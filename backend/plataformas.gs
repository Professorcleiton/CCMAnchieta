/**
 * =====================================================================
 *  SIGA v3 — Plataformas obrigatórias (Importar do BI + Painel do Professor)
 * =====================================================================
 *  Cole num arquivo novo do Apps Script chamado "plataformas".
 *  Substitui (pelo seguranca.gs) as rotas do Código.gs:
 *    GET  meus_lancamentos, historico_docente, visao_geral_docentes, metas_plataformas
 *    POST IMPORTAR_LANCAMENTOS, PLATAFORMAS_SALVAR (novo)
 *
 *  COMO FUNCIONA
 *   • O Power BI dá o índice POR TURMA (relatório acumulado do ano, índices já
 *     em média). A direção escolhe a plataforma e a semana, cola a tabela,
 *     confere a prévia e salva. Reimportar a mesma semana substitui.
 *   • O índice da turma aparece para o professor que dá, naquela turma, a
 *     disciplina da plataforma (pela grade de horários). Plataformas sem
 *     disciplina (Leia Paraná, Desafio Paraná) aparecem para todos da turma.
 *     Plataformas "pela disciplina do BI" (Robótica Paraná) vão para o professor
 *     da disciplina que vem na própria tabela (ex.: FISICA III no 3º A).
 *   • Linhas que o sistema não reconhece (turma do contraturno, por exemplo)
 *     podem ser ligadas à mão a uma turma ou a um professor na prévia; a escolha
 *     fica guardada para as próximas semanas.
 *
 *  Corrigido em relação ao Código.gs: data gravada como texto (semana errada ou
 *  sumindo), início da semana com hora (segunda não contava), reimportação
 *  somando em dobro, 3ANEM/1AGRO virando 3A/1A, meta da Matific 1.100 = 1100.
 *
 *  Abas:
 *   "Lancamentos_Plataformas" (a mesma de antes; linhas antigas continuam valendo)
 *     A ID | B Professor (vazio = pela grade) | C Disciplina | D Turma | E Plataforma |
 *     F Semana (segunda-feira) | G Índice | H Status | I Observação | J Lançado em |
 *     K Lançado por | L Alunos | M % Acessos | N Código SEED | O Linha do BI
 *   "Plataformas_Cobradas"  A Plataforma | B Outros nomes | C Disciplinas (vazio = todas) |
 *     D Séries (vazio = todas; ex.: 6, 7 · fundamental · médio · 1NEM) | E Coluna do BI |
 *     F Meta semanal | G Ativa | H Atribuir por ("grade" ou "disciplina do BI")
 *   "Plataformas_Turmas"  A Código SEED | B Turma da grade | C Professor (e-mail) | D Nome para mostrar
 * =====================================================================
 */

var PLAT_CONFIG = {
  ABA_LANC: 'Lancamentos_Plataformas',
  ABA_METAS_ANTIGA: 'Metas_Plataformas',
  ABA_REGRAS: 'Plataformas_Cobradas',
  ABA_TURMAS: 'Plataformas_Turmas',
  SEMANAS_HISTORICO: 5,
  CAB_LANC: ['ID_Lanc', 'Professor', 'Disciplina', 'Turma', 'Plataforma', 'Semana', 'Indice', 'Status', 'Observacao',
             'Lancado_em', 'Lancado_por', 'Alunos', 'Acessos_%', 'Codigo_SEED', 'Linha_BI'],
  CAB_REGRAS: ['Plataforma', 'Outros nomes', 'Disciplinas (vazio = todas)', 'Séries (vazio = todas)', 'Coluna do BI', 'Meta semanal', 'Ativa', 'Atribuir por'],
  // Plataformas cobradas em 2026 (tabelas do Power BI conferidas em 22/11/2026). Tudo editável na tela.
  PADRAO: [
    { plataforma: 'Redação Paraná', apelidos: 'Redação', disciplinas: 'Português, Língua Portuguesa, Redação', series: '', coluna: 'Índice Semanal de Redações Concluídas' },
    { plataforma: 'Leia Paraná', apelidos: 'Leia', disciplinas: '', series: '', coluna: 'Índice de Atividades Realizadas' },
    { plataforma: 'Inglês Teens', apelidos: 'Inglês Paraná, English Teens', disciplinas: 'Inglês, Língua Inglesa', series: '6, 7, 8', coluna: 'Índice de Lições Realizadas' },
    { plataforma: 'Inglês High', apelidos: 'Inglês Paraná, English High', disciplinas: 'Inglês, Língua Inglesa', series: '9, médio', coluna: 'Índice de Lições Realizadas' },
    { plataforma: 'Desafio Paraná', apelidos: 'Quizizz, Desafio', disciplinas: '', series: '', coluna: 'Índice de Respostas' },
    { plataforma: 'Robótica Paraná', apelidos: 'Robótica', disciplinas: 'Robótica', series: '', coluna: 'Índice de Respostas', atribuir: 'disciplina do BI' },
    { plataforma: 'Matemática Paraná', apelidos: 'Matific', disciplinas: 'Matemática', series: '6, 7', coluna: 'Índice de Tarefas Concluídas' },
    { plataforma: 'Khan Academy', apelidos: 'Khan', disciplinas: 'Matemática', series: '8, 9, médio', coluna: 'Minutos de aprendizagem' },
    { plataforma: 'Programação Paraná', apelidos: 'Programação, Alura', disciplinas: 'Programação, Pensamento Computacional', series: '', coluna: 'Índice de Exercícios Realizados' }
  ]
};

