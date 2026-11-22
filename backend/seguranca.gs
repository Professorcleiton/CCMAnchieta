/**
 * =====================================================================
 *  SIGA v3 — Camada de segurança do backend (Google Apps Script)
 * =====================================================================
 *  COMO USAR (resumo — o passo a passo completo está em backend/INTEGRACAO.md):
 *
 *   1. Crie um arquivo novo no projeto do Apps Script chamado "seguranca.gs"
 *      e cole TODO este conteúdo.
 *   2. No seu código atual, renomeie:
 *         function doGet(e)  ->  function doGetOriginal(e)
 *         function doPost(e) ->  function doPostOriginal(e)
 *   3. Este arquivo cria novos doGet/doPost que conferem o token, as
 *      permissões e o vínculo dos responsáveis ANTES de chamar o seu código.
 *   4. Implante uma NOVA VERSÃO da implantação existente (mesma URL).
 *
 *  O que esta camada faz:
 *   - Exige login (token) em toda leitura e escrita, exceto login/cadastro/recuperação.
 *   - Confere o nível de acesso por operação NO SERVIDOR.
 *   - Responsáveis: cadastro fica PENDENTE até a secretaria aprovar; depois
 *     de aprovado, só recebem dados dos alunos vinculados (filtro no servidor).
 *   - Nova rota ?aba=tabela&nome=Alunos para o site parar de ler a planilha
 *     pública (GViz).
 *   - Registro de auditoria (aba "Auditoria").
 *   - Recuperação de senha por e-mail com código de 6 dígitos.
 *   - Funções de hash de senha (SHA-256 + salt) com migração automática.
 * =====================================================================
 */

// ---------------------------------------------------------------------
// CONFIGURAÇÃO — ajuste os nomes das abas/colunas se forem diferentes
// ---------------------------------------------------------------------
var SEG_CONFIG = {
  ABA_ALUNOS: 'Alunos',                 // coluna B = nome, coluna C = turma
  ABA_USUARIOS: 'Usuarios',             // precisa ter cabeçalhos "email" e "senha"
  ABA_RESPONSAVEIS: 'Responsaveis',     // precisa ter cabeçalhos "email" e "senha"
  ABA_VINCULOS: 'Vinculos_Responsaveis',// criada automaticamente
  ABA_AUDITORIA: 'Auditoria',           // criada automaticamente

  SESSAO_SEGUNDOS: 6 * 60 * 60,         // 6h (limite máximo do CacheService)

  // Responsáveis que JÁ tinham conta antes desta atualização:
  //  true  = continuam entrando; o vínculo é criado como "APROVADO (legado)"
  //          e aparece em aprovar-responsaveis.html para a secretaria revisar/revogar.
  //  false = todos precisam ser aprovados de novo (mais seguro, mas bloqueia
  //          as famílias até a secretaria aprovar).
  LIBERAR_RESPONSAVEIS_LEGADO: true,

  // Deixe false até adaptar o seu LOGIN para usar SEG_conferirSenha() (ver INTEGRACAO.md).
  // Com true, senhas redefinidas pelo "Esqueci minha senha" são salvas com hash.
  SALVAR_SENHA_COM_HASH: false,

  NOME_SISTEMA: 'SIGA - CCM Anchieta',
  URL_SITE: 'https://www.ccmanchieta.com.br'
};

// Nível mínimo por operação. Operações não listadas exigem nível 1 (qualquer servidor logado).
var SEG_NIVEL_MINIMO = {
  // GET (?aba= / ?operacao=)
  'usuarios': 3,
  'responsaveis_cadastros': 3,
  'avaliacoes_listar': 3,
  'avaliacoes_estatisticas': 3,
  'disciplinas_todas': 3,
  // POST (operacao)
  'USER_SALVAR': 3,
  'USER_DELETAR': 3,
  'APROVAR_RESPONSAVEL': 3,
  'RECUSAR_RESPONSAVEL': 3,
  'MARCAR_PEDIDO_IMPRESSO': 3,
  'CANCELAR_PEDIDO_AVALIACAO': 1,
  'IMPORTAR_LANCAMENTOS': 3,
  'SALVAR_FATO_SEED': 3,
  'ALUNO_ADICIONAR': 3,
  'PAT_CADASTRAR': 3,
  'PAT_EXCLUIR': 3,
  'AMB_ADICIONAR': 3,
  'AMB_DELETAR': 3,
  'PROGRESSAO_TURMAS': 4,
  'SALVAR_GRADE': 4
};

