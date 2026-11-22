/**
 * =====================================================================
 *  SIGA v3 — Dados do Frequenciômetro (TV da escola)
 * =====================================================================
 *  Cole num arquivo novo do Apps Script chamado "frequenciometro".
 *
 *  Substitui a planilha "publicada na web", que deixava a LISTA DE TODOS
 *  OS ALUNOS (nome, ID e turma) aberta para qualquer pessoa.
 *
 *   - ?aba=frequenciometro          → PÚBLICO: % por turma, histórico e trimestres
 *                                     (números agregados, ninguém é identificado)
 *   - ?aba=frequenciometro_alunos   → SÓ COM A CHAVE DA TV: nomes para o sorteio
 *   - POST SORTEIO_REGISTRAR / SORTEIO_DESMARCAR / SORTEIO_LIMPAR
 *                                   → SÓ COM A CHAVE DA TV: histórico na aba "Sorteios"
 *
 *  CONFIGURAÇÃO (uma vez, pelo editor do Apps Script):
 *   1. Execute FREQ_diagnosticar: o registro mostra se as abas foram achadas.
 *   2. Execute FREQ_gerarChaveTV: o registro mostra o endereço para abrir na TV.
 *   3. Execute FREQ_instalarFechamentoSemanal: fecha a semana sozinho toda sexta.
 *
 *  ATUALIZAÇÃO SEMANAL (sem abrir a planilha):
 *   SIGA → "Frequência da Semana" (nível 3+): digitar ou colar as % das turmas.
 *   Toda sexta às 18h, se os números foram atualizados na semana, a média da
 *   escola entra sozinha no HistoricoGeral como a próxima semana.
 * =====================================================================
 */

var FREQ_CONFIG = {
  // '' = esta mesma planilha do SIGA (é onde as abas estão agora).
  PLANILHA_ID: '',

  // Nomes das abas (procuradas pelo nome; o gid antigo fica como reserva)
  ABA_FREQUENCIA: 'frequencia',   // A = Turma, B = Frequência, C = Bloco, D = Troféus, E = Código
  ABA_ALUNOS: 'Alunos',           // A = aluno_id, B = nome_aluno, C = turma_ref, D = turma_codigo
  ABA_HISTORICO: 'HistoricoGeral',// A = Semana, B = Media
  GID_FREQUENCIA: 1746538498,
  GID_ALUNOS: 1866544411,
  GID_HISTORICO: 541390615,

  ABA_TRIMESTRES: 'Frequenciometro_Trimestres', // criada automaticamente nesta planilha
  ABA_SORTEIOS: 'Sorteios',                     // criada automaticamente nesta planilha
  CACHE_SEGUNDOS: 120
};


// ---------------------------------------------------------------------
//  Rotas (chamadas pelo doGet/doPost de seguranca.gs)
// ---------------------------------------------------------------------
function FREQ_dadosPublicos_() {
  var cache = CacheService.getScriptCache();
  var c = cache.get('freq_publico');
  if (c) return JSON.parse(c);

  var ss = FREQ_planilha_();
  var turmas = FREQ_lerTurmas_();
  var historico = [['Semana', 'Media']].concat(FREQ_lerHistorico_().map(function (h) { return [String(h.semana), FREQ_fmt_(h.media)]; }));
  var medias = FREQ_mediasPorTurno_(turmas);
  if (medias.escola !== null) historico.push(['Esta', FREQ_fmt_(medias.escola)]);   // semana em andamento, sempre calculada
  var resposta = {
    status: 'success',
    atualizadoEm: Utilities.formatDate(new Date(), 'GMT-3', 'dd/MM/yyyy HH:mm'),
    frequencia: FREQ_linhas_(ss, 'frequencia', 4),
    historico: historico,
    medias: medias,        // escola / manha / tarde (Σ presenças ÷ Σ aulas)
    trimestres: FREQ_trimestres_()
  };
  cache.put('freq_publico', JSON.stringify(resposta), FREQ_CONFIG.CACHE_SEGUNDOS);
  return resposta;
}