// ---------------------------------------------------------------------
//  Utilidades
// ---------------------------------------------------------------------
function PLAT_norm_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}
function PLAT_cod_(s) { return String(s || '').toUpperCase().replace(/\s+/g, ''); }
function PLAT_lista_(t) { return String(t || '').split(/[,;\/\n]+/).map(function (x) { return x.trim(); }).filter(String); }

function PLAT_data_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  var t = String(v || '').trim(), m;
  if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return new Date(+m[3], +m[2] - 1, +m[1]);
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})/))) return new Date(+m[1], +m[2] - 1, +m[3]);
  if (typeof v === 'number' && v > 30000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000));
  return null;
}
function PLAT_segunda_(d) {
  var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - (x.getDay() === 0 ? 6 : x.getDay() - 1));
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

/** "2,797" · "3.440" (milhar) · "96,7%" · "1.100,5" · 2.797 → número */
function PLAT_numero_(v, inteiro) {
  if (typeof v === 'number') return v;
  var t = String(v === null || v === undefined ? '' : v).trim().replace(/\s/g, '').replace('%', '');
  if (!t) return NaN;
  if (t.indexOf(',') !== -1) t = t.replace(/\./g, '').replace(',', '.');
  else if (inteiro && /^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  return parseFloat(t);
}

function PLAT_linhas_(nome) {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nome);
  return aba ? aba.getDataRange().getValues().slice(1) : [];
}

function PLAT_serie_(turma) {
  var c = PLAT_cod_(turma), m;
  if ((m = c.match(/^(\d)(NEM|FD|AGRO)$/) || c.match(/^(\d)[A-Z](NEM|FD|AGRO)$/) || c.match(/^(\d)([A-Z]{2,})$/))) return m[1] + m[2];
  m = c.match(/^(\d)[A-Z]?$/);
  return m ? m[1] : c;
}
function PLAT_ehMedio_(turma) { return /^\d[A-Z]{2,}$/.test(PLAT_serie_(turma)); }

/** séries: "6, 7" · "fundamental" · "médio" · "1NEM" · "9A" (vazio = todas) */
function PLAT_serieOk_(regra, turma) {
  var tokens = PLAT_lista_(regra.series).map(PLAT_norm_);
  if (!tokens.length) return true;
  var serie = PLAT_norm_(PLAT_serie_(turma)), medio = PLAT_ehMedio_(turma), t = PLAT_norm_(turma);
  return tokens.some(function (k) {
    if (k === 'fundamental' || k === 'ef') return !medio;
    if (k === 'medio' || k === 'em' || k === 'ensino medio') return medio;
    if (/^\d$/.test(k)) return !medio && serie === k;
    return k === serie || k === t;
  });
}

/** Disciplina "3444 - FISICA III" ≈ "Física" */
function PLAT_discBase_(d) {
  return PLAT_norm_(d).replace(/^\d+\s*-\s*/, '').replace(/\s+(i{1,3}|iv|v|vi{0,3})$/, '').trim();
}
function PLAT_discParecida_(a, b) {
  var x = PLAT_discBase_(a), y = PLAT_discBase_(b);
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 4 && (x.indexOf(y) === 0 || y.indexOf(x) === 0));
}
function PLAT_disciplinaOk_(regra, disciplina) {
  var ds = PLAT_lista_(regra.disciplinas);
  return !ds.length || ds.some(function (d) { return PLAT_discParecida_(d, disciplina); });
}

// ---------------------------------------------------------------------
//  Regras (plataformas cobradas)
// ---------------------------------------------------------------------
function PLAT_metaCorrigida_(r) {
  if (/matific|matematica parana/.test(PLAT_norm_(r.plataforma + ' ' + r.apelidos)) && r.meta > 100) return r.meta / 1000;
  return r.meta;
}