// Operações que não exigem token
var SEG_PUBLICAS = ['LOGIN', 'LOGIN_RESPONSAVEL', 'CADASTRAR_RESPONSAVEL', 'RECUPERAR_SENHA', 'REDEFINIR_SENHA'];

// O que um RESPONSÁVEL logado pode chamar (todo o resto é negado)
var SEG_PERMITIDO_RESPONSAVEL = {
  GET: ['todos_os_dados', 'listar_documentos_aluno', 'fatos_emitidos', 'horarios', 'alunos'],
  POST: ['salvar_token_push', 'upload_documento', 'verificar_atualizacao', 'LOGOUT']
};

// Listas de ?operacao=todos_os_dados que um responsável pode receber (já filtradas pelo filho)
var SEG_CHAVES_RESPONSAVEL = ['apontamentos', 'documentos', 'ocorrencias', 'atas'];

// Abas que podem ser lidas por ?aba=tabela&nome=...
var SEG_TABELAS_LIBERADAS = { 'Alunos': 1, 'Pre_Conselho': 1 };

// Operações registradas na auditoria além de todas as escritas (POST)
var SEG_AUDITAR_GET = ['usuarios', 'todos_os_dados', 'tabela', 'responsaveis_cadastros', 'fatos_aluno'];


// =====================================================================
//  PONTOS DE ENTRADA (substituem os seus doGet/doPost)
// =====================================================================
function doGet(e) {
  e = e || { parameter: {} };
  var p = e.parameter || {};
  var rota = p.aba || p.operacao || '';

  var sessao = SEG_validarSessao_(p.token);
  if (!sessao) return SEG_json_({ status: 'unauthorized', message: 'Sessão expirada. Entre novamente.' });

  var negado = SEG_checarPermissao_(sessao, rota, 'GET', p);
  if (negado) return negado;

  if (SEG_AUDITAR_GET.indexOf(rota) !== -1) SEG_auditar_(sessao, 'GET ' + rota, p.aluno || p.nome || p.turma || '');

  // Rotas novas desta camada
  if (rota === 'tabela') return SEG_json_(SEG_lerTabelaGviz_(p.nome));
  if (rota === 'responsaveis_cadastros') return SEG_json_(SEG_listarVinculos_());

  var saida = doGetOriginal(e);
  if (sessao.tipo === 'responsavel') saida = SEG_filtrarSaidaResponsavel_(saida, sessao, rota);
  return saida;
}

