/**
 * =====================================================================
 *  SIGA v3 — Atas Disciplinares: leitura do conteúdo + fila de conferência
 * =====================================================================
 *  Cole num arquivo novo do Apps Script chamado "atas".
 *
 *  Antes (Código.gs → verificarNovasAtas): só o NOME do arquivo era lido, no
 *  formato exato "Ata nº 12/2026 Nome do Aluno". Qualquer diferença descartava
 *  a ata sem aviso; "João" ia para o primeiro João da lista; nome não achado
 *  era gravado assim mesmo e a ata não aparecia no histórico.
 *
 *  Agora (ATA_verificarNovasAtas):
 *   1. Lê o nome do arquivo E o texto do Google Docs.
 *   2. Procura os NOMES COMPLETOS dos alunos cadastrados; usa a turma escrita
 *      na ata para separar alunos com nome parecido; aceita "nº", "n°", "Nº",
 *      "no", "n." e número com ou sem "/2026".
 *   3. Só registra sozinho quando tem certeza. Na dúvida, a ata vai para a
 *      aba "Atas_Conferir" e aparece no SIGA em "Atas para conferir", onde a
 *      equipe escolhe o aluno certo. Nada é descartado em silêncio.
 *
 *  CONFIGURAÇÃO (uma vez, no editor do Apps Script):
 *   • Execute ATA_instalarVerificacao: troca o gatilho antigo (verificarNovasAtas)
 *     pelo novo, a cada 30 minutos.
 *   • Execute ATA_revisarPasta (ou use o botão no SIGA): relê as atas da pasta
 *     que nunca entraram no histórico (as que o código antigo descartou).
 * =====================================================================
 */

var ATA_CONFIG = {
  ABA_ATAS: 'Atas_Disciplinares',      // A Data | B Aluno | C Número | D Arquivo | E Link | F Processado
  ABA_CONFERIR: 'Atas_Conferir',
  CAB_CONFERIR: ['ID Arquivo', 'Arquivo', 'Link', 'Número', 'Data', 'Sugestões', 'Motivo', 'Status', 'Resolvido por', 'Resolvido em'],
  PALAVRAS_FORA: ['de', 'da', 'do', 'das', 'dos', 'e'],
  MAX_POR_EXECUCAO: 60
};

// ---------------------------------------------------------------------
//  Texto
// ---------------------------------------------------------------------
function ATA_norm_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
/** Tokens sem "de/da/dos/e" */
function ATA_tokens_(s) {
  return ATA_norm_(s).split(' ').filter(function (t) { return t && ATA_CONFIG.PALAVRAS_FORA.indexOf(t) === -1; });
}
function ATA_contem_(texto, frase) { return frase && (' ' + texto + ' ').indexOf(' ' + frase + ' ') !== -1; }

/** Número da ata: "nº 12/2026", "n° 12", "Nº12/26", "Ata 12/2026", "no. 7" */
function ATA_numero_(texto) {
  var t = String(texto || '');
  var m = t.match(/\bn\s*[º°o.]?\s*[º°.]?\s*(\d{1,4}\s*[\/\-]\s*\d{2,4})/i) || t.match(/\bata\D{0,15}?(\d{1,4}\s*[\/\-]\s*\d{2,4})/i)
       || t.match(/\bn\s*[º°]\s*(\d{1,4})\b/i) || t.match(/\bata\s+(?:n\S*\s*)?(\d{1,4})\b/i);
  return m ? m[1].replace(/\s+/g, '').replace('-', '/') : '';
}

/** Turmas citadas: "7B", "7º ano B", "7º B", "3ANEM", "turma do 9º C" */
function ATA_turmasCitadas_(texto, turmas) {
  var n = ATA_norm_(texto), achadas = {};
  turmas.forEach(function (t) {
    var c = ATA_norm_(t.codigo).replace(/\s/g, '');
    if (!c) return;
    if (ATA_contem_(n, c)) achadas[t.codigo] = true;
    var m = String(t.codigo).toUpperCase().match(/^(\d)([A-Z])$/);
    if (m && (new RegExp('\\b' + m[1] + ' (o |a )?(ano |serie )?' + m[2].toLowerCase() + '\\b')).test(n)) achadas[t.codigo] = true;
    if (t.nome && ATA_contem_(n, ATA_norm_(t.nome))) achadas[t.codigo] = true;
  });
  return Object.keys(achadas);
}