function PLAT_regras_() {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PLAT_CONFIG.ABA_REGRAS);
  var regras;
  if (aba) {
    regras = PLAT_linhas_(PLAT_CONFIG.ABA_REGRAS).filter(function (l) { return String(l[0] || '').trim(); }).map(function (l) {
      return { plataforma: String(l[0]).trim(), apelidos: String(l[1] || '').trim(), disciplinas: String(l[2] || '').trim(),
               series: String(l[3] || '').trim(), coluna: String(l[4] || '').trim(), meta: PLAT_numero_(l[5]) || 0,
               ativa: !/^n/i.test(String(l[6] || '').trim()), atribuir: /bi/i.test(String(l[7] || '')) ? 'disciplina do BI' : 'grade' };
    });
  } else {
    // Ainda não configurado: lista padrão + metas da aba antiga "Metas_Plataformas"
    var antigas = PLAT_linhas_(PLAT_CONFIG.ABA_METAS_ANTIGA);
    regras = PLAT_CONFIG.PADRAO.map(function (r) {
      var nomes = [r.plataforma].concat(PLAT_lista_(r.apelidos)).map(PLAT_norm_);
      var achou = antigas.filter(function (m) { return nomes.indexOf(PLAT_norm_(m[2])) !== -1; })[0];
      return { plataforma: r.plataforma, apelidos: r.apelidos, disciplinas: r.disciplinas, series: r.series, coluna: r.coluna,
               meta: achou ? PLAT_numero_(achou[3]) || 0 : 0, ativa: true, atribuir: r.atribuir || 'grade' };
    });
  }
  regras.forEach(function (r) {
    r.meta = PLAT_metaCorrigida_(r);
    r.nomes = [r.plataforma].concat(PLAT_lista_(r.apelidos)).map(PLAT_norm_);
  });
  return { padrao: !aba, regras: regras };
}

function PLAT_canonica_(nome, regras) {
  var n = PLAT_norm_(nome);
  for (var i = 0; i < regras.length; i++) if (regras[i].nomes.indexOf(n) !== -1) return regras[i];
  return null;
}
function PLAT_mesmaPlataforma_(nomeLanc, regra) { return regra.nomes.indexOf(PLAT_norm_(nomeLanc)) !== -1; }

function PLAT_salvarRegras_(sessao, corpo) {
  var linhas = [], vistos = {};
  (Array.isArray(corpo.regras) ? corpo.regras : []).forEach(function (r) {
    var nome = String(r.plataforma || '').trim().slice(0, 60);
    if (!nome || vistos[PLAT_norm_(nome)]) return;
    vistos[PLAT_norm_(nome)] = true;
    var meta = PLAT_numero_(r.meta);
    linhas.push([nome, String(r.apelidos || '').trim().slice(0, 200), String(r.disciplinas || '').trim().slice(0, 200),
                 String(r.series || '').trim().slice(0, 100), String(r.coluna || '').trim().slice(0, 120),
                 isNaN(meta) ? '' : meta, r.ativa === false ? 'Não' : 'Sim', /bi/i.test(String(r.atribuir || '')) ? 'disciplina do BI' : 'grade']);
  });
  if (!linhas.length) return { status: 'error', message: 'Cadastre pelo menos uma plataforma.' };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var aba = ss.getSheetByName(PLAT_CONFIG.ABA_REGRAS) || ss.insertSheet(PLAT_CONFIG.ABA_REGRAS);
    aba.clearContents();
    aba.getRange(1, 1, 1, 8).setValues([PLAT_CONFIG.CAB_REGRAS]);
    aba.getRange(2, 1, linhas.length, 8).setValues(linhas);
  } finally { lock.releaseLock(); }
  if (typeof SEG_auditar_ === 'function') SEG_auditar_(sessao, 'PLATAFORMAS_SALVAR', linhas.length + ' plataformas');
  return { status: 'success', plataformas: linhas.length };
}

// ---------------------------------------------------------------------
//  Turmas: "6º Série A Manhã - 2624496" → 6A
// ---------------------------------------------------------------------
function PLAT_canonTurma_(c) { return PLAT_cod_(c).replace(/^(\d)A(NEM|FD|AGRO)$/, '$1$2'); }

