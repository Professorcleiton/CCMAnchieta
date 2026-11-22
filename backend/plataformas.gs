/**
 * =====================================================================
 *  SIGA v3 — Plataformas obrigatórias (Importar do BI + Painel do Professor)
 * =====================================================================
 *  Cole num arquivo novo do Apps Script chamado "plataformas".
 *  Substitui (pelo seguranca.gs) as rotas do Código.gs:
 *    GET  meus_lancamentos, historico_docente, visao_geral_docentes, metas_plataformas
 *    POST IMPORTAR_LANCAMENTOS
 *
 *  O que estava errado no Código.gs:
 *   1. A data do lançamento era gravada como TEXTO "dd/MM/yyyy". O painel fazia
 *      new Date("22/11/2026") → data inválida (ou mês e dia trocados) e o
 *      lançamento sumia ou caía na semana errada.
 *   2. O início da semana guardava a HORA atual: o que foi lançado na segunda
 *      (00:00) ficava "antes" da segunda às 10h e não contava.
 *   3. O painel só olhava a semana corrente: o que a direção importava na segunda
 *      sobre a semana anterior não aparecia em lugar nenhum no fim de semana, e
 *      importar duas vezes somava em dobro.
 *   4. A turma era "formatada" no importador: 3ANEM virava 3A, 1AGRO virava 1A,
 *      e nunca batia com a grade de horários.
 *   5. Meta da Matific digitada "1.100" (= 1,1) virava 1100: sempre vermelho.
 *
 *  Agora cada lançamento tem uma SEMANA DE REFERÊNCIA (a segunda-feira da semana
 *  a que o índice se refere). Reimportar a mesma semana SUBSTITUI o valor.
 *  O painel mostra a semana mais recente com lançamentos e as 4 anteriores.
 *
 *  Aba "Lancamentos_Plataformas" (a mesma de antes; as linhas antigas continuam valendo):
 *   A ID | B Professor_Email | C Disciplina | D Turma | E Plataforma | F Semana (data) |
 *   G Índice | H Status | I Observação | J Lançado em | K Lançado por
 * =====================================================================
 */

var PLAT_CONFIG = {
  ABA_LANC: 'Lancamentos_Plataformas',
  ABA_METAS: 'Metas_Plataformas',
  SEMANAS_HISTORICO: 5
};

// ---------------------------------------------------------------------
//  Utilidades
// ---------------------------------------------------------------------
function PLAT_norm_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}
function PLAT_cod_(s) { return String(s || '').toUpperCase().replace(/\s+/g, ''); }

/** Data de uma célula: Date, "dd/MM/yyyy", "yyyy-MM-dd". null se não der. */
function PLAT_data_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  var t = String(v || '').trim(), m;
  if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return new Date(+m[3], +m[2] - 1, +m[1]);
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})/))) return new Date(+m[1], +m[2] - 1, +m[3]);
  if (typeof v === 'number' && v > 30000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)); // número serial
  return null;
}

/** Segunda-feira 00:00 da semana da data. */
function PLAT_segunda_(d) {
  var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  var dia = x.getDay();
  x.setDate(x.getDate() - (dia === 0 ? 6 : dia - 1));
  return x;
}
function PLAT_chaveSemana_(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
function PLAT_rotuloSemana_(seg) {
  var fim = new Date(seg.getTime() + 4 * 86400000);
  var f = function (d) { return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2); };
  return f(seg) + ' a ' + f(fim);
}

/** Número em formato brasileiro ou não: "2,937" "1.100,5" "1.100" (Matific = 1,1) 2.937 */
function PLAT_numero_(v) {
  if (typeof v === 'number') return v;
  var t = String(v || '').trim().replace(/\s/g, '').replace('%', '');
  if (!t) return NaN;
  if (t.indexOf(',') !== -1) t = t.replace(/\./g, '').replace(',', '.');
  return parseFloat(t);
}

function PLAT_metaCorrigida_(plataforma, meta) {
  // "1.100" digitado na planilha em português vira 1100; a meta da Matific é 1,1
  if (/matific/i.test(plataforma) && meta > 100) return meta / 1000;
  return meta;
}

function PLAT_plataformasIguais_(a, b) {
  var n = function (p) { var v = PLAT_norm_(p); return v === 'desafio' ? 'quizizz' : v; };
  return n(a) === n(b);
}