// ---------------------------------------------------------------------
//  Análise de uma ata (pura: testada em tests/test-backend.js)
//  alunos: [{nome, turma (código), turmaNome}]
//  Devolve { numero, registrar: [nomes], sugestoes: [{nome, turma, confianca, fonte}], motivo, certo }
// ---------------------------------------------------------------------
function ATA_analisar_(nomeArquivo, textoDoc, alunos) {
  var semExt = String(nomeArquivo || '').replace(/\.[a-z0-9]{2,5}$/i, '');
  var texto = String(textoDoc || '');
  var numero = ATA_numero_(semExt) || ATA_numero_(texto.slice(0, 600));
  var turmasLista = {};
  alunos.forEach(function (a) { if (a.turma) turmasLista[a.turma] = a.turmaNome || ''; });
  var turmasObj = Object.keys(turmasLista).map(function (c) { return { codigo: c, nome: turmasLista[c] }; });
  var turmasCitadas = ATA_turmasCitadas_(semExt + '\n' + texto.slice(0, 3000), turmasObj);

  var prep = alunos.map(function (a) { var tk = ATA_tokens_(a.nome); return { a: a, tk: tk, frase: tk.join(' ') }; })
    .filter(function (p) { return p.tk.length >= 2; });

  // Trechos "confiáveis": nomes no nome do arquivo e linhas "Aluno(a): ..." / "Estudante: ..."
  var trechos = [];
  var resto = semExt.replace(/\bata(s)?\b/ig, ' ').replace(/disciplinar(es)?/ig, ' ')
    .replace(/\bn\s*[º°o.]?\s*[º°.]?\s*\d{1,4}(\s*[\/\-]\s*\d{2,4})?/ig, ' ').replace(/\b\d{1,4}\s*[\/\-]\s*\d{2,4}\b/g, ' ')
    .replace(/\b\d\s*[º°ª]?\s*(ano|s[ée]rie)?\s*[A-Da-d]?\b/g, ' ').replace(/\b(turma|aluno|aluna|alunos|alunas|estudante)s?\b/ig, ' ');
  resto.split(/\s*,\s*|\s*\/\s*|\s*;\s*|\s+-\s+|\s+e\s+/i).forEach(function (p) { if (ATA_tokens_(p).length) trechos.push({ texto: p, fonte: 'nome do arquivo' }); });
  texto.split(/\r?\n/).forEach(function (linha) {
    var m = linha.match(/\b(alun[oa]s?(\s*\(a\))?|estudantes?|discentes?|nome\s+d[oa]\s*\(?a?\)?\s*alun[oa])\s*(\(a\))?\s*[:\-–]\s*(.+)$/i);
    if (!m) return;
    m[4].split(/\s*,\s*|\s*;\s*|\s+e\s+/i).forEach(function (p) {
      p = p.replace(/\b(turma|s[ée]rie|ano)\b.*$/i, '').replace(/\b\d\s*[º°ª]?\s*(ano|s[ée]rie)?\s*[A-Da-d]?\b.*$/, '');
      if (ATA_tokens_(p).length) trechos.push({ texto: p, fonte: 'campo "Aluno" da ata' });
    });
  });

  var registrar = {}, sugestoes = {}, duvidas = [];
  var sugerir = function (p, conf, fonte) {
    var k = p.a.nome;
    if (!sugestoes[k] || sugestoes[k].confianca < conf) sugestoes[k] = { nome: p.a.nome, turma: p.a.turma, confianca: conf, fonte: fonte };
  };
  var filtrarTurma = function (lista) {
    if (lista.length < 2 || !turmasCitadas.length) return lista;
    var f = lista.filter(function (p) { return turmasCitadas.indexOf(p.a.turma) !== -1; });
    return f.length ? f : lista;
  };

  trechos.forEach(function (tr) {
    var tk = ATA_tokens_(tr.texto), frase = tk.join(' ');
    if (!tk.length) return;
    // 1) nome completo idêntico
    var iguais = filtrarTurma(prep.filter(function (p) { return p.frase === frase; }));
    // 2) o trecho está contido (em sequência) no nome do aluno: "joao pedro" em "joao pedro silva"
    var contidos = filtrarTurma(prep.filter(function (p) { return tk.length >= 2 && ATA_contem_(p.frase, frase); }));
    // 3) primeiro + último nome
    var pontas = tk.length >= 2 ? filtrarTurma(prep.filter(function (p) { return p.tk[0] === tk[0] && p.tk[p.tk.length - 1] === tk[tk.length - 1]; })) : [];
    var lista = iguais.length ? iguais : (contidos.length ? contidos : pontas);
    if (lista.length === 1 && (iguais.length || tk.length >= 2)) {
      registrar[lista[0].a.nome] = true;
      sugerir(lista[0], iguais.length ? 100 : 85, tr.fonte);
    } else if (lista.length > 1) {
      duvidas.push('"' + tr.texto.trim() + '" pode ser ' + lista.length + ' alunos');
      lista.slice(0, 6).forEach(function (p) { sugerir(p, 60, tr.fonte); });
    } else if (tr.fonte === 'campo "Aluno" da ata' || tk.length >= 2) {
      duvidas.push('"' + tr.texto.trim() + '" não está no cadastro de alunos');
      // sugestões por primeiro nome
      filtrarTurma(prep.filter(function (p) { return p.tk[0] === tk[0]; })).slice(0, 5).forEach(function (p) { sugerir(p, 30, 'primeiro nome'); });
    }
  });

  // Nomes completos citados no texto (pode ser vítima ou testemunha: só sugestão)
  var corpo = ATA_tokens_(texto).join(' ');
  var noTexto = prep.filter(function (p) { return ATA_contem_(corpo, p.frase); });
  noTexto.forEach(function (p) { if (!registrar[p.a.nome]) sugerir(p, 70, 'citado no texto'); });

  var lista = Object.keys(registrar);
  var motivo = '';
  if (!lista.length && !duvidas.length && noTexto.length === 1) {
    // ata sem nome no arquivo e sem campo "Aluno", mas com um único aluno citado no texto
    lista = [noTexto[0].a.nome];
  }
  if (!lista.length) motivo = duvidas.length ? duvidas.join('; ') : (noTexto.length > 1 ? noTexto.length + ' alunos citados no texto; escolha quem é o aluno da ata' : 'nenhum aluno do cadastro foi encontrado na ata');
  else if (duvidas.length) motivo = duvidas.join('; ');
  if (!numero) motivo = (motivo ? motivo + '; ' : '') + 'número da ata não encontrado';

  var certo = lista.length > 0 && !duvidas.length && !!numero;
  return {
    numero: numero, turmasCitadas: turmasCitadas, certo: certo,
    registrar: certo ? lista : [],
    sugestoes: Object.keys(sugestoes).map(function (k) { var s = sugestoes[k]; s.marcado = lista.indexOf(k) !== -1; return s; })
      .sort(function (a, b) { return b.confianca - a.confianca; }),
    motivo: motivo
  };
}