/** Nome do BI (+ coluna Curso, quando há) → código: "1º Série A Integral" + "FORM DOC..." → 1AFD */
function PLAT_codigoDoNome_(nome, curso) {
  var cur = PLAT_norm_(curso), sufixo = '';
  if (/form\w* doc|normal/.test(cur)) sufixo = 'FD';
  else if (/agro|agricola|agropec/.test(cur)) sufixo = 'AGRO';
  else if (/medio/.test(cur)) sufixo = 'NEM';
  var t = String(nome || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s*-?\s*\d{6,}(\s*\/\s*\d+)*\s*$/, ' ')
    .replace(/FORMACAO\s+DE\s+DOCENTES?/g, ' FD ').replace(/NOVO\s+ENSINO\s+MEDIO/g, ' NEM ')
    .replace(/(TECNICO\s+EM\s+)?AGRO\w*/g, ' AGRO ')
    .replace(/\b(ENSINO|FUNDAMENTAL|MEDIO|REGULAR|INTEGRAL|ANOS FINAIS|NOVO|DE|DA|DO)\b/g, ' ')
    .replace(/º|ª|°/g, '').replace(/-/g, ' ').replace(/\b(EF|EM|ANOS|ANO|SERIE)\b/g, '')
    .replace(/\b(MANHA|TARDE|NOITE)\b/g, '').replace(/\s+/g, '');
  if (sufixo && !/(NEM|FD|AGRO)$/.test(t)) t += sufixo;
  return t;
}

function PLAT_contextoTurmas_() {
  var grade = {};
  PLAT_linhas_('Horarios').forEach(function (h) { if (h[1]) grade[PLAT_cod_(h[1])] = true; });
  var porCanon = {};
  Object.keys(grade).forEach(function (c) { (porCanon[PLAT_canonTurma_(c)] = porCanon[PLAT_canonTurma_(c)] || []).push(c); });
  var ctx = { grade: grade, porCanon: porCanon, seed: {}, extra: {} };
  // aba "frequencia": A = nome da turma, E = código SEED ("2625776/775" = dois códigos)
  PLAT_linhas_('frequencia').forEach(function (l) {
    var nome = String(l[0] || '').trim();
    var alvo = nome ? PLAT_turmaPorNome_(nome, '', ctx) : '';
    if (!alvo) return;
    var base = '';
    String(l[4] || '').split(/[\/,;]/).forEach(function (c, i) {
      c = c.trim();
      if (!c) return;
      if (i > 0 && base && c.length < base.length) c = base.slice(0, base.length - c.length) + c;
      if (i === 0) base = c;
      if (/^\d{6,}$/.test(c)) ctx.seed[c] = alvo;
    });
  });
  // escolhas feitas na prévia
  PLAT_linhas_(PLAT_CONFIG.ABA_TURMAS).forEach(function (l) {
    var s = String(l[0] || '').trim();
    if (!s) return;
    if (l[1] && grade[PLAT_cod_(l[1])]) ctx.seed[s] = PLAT_cod_(l[1]);
    else if (l[2]) ctx.extra[s] = { professor: String(l[2]).trim().toLowerCase(), nome: String(l[3] || '').trim() || ('Turma ' + s) };
  });
  return ctx;
}

function PLAT_turmaPorNome_(nome, curso, ctx) {
  var c = PLAT_cod_(nome);
  if (ctx.grade[c]) return c;
  var d = PLAT_codigoDoNome_(nome, curso);
  if (ctx.grade[d]) return d;
  var lista = ctx.porCanon[PLAT_canonTurma_(d)] || [];
  return lista.length === 1 ? lista[0] : '';
}

/** { turma } (grade) · { extra: {professor, nome} } (contraturno ligado à mão) · {} */
function PLAT_acharTurma_(texto, curso, ctx) {
  var m = String(texto || '').match(/(\d{6,})\s*$/), seed = m ? m[1] : '';
  if (seed && ctx.seed[seed]) return { turma: ctx.seed[seed], seed: seed };
  if (seed && ctx.extra[seed]) return { extra: ctx.extra[seed], seed: seed };
  return { turma: PLAT_turmaPorNome_(texto, curso, ctx), seed: seed };
}

// ---------------------------------------------------------------------
//  Lançamentos e painel
// ---------------------------------------------------------------------
function PLAT_lancamentos_() {
  return PLAT_linhas_(PLAT_CONFIG.ABA_LANC).map(function (l) {
    var d = PLAT_data_(l[5]);
    if (!d || !String(l[3] || '').trim()) return null;
    return {
      professor: String(l[1] || '').trim(), disciplina: String(l[2] || '').trim(), turma: PLAT_cod_(l[3]),
      plataforma: String(l[4] || '').trim(), semana: PLAT_chaveSemana_(PLAT_segunda_(d)), valor: PLAT_numero_(l[6]) || 0,
      obs: String(l[8] || '').trim(), acessos: PLAT_numero_(l[12])
    };
  }).filter(Boolean);
}