function FREQ_dadosAlunos_(chave) {
  if (!FREQ_chaveValida_(chave)) return { status: 'unauthorized', message: 'Chave da TV inválida.' };
  return {
    status: 'success',
    alunos: FREQ_linhas_(FREQ_planilha_(), 'alunos', 4),
    sorteados: FREQ_sorteadosAtivos_()
  };
}

function FREQ_post_(corpo) {
  if (!FREQ_chaveValida_(corpo.chave)) return { status: 'unauthorized', message: 'Chave da TV inválida.' };
  var op = corpo.operacao;
  var nome = String(corpo.nome || '').trim().substring(0, 150);
  var turma = String(corpo.turma || '').trim().substring(0, 60);

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var aba = FREQ_abaSorteios_();
    if (op === 'SORTEIO_REGISTRAR') {
      if (!nome) return { status: 'error', message: 'Nome vazio.' };
      var origem = corpo.origem === 'manual' ? 'manual' : 'sorteio';
      aba.appendRow([new Date(), turma, nome, origem, 'SIM']);
      return { status: 'success' };
    }
    if (op === 'SORTEIO_DESMARCAR' || op === 'SORTEIO_LIMPAR') {
      var dados = aba.getDataRange().getValues();
      var n = 0;
      for (var i = 1; i < dados.length; i++) {
        if (String(dados[i][4]).toUpperCase() !== 'SIM') continue;
        var bate = op === 'SORTEIO_DESMARCAR'
          ? String(dados[i][2]).trim() === nome
          : (!turma || String(dados[i][1]).trim() === turma);
        if (bate) { aba.getRange(i + 1, 5).setValue('NAO'); n++; }
      }
      return { status: 'success', alterados: n };
    }
    return { status: 'error', message: 'Operação desconhecida.' };
  } finally {
    lock.releaseLock();
  }
}


// ---------------------------------------------------------------------
//  Leitura das abas
// ---------------------------------------------------------------------
function FREQ_planilha_() {
  return FREQ_CONFIG.PLANILHA_ID
    ? SpreadsheetApp.openById(FREQ_CONFIG.PLANILHA_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function FREQ_abaPorGid_(ss, gid) {
  var abas = ss.getSheets();
  for (var i = 0; i < abas.length; i++) if (abas[i].getSheetId() === gid) return abas[i];
  return null;
}

// tipo: 'frequencia' | 'alunos' | 'historico' — procura pelo nome e, se não achar, pelo gid antigo
function FREQ_aba_(ss, tipo) {
  var mapa = {
    frequencia: [FREQ_CONFIG.ABA_FREQUENCIA, FREQ_CONFIG.GID_FREQUENCIA],
    alunos: [FREQ_CONFIG.ABA_ALUNOS, FREQ_CONFIG.GID_ALUNOS],
    historico: [FREQ_CONFIG.ABA_HISTORICO, FREQ_CONFIG.GID_HISTORICO]
  }[tipo];
  return ss.getSheetByName(mapa[0]) || FREQ_abaPorGid_(ss, mapa[1]);
}

// Lê "91,26", "92.77", "90%" ou número → 91.26
function FREQ_num_(v) {
  if (typeof v === 'number') return v;
  var t = String(v == null ? '' : v).replace('%', '').trim().replace(',', '.').replace(/[^0-9.\-]/g, '');
  var n = parseFloat(t);
  return isNaN(n) ? null : n;
}
function FREQ_fmt_(n) { return (Math.round(n * 100) / 100).toFixed(2).replace('.', ','); }

// Devolve as linhas como texto, igual ao CSV antigo (com o cabeçalho na linha 0)
function FREQ_linhas_(ss, tipo, colunas) {
  var aba = FREQ_aba_(ss, tipo);
  if (!aba || aba.getLastRow() === 0) return [];
  return aba.getRange(1, 1, aba.getLastRow(), colunas).getDisplayValues()
    .filter(function (l, i) { return i === 0 || l.join('').trim() !== ''; });
}

function FREQ_trimestres_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName(FREQ_CONFIG.ABA_TRIMESTRES);
  if (!aba) {
    aba = ss.insertSheet(FREQ_CONFIG.ABA_TRIMESTRES);
    aba.getRange(1, 1, 4, 2).setValues([
      ['Trimestre', 'Média fechada (%) — deixe em branco enquanto o trimestre estiver em andamento'],
      ['1º Trimestre', 91.9], ['2º Trimestre', ''], ['3º Trimestre', '']
    ]);
    aba.setFrozenRows(1);
  }
  return aba.getRange(2, 1, Math.max(aba.getLastRow() - 1, 1), 2).getValues()
    .filter(function (l) { return String(l[0]).trim() !== ''; })
    .map(function (l) {
      var v = parseFloat(String(l[1]).replace(',', '.').replace('%', ''));
      return { nome: String(l[0]).trim(), fechado: isNaN(v) ? null : v };
    });
}

function FREQ_abaSorteios_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName(FREQ_CONFIG.ABA_SORTEIOS);
  if (!aba) {
    aba = ss.insertSheet(FREQ_CONFIG.ABA_SORTEIOS);
    aba.appendRow(['data_hora', 'turma', 'aluno', 'origem', 'ativo']);
    aba.setFrozenRows(1);
  }
  return aba;
}