// ---------------------------------------------------------------------
//  Planilha
// ---------------------------------------------------------------------
function ATA_alunos_() {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Alunos');
  if (!aba) return [];
  return aba.getDataRange().getValues().slice(1).filter(function (l) { return String(l[1] || '').trim(); })
    .map(function (l) { return { nome: String(l[1]).trim(), turma: String(l[3] || '').trim(), turmaNome: String(l[2] || '').trim() }; });
}

function ATA_abaConferir_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName(ATA_CONFIG.ABA_CONFERIR);
  if (!aba) { aba = ss.insertSheet(ATA_CONFIG.ABA_CONFERIR); aba.getRange(1, 1, 1, ATA_CONFIG.CAB_CONFERIR.length).setValues([ATA_CONFIG.CAB_CONFERIR]); }
  return aba;
}

function ATA_registrar_(data, aluno, numero, arquivo, link) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName(ATA_CONFIG.ABA_ATAS);
  if (!aba) { aba = ss.insertSheet(ATA_CONFIG.ABA_ATAS); aba.appendRow(['Data/Hora', 'Aluno', 'Número Ata', 'Nome Arquivo', 'Link Drive', 'Processado']); }
  var dados = aba.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][1]).trim() === aluno && String(dados[i][4] || '').trim() === link && link) return false;
    if (String(dados[i][1]).trim() === aluno && String(dados[i][2]).trim() === numero && String(dados[i][3]).trim() === arquivo) return false;
  }
  aba.appendRow([data, aluno, numero, arquivo, link, 'SIM']);
  if (typeof notificarResponsaveis === 'function') {
    try {
      notificarResponsaveis(ss, aluno, '📁 Ata Disciplinar nº ' + numero + ' registrada em ' + Utilities.formatDate(data, 'GMT-3', 'dd/MM/yyyy'), 'Ata Disciplinar');
    } catch (e) { /* aviso aos pais não pode travar o registro */ }
  }
  return true;
}

