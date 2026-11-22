/**
 * =====================================================================
 *  SIGA v3 — Virada do Ano Letivo (substitui a "Progressão de Turmas")
 * =====================================================================
 *  Cole num arquivo novo do Apps Script chamado "virada-ano".
 *  As rotas são chamadas pelo doGet/doPost de seguranca.gs (nível 4).
 *
 *  Tudo é editável na tela (incluir e excluir) e fica na planilha:
 *   "Turmas_Ano"         A Ano | B Turma (código) | C Nome | D Série | E Turno | F Destino no ano seguinte | G Ativa
 *                        Destino: código da turma, "EGRESSO" (formandos) ou "ESCOLHA" (cada aluno escolhe: 9º ano)
 *   "Matriz_Curricular"  A Série | B Disciplina | C Aulas por semana | D Observação
 *   "Situacao_Final"     A Ano | B Aluno | C Turma | D Situação | E Destino (só se for diferente da turma) | F Por | G Em
 *                        Situação: Aprovado (padrão), Retido, Transferido, Desistente, Egresso
 *   "Alunos_Historico"   uma linha por aluno a cada virada (turma de cada ano, situação, linha original)
 *   "Virada_Log"         quando, quem, cópia de segurança, números — usado para DESFAZER
 *
 *  Enquanto "Turmas_Ano" e "Matriz_Curricular" não existem, as listas são
 *  montadas a partir das abas Alunos e Horarios do ano atual.
 * =====================================================================
 */

var VIR_CONFIG = {
  ABA_TURMAS: 'Turmas_Ano',
  ABA_MATRIZ: 'Matriz_Curricular',
  ABA_SITUACAO: 'Situacao_Final',
  ABA_HISTORICO: 'Alunos_Historico',
  ABA_LOG: 'Virada_Log',
  SITUACOES: ['Aprovado', 'Retido', 'Transferido', 'Desistente', 'Egresso'],
  DIAS_PARA_DESFAZER: 30,
  // Abas que podem ser arquivadas (copiadas para "Nome_2026" e esvaziadas) na virada
  ARQUIVAVEIS: {
    impressoes: ['Controle_Impressoes'],
    preConselho: ['Pre_Conselho'],
    frequenciometro: ['Sorteios', 'Frequenciometro_Trimestres', 'HistoricoGeral']
  }
};


// ---------------------------------------------------------------------
//  Utilidades
// ---------------------------------------------------------------------
function VIR_anoAtual_() {
  var prop = parseInt(PropertiesService.getScriptProperties().getProperty('ANO_LETIVO'), 10);
  return isNaN(prop) ? new Date().getFullYear() : prop;
}
function VIR_txt_(v) { return String(v === null || v === undefined ? '' : v).trim(); }
function VIR_cod_(v) { return VIR_txt_(v).toUpperCase().replace(/\s+/g, ''); }
function VIR_norm_(s) {
  return VIR_txt_(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').toLowerCase();
}
function VIR_aba_(nome, cabecalho) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName(nome);
  if (!aba && cabecalho) {
    aba = ss.insertSheet(nome);
    aba.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]);
  }
  return aba;
}
function VIR_linhas_(nome) {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nome);
  return aba ? aba.getDataRange().getValues() : [];
}
function VIR_reescrever_(aba, linhas, largura) {
  var total = aba.getLastRow();
  if (total > 1) aba.getRange(2, 1, total - 1, largura).clearContent();
  if (linhas.length) aba.getRange(2, 1, linhas.length, largura).setValues(linhas);
}

/** Série pelo código: 6A → "6", 3ANEM → "3NEM", 1AGRO → "1AGRO". */
function VIR_serie_(codigo) {
  var c = VIR_cod_(codigo);
  var m = c.match(/^(\d)(NEM|FD|AGRO)$/) || c.match(/^(\d)[A-Z](NEM|FD|AGRO)$/) || c.match(/^(\d)([A-Z]{2,})$/);
  if (m) return m[1] + m[2];
  m = c.match(/^(\d)[A-Z]?$/);
  return m ? m[1] : c;
}