function FREQ_sorteadosAtivos_() {
  var dados = FREQ_abaSorteios_().getDataRange().getValues();
  var nomes = {};
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][4]).toUpperCase() === 'SIM') nomes[String(dados[i][2]).trim()] = true;
  }
  return Object.keys(nomes);
}


// ---------------------------------------------------------------------
//  Frequência semanal: leitura, gravação e fechamento da semana
//  Média da escola = Σ presenças ÷ Σ aulas (colunas F e G da aba frequencia,
//  preenchidas pela importação do Power BI). Se faltar F/G em alguma turma
//  (digitação manual), usa a média simples das turmas.
//  Semanas numeradas pela SEMANA LETIVA do Power BI (42, 43, ...).
// ---------------------------------------------------------------------
function FREQ_lerTurmas_() {
  var aba = FREQ_aba_(FREQ_planilha_(), 'frequencia');
  if (!aba || aba.getLastRow() < 2) return [];
  return aba.getRange(2, 1, aba.getLastRow() - 1, 7).getValues()
    .map(function (l, i) {
      return { linha: i + 2, turma: String(l[0] || '').trim(), freq: FREQ_num_(l[1]),
        bloco: String(l[2] || '').trim(), trofeus: FREQ_num_(l[3]) || 0, codigo: String(l[4] || '').trim(),
        presencas: FREQ_num_(l[5]), aulas: FREQ_num_(l[6]) };
    })
    .filter(function (t) { return t.turma !== ''; });
}

// Semanas numeradas, em ordem (a linha "Esta" antiga é ignorada)
function FREQ_lerHistorico_() {
  var aba = FREQ_aba_(FREQ_planilha_(), 'historico');
  if (!aba || aba.getLastRow() < 2) return [];
  return aba.getRange(2, 1, aba.getLastRow() - 1, 2).getValues()
    .map(function (l, i) { return { linha: i + 2, semana: parseInt(l[0], 10), media: FREQ_num_(l[1]) }; })
    .filter(function (h) { return !isNaN(h.semana) && h.media !== null && h.media > 0; })
    .sort(function (a, b) { return a.semana - b.semana; });
}

// { valor, metodo } — ponderada quando todas as turmas têm Σ presenças e Σ aulas
function FREQ_calcularMedia_(turmas) {
  var com = turmas.filter(function (t) { return t.freq !== null && t.freq > 0; });
  if (!com.length) return { valor: null, metodo: '' };
  var ponderavel = com.every(function (t) { return t.presencas !== null && t.aulas; });
  if (ponderavel) {
    var p = com.reduce(function (s, t) { return s + t.presencas; }, 0);
    var a = com.reduce(function (s, t) { return s + t.aulas; }, 0);
    return { valor: 100 * p / a, metodo: 'ponderada' };
  }
  return { valor: com.reduce(function (s, t) { return s + t.freq; }, 0) / com.length, metodo: 'simples' };
}
function FREQ_mediaEscola_(turmas) { return FREQ_calcularMedia_(turmas).valor; }