/** A plataforma vale para a turma? (Matific: 6º e 7º; Khan: do 8º em diante) */
function PLAT_valeParaTurma_(plataforma, turma) {
  var p = PLAT_norm_(plataforma), anoFund = /^[67]/.test(PLAT_cod_(turma));
  if (p === 'matific') return anoFund;
  if (p.indexOf('khan') !== -1) return !anoFund;
  return true;
}

function PLAT_linhas_(nome) {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nome);
  return aba ? aba.getDataRange().getValues().slice(1) : [];
}

function PLAT_metas_() {
  return PLAT_linhas_(PLAT_CONFIG.ABA_METAS).filter(function (m) { return String(m[2] || '').trim(); }).map(function (m) {
    var plataforma = String(m[2]).trim();
    return {
      disciplina: String(m[1] || '').trim(),
      plataforma: plataforma,
      meta: PLAT_metaCorrigida_(plataforma, PLAT_numero_(m[3]) || 0),
      universal: String(m[7] || '').trim().toUpperCase() === 'SIM',
      linha: m
    };
  });
}

/** Lançamentos com a semana de referência já calculada. */
function PLAT_lancamentos_() {
  return PLAT_linhas_(PLAT_CONFIG.ABA_LANC).map(function (l) {
    var d = PLAT_data_(l[5]);
    if (!d) return null;
    var seg = PLAT_segunda_(d);
    return {
      professor: String(l[1] || '').trim(), disciplina: String(l[2] || '').trim(), turma: PLAT_cod_(l[3]),
      plataforma: String(l[4] || '').trim(), semana: PLAT_chaveSemana_(seg), segunda: seg,
      valor: PLAT_numero_(l[6]) || 0
    };
  }).filter(Boolean);
}

/** Pares disciplina/turma de cada professor, pela grade de horários. */
function PLAT_aulas_() {
  var usuarios = PLAT_linhas_('Usuários'), emailDoNome = {};
  usuarios.forEach(function (u) { if (u[0] && u[1]) emailDoNome[PLAT_norm_(u[1])] = { email: String(u[0]).trim().toLowerCase(), nome: String(u[1]).trim() }; });
  var pares = {};
  PLAT_linhas_('Horarios').forEach(function (h) {
    var nome = PLAT_norm_(h[6]), disc = String(h[5] || '').trim(), turma = PLAT_cod_(h[1]);
    if (!nome || !disc || !turma) return;
    var info = emailDoNome[nome] || { email: '', nome: String(h[6]).trim() };
    pares[nome + '||' + PLAT_norm_(disc) + '||' + turma] = { nomeNorm: nome, nome: info.nome, email: info.email, disciplina: disc, turma: turma };
  });
  return Object.keys(pares).map(function (k) { return pares[k]; });
}

function PLAT_ehDoProfessor_(lanc, nomeNorm, email) {
  var v = lanc.professor;
  return (email && v.toLowerCase() === email) || (nomeNorm && PLAT_norm_(v) === nomeNorm);
}

/** Semana mostrada no painel: a mais recente com lançamentos (até a semana atual). */
function PLAT_semanaAtualDados_(lancs) {
  var hoje = PLAT_chaveSemana_(PLAT_segunda_(new Date()));
  var mais = '';
  lancs.forEach(function (l) { if (l.semana <= hoje && l.semana > mais) mais = l.semana; });
  return mais || hoje;
}

function PLAT_status_(lancado, meta) {
  if (meta <= 0) return 'verde';
  var pct = lancado / meta;
  return pct >= 1 ? 'verde' : (pct >= 0.7 ? 'amarelo' : 'vermelho');
}

function PLAT_itens_(pares, metas, lancs, semana) {
  var itens = [];
  pares.forEach(function (p) {
    metas.forEach(function (m) {
      if (!m.universal && PLAT_norm_(m.disciplina) !== PLAT_norm_(p.disciplina)) return;
      if (!PLAT_valeParaTurma_(m.plataforma, p.turma)) return;
      var qtd = 0, teve = false;
      lancs.forEach(function (l) {
        if (l.semana !== semana || l.turma !== p.turma) return;
        if (PLAT_norm_(l.disciplina) !== PLAT_norm_(p.disciplina) || !PLAT_plataformasIguais_(l.plataforma, m.plataforma)) return;
        if (!PLAT_ehDoProfessor_(l, p.nomeNorm, p.email)) return;
        qtd += l.valor; teve = true;
      });
      itens.push({
        id: p.disciplina + '-' + p.turma + '-' + m.plataforma, nome: p.nome, email: p.email,
        disciplina: p.disciplina, turma: p.turma, plataforma: m.plataforma,
        meta_semanal: m.meta, qtd_lancada: Math.round(qtd * 1000) / 1000, lancado: teve,
        status: PLAT_status_(qtd, m.meta), universal: m.universal
      });
    });
  });
  return itens;
}