/** Destino sugerido: 6A → 7A; 9º → ESCOLHA; 3º do médio → EGRESSO; 1NEM → 2NEM. */
function VIR_destinoSugerido_(codigo) {
  var c = VIR_cod_(codigo), m;
  if ((m = c.match(/^(\d)([A-Z])$/))) {
    var n = parseInt(m[1], 10);
    return n >= 9 ? 'ESCOLHA' : (n + 1) + m[2];
  }
  if ((m = c.match(/^(\d)([A-Z]?)(NEM|FD|AGRO)$/))) {
    var s = parseInt(m[1], 10);
    return s >= 3 ? 'EGRESSO' : (s + 1) + m[2] + m[3];
  }
  return '';
}

function VIR_nomeSugerido_(codigo) {
  var c = VIR_cod_(codigo), m;
  if ((m = c.match(/^(\d)([A-Z])$/))) return m[1] + 'º Ano ' + m[2];
  if ((m = c.match(/^(\d)([A-Z]?)(NEM|FD|AGRO)$/))) return m[1] + 'º Ano ' + (m[2] ? m[2] + ' ' : '') + m[3];
  return c;
}

function VIR_maisComum_(lista) {
  var conta = {}, melhor = '', max = 0;
  lista.forEach(function (v) { if (!v) return; conta[v] = (conta[v] || 0) + 1; if (conta[v] > max) { max = conta[v]; melhor = v; } });
  return melhor;
}


// ---------------------------------------------------------------------
//  Leituras
// ---------------------------------------------------------------------
function VIR_lerAlunos_() {
  var dados = VIR_linhas_('Alunos');
  var lista = [];
  for (var i = 1; i < dados.length; i++) {
    var nome = VIR_txt_(dados[i][1]);
    if (!nome) continue;
    lista.push({ id: VIR_txt_(dados[i][0]), nome: nome, turma: VIR_txt_(dados[i][2]), codigo: VIR_cod_(dados[i][3]) });
  }
  return lista;
}

function VIR_lerTurmasSalvas_(ano) {
  var dados = VIR_linhas_(VIR_CONFIG.ABA_TURMAS), lista = [];
  for (var i = 1; i < dados.length; i++) {
    if (parseInt(dados[i][0], 10) !== ano || !VIR_cod_(dados[i][1])) continue;
    lista.push({
      codigo: VIR_cod_(dados[i][1]), nome: VIR_txt_(dados[i][2]), serie: VIR_txt_(dados[i][3]) || VIR_serie_(dados[i][1]),
      turno: VIR_txt_(dados[i][4]), destino: VIR_cod_(dados[i][5]), ativa: !/^n/i.test(VIR_txt_(dados[i][6]))
    });
  }
  return lista;
}

/** Turmas do ano atual: salvas ou montadas a partir de Alunos + Horarios. */
function VIR_turmasAtuais_(alunos, horarios) {
  var ano = VIR_anoAtual_();
  var salvas = VIR_lerTurmasSalvas_(ano);
  if (salvas.length) return { salvas: true, turmas: salvas };
  var info = {};
  alunos.forEach(function (a) {
    if (!a.codigo) return;
    var t = info[a.codigo] = info[a.codigo] || { nomes: [], turnos: [] };
    t.nomes.push(a.turma);
  });
  for (var i = 1; i < horarios.length; i++) {
    var c = VIR_cod_(horarios[i][1]);
    if (!c) continue;
    var t2 = info[c] = info[c] || { nomes: [], turnos: [] };
    t2.turnos.push(VIR_txt_(horarios[i][0]));
  }
  var turmas = Object.keys(info).sort(VIR_ordemTurma_).map(function (c) {
    var nome = VIR_maisComum_(info[c].nomes);
    return { codigo: c, nome: nome && nome !== c ? nome : VIR_nomeSugerido_(c), serie: VIR_serie_(c),
             turno: VIR_maisComum_(info[c].turnos), destino: VIR_destinoSugerido_(c), ativa: true };
  });
  return { salvas: false, turmas: turmas };
}