function FREQ_mediasPorTurno_(turmas) {
  function doTurno(re) { return FREQ_calcularMedia_(turmas.filter(function (t) { return re.test(t.bloco); })).valor; }
  var geral = FREQ_calcularMedia_(turmas);
  return { escola: geral.valor, manha: doTurno(/man/i), tarde: doTurno(/tard/i), metodo: geral.metodo };
}

function FREQ_semanaAtual_(hist) {
  var prop = parseInt(PropertiesService.getScriptProperties().getProperty('FREQ_SEMANA_ATUAL'), 10);
  if (!isNaN(prop)) return prop;
  return hist.length ? hist[hist.length - 1].semana + 1 : 1;
}

// Tela "Frequência da Semana" do SIGA (nível 3+)
function FREQ_gestao_() {
  var turmas = FREQ_lerTurmas_();
  var hist = FREQ_lerHistorico_();
  var props = PropertiesService.getScriptProperties();
  var ultima = hist.length ? hist[hist.length - 1] : null;
  var media = FREQ_calcularMedia_(turmas);
  return {
    status: 'success',
    turmas: turmas,
    mediaAtual: media.valor,
    metodoMedia: media.metodo,
    ultimaSemana: ultima ? { semana: ultima.semana, media: ultima.media } : null,
    semanaAtual: FREQ_semanaAtual_(hist),
    proximaSemana: FREQ_semanaAtual_(hist),
    historico: hist.slice(-15).map(function (h) { return { semana: h.semana, media: h.media }; }),
    atualizadoEm: props.getProperty('FREQ_ATUALIZADO_EM') || '',
    atualizadoPor: props.getProperty('FREQ_ATUALIZADO_POR') || '',
    pendenteFechar: props.getProperty('FREQ_PENDENTE') === 'SIM'
  };
}

function FREQ_salvar_(sessao, corpo) {
  var itens = Array.isArray(corpo.itens) ? corpo.itens : [];
  var semana = parseInt(corpo.semana, 10);
  if (!itens.length && isNaN(semana)) return { status: 'error', message: 'Nada para salvar.' };
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var aba = FREQ_aba_(FREQ_planilha_(), 'frequencia');
    // Cabeçalhos das colunas novas (F e G)
    var cab = aba.getRange(1, 6, 1, 2).getValues()[0];
    if (!String(cab[0]).trim() && !String(cab[1]).trim()) aba.getRange(1, 6, 1, 2).setValues([['Σ Presenças', 'Σ Aulas']]);

    var porLinha = {};
    FREQ_lerTurmas_().forEach(function (t) { porLinha[t.linha] = t; });
    var n = 0;
    itens.forEach(function (it) {
      var t = porLinha[parseInt(it.linha, 10)];
      if (!t) return;
      if (it.turma && String(it.turma).trim() !== t.turma) return;   // a linha mudou na planilha
      var f = FREQ_num_(it.freq);
      if (f !== null && f >= 0 && f <= 100) {
        aba.getRange(t.linha, 2).setValue(Math.round(f * 100) / 100);
        var p = FREQ_num_(it.presencas), a = FREQ_num_(it.aulas);
        // Valor digitado à mão (sem Σ do Power BI): limpa F/G para não ponderar com número velho
        aba.getRange(t.linha, 6, 1, 2).setValues([(p !== null && a) ? [p, a] : ['', '']]);
        n++;
      }
      if (it.trofeus !== undefined && it.trofeus !== '') {
        var tr = parseInt(it.trofeus, 10);
        if (!isNaN(tr) && tr >= 0 && tr < 1000) aba.getRange(t.linha, 4).setValue(tr);
      }
    });
    var props = PropertiesService.getScriptProperties();
    if (!isNaN(semana) && semana > 0 && semana < 60) props.setProperty('FREQ_SEMANA_ATUAL', String(semana));
    if (n) {
      props.setProperty('FREQ_ATUALIZADO_EM', Utilities.formatDate(new Date(), 'GMT-3', 'dd/MM/yyyy HH:mm'));
      props.setProperty('FREQ_ATUALIZADO_POR', sessao.email);
      props.setProperty('FREQ_PENDENTE', 'SIM');
    }
    CacheService.getScriptCache().remove('freq_publico');
    return { status: 'success', message: n + ' turma(s) atualizada(s).', gestao: FREQ_gestao_() };
  } finally {
    lock.releaseLock();
  }
}