function ATA_jaTratado_(idArquivo, link) {
  var conf = ATA_abaConferir_().getDataRange().getValues().slice(1);
  if (conf.some(function (l) { return String(l[0]) === idArquivo; })) return true;
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ATA_CONFIG.ABA_ATAS);
  if (!aba) return false;
  return aba.getDataRange().getValues().slice(1).some(function (l) { return String(l[4] || '').indexOf(idArquivo) !== -1; });
}

/** Lê o texto de um Google Docs (outros formatos: só o nome do arquivo). */
function ATA_textoDoArquivo_(arquivo) {
  try {
    if (arquivo.getMimeType() === 'application/vnd.google-apps.document') return DocumentApp.openById(arquivo.getId()).getBody().getText();
  } catch (e) { /* sem acesso ao conteúdo: segue só com o nome */ }
  return '';
}

/** Analisa um arquivo da pasta e registra ou manda para conferência. */
function ATA_processarArquivo_(arquivo, alunos) {
  var nome = arquivo.getName();
  var analise = ATA_analisar_(nome, ATA_textoDoArquivo_(arquivo), alunos);
  var data = arquivo.getDateCreated(), link = arquivo.getUrl();
  if (analise.certo) {
    analise.registrar.forEach(function (aluno) { ATA_registrar_(data, aluno, analise.numero, nome, link); });
    return 'registrada';
  }
  var aba = ATA_abaConferir_();
  var dados = aba.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][0]) === arquivo.getId()) {
      aba.getRange(i + 1, 4, 1, 5).setValues([[analise.numero, data, JSON.stringify(analise.sugestoes), analise.motivo, 'Pendente']]);
      return 'conferir';
    }
  }
  aba.appendRow([arquivo.getId(), nome, link, analise.numero, data, JSON.stringify(analise.sugestoes), analise.motivo, 'Pendente', '', '']);
  return 'conferir';
}

