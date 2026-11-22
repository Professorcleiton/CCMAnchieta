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
 *  CONFIGURAÇÃO (uma vez):
 *   1. Ajuste FREQ_CONFIG.PLANILHA_ID abaixo (veja o comentário).
 *   2. No editor, execute FREQ_diagnosticar: o registro mostra se as 3 abas foram achadas.
 *   3. Execute FREQ_gerarChaveTV: o registro mostra o endereço para abrir na TV.
 * =====================================================================
 */

var FREQ_CONFIG = {
  // ID da planilha do frequenciômetro: o trecho entre /d/ e /edit no endereço dela.
  // Deixe '' se as abas de frequência estiverem nesta MESMA planilha do SIGA.
  PLANILHA_ID: '',

  // Números "gid" das abas que o frequenciômetro usava (copiados do código antigo).
  GID_FREQUENCIA: 1746538498,   // A = turma, B = % frequência, C = turno, D = troféus
  GID_ALUNOS: 1866544411,       // A = id, B = nome, C = turma, D = código da turma
  GID_HISTORICO: 541390615,     // A = semana, B = média da escola

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
  var resposta = {
    status: 'success',
    atualizadoEm: Utilities.formatDate(new Date(), 'GMT-3', 'dd/MM/yyyy HH:mm'),
    frequencia: FREQ_linhas_(ss, FREQ_CONFIG.GID_FREQUENCIA, 4),
    historico: FREQ_linhas_(ss, FREQ_CONFIG.GID_HISTORICO, 2),
    trimestres: FREQ_trimestres_()
  };
  cache.put('freq_publico', JSON.stringify(resposta), FREQ_CONFIG.CACHE_SEGUNDOS);
  return resposta;
}

function FREQ_dadosAlunos_(chave) {
  if (!FREQ_chaveValida_(chave)) return { status: 'unauthorized', message: 'Chave da TV inválida.' };
  return {
    status: 'success',
    alunos: FREQ_linhas_(FREQ_planilha_(), FREQ_CONFIG.GID_ALUNOS, 4),
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

// Devolve as linhas como texto, igual ao CSV antigo (com o cabeçalho na linha 0)
function FREQ_linhas_(ss, gid, colunas) {
  var aba = FREQ_abaPorGid_(ss, gid);
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
  [['Frequência', FREQ_CONFIG.GID_FREQUENCIA], ['Alunos', FREQ_CONFIG.GID_ALUNOS], ['Histórico', FREQ_CONFIG.GID_HISTORICO]]
    .forEach(function (p) {
      var aba = FREQ_abaPorGid_(ss, p[1]);
      Logger.log(p[0] + ' (gid ' + p[1] + '): ' + (aba ? 'OK → aba "' + aba.getName() + '", ' + (aba.getLastRow() - 1) + ' linhas'
        : 'NÃO ENCONTRADA. Confira FREQ_CONFIG.PLANILHA_ID.'));
    });
  Logger.log('Chave da TV: ' + (PropertiesService.getScriptProperties().getProperty('FREQ_CHAVE_TV') ? 'configurada' : 'FALTA, execute FREQ_gerarChaveTV'));
}