// Regrava o HistoricoGeral inteiro em ordem de semana, como números.
// alteracoes: { semana: media } (media null = apagar a semana)
function FREQ_regravarHistorico_(alteracoes) {
  var aba = FREQ_aba_(FREQ_planilha_(), 'historico');
  var mapa = {};
  FREQ_lerHistorico_().forEach(function (h) { mapa[h.semana] = h.media; });
  Object.keys(alteracoes).forEach(function (k) {
    if (alteracoes[k] === null) delete mapa[k]; else mapa[k] = alteracoes[k];
  });
  var semanas = Object.keys(mapa).map(Number).sort(function (a, b) { return a - b; });
  var linhas = semanas.map(function (s) { return [s, Math.round(mapa[s] * 100) / 100]; });
  var antigas = Math.max(aba.getLastRow() - 1, 0);
  if (antigas > 0) aba.getRange(2, 1, antigas, 2).clearContent();   // some também a linha "Esta"
  if (linhas.length) aba.getRange(2, 1, linhas.length, 2).setValues(linhas);
  CacheService.getScriptCache().remove('freq_publico');
}

// Registra a média atual como a semana letiva informada (ou a semana atual)
function FREQ_fecharSemana_(quem, semanaPedida) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var media = FREQ_mediaEscola_(FREQ_lerTurmas_());
    if (media === null) return { status: 'error', message: 'Sem frequências para calcular a média.' };
    var semana = parseInt(semanaPedida, 10);
    if (isNaN(semana)) semana = FREQ_semanaAtual_(FREQ_lerHistorico_());
    var alt = {}; alt[semana] = media;
    FREQ_regravarHistorico_(alt);
    var props = PropertiesService.getScriptProperties();
    props.setProperty('FREQ_PENDENTE', 'NAO');
    props.setProperty('FREQ_SEMANA_ATUAL', String(semana + 1));
    if (typeof SEG_auditar_ === 'function') SEG_auditar_({ email: quem || 'automático', tipo: 'sistema' }, 'FREQ_FECHAR_SEMANA', 'Semana ' + semana + ' = ' + FREQ_fmt_(media));
    return { status: 'success', message: 'Semana ' + semana + ' registrada: ' + FREQ_fmt_(media) + '%', semana: semana };
  } finally {
    lock.releaseLock();
  }
}

// Editor do histórico na tela (preencher semanas que faltaram, corrigir, apagar)
function FREQ_salvarHistorico_(sessao, corpo) {
  var lista = Array.isArray(corpo.semanas) ? corpo.semanas : [];
  var alt = {}, n = 0;
  lista.forEach(function (s) {
    var sem = parseInt(s.semana, 10);
    if (isNaN(sem) || sem < 1 || sem > 60) return;
    if (s.apagar) { alt[sem] = null; n++; return; }
    var m = FREQ_num_(s.media);
    if (m !== null && m > 0 && m <= 100) { alt[sem] = m; n++; }
  });
  if (!n) return { status: 'error', message: 'Nenhuma semana válida.' };
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { FREQ_regravarHistorico_(alt); } finally { lock.releaseLock(); }
  if (typeof SEG_auditar_ === 'function') SEG_auditar_(sessao, 'FREQ_HISTORICO_SALVAR', JSON.stringify(alt).substring(0, 400));
  return { status: 'success', message: n + ' semana(s) gravada(s).', gestao: FREQ_gestao_() };
}