/** Turmas do ano seguinte: salvas ou sugeridas pelos destinos. */
function VIR_turmasProximas_(atuais) {
  var prox = VIR_anoAtual_() + 1;
  var salvas = VIR_lerTurmasSalvas_(prox);
  if (salvas.length) return { salvas: true, turmas: salvas };
  var turnoAtual = {}, vistos = {}, turmas = [];
  atuais.forEach(function (t) { turnoAtual[t.codigo] = t.turno; });
  // 6º ano entra com turmas novas: mesmas letras do 6º atual
  atuais.forEach(function (t) {
    if (/^6[A-Z]$/.test(t.codigo) && !vistos[t.codigo]) {
      vistos[t.codigo] = true;
      turmas.push({ codigo: t.codigo, nome: t.nome, serie: '6', turno: t.turno, destino: VIR_destinoSugerido_(t.codigo), ativa: true });
    }
  });
  atuais.forEach(function (t) {
    var d = t.destino;
    if (!d || d === 'EGRESSO' || d === 'ESCOLHA' || vistos[d]) return;
    vistos[d] = true;
    turmas.push({ codigo: d, nome: VIR_nomeSugerido_(d), serie: VIR_serie_(d), turno: turnoAtual[d] || t.turno, destino: VIR_destinoSugerido_(d), ativa: true });
  });
  // 1º ano do médio recebe o 9º (ESCOLHA): mantém os 1º anos que já existem
  atuais.forEach(function (t) {
    if (/^1[A-Z]?(NEM|FD|AGRO)$/.test(t.codigo) && !vistos[t.codigo]) {
      vistos[t.codigo] = true;
      turmas.push({ codigo: t.codigo, nome: t.nome, serie: VIR_serie_(t.codigo), turno: t.turno, destino: VIR_destinoSugerido_(t.codigo), ativa: true });
    }
  });
  turmas.sort(function (a, b) { return VIR_ordemTurma_(a.codigo, b.codigo); });
  return { salvas: false, turmas: turmas };
}

function VIR_ordemTurma_(a, b) {
  var chave = function (c) {
    var medio = /(NEM|FD|AGRO)$/.test(c) ? 1 : 0;
    return medio + '|' + c;
  };
  return chave(a) < chave(b) ? -1 : chave(a) > chave(b) ? 1 : 0;
}

/** Matriz curricular: salva ou calculada pela grade do ano (aulas por disciplina em cada série). */
function VIR_matriz_(horarios) {
  var dados = VIR_linhas_(VIR_CONFIG.ABA_MATRIZ);
  if (dados.length > 1) {
    var salvas = [];
    for (var i = 1; i < dados.length; i++) {
      if (!VIR_txt_(dados[i][0]) || !VIR_txt_(dados[i][1])) continue;
      salvas.push({ serie: VIR_txt_(dados[i][0]), disciplina: VIR_txt_(dados[i][1]), aulas: parseInt(dados[i][2], 10) || 0, obs: VIR_txt_(dados[i][3]) });
    }
    return { salva: true, linhas: salvas };
  }
  var porTurma = {}, turmasDaSerie = {};
  for (var j = 1; j < horarios.length; j++) {
    var turma = VIR_cod_(horarios[j][1]), disc = VIR_txt_(horarios[j][5]);
    if (!turma || !disc) continue;
    var serie = VIR_serie_(turma);
    (turmasDaSerie[serie] = turmasDaSerie[serie] || {})[turma] = true;
    var k = serie + '|' + disc;
    porTurma[k] = porTurma[k] || {};
    porTurma[k][turma] = (porTurma[k][turma] || 0) + 1;
  }
  var linhas = Object.keys(porTurma).map(function (k) {
    var p = k.split('|'), contagens = porTurma[k];
    var valores = Object.keys(contagens).map(function (t) { return contagens[t]; });
    var aulas = parseInt(VIR_maisComum_(valores.map(String)), 10);
    var total = Object.keys(turmasDaSerie[p[0]]).length;
    var obs = [];
    if (valores.length < total) obs.push('em ' + valores.length + ' de ' + total + ' turmas');
    var diferentes = Object.keys(contagens).filter(function (t) { return contagens[t] !== aulas; });
    if (diferentes.length) obs.push('diferente em ' + diferentes.map(function (t) { return t + ' (' + contagens[t] + ')'; }).join(', '));
    return { serie: p[0], disciplina: p[1], aulas: aulas, obs: obs.join('; ') };
  });
  linhas.sort(function (a, b) {
    return VIR_ordemTurma_(a.serie, b.serie) || a.disciplina.localeCompare(b.disciplina);
  });
  return { salva: false, linhas: linhas };
}

