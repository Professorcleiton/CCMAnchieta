/**
 * =====================================================================
 *  SIGA v3 — Gestão de Horários e Recursos (laboratório, tablets...)
 * =====================================================================
 *  Cole num arquivo novo do Apps Script chamado "horarios".
 *  As rotas são chamadas pelo doGet/doPost de seguranca.gs.
 *
 *   - ?aba=recursos            → recursos (Lab, Tablet...) e as disciplinas
 *                                 que usam cada um. Qualquer servidor logado.
 *   - POST RECURSOS_SALVAR     → grava as duas listas (nível 4).
 *   - POST SALVAR_GRADE        → substitui o SALVAR_GRADE do Código.gs:
 *        • não apaga mais o professor de apoio nem o local;
 *        • confere conflitos (professor em duas turmas, recurso lotado)
 *          antes de gravar — o usuário pode confirmar e salvar assim mesmo;
 *        • guarda a grade anterior na aba "Horarios_Historico";
 *        • grava tudo de uma vez (bem mais rápido que apagar linha a linha).
 *
 *  Abas criadas sozinhas no primeiro salvamento (podem ser editadas à mão):
 *   "Recursos"             A Recurso | B Turmas ao mesmo tempo | C Observação
 *   "Recursos_Disciplinas" A Disciplina | B Recurso | C Aulas/semana no recurso
 *                          ("Todas" ou um número) | D Séries (vazio = todas)
 * =====================================================================
 */

var HOR_CONFIG = {
  ABA_HORARIOS: 'Horarios',
  ABA_HISTORICO: 'Horarios_Historico',
  ABA_RECURSOS: 'Recursos',
  ABA_RECURSOS_DISC: 'Recursos_Disciplinas',
  DIAS: ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'],
  AULAS: ['1ª', '2ª', '3ª', '4ª', '5ª', '6ª'],
  HORARIOS: {
    'Manhã': ['06:55-07:45', '07:45-08:35', '08:35-09:30', '09:40-10:30', '10:30-11:20', '11:20-12:10'],
    'Tarde': ['12:55-13:45', '13:45-14:35', '14:35-15:30', '15:40-16:30', '16:30-17:20', '17:20-18:10']
  },
  // Usados só enquanto as abas ainda não existem (eram fixos no restrito.html)
  RECURSOS_PADRAO: [
    { recurso: 'Lab. Informática', simultaneas: 1, obs: '' },
    { recurso: 'Tablet', simultaneas: 1, obs: '' }
  ],
  DISCIPLINAS_PADRAO: [
    { disciplina: 'Programação', recurso: 'Lab. Informática', aulas: 'Todas', series: '' },
    { disciplina: 'Robótica', recurso: 'Lab. Informática', aulas: 'Todas', series: '' },
    { disciplina: 'Redação', recurso: 'Lab. Informática', aulas: '1', series: '' },
    { disciplina: 'Inglês', recurso: 'Lab. Informática', aulas: '1', series: '' },
    { disciplina: 'Matemática', recurso: 'Lab. Informática', aulas: '1', series: '' },
    { disciplina: 'Português', recurso: 'Lab. Informática', aulas: '1', series: '' },
    { disciplina: 'REC MAT', recurso: 'Tablet', aulas: '1', series: '' },
    { disciplina: 'REC PORT', recurso: 'Tablet', aulas: '1', series: '' }
  ]
};


// ---------------------------------------------------------------------
//  Recursos
// ---------------------------------------------------------------------
function HOR_lerRecursos_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var abaR = ss.getSheetByName(HOR_CONFIG.ABA_RECURSOS);
  var abaD = ss.getSheetByName(HOR_CONFIG.ABA_RECURSOS_DISC);
  var recursos = [], disciplinas = [];

  if (abaR) {
    abaR.getDataRange().getValues().slice(1).forEach(function (l) {
      var nome = String(l[0] || '').trim();
      if (!nome) return;
      recursos.push({ recurso: nome, simultaneas: Math.max(1, parseInt(l[1], 10) || 1), obs: String(l[2] || '').trim() });
    });
  }
  if (abaD) {
    abaD.getDataRange().getValues().slice(1).forEach(function (l) {
      var disc = String(l[0] || '').trim();
      if (!disc) return;
      disciplinas.push({
        disciplina: disc,
        recurso: String(l[1] || '').trim(),
        aulas: HOR_normalizarAulas_(l[2]),
        series: String(l[3] || '').trim()
      });
    });
  }
  return {
    status: 'success',
    padrao: !abaR && !abaD,
    recursos: abaR ? recursos : HOR_CONFIG.RECURSOS_PADRAO,
    disciplinas: abaD ? disciplinas : HOR_CONFIG.DISCIPLINAS_PADRAO
  };
}

function HOR_normalizarAulas_(v) {
  var t = String(v === undefined || v === null ? '' : v).trim();
  if (!t || /^tod/i.test(t)) return 'Todas';
  var n = parseInt(t, 10);
  return n > 0 ? String(n) : 'Todas';
}