// Converte "92.77" (texto com ponto) em número de verdade e põe em ordem
function FREQ_corrigirHistorico_(aba) {
  if (!aba || aba.getLastRow() < 2) return;
  FREQ_regravarHistorico_({});
}

// Gatilho de sexta-feira: só fecha se houve atualização na semana
function FREQ_fecharSemanaAutomatico() {
  if (PropertiesService.getScriptProperties().getProperty('FREQ_PENDENTE') !== 'SIM') {
    Logger.log('Frequência não foi atualizada nesta semana: nada a fechar.');
    return;
  }
  Logger.log(JSON.stringify(FREQ_fecharSemana_('automático (sexta-feira)')));
}

// Execute UMA vez pelo editor
function FREQ_instalarFechamentoSemanal() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'FREQ_fecharSemanaAutomatico') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('FREQ_fecharSemanaAutomatico').timeBased()
    .onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(18).inTimezone('America/Sao_Paulo').create();
  FREQ_corrigirHistorico_(FREQ_aba_(FREQ_planilha_(), 'historico'));
  Logger.log('Pronto: toda sexta às 18h a semana é fechada (se a frequência foi atualizada).');
}

// ---------------------------------------------------------------------
//  Chave da TV
// ---------------------------------------------------------------------
function FREQ_chaveValida_(chave) {
  var certa = PropertiesService.getScriptProperties().getProperty('FREQ_CHAVE_TV');
  if (!certa || !chave || String(chave).length !== certa.length) return false;
  var dif = 0;
  for (var i = 0; i < certa.length; i++) dif |= certa.charCodeAt(i) ^ String(chave).charCodeAt(i);
  return dif === 0;
}

// Execute pelo editor. Gera (ou troca) a chave e mostra o endereço para a TV.
// Trocar a chave desconecta todas as TVs, que precisam abrir o endereço novo.
function FREQ_gerarChaveTV() {
  var chave = Utilities.getUuid().replace(/-/g, '').substring(0, 24);
  PropertiesService.getScriptProperties().setProperty('FREQ_CHAVE_TV', chave);
  Logger.log('Chave nova da TV: ' + chave);
  Logger.log('Abra UMA VEZ em cada TV: https://anchietafrequencia.vercel.app/?chave=' + chave);
  Logger.log('A TV guarda a chave sozinha e ela some do endereço.');
}

// Execute pelo editor para conferir se as abas foram encontradas.
function FREQ_diagnosticar() {
  var ss = FREQ_planilha_();
  Logger.log('Planilha: ' + ss.getName());
  [['Frequência', 'frequencia'], ['Alunos', 'alunos'], ['Histórico', 'historico']]
    .forEach(function (p) {
      var aba = FREQ_aba_(ss, p[1]);
      Logger.log(p[0] + ': ' + (aba ? 'OK → aba "' + aba.getName() + '", ' + (aba.getLastRow() - 1) + ' linhas'
        : 'NÃO ENCONTRADA. Confira os nomes em FREQ_CONFIG.'));
    });
  var hist = FREQ_lerHistorico_();
  Logger.log('Última semana no histórico: ' + (hist.length ? hist[hist.length - 1].semana : 'nenhuma'));
  Logger.log('Média atual da escola: ' + FREQ_fmt_(FREQ_mediaEscola_(FREQ_lerTurmas_()) || 0) + '%');
  Logger.log('Fechamento automático: ' + (ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'FREQ_fecharSemanaAutomatico'; }) ? 'instalado' : 'FALTA, execute FREQ_instalarFechamentoSemanal'));
  Logger.log('Chave da TV: ' + (PropertiesService.getScriptProperties().getProperty('FREQ_CHAVE_TV') ? 'configurada' : 'FALTA, execute FREQ_gerarChaveTV'));
}