function VIR_lerSituacoes_(ano) {
  var dados = VIR_linhas_(VIR_CONFIG.ABA_SITUACAO), mapa = {};
  for (var i = 1; i < dados.length; i++) {
    if (parseInt(dados[i][0], 10) !== ano) continue;
    var nome = VIR_txt_(dados[i][1]);
    if (!nome) continue;
    mapa[VIR_norm_(nome) + '|' + VIR_cod_(dados[i][2])] = {
      nome: nome, turma: VIR_cod_(dados[i][2]), situacao: VIR_txt_(dados[i][3]) || 'Aprovado', destino: VIR_cod_(dados[i][4])
    };
  }
  return mapa;
}

function VIR_ultimaVirada_() {
  var dados = VIR_linhas_(VIR_CONFIG.ABA_LOG);
  for (var i = dados.length - 1; i >= 1; i--) {
    if (!dados[i][0]) continue;
    return { linha: i + 1, id: VIR_txt_(dados[i][0]), em: dados[i][1], por: VIR_txt_(dados[i][2]),
             de: parseInt(dados[i][3], 10), para: parseInt(dados[i][4], 10), backup: VIR_txt_(dados[i][5]),
             resumo: VIR_txt_(dados[i][6]), arquivadas: VIR_txt_(dados[i][7]), status: VIR_txt_(dados[i][8]) };
  }
  return null;
}


// ---------------------------------------------------------------------
//  Rotas
// ---------------------------------------------------------------------
/** GET ?aba=virada_dados — tudo que o assistente precisa. */
function VIR_dados_() {
  var horarios = VIR_linhas_('Horarios');
  var alunos = VIR_lerAlunos_();
  var atuais = VIR_turmasAtuais_(alunos, horarios);
  var proximas = VIR_turmasProximas_(atuais.turmas);
  var ano = VIR_anoAtual_();
  var sit = VIR_lerSituacoes_(ano);
  var ultima = VIR_ultimaVirada_();
  if (ultima && ultima.em instanceof Date) ultima.em = ultima.em.toISOString();
  return {
    status: 'success',
    anoAtual: ano, proximoAno: ano + 1,
    turmasAtuais: atuais.turmas, turmasAtuaisSalvas: atuais.salvas,
    turmasProximas: proximas.turmas, turmasProximasSalvas: proximas.salvas,
    matriz: VIR_matriz_(horarios),
    alunos: alunos.map(function (a) { return { nome: a.nome, codigo: a.codigo, turma: a.turma }; }),
    situacoes: Object.keys(sit).map(function (k) { return sit[k]; }),
    situacoesPossiveis: VIR_CONFIG.SITUACOES,
    ultimaVirada: ultima,
    podeDesfazer: VIR_podeDesfazer_(ultima)
  };
}

/** GET ?aba=planejamento_ano — usado pela Gestão de Horários (turmas e matriz). */
function VIR_planejamento_() {
  var horarios = VIR_linhas_('Horarios');
  var ano = VIR_anoAtual_();
  return { status: 'success', anoAtual: ano, turmas: VIR_lerTurmasSalvas_(ano), turmasProximas: VIR_lerTurmasSalvas_(ano + 1), matriz: VIR_matriz_(horarios) };
}

function VIR_validarTurmas_(lista) {
  var saida = [], vistos = {};
  for (var i = 0; i < lista.length; i++) {
    var t = lista[i] || {};
    var c = VIR_cod_(t.codigo);
    if (!c) continue;
    if (!/^[A-Z0-9]{1,12}$/.test(c)) return { erro: 'Código de turma inválido: ' + t.codigo };
    if (vistos[c]) return { erro: 'Turma repetida: ' + c };
    vistos[c] = true;
    var turno = VIR_txt_(t.turno);
    saida.push({ codigo: c, nome: VIR_txt_(t.nome).slice(0, 60) || VIR_nomeSugerido_(c), serie: VIR_txt_(t.serie).slice(0, 12) || VIR_serie_(c),
                 turno: turno === 'Manhã' || turno === 'Tarde' ? turno : '', destino: VIR_cod_(t.destino).slice(0, 12), ativa: t.ativa !== false });
  }
  return { turmas: saida };
}