function HOR_salvarRecursos_(sessao, corpo) {
  var recursos = Array.isArray(corpo.recursos) ? corpo.recursos : [];
  var disciplinas = Array.isArray(corpo.disciplinas) ? corpo.disciplinas : [];

  var linhasR = [], vistos = {};
  recursos.forEach(function (r) {
    var nome = String(r.recurso || '').trim().slice(0, 60);
    if (!nome || vistos[nome.toLowerCase()]) return;
    vistos[nome.toLowerCase()] = true;
    linhasR.push([nome, Math.max(1, Math.min(99, parseInt(r.simultaneas, 10) || 1)), String(r.obs || '').trim().slice(0, 200)]);
  });
  if (!linhasR.length) return { status: 'error', message: 'Cadastre pelo menos um recurso.' };

  var linhasD = [], vistasD = {};
  for (var i = 0; i < disciplinas.length; i++) {
    var d = disciplinas[i];
    var disc = String(d.disciplina || '').trim().slice(0, 80);
    var rec = String(d.recurso || '').trim();
    if (!disc) continue;
    if (!vistos[rec.toLowerCase()]) return { status: 'error', message: 'A disciplina "' + disc + '" usa um recurso que não está na lista: ' + rec };
    var chave = (disc + '|' + rec).toLowerCase();
    if (vistasD[chave]) continue;
    vistasD[chave] = true;
    linhasD.push([disc, rec, HOR_normalizarAulas_(d.aulas), String(d.series || '').trim().slice(0, 120)]);
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    HOR_reescreverAba_(HOR_CONFIG.ABA_RECURSOS, ['Recurso', 'Turmas ao mesmo tempo', 'Observação'], linhasR);
    HOR_reescreverAba_(HOR_CONFIG.ABA_RECURSOS_DISC, ['Disciplina', 'Recurso', 'Aulas/semana no recurso', 'Séries (vazio = todas)'], linhasD);
  } finally {
    lock.releaseLock();
  }
  if (typeof SEG_auditar_ === 'function') SEG_auditar_(sessao, 'RECURSOS_SALVAR', linhasR.length + ' recursos, ' + linhasD.length + ' disciplinas');
  return { status: 'success', recursos: linhasR.length, disciplinas: linhasD.length };
}

function HOR_reescreverAba_(nome, cabecalho, linhas) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName(nome) || ss.insertSheet(nome);
  aba.clearContents();
  aba.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]);
  aba.getRange(1, 1, 1, cabecalho.length).setFontWeight('bold');
  if (linhas.length) aba.getRange(2, 1, linhas.length, cabecalho.length).setValues(linhas);
}


// ---------------------------------------------------------------------
//  Salvar a grade de uma turma (substitui o SALVAR_GRADE do Código.gs)
// ---------------------------------------------------------------------
function HOR_norm_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Qual recurso uma célula ocupa ('' = sala comum), pelo texto do "local". */
function HOR_recursoDoLocal_(local, recursos) {
  var l = HOR_norm_(local);
  if (!l || l.indexOf('sala') === 0) return '';
  for (var i = 0; i < recursos.length; i++) {
    if (HOR_norm_(recursos[i].recurso) === l) return recursos[i].recurso;
  }
  // nomes antigos: "Lab", "Laboratório", "Tablets"...
  for (var j = 0; j < recursos.length; j++) {
    var r = HOR_norm_(recursos[j].recurso);
    if ((l.indexOf('lab') === 0 && r.indexOf('lab') === 0) || (l.indexOf('tablet') === 0 && r.indexOf('tablet') === 0)) return recursos[j].recurso;
  }
  return '';
}

/**
 * Confere a grade nova de uma turma contra as outras turmas do mesmo turno.
 * linhasOutras: linhas da aba Horarios (outras turmas); celulas: [{dia, aula, disciplina, professor, local}]
 */
function HOR_conflitos_(turma, turno, celulas, linhasOutras, recursos) {
  var ocupacao = {};   // "dia|aula" → [{turma, professor, recurso}]
  linhasOutras.forEach(function (l) {
    if (String(l[0] || '').trim() !== turno) return;
    var chave = String(l[2] || '').trim() + '|' + String(l[3] || '').trim();
    (ocupacao[chave] = ocupacao[chave] || []).push({
      turma: String(l[1] || '').trim(),
      professor: String(l[6] || '').trim(),
      apoio: String(l[8] || '').trim(),
      recurso: HOR_recursoDoLocal_(l[7], recursos)
    });
  });
  var limite = {};
  recursos.forEach(function (r) { limite[r.recurso] = r.simultaneas; });

  var conflitos = [];
  celulas.forEach(function (c) {
    var outras = ocupacao[c.dia + '|' + c.aula] || [];
    var prof = HOR_norm_(c.professor);
    if (prof) {
      outras.forEach(function (o) {
        if (HOR_norm_(o.professor) === prof || HOR_norm_(o.apoio) === prof) {
          conflitos.push({ tipo: 'professor', dia: c.dia, aula: c.aula, texto: c.professor + ' já tem aula na turma ' + o.turma });
        }
      });
    }
    var rec = HOR_recursoDoLocal_(c.local, recursos);
    if (rec) {
      var usando = outras.filter(function (o) { return o.recurso === rec; });
      if (usando.length >= (limite[rec] || 1)) {
        conflitos.push({ tipo: 'recurso', dia: c.dia, aula: c.aula,
          texto: rec + ' já está com ' + usando.map(function (o) { return o.turma; }).join(', ') });
      }
    }
  });
  return conflitos;
}