// ---------------------------------------------------------------------
//  Gatilho (substitui verificarNovasAtas do Código.gs)
// ---------------------------------------------------------------------
function ATA_verificarNovasAtas() {
  var pasta = DriveApp.getFolderById(PASTA_ATAS_ID);
  var arquivos = pasta.getFiles(), alunos = ATA_alunos_(), cont = { registrada: 0, conferir: 0 };
  var processado = typeof arquivoJaProcessado === 'function' ? arquivoJaProcessado : function () { return false; };
  var marcar = typeof marcarComoProcessado === 'function' ? marcarComoProcessado : function () {};
  while (arquivos.hasNext()) {
    var arq = arquivos.next();
    var nome = '';
    try { nome = arq.getName(); } catch (e) { continue; }
    if (!nome || /^~|\.tmp$/i.test(nome)) continue;
    var ext = (nome.split('.').pop() || '').toLowerCase();
    var ok = ['pdf', 'docx', 'doc', 'odt', 'txt'].indexOf(ext) !== -1 || arq.getMimeType() === 'application/vnd.google-apps.document';
    if (!ok || processado(arq.getId(), arq.getLastUpdated())) continue;
    cont[ATA_processarArquivo_(arq, alunos)]++;
    marcar(arq.getId());
  }
  console.log('Atas: ' + cont.registrada + ' registradas, ' + cont.conferir + ' para conferir');
  return cont;
}

/** Relê os arquivos da pasta que nunca entraram no histórico nem na conferência (os que o código antigo descartou). */
function ATA_revisarPasta() {
  var pasta = DriveApp.getFolderById(PASTA_ATAS_ID);
  var arquivos = pasta.getFiles(), alunos = ATA_alunos_(), cont = { registrada: 0, conferir: 0, analisados: 0 };
  var inicio = Date.now();
  while (arquivos.hasNext() && cont.analisados < ATA_CONFIG.MAX_POR_EXECUCAO && Date.now() - inicio < 240000) {
    var arq = arquivos.next();
    var ok = arq.getMimeType() === 'application/vnd.google-apps.document' || /\.(pdf|docx?|odt|txt)$/i.test(arq.getName());
    if (!ok || ATA_jaTratado_(arq.getId(), arq.getUrl())) continue;
    cont[ATA_processarArquivo_(arq, alunos)]++;
    cont.analisados++;
  }
  cont.terminou = !arquivos.hasNext();
  console.log(JSON.stringify(cont));
  return cont;
}

function ATA_instalarVerificacao() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'verificarNovasAtas' || f === 'ATA_verificarNovasAtas') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('ATA_verificarNovasAtas').timeBased().everyMinutes(30).create();
  console.log('✅ Verificação de atas a cada 30 minutos (ATA_verificarNovasAtas).');
}

// ---------------------------------------------------------------------
//  Rotas (seguranca.gs) — nível 3
// ---------------------------------------------------------------------
/** GET atas_conferir: pendentes + atas já registradas com nome que não existe no cadastro */
function ATA_listar_() {
  var alunos = ATA_alunos_(), nomes = {};
  alunos.forEach(function (a) { nomes[a.nome] = a.turma; });
  var pend = ATA_abaConferir_().getDataRange().getValues().slice(1).map(function (l, i) {
    if (String(l[7]) !== 'Pendente') return null;
    var sug = []; try { sug = JSON.parse(l[5] || '[]'); } catch (e) { }
    return { id: String(l[0]), linha: i + 2, arquivo: String(l[1]), link: String(l[2]), numero: String(l[3] || ''),
             data: l[4] instanceof Date ? Utilities.formatDate(l[4], 'GMT-3', 'dd/MM/yyyy') : String(l[4] || ''), sugestoes: sug, motivo: String(l[6] || '') };
  }).filter(Boolean);

  var orfas = [];
  var abaAtas = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ATA_CONFIG.ABA_ATAS);
  if (abaAtas) {
    abaAtas.getDataRange().getValues().slice(1).forEach(function (l, i) {
      var aluno = String(l[1] || '').trim();
      if (!aluno || nomes.hasOwnProperty(aluno)) return;
      var an = ATA_analisar_('Ata nº 0/0 ' + aluno, '', alunos);
      orfas.push({ linha: i + 2, aluno: aluno, numero: String(l[2] || ''), arquivo: String(l[3] || ''), link: String(l[4] || ''),
                   data: l[0] instanceof Date ? Utilities.formatDate(l[0], 'GMT-3', 'dd/MM/yyyy') : String(l[0] || ''), sugestoes: an.sugestoes.slice(0, 5) });
    });
  }
  return { status: 'success', pendentes: pend, orfas: orfas,
           alunos: alunos.map(function (a) { return { nome: a.nome, turma: a.turma }; }) };
}