/** POST VIRADA_SALVAR_TURMAS { ano, turmas:[...] } — substitui as turmas daquele ano. */
function VIR_salvarTurmas_(sessao, corpo) {
  var ano = parseInt(corpo.ano, 10), atual = VIR_anoAtual_();
  if (ano !== atual && ano !== atual + 1) return { status: 'error', message: 'Só dá para editar ' + atual + ' e ' + (atual + 1) + '.' };
  var v = VIR_validarTurmas_(Array.isArray(corpo.turmas) ? corpo.turmas : []);
  if (v.erro) return { status: 'error', message: v.erro };
  var cab = ['Ano', 'Turma', 'Nome', 'Série', 'Turno', 'Destino no ano seguinte', 'Ativa'];
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var aba = VIR_aba_(VIR_CONFIG.ABA_TURMAS, cab);
    var dados = aba.getDataRange().getValues();
    var outras = dados.slice(1).filter(function (l) { return VIR_txt_(l[0]) && parseInt(l[0], 10) !== ano; });
    var novas = v.turmas.map(function (t) { return [ano, t.codigo, t.nome, t.serie, t.turno, t.destino, t.ativa ? 'Sim' : 'Não']; });
    VIR_reescrever_(aba, outras.concat(novas).map(function (l) { return l.slice(0, 7); }), 7);
  } finally { lock.releaseLock(); }
  if (typeof SEG_auditar_ === 'function') SEG_auditar_(sessao, 'VIRADA_SALVAR_TURMAS', ano + ': ' + v.turmas.length + ' turmas');
  return { status: 'success', turmas: v.turmas.length };
}

/** POST VIRADA_SALVAR_MATRIZ { linhas:[{serie, disciplina, aulas, obs}] } */
function VIR_salvarMatriz_(sessao, corpo) {
  var linhas = [], vistos = {};
  (Array.isArray(corpo.linhas) ? corpo.linhas : []).forEach(function (l) {
    var serie = VIR_txt_(l.serie).slice(0, 12), disc = VIR_txt_(l.disciplina).slice(0, 80);
    if (!serie || !disc) return;
    var k = VIR_norm_(serie) + '|' + VIR_norm_(disc);
    if (vistos[k]) return;
    vistos[k] = true;
    linhas.push([serie, disc, Math.max(0, Math.min(30, parseInt(l.aulas, 10) || 0)), VIR_txt_(l.obs).slice(0, 200)]);
  });
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var aba = VIR_aba_(VIR_CONFIG.ABA_MATRIZ, ['Série', 'Disciplina', 'Aulas por semana', 'Observação']);
    VIR_reescrever_(aba, linhas, 4);
  } finally { lock.releaseLock(); }
  if (typeof SEG_auditar_ === 'function') SEG_auditar_(sessao, 'VIRADA_SALVAR_MATRIZ', linhas.length + ' linhas');
  return { status: 'success', linhas: linhas.length };
}

/** POST VIRADA_SALVAR_SITUACOES { itens:[{nome, turma, situacao, destino}] } — só o que foge do padrão precisa vir. */
function VIR_salvarSituacoes_(sessao, corpo) {
  var ano = VIR_anoAtual_();
  var itens = Array.isArray(corpo.itens) ? corpo.itens : [];
  var linhas = [], agora = new Date();
  for (var i = 0; i < itens.length; i++) {
    var it = itens[i] || {};
    var sit = VIR_txt_(it.situacao) || 'Aprovado';
    if (VIR_CONFIG.SITUACOES.indexOf(sit) === -1) return { status: 'error', message: 'Situação inválida: ' + sit };
    if (!VIR_txt_(it.nome)) continue;
    linhas.push([ano, VIR_txt_(it.nome), VIR_cod_(it.turma), sit, VIR_cod_(it.destino), sessao.email, agora]);
  }
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var aba = VIR_aba_(VIR_CONFIG.ABA_SITUACAO, ['Ano', 'Aluno', 'Turma', 'Situação', 'Destino', 'Por', 'Em']);
    var outras = aba.getDataRange().getValues().slice(1).filter(function (l) { return VIR_txt_(l[0]) && parseInt(l[0], 10) !== ano; });
    VIR_reescrever_(aba, outras.map(function (l) { return l.slice(0, 7); }).concat(linhas), 7);
  } finally { lock.releaseLock(); }
  if (typeof SEG_auditar_ === 'function') SEG_auditar_(sessao, 'VIRADA_SALVAR_SITUACOES', linhas.length + ' alunos');
  return { status: 'success', alunos: linhas.length };
}