function doPost(e) {
  var corpo = {};
  try { corpo = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
  var op = corpo.operacao || '';

  // ---- Operações públicas ----
  if (op === 'RECUPERAR_SENHA') return SEG_json_(SEG_recuperarSenha_(corpo));
  if (op === 'REDEFINIR_SENHA') return SEG_json_(SEG_redefinirSenha_(corpo));

  if (op === 'LOGIN') {
    var saidaLogin = doPostOriginal(e);
    return SEG_posLoginServidor_(saidaLogin, corpo);
  }
  if (op === 'LOGIN_RESPONSAVEL') {
    var saidaResp = doPostOriginal(e);
    return SEG_posLoginResponsavel_(saidaResp, corpo);
  }
  if (op === 'CADASTRAR_RESPONSAVEL') {
    var saidaCad = doPostOriginal(e);
    return SEG_posCadastroResponsavel_(saidaCad, corpo);
  }

  // ---- Daqui para baixo, só com sessão válida ----
  var sessao = SEG_validarSessao_(corpo.token);
  if (!sessao) return SEG_json_({ status: 'unauthorized', message: 'Sessão expirada. Entre novamente.' });

  var negado = SEG_checarPermissao_(sessao, op, 'POST', corpo);
  if (negado) return negado;

  // Nunca confie em email/nível enviados pelo navegador: usa os da sessão
  corpo.emailSessao = sessao.email;
  corpo.nivelSessao = sessao.nivel;
  e.postData.contents = JSON.stringify(corpo); // seu doPostOriginal lê daqui

  if (op === 'LOGOUT') {
    SEG_encerrarSessao_(corpo.token);
    SEG_auditar_(sessao, 'LOGOUT', '');
    return doPostOriginal(e);
  }
  if (op === 'APROVAR_RESPONSAVEL') return SEG_json_(SEG_decidirVinculo_(sessao, corpo.email, true, corpo.alunos));
  if (op === 'RECUSAR_RESPONSAVEL') return SEG_json_(SEG_decidirVinculo_(sessao, corpo.email, false, []));

  SEG_auditar_(sessao, op, SEG_resumoAuditoria_(corpo));
  return doPostOriginal(e);
}


// =====================================================================
//  SESSÕES
// =====================================================================
function SEG_criarSessao_(dados) {
  var token = dados.token || (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  var sessao = {
    email: String(dados.email || '').toLowerCase(),
    nome: dados.nome || '',
    nivel: parseInt(dados.nivel, 10) || 0,
    setor: dados.setor || '',
    tipo: dados.tipo || 'servidor',
    alunos: dados.alunos || [],
    criadaEm: Date.now()
  };
  CacheService.getScriptCache().put('sess_' + token, JSON.stringify(sessao), SEG_CONFIG.SESSAO_SEGUNDOS);
  return token;
}

function SEG_validarSessao_(token) {
  if (!token || typeof token !== 'string' || token.length < 20) return null;
  var bruto = CacheService.getScriptCache().get('sess_' + token);
  if (!bruto) return null;
  try { return JSON.parse(bruto); } catch (e) { return null; }
}

function SEG_encerrarSessao_(token) {
  if (token) CacheService.getScriptCache().remove('sess_' + token);
}

function SEG_checarPermissao_(sessao, rota, metodo, params) {
  if (sessao.tipo === 'responsavel') {
    if (SEG_PERMITIDO_RESPONSAVEL[metodo].indexOf(rota) === -1) {
      return SEG_json_({ status: 'forbidden', message: 'Acesso não permitido.' });
    }
    // Se pedir dados de um aluno específico, ele precisa estar vinculado
    var pedidos = [];
    if (params.aluno) pedidos.push(params.aluno);
    if (params.alunos) pedidos = pedidos.concat(String(params.alunos).split(/[,;|]/));
    var permitidos = sessao.alunos.map(SEG_normalizar_);
    for (var i = 0; i < pedidos.length; i++) {
      var n = SEG_normalizar_(pedidos[i]);
      if (n && permitidos.indexOf(n) === -1) {
        return SEG_json_({ status: 'forbidden', message: 'Aluno não vinculado a este responsável.' });
      }
    }
    return null;
  }

  var minimo = SEG_NIVEL_MINIMO[rota] || 1;
  if ((parseInt(sessao.nivel, 10) || 0) < minimo) {
    SEG_auditar_(sessao, 'NEGADO ' + metodo + ' ' + rota, 'nível ' + sessao.nivel + ' < ' + minimo);
    return SEG_json_({ status: 'forbidden', message: 'Você não tem permissão para esta ação.' });
  }
  return null;
}


// =====================================================================
//  LOGIN / CADASTRO (pós-processamento do seu código original)
// =====================================================================
function SEG_posLoginServidor_(saida, corpo) {
  var dados = SEG_lerSaida_(saida);
  if (!dados || dados.status !== 'success') return saida;
  dados.token = SEG_criarSessao_({
    token: dados.token, email: corpo.email, nome: dados.nome,
    nivel: dados.nivel, setor: dados.setor, tipo: 'servidor'
  });
  SEG_auditar_({ email: corpo.email, tipo: 'servidor' }, 'LOGIN', '');
  return SEG_json_(dados);
}

function SEG_posCadastroResponsavel_(saida, corpo) {
  var dados = SEG_lerSaida_(saida);
  if (!dados || dados.status !== 'success') return saida;

  var filhos = [];
  try { filhos = JSON.parse(corpo.filhos || '[]'); } catch (e) {}
  SEG_salvarVinculo_({
    email: String(corpo.email || '').toLowerCase(),
    nome: corpo.nome || '',
    telefone: corpo.telefone || '',
    filhosDigitados: filhos,
    status: 'PENDENTE',
    alunosAprovados: [],
    aprovadoPor: ''
  });
  SEG_auditar_({ email: corpo.email, tipo: 'responsavel' }, 'CADASTRAR_RESPONSAVEL', filhos.join(', '));
  return SEG_json_({
    status: 'pending',
    message: 'Cadastro recebido! A secretaria vai confirmar o vínculo com o(s) aluno(s). Você poderá entrar assim que for aprovado.'
  });
}

function SEG_posLoginResponsavel_(saida, corpo) {
  var dados = SEG_lerSaida_(saida);
  if (!dados || dados.status !== 'success') return saida;

  var email = String(corpo.email || '').toLowerCase();
  var vinculo = SEG_buscarVinculo_(email);

  if (!vinculo) {
    if (!SEG_CONFIG.LIBERAR_RESPONSAVEIS_LEGADO) {
      SEG_salvarVinculo_({ email: email, nome: dados.nome || '', telefone: dados.telefone || '',
        filhosDigitados: dados.alunos || [], status: 'PENDENTE', alunosAprovados: [], aprovadoPor: '' });
      return SEG_json_({ status: 'pending', message: 'Seu cadastro precisa ser confirmado pela secretaria.' });
    }
    // Conta antiga: libera, mas registra para revisão
    var oficiais = (dados.alunos || []).map(function (n) { var a = SEG_resolverAluno_(n); return a ? a.nome : n; });
    vinculo = { email: email, nome: dados.nome || '', telefone: dados.telefone || '',
      filhosDigitados: dados.alunos || [], status: 'APROVADO', alunosAprovados: oficiais, aprovadoPor: 'LEGADO - revisar' };
    SEG_salvarVinculo_(vinculo);
  }

  if (vinculo.status === 'PENDENTE') {
    return SEG_json_({ status: 'pending', message: 'Seu cadastro ainda está aguardando a confirmação da secretaria.' });
  }
  if (vinculo.status !== 'APROVADO') {
    return SEG_json_({ status: 'error', message: 'Cadastro não aprovado. Procure a secretaria da escola.' });
  }

  dados.alunos = vinculo.alunosAprovados;   // SÓ os aprovados pela secretaria
  dados.token = SEG_criarSessao_({
    email: email, nome: dados.nome, nivel: 0, tipo: 'responsavel', alunos: vinculo.alunosAprovados
  });
  SEG_auditar_({ email: email, tipo: 'responsavel' }, 'LOGIN_RESPONSAVEL', '');
  return SEG_json_(dados);
}


// =====================================================================
//  VÍNCULOS RESPONSÁVEL ↔ ALUNO (aba Vinculos_Responsaveis)
// =====================================================================
var SEG_CAB_VINCULOS = ['email', 'nome', 'telefone', 'filhos_digitados', 'status', 'alunos_aprovados', 'data_cadastro', 'aprovado_por', 'data_decisao'];

function SEG_abaVinculos_() {
  var ss = SpreadsheetApp.getActive();
  var aba = ss.getSheetByName(SEG_CONFIG.ABA_VINCULOS);
  if (!aba) {
    aba = ss.insertSheet(SEG_CONFIG.ABA_VINCULOS);
    aba.appendRow(SEG_CAB_VINCULOS);
    aba.setFrozenRows(1);
  }
  return aba;
}

function SEG_buscarVinculo_(email) {
  var aba = SEG_abaVinculos_();
  var valores = aba.getDataRange().getValues();
  for (var i = 1; i < valores.length; i++) {
    if (String(valores[i][0]).toLowerCase() === email) return SEG_linhaParaVinculo_(valores[i], i + 1);
  }
  return null;
}

function SEG_linhaParaVinculo_(l, numLinha) {
  function arr(v) { try { var x = JSON.parse(v || '[]'); return Array.isArray(x) ? x : []; } catch (e) { return []; } }
  return {
    linha: numLinha, email: String(l[0]).toLowerCase(), nome: l[1], telefone: l[2],
    filhosDigitados: arr(l[3]), status: l[4] || 'PENDENTE', alunosAprovados: arr(l[5]),
    dataCadastro: l[6] instanceof Date ? Utilities.formatDate(l[6], 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm') : String(l[6] || ''),
    aprovadoPor: l[7] || ''
  };
}

function SEG_salvarVinculo_(v) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var aba = SEG_abaVinculos_();
    var existente = SEG_buscarVinculo_(v.email);
    var linha = [v.email, v.nome, v.telefone, JSON.stringify(v.filhosDigitados || []), v.status,
      JSON.stringify(v.alunosAprovados || []), existente ? existente.dataCadastro : new Date(), v.aprovadoPor || '',
      v.status === 'PENDENTE' ? '' : new Date()];
    if (existente) aba.getRange(existente.linha, 1, 1, linha.length).setValues([linha]);
    else aba.appendRow(linha);
  } finally {
    lock.releaseLock();
  }
}

function SEG_listarVinculos_() {
  var aba = SEG_abaVinculos_();
  var valores = aba.getDataRange().getValues();
  var lista = [];
  for (var i = 1; i < valores.length; i++) {
    var v = SEG_linhaParaVinculo_(valores[i], i + 1);
    var origem = v.status === 'PENDENTE' ? v.filhosDigitados : (v.alunosAprovados.length ? v.alunosAprovados : v.filhosDigitados);
    v.filhos = origem.map(function (digitado) {
      var a = SEG_resolverAluno_(digitado);
      return { digitado: digitado, encontrado: !!a, nomeOficial: a ? a.nome : '', turma: a ? a.turma : '' };
    });
    lista.push(v);
  }
  lista.reverse(); // mais recentes primeiro
  return lista;
}

function SEG_decidirVinculo_(sessao, email, aprovar, alunos) {
  email = String(email || '').toLowerCase();
  var v = SEG_buscarVinculo_(email);
  if (!v) return { status: 'error', message: 'Cadastro não encontrado.' };

  if (aprovar) {
    // Só aceita nomes que existem de fato na aba Alunos
    var oficiais = (alunos || []).map(function (n) { var a = SEG_resolverAluno_(n); return a ? a.nome : null; })
      .filter(function (n) { return !!n; });
    if (oficiais.length === 0) return { status: 'error', message: 'Nenhum aluno válido selecionado.' };
    v.status = 'APROVADO';
    v.alunosAprovados = oficiais;
  } else {
    v.status = 'RECUSADO';
    v.alunosAprovados = [];
  }
  v.aprovadoPor = sessao.email;
  SEG_salvarVinculo_(v);
  SEG_auditar_(sessao, aprovar ? 'APROVAR_RESPONSAVEL' : 'RECUSAR_RESPONSAVEL', email + ' -> ' + v.alunosAprovados.join(', '));
  return { status: 'success' };
}


// =====================================================================
//  ALUNOS / TABELAS
// =====================================================================
function SEG_normalizar_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function SEG_mapaAlunos_() {
  var cache = CacheService.getScriptCache();
  var c = cache.get('seg_mapa_alunos');
  if (c) return JSON.parse(c);
  var aba = SpreadsheetApp.getActive().getSheetByName(SEG_CONFIG.ABA_ALUNOS);
  var mapa = {};
  if (aba) {
    var v = aba.getDataRange().getValues();
    for (var i = 1; i < v.length; i++) {
      var nome = String(v[i][1] || '').trim();
      if (nome) mapa[SEG_normalizar_(nome)] = { nome: nome, turma: String(v[i][2] || '').trim() };
    }
  }
  try { cache.put('seg_mapa_alunos', JSON.stringify(mapa), 600); } catch (e) { /* >100KB: sem cache */ }
  return mapa;
}

function SEG_resolverAluno_(nomeDigitado) {
  return SEG_mapaAlunos_()[SEG_normalizar_(nomeDigitado)] || null;
}

// Devolve a aba no MESMO formato da GViz, para o site não precisar mudar
function SEG_lerTabelaGviz_(nomeAba) {
  if (!SEG_TABELAS_LIBERADAS[nomeAba]) return { status: 'forbidden', message: 'Aba não liberada.' };
  var aba = SpreadsheetApp.getActive().getSheetByName(nomeAba);
  if (!aba) return { status: 'error', message: 'Aba não encontrada.' };
  var valores = aba.getDataRange().getValues();
  var linhas = valores.slice(1).map(function (l) {
    return { c: l.map(function (cel) {
      if (cel === '' || cel === null) return null;
      if (cel instanceof Date) return { v: Utilities.formatDate(cel, 'America/Sao_Paulo', "yyyy-MM-dd'T'HH:mm:ss") };
      return { v: cel };
    }) };
  });
  return { table: { cols: (valores[0] || []).map(function (h) { return { label: String(h) }; }), rows: linhas } };
}


// =====================================================================
//  FILTRO DE SAÍDA PARA RESPONSÁVEIS
//  Remove de qualquer lista os itens de alunos que não são do responsável.
// =====================================================================
function SEG_filtrarSaidaResponsavel_(saida, sessao, rota) {
  var dados = SEG_lerSaida_(saida);
  if (dados === null) return SEG_json_({ status: 'error', message: 'Resposta indisponível.' });
  var permitidos = sessao.alunos.map(SEG_normalizar_);
  var usarCampoNome = (rota === 'alunos');

  // Em todos_os_dados, o responsável só recebe estas listas (o resto é descartado)
  if (rota === 'todos_os_dados' && dados && typeof dados === 'object' && !Array.isArray(dados)) {
    var enxuto = {};
    SEG_CHAVES_RESPONSAVEL.forEach(function (k) { if (k in dados) enxuto[k] = dados[k]; });
    dados = enxuto;
  }

  function permitido(item) {
    if (Array.isArray(item)) {
      // Linha crua: mantém só se algum valor for um aluno permitido
      return item.some(function (c) { return permitidos.indexOf(SEG_normalizar_(c)) !== -1; });
    }
    if (item && typeof item === 'object') {
      if ('aluno' in item) return permitidos.indexOf(SEG_normalizar_(item.aluno)) !== -1;
      if (usarCampoNome && 'nome' in item) return permitidos.indexOf(SEG_normalizar_(item.nome)) !== -1;
    }
    return true;
  }

  function filtrar(obj, prof) {
    if (prof > 8 || obj === null) return obj;
    if (Array.isArray(obj)) {
      var ehListaDeAlunos = obj.some(function (x) { return x && typeof x === 'object' && ('aluno' in x || (usarCampoNome && 'nome' in x)); })
        || (usarCampoNome && obj.length && Array.isArray(obj[0]));
      var res = ehListaDeAlunos ? obj.filter(permitido) : obj;
      return res.map(function (x) { return filtrar(x, prof + 1); });
    }
    if (typeof obj === 'object') {
      for (var k in obj) if (obj.hasOwnProperty(k)) obj[k] = filtrar(obj[k], prof + 1);
    }
    return obj;
  }
  return SEG_json_(filtrar(dados, 0));
}


// =====================================================================
//  RECUPERAÇÃO DE SENHA
// =====================================================================
function SEG_recuperarSenha_(corpo) {
  var neutro = { status: 'success', message: 'Se o e-mail estiver cadastrado, enviaremos um código.' };
  var email = String(corpo.email || '').toLowerCase().trim();
  var tipo = corpo.tipo === 'responsavel' ? 'responsavel' : 'servidor';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return neutro;

  var cache = CacheService.getScriptCache();
  var chaveLimite = 'rec_lim_' + email;
  var tentativas = parseInt(cache.get(chaveLimite) || '0', 10);
  if (tentativas >= 3) return neutro;                       // no máx. 3 e-mails por hora
  cache.put(chaveLimite, String(tentativas + 1), 3600);

  var alvo = SEG_localizarConta_(email, tipo);
  if (!alvo) return neutro;

  var codigo = String(Math.floor(100000 + Math.random() * 900000));
  cache.put('rec_cod_' + tipo + '_' + email, JSON.stringify({ hash: SEG_sha256_(codigo + email), erros: 0 }), 15 * 60);

  MailApp.sendEmail({
    to: email,
    subject: SEG_CONFIG.NOME_SISTEMA + ' — código para redefinir a senha',
    body: 'Olá!\n\nSeu código para redefinir a senha é: ' + codigo +
      '\n\nEle vale por 15 minutos. Se você não pediu a troca, ignore este e-mail.\n\n' +
      SEG_CONFIG.NOME_SISTEMA + '\n' + SEG_CONFIG.URL_SITE
  });
  SEG_auditar_({ email: email, tipo: tipo }, 'RECUPERAR_SENHA', '');
  return neutro;
}

function SEG_redefinirSenha_(corpo) {
  var email = String(corpo.email || '').toLowerCase().trim();
  var tipo = corpo.tipo === 'responsavel' ? 'responsavel' : 'servidor';
  var cache = CacheService.getScriptCache();
  var chave = 'rec_cod_' + tipo + '_' + email;
  var reg = cache.get(chave);
  if (!reg) return { status: 'error', message: 'Código inválido ou expirado.' };
  reg = JSON.parse(reg);

  if (reg.hash !== SEG_sha256_(String(corpo.codigo || '') + email)) {
    reg.erros++;
    if (reg.erros >= 5) cache.remove(chave); else cache.put(chave, JSON.stringify(reg), 15 * 60);
    return { status: 'error', message: 'Código inválido ou expirado.' };
  }

  var senha = String(corpo.novaSenha || '');
  if (senha.length < 6) return { status: 'error', message: 'A senha precisa ter pelo menos 6 caracteres.' };

  var alvo = SEG_localizarConta_(email, tipo);
  if (!alvo) return { status: 'error', message: 'Conta não encontrada.' };
  alvo.aba.getRange(alvo.linha, alvo.colSenha).setValue(SEG_CONFIG.SALVAR_SENHA_COM_HASH ? SEG_gerarHashSenha(senha) : senha);
  cache.remove(chave);
  SEG_auditar_({ email: email, tipo: tipo }, 'REDEFINIR_SENHA', '');
  return { status: 'success' };
}

function SEG_localizarConta_(email, tipo) {
  var nomeAba = tipo === 'responsavel' ? SEG_CONFIG.ABA_RESPONSAVEIS : SEG_CONFIG.ABA_USUARIOS;
  var aba = SpreadsheetApp.getActive().getSheetByName(nomeAba);
  if (!aba) return null;
  var valores = aba.getDataRange().getValues();
  var cab = valores[0].map(function (h) { return SEG_normalizar_(h); });
  var colEmail = cab.indexOf('email') !== -1 ? cab.indexOf('email') : cab.indexOf('e mail');
  var colSenha = cab.indexOf('senha');
  if (colEmail === -1 || colSenha === -1) return null;
  for (var i = 1; i < valores.length; i++) {
    if (String(valores[i][colEmail]).toLowerCase().trim() === email) {
      return { aba: aba, linha: i + 1, colSenha: colSenha + 1 };
    }
  }
  return null;
}


// =====================================================================
//  HASH DE SENHAS
//  Formato salvo na planilha: sha256$<salt>$<hash>
//  Use no seu LOGIN:  var r = SEG_conferirSenha(senhaDigitada, valorDaPlanilha);
//                     if (r.ok && r.novoValor) celulaSenha.setValue(r.novoValor); // migra
// =====================================================================
function SEG_sha256_(texto) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes);
}