function HOR_salvarGrade_(sessao, corpo) {
  var turma = String(corpo.turma || '').trim();
  var turno = String(corpo.turno || '').trim();
  var grade = corpo.grade || {};
  if (!turma || turma.length > 30) return { status: 'error', message: 'Turma inválida.' };
  if (!HOR_CONFIG.HORARIOS[turno]) return { status: 'error', message: 'Turno inválido.' };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName(HOR_CONFIG.ABA_HORARIOS);
  if (!aba) return { status: 'error', message: 'Aba Horarios não encontrada' };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var dados = aba.getDataRange().getValues();
    var largura = Math.max(9, dados[0] ? dados[0].length : 9);
    var cabecalho = dados[0] || ['Turno', 'Turma', 'Dia', 'Aula', 'Horário', 'Disciplina', 'Professor', 'Local', 'Professor Apoio'];
    var daTurma = [], outras = [];
    for (var i = 1; i < dados.length; i++) {
      var l = dados[i];
      while (l.length < largura) l.push('');
      if (!String(l[1] || '').trim()) continue;   // linhas vazias somem
      if (String(l[0] || '').trim() === turno && String(l[1] || '').trim() === turma) daTurma.push(l);
      else outras.push(l);
    }

    // O que já existia em cada horário (para não perder apoio nem colunas extras)
    var antigo = {};
    daTurma.forEach(function (l) { antigo[String(l[2]).trim() + '|' + String(l[3]).trim()] = l; });

    var celulas = [], novas = [];
    HOR_CONFIG.DIAS.forEach(function (dia) {
      HOR_CONFIG.AULAS.forEach(function (aula, idx) {
        var c = grade[dia] && grade[dia][aula];
        if (!c || !String(c.disciplina || '').trim()) return;
        var velho = antigo[dia + '|' + aula];
        var apoio = (c.professor_apoio !== undefined && c.professor_apoio !== null) ? String(c.professor_apoio).trim()
                  : (velho ? String(velho[8] || '').trim() : '');
        var cel = {
          dia: dia, aula: aula,
          disciplina: String(c.disciplina).trim().slice(0, 80),
          professor: String(c.professor || '').trim().slice(0, 80),
          local: String(c.local || '').trim().slice(0, 60)
        };
        celulas.push(cel);
        var linha = [turno, turma, dia, aula, HOR_CONFIG.HORARIOS[turno][idx], cel.disciplina, cel.professor, cel.local, apoio];
        for (var k = 9; k < largura; k++) linha.push(velho ? velho[k] : '');
        novas.push(linha);
      });
    });

    var recursos = HOR_lerRecursos_().recursos;
    var conflitos = HOR_conflitos_(turma, turno, celulas, outras, recursos);
    if (conflitos.length && !corpo.ignorarConflitos) {
      return { status: 'conflito', message: 'Há conflitos com outras turmas.', conflitos: conflitos };
    }

    // Guarda a versão anterior desta turma
    if (daTurma.length) {
      var hist = ss.getSheetByName(HOR_CONFIG.ABA_HISTORICO);
      if (!hist) {
        hist = ss.insertSheet(HOR_CONFIG.ABA_HISTORICO);
        hist.appendRow(['Salvo em', 'Por', 'Turno', 'Turma', 'Dia', 'Aula', 'Horário', 'Disciplina', 'Professor', 'Local', 'Professor Apoio']);
      }
      var quando = new Date();
      var linhasHist = daTurma.map(function (l) { return [quando, sessao.email].concat(l.slice(0, 9)); });
      hist.getRange(hist.getLastRow() + 1, 1, linhasHist.length, 11).setValues(linhasHist);
    }

    // Reescreve a aba de uma vez: outras turmas + esta turma
    var todas = outras.concat(novas);
    var linhasAntes = dados.length - 1;
    if (linhasAntes > 0) aba.getRange(2, 1, linhasAntes, largura).clearContent();
    if (todas.length) aba.getRange(2, 1, todas.length, largura).setValues(todas);
    if (!dados.length) aba.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]);

    if (typeof SEG_auditar_ === 'function') {
      SEG_auditar_(sessao, 'SALVAR_GRADE', turma + ' ' + turno + ' (' + novas.length + ' aulas' + (conflitos.length ? ', ' + conflitos.length + ' conflitos aceitos' : '') + ')');
    }
    return { status: 'success', message: 'Grade salva!', aulas: novas.length, conflitos: conflitos };
  } finally {
    lock.releaseLock();
  }
}