/**
 * Calcula o que acontece com cada aluno (usado pela prévia e pela execução).
 * Devolve { novos: [{linhaOriginal, destino, situacao}], saidas, pendencias, porTurma }
 */
function VIR_planejar_(linhasAlunos, turmasAtuais, turmasProximas, situacoes) {
  var destinoTurma = {}, codigosProx = {};
  turmasAtuais.forEach(function (t) { destinoTurma[t.codigo] = t.destino; });
  turmasProximas.forEach(function (t) { if (t.ativa !== false) codigosProx[t.codigo] = t; });
  var res = { alunos: [], pendencias: [], porTurma: {}, contagem: { Aprovado: 0, Retido: 0, Transferido: 0, Desistente: 0, Egresso: 0 } };
  for (var i = 1; i < linhasAlunos.length; i++) {
    var l = linhasAlunos[i], nome = VIR_txt_(l[1]);
    if (!nome) continue;
    var cod = VIR_cod_(l[3]);
    var s = situacoes[VIR_norm_(nome) + '|' + cod] || {};
    var padraoTurma = destinoTurma[cod];
    var sit = s.situacao || (padraoTurma === 'EGRESSO' ? 'Egresso' : 'Aprovado');
    var destino = '';
    if (sit === 'Aprovado') destino = s.destino || padraoTurma || '';
    else if (sit === 'Retido') destino = s.destino || cod;
    if (destino === 'EGRESSO') { sit = 'Egresso'; destino = ''; }
    if (sit === 'Aprovado' || sit === 'Retido') {
      if (!destino || destino === 'ESCOLHA') res.pendencias.push(nome + ' (' + (cod || 'sem turma') + '): escolher a turma de destino');
      else if (!codigosProx[destino]) res.pendencias.push(nome + ' (' + cod + '): a turma ' + destino + ' não está na lista de turmas do ano seguinte');
      else res.porTurma[destino] = (res.porTurma[destino] || 0) + 1;
    }
    res.contagem[sit] = (res.contagem[sit] || 0) + 1;
    res.alunos.push({ indice: i, nome: nome, de: cod, situacao: sit, destino: destino });
  }
  return res;
}

function VIR_podeDesfazer_(ultima) {
  if (!ultima || ultima.status !== 'feita') return false;
  var em = ultima.em instanceof Date ? ultima.em : new Date(ultima.em);
  return (Date.now() - em.getTime()) < VIR_CONFIG.DIAS_PARA_DESFAZER * 86400000;
}