function PLAT_aulas_() {
  var emailDoNome = {}, nomeDoEmail = {};
  PLAT_linhas_('Usuários').forEach(function (u) {
    if (!u[0] || !u[1]) return;
    var info = { email: String(u[0]).trim().toLowerCase(), nome: String(u[1]).trim() };
    emailDoNome[PLAT_norm_(u[1])] = info; nomeDoEmail[info.email] = info.nome;
  });
  var pares = {};
  PLAT_linhas_('Horarios').forEach(function (h) {
    var nome = PLAT_norm_(h[6]), disc = String(h[5] || '').trim(), turma = PLAT_cod_(h[1]);
    if (!nome || !disc || !turma) return;
    var info = emailDoNome[nome] || { email: '', nome: String(h[6]).trim() };
    pares[nome + '||' + PLAT_norm_(disc) + '||' + turma] = { nomeNorm: nome, nome: info.nome, email: info.email, disciplina: disc, turma: turma };
  });
  var lista = Object.keys(pares).map(function (k) { return pares[k]; });
  lista.nomeDoEmail = nomeDoEmail;
  return lista;
}

function PLAT_ultimaSemana_(lancs) {
  var hoje = PLAT_chaveSemana_(PLAT_segunda_(new Date())), mais = '';
  lancs.forEach(function (l) { if (l.semana <= hoje && l.semana > mais) mais = l.semana; });
  return mais || hoje;
}
function PLAT_status_(v, meta, lancado) {
  if (!lancado) return 'sem_lancamento';
  if (!(meta > 0)) return 'sem_meta';
  var p = v / meta;
  return p >= 1 ? 'verde' : (p >= 0.7 ? 'amarelo' : 'vermelho');
}
function PLAT_semanaAnterior_(semana) {
  var d = PLAT_data_(semana);
  return PLAT_chaveSemana_(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7));
}

/**
 * Itens do painel (um por professor + turma + plataforma).
 * filtroProf: { nomeNorm, email } para um professor só, ou null para a escola toda.
 */
function PLAT_itens_(filtroProf, semana) {
  var aulas = PLAT_aulas_(), regras = PLAT_regras_().regras, lancs = PLAT_lancamentos_();
  var anterior = PLAT_semanaAnterior_(semana);
  var meu = function (p) { return !filtroProf || p.nomeNorm === filtroProf.nomeNorm || (filtroProf.email && p.email === filtroProf.email); };
  var itens = {}, ordem = [];
  var item = function (k, base) { if (!itens[k]) { itens[k] = base; ordem.push(k); } return itens[k]; };
  var valorDe = function (lista) { return lista.length ? Math.round(lista.reduce(function (s, l) { return s + l.valor; }, 0) * 1000) / 1000 : null; };

  regras.forEach(function (r) {
    if (!r.ativa) return;
    var daPlat = lancs.filter(function (l) { return PLAT_mesmaPlataforma_(l.plataforma, r); });
    var naSemana = function (sem) { return daPlat.filter(function (l) { return l.semana === sem; }); };
    var agora = naSemana(semana), antes = naSemana(anterior);

    // Linhas ligadas a um professor (contraturno) ou, na Robótica, à disciplina do BI
    var porChave = {};
    var porLancamento = function (lista) {
      lista.forEach(function (l) {
        var donos = [];
        if (l.professor) {
          var nomeP = aulas.nomeDoEmail[l.professor.toLowerCase()] || l.professor;
          donos.push({ nome: nomeP, nomeNorm: PLAT_norm_(nomeP), email: l.professor.toLowerCase(), disciplina: l.disciplina, turma: l.turma, rotulo: l.obs });
        } else {
          aulas.forEach(function (p) { if (p.turma === l.turma && PLAT_discParecida_(p.disciplina, l.disciplina)) donos.push(p); });
        }
        donos.forEach(function (p) {
          if (!meu(p)) return;
          var k = p.nomeNorm + '|' + l.turma + '|' + r.plataforma + '|' + PLAT_discBase_(l.disciplina);
          var it = porChave[k] || (porChave[k] = item(k, {
            nome: p.nome, email: p.email, disciplina: l.disciplina || p.disciplina, turma: p.rotulo || l.turma, plataforma: r.plataforma,
            meta_semanal: r.meta, universal: false, _agora: [], _antes: []
          }));
          (l.semana === semana ? it._agora : it._antes).push(l);
        });
      });
    };
    if (r.atribuir === 'disciplina do BI') { porLancamento(agora.concat(antes)); return; }
    porLancamento(agora.concat(antes).filter(function (l) { return l.professor && /^X/.test(l.turma); }));

    aulas.forEach(function (p) {
      if (!meu(p) || !PLAT_disciplinaOk_(r, p.disciplina) || !PLAT_serieOk_(r, p.turma)) return;
      var k = p.nomeNorm + '|' + p.turma + '|' + r.plataforma;
      if (itens[k]) { if (itens[k].disciplina.indexOf(p.disciplina) === -1) itens[k].disciplina += ', ' + p.disciplina; return; }
      // índice da turma (lançamento sem professor); lançamentos antigos por professor também valem
      var escolher = function (lista) {
        var daTurma = lista.filter(function (l) { return l.turma === p.turma && !l.professor; });
        if (daTurma.length) return daTurma.slice(-1);
        return lista.filter(function (l) {
          return l.turma === p.turma && l.professor && ((p.email && l.professor.toLowerCase() === p.email) || PLAT_norm_(l.professor) === p.nomeNorm);
        });
      };
      item(k, { nome: p.nome, email: p.email, disciplina: p.disciplina, turma: p.turma, plataforma: r.plataforma,
                meta_semanal: r.meta, universal: !PLAT_lista_(r.disciplinas).length, _agora: escolher(agora), _antes: escolher(antes) });
    });
  });

  return ordem.map(function (k) {
    var it = itens[k], v = valorDe(it._agora), a = valorDe(it._antes);
    var ac = it._agora.length ? it._agora[it._agora.length - 1].acessos : NaN;
    var saida = {
      id: k, nome: it.nome, email: it.email, disciplina: it.disciplina, turma: it.turma, plataforma: it.plataforma,
      meta_semanal: it.meta_semanal, qtd_lancada: v === null ? 0 : v, lancado: v !== null,
      anterior: a, variacao: (v !== null && a !== null) ? Math.round((v - a) * 1000) / 1000 : null,
      acessos: isNaN(ac) ? null : ac, universal: it.universal
    };
    saida.status = PLAT_status_(saida.qtd_lancada, it.meta_semanal, saida.lancado);
    return saida;
  });
}