function SEG_gerarHashSenha(senha) {
  var salt = Utilities.getUuid().replace(/-/g, '').substring(0, 16);
  var h = senha;
  for (var i = 0; i < 1000; i++) h = SEG_sha256_(salt + h);  // 1000 rodadas
  return 'sha256$' + salt + '$' + h;
}

function SEG_conferirSenha(senhaDigitada, valorPlanilha) {
  senhaDigitada = String(senhaDigitada || '');
  valorPlanilha = String(valorPlanilha || '');
  if (valorPlanilha.indexOf('sha256$') === 0) {
    var partes = valorPlanilha.split('$');
    var h = senhaDigitada;
    for (var i = 0; i < 1000; i++) h = SEG_sha256_(partes[1] + h);
    return { ok: h === partes[2], novoValor: null };
  }
  // Senha antiga em texto puro: confere e devolve o hash para migrar
  var ok = senhaDigitada !== '' && senhaDigitada === valorPlanilha.trim();
  return { ok: ok, novoValor: ok ? SEG_gerarHashSenha(senhaDigitada) : null };
}

// Execute UMA vez pelo editor (menu Executar) para converter todas as senhas.
// Só faça isso DEPOIS de adaptar o LOGIN para usar SEG_conferirSenha().
function SEG_migrarTodasAsSenhas() {
  [SEG_CONFIG.ABA_USUARIOS, SEG_CONFIG.ABA_RESPONSAVEIS].forEach(function (nomeAba) {
    var aba = SpreadsheetApp.getActive().getSheetByName(nomeAba);
    if (!aba) return;
    var valores = aba.getDataRange().getValues();
    var col = valores[0].map(function (h) { return SEG_normalizar_(h); }).indexOf('senha');
    if (col === -1) return;
    for (var i = 1; i < valores.length; i++) {
      var s = String(valores[i][col] || '').trim();
      if (s && s.indexOf('sha256$') !== 0) aba.getRange(i + 1, col + 1).setValue(SEG_gerarHashSenha(s));
    }
  });
}