/** POST VIRADA_EXECUTAR { confirmar: "2027", arquivar: {impressoes, preConselho, frequenciometro} } */
function VIR_executar_(sessao, corpo) {
  var ano = VIR_anoAtual_(), prox = ano + 1;
  if (VIR_txt_(corpo.confirmar) !== String(prox)) return { status: 'error', message: 'Digite ' + prox + ' para confirmar.' };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var abaAlunos = ss.getSheetByName('Alunos');
    if (!abaAlunos) return { status: 'error', message: 'Aba Alunos não encontrada.' };
    var linhas = abaAlunos.getDataRange().getValues();
    var largura = Math.max(4, linhas[0] ? linhas[0].length : 4);
    var horarios = VIR_linhas_('Horarios');
    var atuais = VIR_turmasAtuais_(VIR_lerAlunos_(), horarios);
    if (!atuais.salvas) return { status: 'error', message: 'Salve antes a lista de turmas de ' + ano + ' com os destinos (passo 1).' };
    var proximas = VIR_lerTurmasSalvas_(prox);
    if (!proximas.length) return { status: 'error', message: 'Salve antes a lista de turmas de ' + prox + ' (passo 2).' };
    var plano = VIR_planejar_(linhas, atuais.turmas, proximas, VIR_lerSituacoes_(ano));
    if (plano.pendencias.length) return { status: 'pendencias', message: 'Há alunos sem destino.', pendencias: plano.pendencias };

    // 1) Cópia de segurança da planilha inteira no Drive
    var backup = '';
    try {
      var copia = DriveApp.getFileById(ss.getId()).makeCopy('SIGA - cópia antes da virada ' + ano + '→' + prox + ' - ' +
        Utilities.formatDate(new Date(), 'GMT-3', 'dd-MM-yyyy HH.mm'));
      backup = copia.getUrl();
    } catch (e) {
      if (!corpo.semCopia) return { status: 'error', message: 'Não foi possível criar a cópia de segurança: ' + e.message };
    }

    // 2) Histórico: a turma de cada aluno neste ano e o que aconteceu
    var id = 'V' + new Date().getTime();
    var agora = new Date();
    var hist = VIR_aba_(VIR_CONFIG.ABA_HISTORICO, ['Virada', 'Ano letivo', 'aluno_id', 'Aluno', 'Turma', 'Código', 'Situação', 'Destino', 'Em', 'Linha original']);
    var nomesProx = {};
    proximas.forEach(function (t) { nomesProx[t.codigo] = t.nome; });
    var linhasHist = [], novasAlunos = [];
    plano.alunos.forEach(function (a) {
      var l = linhas[a.indice];
      while (l.length < largura) l.push('');
      linhasHist.push([id, ano, l[0], l[1], l[2], l[3], a.situacao, a.destino, agora, JSON.stringify(l.slice(0, largura))]);
      if (a.destino) {
        var nova = l.slice(0, largura);
        nova[2] = nomesProx[a.destino] || a.destino;
        nova[3] = a.destino;
        novasAlunos.push(nova);
      }
    });
    if (linhasHist.length) hist.getRange(hist.getLastRow() + 1, 1, linhasHist.length, 10).setValues(linhasHist);

    // 3) Alunos do ano novo (egressos, transferidos e desistentes saem da lista)
    if (linhas.length > 1) abaAlunos.getRange(2, 1, linhas.length - 1, largura).clearContent();
    if (novasAlunos.length) abaAlunos.getRange(2, 1, novasAlunos.length, largura).setValues(novasAlunos);

    // 4) Arquivar contadores do ano (impressões, pré-conselho, frequenciômetro)
    var arquivadas = VIR_arquivar_(corpo.arquivar || {}, ano);

    // 5) Turmas de cada professor se refazem; ano letivo novo
    if (typeof HOR_limparTurmasProfessor_ === 'function') HOR_limparTurmasProfessor_(null);
    PropertiesService.getScriptProperties().setProperty('ANO_LETIVO', String(prox));
    try { CacheService.getScriptCache().remove('freq_publico'); } catch (e) { /* sem cache */ }

    var c = plano.contagem;
    var resumo = 'Aprovados ' + c.Aprovado + ', retidos ' + c.Retido + ', egressos ' + c.Egresso + ', transferidos ' + c.Transferido + ', desistentes ' + c.Desistente;
    var log = VIR_aba_(VIR_CONFIG.ABA_LOG, ['Virada', 'Em', 'Por', 'De', 'Para', 'Cópia de segurança', 'Resumo', 'Abas arquivadas', 'Status']);
    log.appendRow([id, agora, sessao.email, ano, prox, backup, resumo, JSON.stringify(arquivadas), 'feita']);
    if (typeof SEG_auditar_ === 'function') SEG_auditar_(sessao, 'VIRADA_EXECUTAR', ano + '→' + prox + ': ' + resumo);
    return { status: 'success', anoNovo: prox, contagem: c, alunosNoAnoNovo: novasAlunos.length, backup: backup, arquivadas: arquivadas, porTurma: plano.porTurma };
  } finally { lock.releaseLock(); }
}

/** Copia cada aba escolhida para "Nome_2026" e deixa só o cabeçalho na original. */
function VIR_arquivar_(escolhas, ano) {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), feitas = [];
  Object.keys(VIR_CONFIG.ARQUIVAVEIS).forEach(function (grupo) {
    if (!escolhas[grupo]) return;
    VIR_CONFIG.ARQUIVAVEIS[grupo].forEach(function (nome) {
      var aba = ss.getSheetByName(nome);
      if (!aba) return;
      var dados = aba.getDataRange().getValues();
      if (dados.length < 2) return;
      var destino = nome + '_' + ano, n = 2;
      while (ss.getSheetByName(destino)) destino = nome + '_' + ano + '_' + (n++);
      var arq = ss.insertSheet(destino);
      arq.getRange(1, 1, dados.length, dados[0].length).setValues(dados);
      aba.getRange(2, 1, dados.length - 1, dados[0].length).clearContent();
      feitas.push({ aba: nome, arquivo: destino, linhas: dados.length - 1 });
    });
  });
  return feitas;
}