// ---------------------------------------------------------------------
//  Rotas GET
// ---------------------------------------------------------------------
function PLAT_meusLancamentos_(email, nome) {
  email = String(email || '').trim().toLowerCase();
  var nomeNorm = PLAT_norm_(nome);
  if (!email && !nomeNorm) return { erro: 'Usuário não informado', dados: [] };
  var lancs = PLAT_lancamentos_();
  var semana = PLAT_semanaAtualDados_(lancs);
  var pares = PLAT_aulas_().filter(function (p) { return p.nomeNorm === nomeNorm || (email && p.email === email); });
  var seg = PLAT_data_(semana);
  return { dados: PLAT_itens_(pares, PLAT_metas_(), lancs, semana), semana: semana, semanaRotulo: PLAT_rotuloSemana_(seg) };
}

function PLAT_historico_(email, nome) {
  email = String(email || '').trim().toLowerCase();
  var nomeNorm = PLAT_norm_(nome);
  var lancs = PLAT_lancamentos_().filter(function (l) { return PLAT_ehDoProfessor_(l, nomeNorm, email); });
  var ultima = PLAT_data_(PLAT_semanaAtualDados_(PLAT_lancamentos_()));
  var semanas = [], valores = [];
  for (var i = PLAT_CONFIG.SEMANAS_HISTORICO - 1; i >= 0; i--) {
    var seg = new Date(ultima.getFullYear(), ultima.getMonth(), ultima.getDate() - 7 * i);
    var chave = PLAT_chaveSemana_(seg);
    var total = lancs.filter(function (l) { return l.semana === chave; }).reduce(function (s, l) { return s + l.valor; }, 0);
    semanas.push(PLAT_rotuloSemana_(seg));
    valores.push(Math.round(total * 100) / 100);
  }
  return { semanas: semanas, valores: valores };
}

function PLAT_visaoGeral_(semanaPedida) {
  var lancs = PLAT_lancamentos_();
  var semana = /^\d{4}-\d{2}-\d{2}$/.test(String(semanaPedida || '')) ? semanaPedida : PLAT_semanaAtualDados_(lancs);
  return { dados: PLAT_itens_(PLAT_aulas_(), PLAT_metas_(), lancs, semana), semana: semana, semanaRotulo: PLAT_rotuloSemana_(PLAT_data_(semana)) };
}

function PLAT_metasRota_() {
  // Mesmo formato de antes (linhas da planilha), com a meta já corrigida na coluna D
  return { dados: PLAT_metas_().map(function (m) { var l = m.linha.slice(); l[3] = m.meta; return l; }),
           plataformas: PLAT_metas_().map(function (m) { return { plataforma: m.plataforma, disciplina: m.disciplina, universal: m.universal, meta: m.meta }; }) };
}