// ---------------------------------------------------------------------
//  Rotas GET
// ---------------------------------------------------------------------
function PLAT_meusLancamentos_(email, nome) {
  email = String(email || '').trim().toLowerCase();
  var nomeNorm = PLAT_norm_(nome);
  if (!email && !nomeNorm) return { erro: 'Usuário não informado', dados: [] };
  var semana = PLAT_ultimaSemana_(PLAT_lancamentos_());
  return { dados: PLAT_itens_({ email: email, nomeNorm: nomeNorm }, semana), semana: semana, semanaRotulo: PLAT_rotuloSemana_(PLAT_data_(semana)) };
}

/** Histórico do professor: média do % da meta atingido em cada semana importada. */
function PLAT_historico_(email, nome) {
  email = String(email || '').trim().toLowerCase();
  var filtro = { email: email, nomeNorm: PLAT_norm_(nome) };
  var ultima = PLAT_data_(PLAT_ultimaSemana_(PLAT_lancamentos_()));
  var semanas = [], valores = [];
  for (var i = PLAT_CONFIG.SEMANAS_HISTORICO - 1; i >= 0; i--) {
    var seg = new Date(ultima.getFullYear(), ultima.getMonth(), ultima.getDate() - 7 * i);
    var itens = PLAT_itens_(filtro, PLAT_chaveSemana_(seg)).filter(function (x) { return x.lancado && x.meta_semanal > 0; });
    var media = itens.length ? itens.reduce(function (s, x) { return s + Math.min(2, x.qtd_lancada / x.meta_semanal); }, 0) / itens.length * 100 : 0;
    semanas.push(PLAT_rotuloSemana_(seg));
    valores.push(Math.round(media));
  }
  return { semanas: semanas, valores: valores, unidade: '% da meta' };
}

function PLAT_visaoGeral_(semanaPedida) {
  var semana = /^\d{4}-\d{2}-\d{2}$/.test(String(semanaPedida || '')) ? semanaPedida : PLAT_ultimaSemana_(PLAT_lancamentos_());
  return { dados: PLAT_itens_(null, semana), semana: semana, semanaRotulo: PLAT_rotuloSemana_(PLAT_data_(semana)) };
}

function PLAT_metasRota_() {
  var r = PLAT_regras_();
  var professores = PLAT_linhas_('Usuários').filter(function (u) { return u[0] && u[1]; })
    .map(function (u) { return { email: String(u[0]).trim().toLowerCase(), nome: String(u[1]).trim() }; })
    .sort(function (a, b) { return a.nome.localeCompare(b.nome); });
  return {
    status: 'success', padrao: r.padrao, turmas: Object.keys(PLAT_contextoTurmas_().grade).sort(), professores: professores,
    plataformas: r.regras.map(function (x) {
      return { plataforma: x.plataforma, apelidos: x.apelidos, disciplinas: x.disciplinas, series: x.series, coluna: x.coluna, meta: x.meta, ativa: x.ativa, atribuir: x.atribuir };
    }),
    dados: r.regras.map(function (x) { return ['', x.disciplinas, x.plataforma, x.meta, '', '', '', PLAT_lista_(x.disciplinas).length ? '' : 'SIM']; })
  };
}