/** POST VIRADA_DESFAZER — volta a lista de alunos, as abas arquivadas e o ano letivo. */
function VIR_desfazer_(sessao) {
  var ultima = VIR_ultimaVirada_();
  if (!VIR_podeDesfazer_(ultima)) return { status: 'error', message: 'Não há virada recente para desfazer (prazo de ' + VIR_CONFIG.DIAS_PARA_DESFAZER + ' dias).' };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var hist = ss.getSheetByName(VIR_CONFIG.ABA_HISTORICO);
    var dadosH = hist ? hist.getDataRange().getValues() : [];
    var originais = [], restantes = [dadosH[0]], daVirada = {};
    for (var i = 1; i < dadosH.length; i++) {
      if (VIR_txt_(dadosH[i][0]) === ultima.id) {
        daVirada[VIR_norm_(dadosH[i][3])] = true;
        try { originais.push(JSON.parse(dadosH[i][9])); } catch (e) { return { status: 'error', message: 'Histórico corrompido na linha ' + (i + 1) + '. Use a cópia de segurança.' }; }
      } else if (VIR_txt_(dadosH[i][0])) restantes.push(dadosH[i]);
    }
    if (!originais.length) return { status: 'error', message: 'Não achei os alunos desta virada no histórico. Use a cópia de segurança: ' + ultima.backup };

    var abaAlunos = ss.getSheetByName('Alunos');
    var atuais = abaAlunos.getDataRange().getValues();
    var largura = Math.max(atuais[0].length, originais[0].length);
    var preencher = function (l) { l = l.slice(0, largura); while (l.length < largura) l.push(''); return l; };
    // alunos cadastrados DEPOIS da virada (ex.: 6º ano novo) continuam na lista
    var novosDepois = atuais.slice(1).filter(function (l) { return VIR_txt_(l[1]) && !daVirada[VIR_norm_(l[1])]; });
    var lista = originais.concat(novosDepois).map(preencher);
    if (atuais.length > 1) abaAlunos.getRange(2, 1, atuais.length - 1, largura).clearContent();
    abaAlunos.getRange(2, 1, lista.length, largura).setValues(lista);

    // histórico sem as linhas desta virada
    VIR_reescrever_(hist, restantes.slice(1).map(function (l) { return l.slice(0, 10); }), 10);

    // abas arquivadas voltam (linhas arquivadas + o que entrou depois)
    var arquivadas = [];
    try { arquivadas = JSON.parse(ultima.arquivadas || '[]'); } catch (e) { arquivadas = []; }
    arquivadas.forEach(function (a) {
      var arq = ss.getSheetByName(a.arquivo), orig = ss.getSheetByName(a.aba);
      if (!arq || !orig) return;
      var velhas = arq.getDataRange().getValues();
      var novas = orig.getDataRange().getValues().slice(1).filter(function (l) { return l.join('') !== ''; });
      var todas = velhas.slice(1).concat(novas);
      var w = velhas[0].length;
      if (orig.getLastRow() > 1) orig.getRange(2, 1, orig.getLastRow() - 1, w).clearContent();
      if (todas.length) orig.getRange(2, 1, todas.length, w).setValues(todas.map(function (l) { l = l.slice(0, w); while (l.length < w) l.push(''); return l; }));
      ss.deleteSheet(arq);
    });

    PropertiesService.getScriptProperties().setProperty('ANO_LETIVO', String(ultima.de));
    if (typeof HOR_limparTurmasProfessor_ === 'function') HOR_limparTurmasProfessor_(null);
    ss.getSheetByName(VIR_CONFIG.ABA_LOG).getRange(ultima.linha, 9).setValue('desfeita em ' + Utilities.formatDate(new Date(), 'GMT-3', 'dd/MM/yyyy HH:mm') + ' por ' + sessao.email);
    if (typeof SEG_auditar_ === 'function') SEG_auditar_(sessao, 'VIRADA_DESFAZER', ultima.id);
    return { status: 'success', alunos: originais.length, mantidos: novosDepois.length, anoLetivo: ultima.de };
  } finally { lock.releaseLock(); }
}