function ATA_validarAlunos_(lista) {
  var nomes = {};
  ATA_alunos_().forEach(function (a) { nomes[a.nome] = true; });
  var ok = [], ruins = [];
  (Array.isArray(lista) ? lista : []).forEach(function (n) { n = String(n || '').trim(); if (!n) return; (nomes[n] ? ok : ruins).push(n); });
  return { ok: ok, ruins: ruins };
}

/** POST ATA_RESOLVER { id, alunos: [nomes exatos do cadastro], numero } */
function ATA_resolver_(sessao, corpo) {
  var v = ATA_validarAlunos_(corpo.alunos);
  if (v.ruins.length) return { status: 'error', message: 'Não está no cadastro: ' + v.ruins.join(', ') };
  if (!v.ok.length) return { status: 'error', message: 'Escolha pelo menos um aluno.' };
  var numero = String(corpo.numero || '').trim().slice(0, 20);
  if (!numero) return { status: 'error', message: 'Informe o número da ata.' };
  var aba = ATA_abaConferir_(), dados = aba.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][0]) !== String(corpo.id)) continue;
    var data = dados[i][4] instanceof Date ? dados[i][4] : new Date();
    v.ok.forEach(function (aluno) { ATA_registrar_(data, aluno, numero, String(dados[i][1]), String(dados[i][2])); });
    aba.getRange(i + 1, 4).setValue(numero);
    aba.getRange(i + 1, 8, 1, 3).setValues([['Resolvida: ' + v.ok.join(', '), sessao.email, new Date()]]);
    if (typeof SEG_auditar_ === 'function') SEG_auditar_(sessao, 'ATA_RESOLVER', String(dados[i][1]) + ' → ' + v.ok.join(', '));
    return { status: 'success', registrados: v.ok.length };
  }
  return { status: 'error', message: 'Ata não encontrada na fila.' };
}

/** POST ATA_IGNORAR { id } — arquivo que não é ata */
function ATA_ignorar_(sessao, corpo) {
  var aba = ATA_abaConferir_(), dados = aba.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][0]) !== String(corpo.id)) continue;
    aba.getRange(i + 1, 8, 1, 3).setValues([['Ignorada', sessao.email, new Date()]]);
    if (typeof SEG_auditar_ === 'function') SEG_auditar_(sessao, 'ATA_IGNORAR', String(dados[i][1]));
    return { status: 'success' };
  }
  return { status: 'error', message: 'Ata não encontrada na fila.' };
}

/** POST ATA_CORRIGIR { linha, aluno, alunoAtual, alunos: [mais nomes] } — ata antiga com nome errado */
function ATA_corrigir_(sessao, corpo) {
  var v = ATA_validarAlunos_([corpo.aluno].concat(corpo.alunos || []));
  if (v.ruins.length || !v.ok.length) return { status: 'error', message: 'Escolha alunos do cadastro.' };
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ATA_CONFIG.ABA_ATAS);
  var linha = parseInt(corpo.linha, 10);
  if (!aba || !(linha >= 2) || linha > aba.getLastRow()) return { status: 'error', message: 'Linha inválida.' };
  var l = aba.getRange(linha, 1, 1, 6).getValues()[0];
  if (String(l[1]).trim() !== String(corpo.alunoAtual || '').trim()) return { status: 'error', message: 'A planilha mudou. Recarregue a página.' };
  aba.getRange(linha, 2).setValue(v.ok[0]);
  for (var k = 1; k < v.ok.length; k++) aba.appendRow([l[0], v.ok[k], l[2], l[3], l[4], 'SIM']);
  if (typeof SEG_auditar_ === 'function') SEG_auditar_(sessao, 'ATA_CORRIGIR', '"' + l[1] + '" → ' + v.ok.join(', '));
  return { status: 'success', corrigidos: v.ok.length };
}