// ---------------------------------------------------------------------
//  POST IMPORTAR_LANCAMENTOS
//  { semana: "2026-11-16", plataforma: "Matemática Paraná", previa: true|false,
//    linhas: [{ texto: "6º Série A Manhã - 2624496", curso, disciplina, valor, alunos, acessos, linha (texto original),
//               turma (escolhida na prévia) | professor + nome (contraturno) }] }
//  Na mesma turma, linhas repetidas (médio com 2 códigos) viram uma, ponderada pelos alunos.
// ---------------------------------------------------------------------
function PLAT_importar_(sessao, corpo) {
  var regras = PLAT_regras_().regras;
  var regra = PLAT_canonica_(corpo.plataforma, regras);
  if (!regra) return { status: 'error', message: 'Escolha a plataforma (ela precisa estar na lista de plataformas cobradas).' };
  var hoje = new Date(), fds = hoje.getDay() === 0 || hoje.getDay() === 6;
  var segunda = PLAT_segunda_(PLAT_data_(corpo.semana) || (fds ? hoje : new Date(Date.now() - 7 * 86400000)));
  if (segunda > PLAT_segunda_(hoje)) return { status: 'error', message: 'A semana de referência não pode ser no futuro.' };
  var chave = PLAT_chaveSemana_(segunda);
  var porBI = regra.atribuir === 'disciplina do BI';

  var ctx = PLAT_contextoTurmas_();
  var emails = {};
  PLAT_linhas_('Usuários').forEach(function (u) { if (u[0]) emails[String(u[0]).trim().toLowerCase()] = String(u[1] || '').trim(); });

  var grupos = {}, ordem = [], problemas = [], aprender = [];
  (Array.isArray(corpo.linhas) ? corpo.linhas : []).forEach(function (l, i) {
    var valor = PLAT_numero_(l.valor);
    var achada = PLAT_acharTurma_(l.texto, l.curso, ctx);
    var turma = '', professor = '', rotulo = '';
    if (l.turma && ctx.grade[PLAT_cod_(l.turma)]) {
      turma = PLAT_cod_(l.turma);
      if (achada.seed) aprender.push([achada.seed, turma, '', '']);
    } else if (l.professor && emails[String(l.professor).toLowerCase()]) {
      professor = String(l.professor).toLowerCase();
      rotulo = String(l.nome || '').trim().slice(0, 60) || String(l.disciplina || '').replace(/^\d+\s*-\s*/, '').trim() || ('Turma ' + achada.seed);
      turma = 'X' + (achada.seed || i);
      if (achada.seed) aprender.push([achada.seed, '', professor, rotulo]);
    } else if (achada.extra) {
      professor = achada.extra.professor; rotulo = achada.extra.nome; turma = 'X' + achada.seed;
    } else if (achada.turma) {
      turma = achada.turma;
    }
    var info = { linha: i, texto: String(l.texto || ''), disciplina: String(l.disciplina || ''), seed: achada.seed, valor: valor };
    if (!turma) { info.problema = 'turma não identificada'; problemas.push(info); return; }
    if (isNaN(valor)) { info.problema = 'índice inválido ou coluna não encontrada'; problemas.push(info); return; }
    var disc = porBI ? String(l.disciplina || '').trim() : '';
    var k = turma + '|' + professor + '|' + PLAT_discBase_(disc);
    var g = grupos[k];
    if (!g) { g = grupos[k] = { turma: turma, professor: professor, rotulo: rotulo, disciplina: disc, seeds: [], textos: [], peso: 0, soma: 0, alunos: 0, acessosPeso: 0, linhasBI: [] }; ordem.push(k); }
    var alunos = PLAT_numero_(l.alunos, true) || 0, peso = alunos || 1;
    g.textos.push(info.texto); if (achada.seed) g.seeds.push(achada.seed);
    g.peso += peso; g.soma += valor * peso; g.alunos += alunos;
    var ac = PLAT_numero_(l.acessos); if (!isNaN(ac)) g.acessosPeso += ac * peso;
    g.linhasBI.push(String(l.linha || '').slice(0, 500));
  });

  var r3 = function (x) { return Math.round(x * 1000) / 1000; };
  var turmas = ordem.map(function (k) {
    var g = grupos[k], v = r3(g.soma / g.peso);
    var prof = g.professor ? (emails[g.professor] || g.professor) : '';
    return { turma: g.turma, rotulo: g.rotulo || g.turma, professor: prof, disciplina: g.disciplina, linhasBI: g.textos.length, textos: g.textos,
             valor: v, alunos: g.alunos, acessos: r3(g.acessosPeso / g.peso), meta: regra.meta, status: PLAT_status_(v, regra.meta, true),
             foraDasSeries: !g.professor && !porBI && !PLAT_serieOk_(regra, g.turma), _g: g };
  });
  var resposta = { plataforma: regra.plataforma, coluna: regra.coluna, meta: regra.meta, semana: chave, semanaRotulo: PLAT_rotuloSemana_(segunda),
                   turmas: turmas.map(function (t) { var o = {}; Object.keys(t).forEach(function (x) { if (x !== '_g') o[x] = t[x]; }); return o; }),
                   problemas: problemas, turmasDaGrade: Object.keys(ctx.grade).sort() };
  if (corpo.previa) { resposta.status = 'previa'; return resposta; }
  if (!turmas.length) { resposta.status = 'error'; resposta.message = 'Nenhuma turma identificada.'; return resposta; }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  var substituidos = 0;
  try {
    var aba = ss.getSheetByName(PLAT_CONFIG.ABA_LANC);
    if (!aba) { aba = ss.insertSheet(PLAT_CONFIG.ABA_LANC); aba.getRange(1, 1, 1, PLAT_CONFIG.CAB_LANC.length).setValues([PLAT_CONFIG.CAB_LANC]); }
    var dados = aba.getDataRange().getValues();
    var largura = Math.max(PLAT_CONFIG.CAB_LANC.length, dados[0].length);
    var cab = dados[0].slice(); while (cab.length < largura) cab.push('');
    for (var c = 9; c < PLAT_CONFIG.CAB_LANC.length; c++) if (!String(cab[c] || '').trim()) cab[c] = PLAT_CONFIG.CAB_LANC[c];
    var novas = {};
    turmas.forEach(function (t) { novas[t.turma] = true; });
    // Reimportar a mesma semana + plataforma + turma substitui (inclusive lançamentos antigos por professor)
    var manter = [];
    for (var i = 1; i < dados.length; i++) {
      var l = dados[i];
      if (!String(l[0] || l[3] || '').trim()) continue;
      var d = PLAT_data_(l[5]);
      if (d && PLAT_chaveSemana_(PLAT_segunda_(d)) === chave && novas[PLAT_cod_(l[3])] && PLAT_mesmaPlataforma_(l[4], regra)) { substituidos++; continue; }
      while (l.length < largura) l.push('');
      manter.push(l.slice(0, largura));
    }
    var agora = new Date();
    turmas.forEach(function (t, k) {
      var g = t._g;
      var linha = ['P' + agora.getTime() + '_' + k, g.professor, g.disciplina, t.turma, regra.plataforma, segunda, t.valor, 'OK',
                   g.rotulo || ('Importado do BI' + (t.linhasBI > 1 ? ' (' + t.linhasBI + ' linhas)' : '')), agora, sessao.email,
                   t.alunos, t.acessos, g.seeds.join('/'), g.linhasBI.join(' | ').slice(0, 1000)];
      while (linha.length < largura) linha.push('');
      manter.push(linha);
    });
    aba.getRange(1, 1, 1, largura).setValues([cab]);
    if (dados.length > 1) aba.getRange(2, 1, dados.length - 1, largura).clearContent();
    aba.getRange(2, 1, manter.length, largura).setValues(manter);
    aba.getRange(2, 6, manter.length, 1).setNumberFormat('dd/MM/yyyy');

    if (aprender.length) {
      var abaT = ss.getSheetByName(PLAT_CONFIG.ABA_TURMAS);
      if (!abaT) { abaT = ss.insertSheet(PLAT_CONFIG.ABA_TURMAS); abaT.getRange(1, 1, 1, 4).setValues([['Código SEED', 'Turma da grade', 'Professor (e-mail)', 'Nome para mostrar']]); }
      var novosSeeds = {};
      aprender.forEach(function (a) { novosSeeds[a[0]] = true; });
      var todas = abaT.getDataRange().getValues().slice(1).filter(function (x) { return x[0] && !novosSeeds[String(x[0]).trim()]; })
        .map(function (x) { return [String(x[0]), x[1] || '', x[2] || '', x[3] || '']; }).concat(aprender);
      if (abaT.getLastRow() > 1) abaT.getRange(2, 1, abaT.getLastRow() - 1, 4).clearContent();
      abaT.getRange(2, 1, todas.length, 4).setValues(todas);
    }
  } finally { lock.releaseLock(); }

  if (typeof SEG_auditar_ === 'function') SEG_auditar_(sessao, 'IMPORTAR_LANCAMENTOS', regra.plataforma + ' semana ' + chave + ': ' + turmas.length + ' turmas');
  resposta.status = 'success';
  resposta.inseridos = turmas.length;
  resposta.substituidos = substituidos;
  resposta.ignorados = problemas.length;
  return resposta;
}