// ---------------------------------------------------------------------
//  POST IMPORTAR_LANCAMENTOS
//  { semana: "2026-11-16" (qualquer dia da semana de referência),
//    lancamentos: [{professor (e-mail ou nome), turma, plataforma, disciplina, valor}] }
// ---------------------------------------------------------------------
function PLAT_importar_(sessao, corpo) {
  var hoje = new Date(), fds = hoje.getDay() === 0 || hoje.getDay() === 6;
  var ref = PLAT_data_(corpo.semana) || (fds ? hoje : new Date(Date.now() - 7 * 86400000)); // padrão: última semana que terminou
  var segunda = PLAT_segunda_(ref);
  var chave = PLAT_chaveSemana_(segunda);
  var hojeSeg = PLAT_segunda_(new Date());
  if (segunda > hojeSeg) return { status: 'error', message: 'A semana de referência não pode ser no futuro.' };

  // Professores: aceita e-mail ou nome
  var usuarios = PLAT_linhas_('Usuários'), emailDoNome = {}, emails = {};
  usuarios.forEach(function (u) {
    var e = String(u[0] || '').trim().toLowerCase();
    if (!e) return;
    emails[e] = true;
    emailDoNome[PLAT_norm_(u[1])] = e;
  });
  var turmasValidas = {};
  PLAT_linhas_('Horarios').forEach(function (h) { if (h[1]) turmasValidas[PLAT_cod_(h[1])] = true; });

  var novos = [], erros = [];
  (Array.isArray(corpo.lancamentos) ? corpo.lancamentos : []).forEach(function (it, i) {
    var prof = String(it.professor || '').trim();
    var email = emails[prof.toLowerCase()] ? prof.toLowerCase() : emailDoNome[PLAT_norm_(prof)];
    var turma = PLAT_cod_(it.turma);
    var valor = PLAT_numero_(it.valor);
    var plat = String(it.plataforma || '').trim(), disc = String(it.disciplina || '').trim();
    if (!email) return erros.push('Linha ' + (i + 1) + ': professor não encontrado (' + prof + ')');
    if (!turma || (Object.keys(turmasValidas).length && !turmasValidas[turma])) return erros.push('Linha ' + (i + 1) + ': turma ' + (turma || '?') + ' não está na grade de horários');
    if (!plat || !disc) return erros.push('Linha ' + (i + 1) + ': falta plataforma ou disciplina');
    if (isNaN(valor) || valor < 0) return erros.push('Linha ' + (i + 1) + ': índice inválido (' + it.valor + ')');
    novos.push({ email: email, turma: turma, plat: plat, disc: disc, valor: valor });
  });
  if (erros.length && !corpo.ignorarErros) return { status: 'erros', message: 'Algumas linhas têm problemas.', erros: erros, validas: novos.length };
  if (!novos.length) return { status: 'error', message: 'Nenhum lançamento válido.' };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var aba = ss.getSheetByName(PLAT_CONFIG.ABA_LANC);
    if (!aba) {
      aba = ss.insertSheet(PLAT_CONFIG.ABA_LANC);
      aba.getRange(1, 1, 1, 11).setValues([['ID_Lanc', 'Professor_Email', 'Disciplina', 'Turma', 'Plataforma', 'Semana', 'Indice', 'Status', 'Observacao', 'Lancado_em', 'Lancado_por']]);
    }
    var dados = aba.getDataRange().getValues();
    var largura = Math.max(11, dados[0].length);
    var chaveLinha = function (email, turma, disc, plat) { return email + '|' + turma + '|' + PLAT_norm_(disc) + '|' + PLAT_norm_(plat === 'Desafio' ? 'Quizizz' : plat); };
    var substituir = {};
    novos.forEach(function (n) { substituir[chaveLinha(n.email, n.turma, n.disc, n.plat)] = true; });

    // Reimportar a mesma semana substitui o valor anterior (não soma em dobro)
    var manter = [], substituidos = 0;
    for (var i = 1; i < dados.length; i++) {
      var l = dados[i];
      if (!String(l[0] || l[1] || '').trim()) continue;
      var d = PLAT_data_(l[5]);
      if (d && PLAT_chaveSemana_(PLAT_segunda_(d)) === chave &&
          substituir[chaveLinha(String(l[1]).trim().toLowerCase(), PLAT_cod_(l[3]), l[2], String(l[4]).trim())]) { substituidos++; continue; }
      while (l.length < largura) l.push('');
      manter.push(l.slice(0, largura));
    }
    var agora = new Date();
    novos.forEach(function (n, k) {
      var linha = ['L' + agora.getTime() + '_' + k, n.email, n.disc, n.turma, n.plat, segunda, n.valor, 'OK', 'Importado do BI', agora, sessao.email];
      while (linha.length < largura) linha.push('');
      manter.push(linha);
    });
    if (dados.length > 1) aba.getRange(2, 1, dados.length - 1, largura).clearContent();
    aba.getRange(2, 1, manter.length, largura).setValues(manter);
    aba.getRange(2, 6, manter.length, 1).setNumberFormat('dd/MM/yyyy');
  } finally { lock.releaseLock(); }

  if (typeof SEG_auditar_ === 'function') SEG_auditar_(sessao, 'IMPORTAR_LANCAMENTOS', 'semana ' + chave + ': ' + novos.length + ' (' + substituidos + ' substituídos)');
  return { status: 'success', inseridos: novos.length, substituidos: substituidos, ignorados: erros.length, semana: chave, semanaRotulo: PLAT_rotuloSemana_(segunda) };
}