// =====================================================================
//  AUDITORIA
// =====================================================================
function SEG_auditar_(sessao, operacao, detalhe) {
  try {
    var ss = SpreadsheetApp.getActive();
    var aba = ss.getSheetByName(SEG_CONFIG.ABA_AUDITORIA);
    if (!aba) {
      aba = ss.insertSheet(SEG_CONFIG.ABA_AUDITORIA);
      aba.appendRow(['data_hora', 'email', 'tipo', 'nivel', 'operacao', 'detalhe']);
      aba.setFrozenRows(1);
    }
    aba.appendRow([new Date(), sessao.email || '', sessao.tipo || '', sessao.nivel || '', operacao, String(detalhe || '').substring(0, 500)]);
  } catch (e) { /* auditoria nunca derruba a operação */ }
}

function SEG_resumoAuditoria_(corpo) {
  var campos = ['aluno', 'idLinha', 'email', 'turma', 'codigo', 'setor', 'idPedido'];
  return campos.filter(function (c) { return corpo[c] !== undefined && corpo[c] !== ''; })
    .map(function (c) { return c + '=' + corpo[c]; }).join(' | ');
}


// =====================================================================
//  UTILITÁRIOS
// =====================================================================
function SEG_json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function SEG_lerSaida_(saida) {
  try { return JSON.parse(saida.getContent()); } catch (e) { return null; }
}
