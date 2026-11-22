/**
 * =====================================================================
 *  SIGA v3 — Notícias das redes sociais no site (plano B, sem API da Meta)
 * =====================================================================
 *  Cole num arquivo novo do Apps Script chamado "noticias".
 *
 *  Como funciona:
 *   - A secretaria (nível 3+) cola o link de uma postagem do Instagram ou
 *     do Facebook na tela "Notícias do Site" do SIGA.
 *   - O link fica na aba "Noticias" da planilha (criada automaticamente).
 *   - A página inicial do site lê ?aba=noticias. É a ÚNICA leitura pública
 *     do sistema, e devolve só os links publicados.
 *
 *  A aba também pode ser editada direto na planilha: para tirar uma notícia
 *  do ar, troque a coluna "ativo" para NAO.
 * =====================================================================
 */

var NOT_CONFIG = {
  ABA: 'Noticias',
  MAX_NO_SITE: 6,            // quantas aparecem na página inicial
  CACHE_SEGUNDOS: 300        // o site atualiza em até 5 minutos
};
var NOT_CABECALHO = ['id', 'data', 'rede', 'link', 'chamada', 'publicado_por', 'ativo'];

function NOT_aba_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName(NOT_CONFIG.ABA);
  if (!aba) {
    aba = ss.insertSheet(NOT_CONFIG.ABA);
    aba.appendRow(NOT_CABECALHO);
    aba.setFrozenRows(1);
  }
  return aba;
}

// Aceita só links de postagem do Instagram e do Facebook e os deixa num formato único.
function NOT_normalizarLink_(url) {
  url = String(url || '').trim();
  var ig = url.match(/^https?:\/\/(?:www\.)?instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/i);
  if (ig) {
    var tipo = ig[1].toLowerCase() === 'reels' ? 'reel' : ig[1].toLowerCase();
    return { rede: 'instagram', link: 'https://www.instagram.com/' + tipo + '/' + ig[2] + '/' };
  }
  var fb = url.match(/^https?:\/\/(?:www\.|m\.|web\.)?facebook\.com\/[^\s<>"']+/i);
  if (fb && /\/(posts|photos|videos|permalink\.php|share\/[pv]|photo\.php|story\.php|reel)/i.test(url)) {
    return { rede: 'facebook', link: fb[0].replace(/^https?:\/\/(?:www\.|m\.|web\.)?/i, 'https://www.') };
  }
  return null;
}

// ---- Leitura pública (página inicial do site) ----
function NOT_listarPublicas_() {
  var cache = CacheService.getScriptCache();
  var c = cache.get('not_publicas');
  if (c) return JSON.parse(c);

  var valores = NOT_aba_().getDataRange().getValues();
  var lista = [];
  for (var i = valores.length - 1; i >= 1 && lista.length < NOT_CONFIG.MAX_NO_SITE; i--) {
    var l = valores[i];
    if (String(l[6] || 'SIM').toUpperCase().trim() === 'NAO') continue;
    var n = NOT_normalizarLink_(l[3]);
    if (!n) continue;
    lista.push({
      id: String(l[0]),
      data: l[1] instanceof Date ? Utilities.formatDate(l[1], 'GMT-3', 'dd/MM/yyyy') : String(l[1] || ''),
      rede: n.rede,
      link: n.link,
      chamada: String(l[4] || '').substring(0, 200)
    });
  }
  var resposta = { status: 'success', noticias: lista };
  cache.put('not_publicas', JSON.stringify(resposta), NOT_CONFIG.CACHE_SEGUNDOS);
  return resposta;
}

// ---- Gestão (nível 3+, chamada pela camada de segurança) ----
function NOT_listarTodas_() {
  var valores = NOT_aba_().getDataRange().getValues();
  var lista = [];
  for (var i = valores.length - 1; i >= 1; i--) {
    var l = valores[i];
    lista.push({
      id: String(l[0]),
      data: l[1] instanceof Date ? Utilities.formatDate(l[1], 'GMT-3', 'dd/MM/yyyy HH:mm') : String(l[1] || ''),
      rede: String(l[2] || ''), link: String(l[3] || ''), chamada: String(l[4] || ''),
      publicadoPor: String(l[5] || ''), ativo: String(l[6] || 'SIM').toUpperCase().trim() !== 'NAO'
    });
  }
  return lista;
}

function NOT_adicionar_(sessao, corpo) {
  var n = NOT_normalizarLink_(corpo.link);
  if (!n) return { status: 'error', message: 'Cole o link de uma postagem do Instagram (instagram.com/p/...) ou do Facebook.' };
  var chamada = String(corpo.chamada || '').trim().substring(0, 200);

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var aba = NOT_aba_();
    var valores = aba.getDataRange().getValues();
    for (var i = 1; i < valores.length; i++) {
      var existente = NOT_normalizarLink_(valores[i][3]);
      if (existente && existente.link === n.link) {
        aba.getRange(i + 1, 5).setValue(chamada || valores[i][4]);
        aba.getRange(i + 1, 7).setValue('SIM');
        CacheService.getScriptCache().remove('not_publicas');
        return { status: 'success', message: 'Essa postagem já estava cadastrada e foi reativada.' };
      }
    }
    aba.appendRow(['N' + Date.now(), new Date(), n.rede, n.link, chamada, sessao.email, 'SIM']);
  } finally {
    lock.releaseLock();
  }
  CacheService.getScriptCache().remove('not_publicas');
  return { status: 'success', message: 'Notícia publicada no site!' };
}

function NOT_alterarAtivo_(corpo, ativo) {
  var aba = NOT_aba_();
  var valores = aba.getDataRange().getValues();
  for (var i = 1; i < valores.length; i++) {
    if (String(valores[i][0]) === String(corpo.id)) {
      aba.getRange(i + 1, 7).setValue(ativo ? 'SIM' : 'NAO');
      CacheService.getScriptCache().remove('not_publicas');
      return { status: 'success' };
    }
  }
  return { status: 'error', message: 'Notícia não encontrada.' };
}
