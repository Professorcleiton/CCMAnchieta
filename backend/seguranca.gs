/**
 * =====================================================================
 *  SIGA v3 — Camada de segurança do backend (Google Apps Script)
 *  Feita sob medida para o Código.gs atual do SIGA (FASE 2 - tokens).
 * =====================================================================
 *  INSTALAÇÃO (passo a passo completo em backend/INTEGRACAO.md):
 *   1. Crie um arquivo "seguranca.gs" no projeto e cole todo este conteúdo.
 *   2. No Código.gs, renomeie:
 *         function doGet(e)   ->  function doGetOriginal(e)
 *         function doPost(e)  ->  function doPostOriginal(e)
 *   3. Implante uma NOVA VERSÃO da implantação existente (mesma URL).
 *
 *  Reaproveita do seu Código.gs: salvarSessao(), validarToken(),
 *  verificarBloqueio(), registrarTentativaLogin(), jsonResponse(),
 *  TEMPO_BLOQUEIO_MINUTOS e as abas "Usuários", "Responsaveis", "Sessoes".
 *
 *  O que esta camada faz:
 *   - Exige token em TODA leitura (doGet) e escrita (doPost), exceto login,
 *     cadastro de responsável e recuperação de senha.
 *   - Confere o nível mínimo por operação no servidor.
 *   - Professor (nível < 3) só consulta os próprios dados (?email= é
 *     trocado pelo e-mail da sessão).
 *   - LOGIN e LOGIN_RESPONSAVEL feitos aqui, com senhas em hash
 *     (SHA-256 + salt). Senhas antigas continuam valendo e são
 *     convertidas sozinhas no primeiro login.
 *   - Responsáveis: cadastro PENDENTE até a secretaria aprovar; depois,
 *     só recebem dados dos filhos aprovados (filtro no servidor).
 *   - ?aba=tabela&nome=Alunos para o site parar de ler a planilha pública.
 *   - Auditoria (aba "Auditoria") e recuperação de senha por e-mail.
 * =====================================================================
 */

// ---------------------------------------------------------------------
// CONFIGURAÇÃO (já ajustada para a sua planilha)
// ---------------------------------------------------------------------
var SEG_CONFIG = {
  ABA_ALUNOS: 'Alunos',                  // B = nome, C = turma
  ABA_USUARIOS: 'Usuários',              // A = email, B = nome, C = setor, D = nível, E = senha
  COL_USUARIO_SENHA: 5,                  // coluna E
  ABA_RESPONSAVEIS: 'Responsaveis',      // A = email, B = nome, C = senha, D = telefone, E = aluno, F = push
  COL_RESPONSAVEL_SENHA: 3,              // coluna C
  ABA_VINCULOS: 'Vinculos_Responsaveis', // criada automaticamente
  ABA_AUDITORIA: 'Auditoria',            // criada automaticamente

  SESSAO_CACHE_SEGUNDOS: 6 * 60 * 60,    // cache rápido; a fonte oficial continua sendo a aba "Sessoes"

  // Responsáveis que JÁ tinham conta antes desta atualização:
  //  true  = continuam entrando; o vínculo vira "APROVADO (LEGADO - revisar)"
  //          e aparece em aprovar-responsaveis.html para a secretaria revisar/revogar.
  //  false = todos precisam ser aprovados de novo (mais seguro, mas bloqueia
  //          as famílias até a secretaria aprovar).
  LIBERAR_RESPONSAVEIS_LEGADO: true,

  NOME_SISTEMA: 'SIGA - CCM Anchieta',
  URL_SITE: 'https://www.ccmanchieta.com.br'
};

// Nível mínimo por operação (alinhado ao que o Código.gs já exige).
// Operações não listadas: basta estar logado como servidor (nível 1).
var SEG_NIVEL_MINIMO = {
  // GET (?aba= / ?operacao=)
  'usuarios': 3,
  'responsaveis_cadastros': 3,
  'noticias_gestao': 3,
  'avaliacoes_listar': 3,
  'avaliacoes_estatisticas': 3,
  'disciplinas_todas': 3,
  'visao_geral_docentes': 3,
  'metas_plataformas': 3,
  // POST (operacao)
  'APROVAR_RESPONSAVEL': 3,
  'NOTICIA_ADICIONAR': 3,
  'NOTICIA_OCULTAR': 3,
  'NOTICIA_REATIVAR': 3,
  'RECUSAR_RESPONSAVEL': 3,
  'USER_SALVAR': 4,
  'USER_DELETAR': 4,
  'ALUNO_ADICIONAR': 4,
  'ALUNO_TRANSFERIR': 4,
  'ALUNO_EXCLUIR': 4,
  'AMB_ADICIONAR': 4,
  'AMB_DELETAR': 4,
  'IMPORTAR_LANCAMENTOS': 4,
  'PROGRESSAO_TURMAS': 4,
  'PAT_CADASTRAR': 3,
  'PAT_EXCLUIR': 3,
  'PAT_TRANSFERIR': 3,
  'SALVAR_GRADE': 3,
  'MARCAR_PEDIDO_IMPRESSO': 3,
  'CANCELAR_PEDIDO_AVALIACAO': 3,
  'NOTIFICAR_PROFESSOR_IMPRESSAO': 3,
  'salvar_documento': 2,
  'registrar_ocorrencia': 2,
  'marcar_fatos_emitidos': 2,
  'SALVAR_FATO_SEED': 2,
  'SALVAR': 2,
  'EDITAR': 2,
  'EXCLUIR': 2
};

// Rotas GET em que um professor (nível < 3) só pode consultar a si mesmo
var SEG_ROTAS_PROPRIO_EMAIL = ['avaliacoes_disciplinas_professor', 'avaliacoes_rascunhos', 'avaliacoes_turmas_professor',
  'turmas_professor', 'meus_lancamentos', 'historico_docente'];

// O que um RESPONSÁVEL logado pode chamar (todo o resto é negado)
var SEG_PERMITIDO_RESPONSAVEL = {
  GET: ['todos_os_dados', 'listar_documentos_aluno', 'fatos_emitidos', 'horarios', 'alunos'],
  POST: ['salvar_token_push', 'verificar_atualizacao', 'listar_documentos_aluno', 'upload_documento', 'LOGOUT']
};

// Listas de todos_os_dados que um responsável recebe (já filtradas pelo filho).
// "fatos_seed" fica de fora de propósito: inclui fatos ainda não emitidos.
var SEG_CHAVES_RESPONSAVEL = ['apontamentos', 'documentos', 'ocorrencias', 'atas'];

// Abas que podem ser lidas por ?aba=tabela&nome=...
var SEG_TABELAS_LIBERADAS = { 'Alunos': 1, 'Pre_Conselho': 1 };

// Leituras registradas na auditoria (todas as escritas já são registradas)
var SEG_AUDITAR_GET = ['usuarios', 'todos_os_dados', 'tabela', 'responsaveis_cadastros', 'fatos_aluno'];


// =====================================================================
//  PONTOS DE ENTRADA (substituem os seus doGet/doPost)
// =====================================================================
function doGet(e) {
  e = e || {};
  e.parameter = e.parameter || {};
  var p = e.parameter;
  var rota = p.aba || p.operacao || '';

  // Única leitura pública: notícias da página inicial (noticias.gs)
  if (rota === 'noticias' && typeof NOT_listarPublicas_ === 'function') return SEG_json_(NOT_listarPublicas_());
  // Frequenciômetro (frequenciometro.gs): números públicos; nomes só com a chave da TV
  if (rota === 'frequenciometro' && typeof FREQ_dadosPublicos_ === 'function') return SEG_json_(FREQ_dadosPublicos_());
  if (rota === 'frequenciometro_alunos' && typeof FREQ_dadosAlunos_ === 'function') return SEG_json_(FREQ_dadosAlunos_(p.chave));

  var sessao = SEG_validarSessao_(p.token);
  if (!sessao) return SEG_json_({ status: 'unauthorized', message: 'Sessão expirada. Entre novamente.' });

  var negado = SEG_checarPermissao_(sessao, rota, 'GET', p);
  if (negado) return negado;

  // Professor comum só consulta os próprios dados
  if (sessao.tipo === 'servidor' && sessao.nivel < 3 && SEG_ROTAS_PROPRIO_EMAIL.indexOf(rota) !== -1) {
    p.email = sessao.email;
    p.nome = sessao.nome;
  }

  if (SEG_AUDITAR_GET.indexOf(rota) !== -1) SEG_auditar_(sessao, 'GET ' + rota, p.aluno || p.nome || p.turma || '');

  if (rota === 'tabela') return SEG_json_(SEG_lerTabelaGviz_(p.nome));
  if (rota === 'responsaveis_cadastros') return SEG_json_(SEG_listarVinculos_());
  if (rota === 'noticias_gestao') return SEG_json_(NOT_listarTodas_());

  var saida = doGetOriginal(e);
  if (sessao.tipo === 'responsavel') saida = SEG_filtrarSaidaResponsavel_(saida, sessao, rota);
  return saida;
}

function doPost(e) {
  var corpo = {};
  try { corpo = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {
    return SEG_json_({ status: 'error', message: 'Dados inválidos' });
  }
  var op = corpo.operacao || '';

  try {
    // ---- Operações públicas ----
    if (op === 'LOGIN') return SEG_json_(SEG_loginServidor_(corpo));
    if (op === 'LOGIN_RESPONSAVEL') return SEG_json_(SEG_loginResponsavel_(corpo));
    if (op === 'CADASTRAR_RESPONSAVEL') return SEG_cadastrarResponsavel_(e, corpo);
    if (op === 'RECUPERAR_SENHA') return SEG_json_(SEG_recuperarSenha_(corpo));
    if (op === 'REDEFINIR_SENHA') return SEG_json_(SEG_redefinirSenha_(corpo));
    if (/^SORTEIO_/.test(op) && typeof FREQ_post_ === 'function') return SEG_json_(FREQ_post_(corpo));  // chave da TV

    // ---- Daqui para baixo, só com sessão válida ----
    // salvar_token_push usa "token" para a inscrição push; a sessão vem em "tokenSessao"
    var tokenSessao = (op === 'salvar_token_push') ? corpo.tokenSessao : corpo.token;
    var sessao = SEG_validarSessao_(tokenSessao);
    if (!sessao) return SEG_json_({ status: 'unauthorized', message: 'Sessão expirada. Entre novamente.' });

    var negado = SEG_checarPermissao_(sessao, op, 'POST', corpo);
    if (negado) return negado;

    // Nunca confia em e-mail/nível vindos do navegador quando o dado é "de quem está logado"
    corpo.emailSessao = sessao.email;
    corpo.nivelSessao = sessao.nivel;
    if (sessao.tipo === 'responsavel' && (op === 'salvar_token_push' || op === 'verificar_atualizacao')) {
      corpo.email = sessao.email;
    }
    e.postData.contents = JSON.stringify(corpo); // o doPostOriginal lê daqui

    if (op === 'NOTICIA_ADICIONAR') { SEG_auditar_(sessao, op, corpo.link); return SEG_json_(NOT_adicionar_(sessao, corpo)); }
    if (op === 'NOTICIA_OCULTAR') { SEG_auditar_(sessao, op, corpo.id); return SEG_json_(NOT_alterarAtivo_(corpo, false)); }
    if (op === 'NOTICIA_REATIVAR') { SEG_auditar_(sessao, op, corpo.id); return SEG_json_(NOT_alterarAtivo_(corpo, true)); }
    if (op === 'APROVAR_RESPONSAVEL') return SEG_json_(SEG_decidirVinculo_(sessao, corpo.email, true, corpo.alunos));
    if (op === 'RECUSAR_RESPONSAVEL') return SEG_json_(SEG_decidirVinculo_(sessao, corpo.email, false, []));

    if (op === 'LOGOUT') {
      CacheService.getScriptCache().remove('sess_' + corpo.token);
      SEG_auditar_(sessao, 'LOGOUT', '');
      return doPostOriginal(e);
    }

    SEG_auditar_(sessao, op, SEG_resumoAuditoria_(corpo));
    var saida = doPostOriginal(e);

    // Depois de salvar usuário com senha nova, troca a senha gravada pelo hash
    if (op === 'USER_SALVAR' && corpo.senha) {
      var r = SEG_lerSaida_(saida);
      if (r && (r.status === 'success' || r.status === 'updated')) {
        SEG_gravarSenha_('servidor', String(corpo.email || '').trim().toLowerCase(), String(corpo.senha));
      }
    }
    if (sessao.tipo === 'responsavel') saida = SEG_filtrarSaidaResponsavel_(saida, sessao, op);
    return saida;
  } catch (erro) {
    return SEG_json_({ status: 'error', message: erro.toString() });
  }
}


// =====================================================================
//  SESSÕES (aba "Sessoes" do seu código + cache para ficar rápido)
// =====================================================================
function SEG_validarSessao_(token) {
  if (!token || typeof token !== 'string' || token.length < 20) return null;
  var cache = CacheService.getScriptCache();
  var bruto = cache.get('sess_' + token);
  if (bruto) { try { return JSON.parse(bruto); } catch (e) {} }

  var s = validarToken(token);          // função do Código.gs (aba Sessoes, 8h)
  if (!s) return null;
  var sessao = { email: s.email.toLowerCase(), nome: s.nome, setor: s.setor, nivel: s.nivel || 0, tipo: 'servidor', alunos: [] };
  if (s.setor === 'responsavel') {
    var v = SEG_buscarVinculo_(sessao.email);
    if (!v || v.status !== 'APROVADO') return null;
    sessao.tipo = 'responsavel';
    sessao.nivel = 0;
    sessao.alunos = v.alunosAprovados;
  }
  cache.put('sess_' + token, JSON.stringify(sessao), SEG_CONFIG.SESSAO_CACHE_SEGUNDOS);
  return sessao;
}

function SEG_registrarSessao_(sessao) {
  var token = salvarSessao(sessao.email, sessao.nome, sessao.setor, sessao.nivel); // grava na aba Sessoes
  CacheService.getScriptCache().put('sess_' + token, JSON.stringify(sessao), SEG_CONFIG.SESSAO_CACHE_SEGUNDOS);
  return token;
}

function SEG_checarPermissao_(sessao, rota, metodo, params) {
  if (sessao.tipo === 'responsavel') {
    if (SEG_PERMITIDO_RESPONSAVEL[metodo].indexOf(rota) === -1) {
      return SEG_json_({ status: 'forbidden', message: 'Acesso não permitido.' });
    }
    var pedidos = [];
    if (params.aluno) pedidos.push(params.aluno);
    if (params.alunos) pedidos = pedidos.concat(String(params.alunos).split(','));
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


// Versão corrigida do verificarBloqueio() do Código.gs: lá, um acerto antigo
// dentro da janela de 15 min "zerava" as tentativas erradas que vieram DEPOIS.
// Aqui contamos só os erros após o último acerto.
function SEG_bloqueado_(email) {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Tentativas_Login');
  if (!aba) return false;
  var dados = aba.getDataRange().getValues();
  var limite = new Date(Date.now() - TEMPO_BLOQUEIO_MINUTOS * 60 * 1000);
  var erradas = 0;
  email = String(email).toLowerCase();
  for (var i = dados.length - 1; i >= 1; i--) {
    if (new Date(dados[i][1]) < limite) break;
    if (String(dados[i][0] || '').trim().toLowerCase() !== email) continue;
    if (dados[i][2] === 'SIM') break;
    if (dados[i][2] === 'NAO') erradas++;
  }
  return erradas >= MAX_TENTATIVAS_LOGIN;
}

// =====================================================================
//  LOGIN DOS SERVIDORES
// =====================================================================
function SEG_loginServidor_(corpo) {
  var email = String(corpo.email || '').trim().toLowerCase();
  var senha = String(corpo.senha || '');
  if (!email || !senha) return { status: 'invalid' };

  if (SEG_bloqueado_(email)) {
    return { status: 'blocked', message: 'Muitas tentativas erradas. Tente novamente em ' + TEMPO_BLOQUEIO_MINUTOS + ' minutos.' };
  }

  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SEG_CONFIG.ABA_USUARIOS);
  if (!aba) return { status: 'error' };
  var linhas = aba.getDataRange().getValues();
  var col = SEG_CONFIG.COL_USUARIO_SENHA - 1;

  for (var i = 1; i < linhas.length; i++) {
    if (!linhas[i][0] || String(linhas[i][0]).trim().toLowerCase() !== email) continue;
    var r = SEG_conferirSenha(senha, linhas[i][col]);
    if (!r.ok) break;
    if (r.novoValor) aba.getRange(i + 1, col + 1).setValue(r.novoValor);   // migra para hash

    var sessao = {
      email: email,
      nome: String(linhas[i][1] || '').trim(),
      setor: String(linhas[i][2] || '').trim().toLowerCase(),
      nivel: parseInt(linhas[i][3], 10) || 1,
      tipo: 'servidor',
      alunos: []
    };
    var token = SEG_registrarSessao_(sessao);
    registrarTentativaLogin(email, true);
    SEG_auditar_(sessao, 'LOGIN', '');
    return { status: 'success', token: token, nome: sessao.nome, setor: sessao.setor, nivel: sessao.nivel };
  }

  registrarTentativaLogin(email, false);
  return { status: 'invalid' };
}


// =====================================================================
//  LOGIN / CADASTRO DOS RESPONSÁVEIS
// =====================================================================
function SEG_loginResponsavel_(corpo) {
  var email = String(corpo.email || '').trim().toLowerCase();
  var senha = String(corpo.senha || '');
  if (!email || !senha) return { status: 'invalid', message: 'E-mail ou senha incorretos.' };

  var chaveBloqueio = 'resp:' + email;
  if (SEG_bloqueado_(chaveBloqueio)) {
    return { status: 'invalid', message: 'Muitas tentativas erradas. Tente novamente em ' + TEMPO_BLOQUEIO_MINUTOS + ' minutos.' };
  }

  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SEG_CONFIG.ABA_RESPONSAVEIS);
  if (!aba) return { status: 'error' };
  var linhas = aba.getDataRange().getValues();
  var col = SEG_CONFIG.COL_RESPONSAVEL_SENHA - 1;

  var nome = '', telefone = '', alunosPlanilha = [], senhaOk = false, migrar = null;
  for (var i = 1; i < linhas.length; i++) {
    if (!linhas[i][0] || String(linhas[i][0]).trim().toLowerCase() !== email) continue;
    if (!senhaOk) {
      var r = SEG_conferirSenha(senha, linhas[i][col]);
      if (!r.ok) break;
      senhaOk = true;
      migrar = r.novoValor;
      nome = String(linhas[i][1] || '').trim();
      telefone = String(linhas[i][3] || '').trim();
    }
    var aluno = String(linhas[i][4] || '').trim();
    if (aluno && alunosPlanilha.indexOf(aluno) === -1) alunosPlanilha.push(aluno);
  }

  if (!senhaOk) {
    registrarTentativaLogin(chaveBloqueio, false);
    return { status: 'invalid', message: 'E-mail ou senha incorretos.' };
  }
  registrarTentativaLogin(chaveBloqueio, true);
  if (migrar) SEG_gravarSenha_('responsavel', email, null, migrar);

  var vinculo = SEG_buscarVinculo_(email);
  if (!vinculo) {
    if (!SEG_CONFIG.LIBERAR_RESPONSAVEIS_LEGADO) {
      SEG_salvarVinculo_({ email: email, nome: nome, telefone: telefone, filhosDigitados: alunosPlanilha,
        status: 'PENDENTE', alunosAprovados: [], aprovadoPor: '' });
      return { status: 'pending', message: 'Seu cadastro precisa ser confirmado pela secretaria.' };
    }
    vinculo = { email: email, nome: nome, telefone: telefone, filhosDigitados: alunosPlanilha,
      status: 'APROVADO', alunosAprovados: alunosPlanilha, aprovadoPor: 'LEGADO - revisar' };
    SEG_salvarVinculo_(vinculo);
  }

  if (vinculo.status === 'PENDENTE') {
    return { status: 'pending', message: 'Seu cadastro ainda está aguardando a confirmação da secretaria.' };
  }
  if (vinculo.status !== 'APROVADO' || vinculo.alunosAprovados.length === 0) {
    return { status: 'invalid', message: 'Cadastro não aprovado. Procure a secretaria da escola.' };
  }

  var sessao = { email: email, nome: nome, setor: 'responsavel', nivel: 0, tipo: 'responsavel', alunos: vinculo.alunosAprovados };
  var token = SEG_registrarSessao_(sessao);
  SEG_auditar_(sessao, 'LOGIN_RESPONSAVEL', '');
  return { status: 'success', token: token, nome: nome, email: email, alunos: vinculo.alunosAprovados };
}

function SEG_cadastrarResponsavel_(e, corpo) {
  var email = String(corpo.email || '').trim().toLowerCase();
  var senha = String(corpo.senha || '');
  if (senha.length < 6) return SEG_json_({ status: 'error', message: 'A senha precisa ter pelo menos 6 caracteres.' });

  if (SEG_linhasDaConta_('responsavel', email).length > 0) {
    return SEG_json_({ status: 'error', message: 'Este e-mail já está cadastrado. Use "Esqueci minha senha" se precisar.' });
  }

  var filhos = corpo.filhos;
  if (typeof filhos === 'string') { try { filhos = JSON.parse(filhos); } catch (err) { filhos = [filhos]; } }
  corpo.email = email;
  corpo.filhos = filhos || [];
  // O Código.gs apaga tudo que não é número da senha; manda um valor provisório
  // e grava o hash da senha verdadeira logo depois.
  corpo.senha = '000000';
  e.postData.contents = JSON.stringify(corpo);

  // O Código.gs atual valida, encontra os nomes oficiais e grava em "Responsaveis".
  // Ele responde em TEXTO ("success", "Cadastro parcial: ..." ou uma mensagem de erro).
  var saida = doPostOriginal(e);
  var texto = String(saida.getContent() || '');
  var json = SEG_lerSaida_(saida);
  if (json && json.status) texto = json.status === 'success' ? 'success' : (json.message || json.status);

  var ok = texto === 'success' || texto.indexOf('Cadastro parcial') === 0;
  if (!ok) return SEG_json_({ status: 'error', message: texto || 'Erro ao cadastrar.' });

  SEG_gravarSenha_('responsavel', email, senha);   // troca a senha gravada pelo hash
  SEG_salvarVinculo_({ email: email, nome: corpo.nome || '', telefone: corpo.telefone || '',
    filhosDigitados: corpo.filhos, status: 'PENDENTE', alunosAprovados: [], aprovadoPor: '' });
  SEG_auditar_({ email: email, tipo: 'responsavel' }, 'CADASTRAR_RESPONSAVEL', corpo.filhos.join(', '));

  var msg = 'Cadastro recebido! A secretaria vai confirmar o vínculo com o(s) aluno(s). Você poderá entrar assim que for aprovado.';
  if (texto.indexOf('Cadastro parcial') === 0) msg += ' Atenção: ' + texto.replace('Cadastro parcial: ', '');
  return SEG_json_({ status: 'pending', message: msg });
}


// =====================================================================
//  VÍNCULOS RESPONSÁVEL ↔ ALUNO (aba Vinculos_Responsaveis)
// =====================================================================
var SEG_CAB_VINCULOS = ['email', 'nome', 'telefone', 'filhos_digitados', 'status', 'alunos_aprovados', 'data_cadastro', 'aprovado_por', 'data_decisao'];

function SEG_abaVinculos_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName(SEG_CONFIG.ABA_VINCULOS);
  if (!aba) {
    aba = ss.insertSheet(SEG_CONFIG.ABA_VINCULOS);
    aba.appendRow(SEG_CAB_VINCULOS);
    aba.setFrozenRows(1);
  }
  return aba;
}

function SEG_buscarVinculo_(email) {
  var valores = SEG_abaVinculos_().getDataRange().getValues();
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
    dataCadastro: l[6] instanceof Date ? Utilities.formatDate(l[6], 'GMT-3', 'dd/MM/yyyy HH:mm') : String(l[6] || ''),
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
  var valores = SEG_abaVinculos_().getDataRange().getValues();
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
  lista.reverse();
  return lista;
}

function SEG_decidirVinculo_(sessao, email, aprovar, alunos) {
  email = String(email || '').toLowerCase();
  var v = SEG_buscarVinculo_(email);
  if (!v) return { status: 'error', message: 'Cadastro não encontrado.' };

  if (aprovar) {
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
  SEG_derrubarSessoes_(email);   // a mudança vale na hora
  SEG_auditar_(sessao, aprovar ? 'APROVAR_RESPONSAVEL' : 'RECUSAR_RESPONSAVEL', email + ' -> ' + v.alunosAprovados.join(', '));
  return { status: 'success' };
}

function SEG_derrubarSessoes_(email) {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sessoes');
  if (!aba) return;
  var dados = aba.getDataRange().getValues();
  var cache = CacheService.getScriptCache();
  for (var i = dados.length - 1; i >= 1; i--) {
    if (String(dados[i][1]).toLowerCase() === email) {
      cache.remove('sess_' + dados[i][0]);
      aba.deleteRow(i + 1);
    }
  }
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
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SEG_CONFIG.ABA_ALUNOS);
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

// Usa a mesma busca tolerante do Código.gs (encontrarAlunoOficial) quando existir
function SEG_resolverAluno_(nomeDigitado) {
  var mapa = SEG_mapaAlunos_();
  var exato = mapa[SEG_normalizar_(nomeDigitado)];
  if (exato) return exato;
  if (typeof encontrarAlunoOficial === 'function') {
    var oficial = encontrarAlunoOficial(String(nomeDigitado || ''));
    if (oficial) return mapa[SEG_normalizar_(oficial)] || { nome: oficial, turma: '' };
  }
  return null;
}

// Devolve a aba no MESMO formato da GViz, para o site não precisar mudar
function SEG_lerTabelaGviz_(nomeAba) {
  if (!SEG_TABELAS_LIBERADAS[nomeAba]) return { status: 'forbidden', message: 'Aba não liberada.' };
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nomeAba);
  if (!aba) return { status: 'error', message: 'Aba não encontrada.' };
  var valores = aba.getDataRange().getValues();
  var linhas = valores.slice(1).map(function (l) {
    return { c: l.map(function (cel) {
      if (cel === '' || cel === null) return null;
      if (cel instanceof Date) return { v: Utilities.formatDate(cel, 'GMT-3', "yyyy-MM-dd'T'HH:mm:ss") };
      return { v: cel };
    }) };
  });
  return { table: { cols: (valores[0] || []).map(function (h) { return { label: String(h) }; }), rows: linhas } };
}


// =====================================================================
//  FILTRO DE SAÍDA PARA RESPONSÁVEIS
// =====================================================================
function SEG_filtrarSaidaResponsavel_(saida, sessao, rota) {
  var dados = SEG_lerSaida_(saida);
  if (dados === null) return SEG_json_({ status: 'error', message: 'Resposta indisponível.' });
  var permitidos = sessao.alunos.map(SEG_normalizar_);
  var usarCampoNome = (rota === 'alunos');

  if (rota === 'todos_os_dados') {
    // O Código.gs corta em 200 registros da escola inteira ANTES de filtrar.
    // Para o responsável, busca direto os registros dos filhos (sem esse corte).
    return SEG_json_(SEG_dadosDosFilhos_(sessao.alunos));
  }

  function permitido(item) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      if ('aluno' in item) return permitidos.indexOf(SEG_normalizar_(item.aluno)) !== -1;
      if (usarCampoNome && 'nome' in item) return permitidos.indexOf(SEG_normalizar_(item.nome)) !== -1;
    }
    return true;
  }
  function filtrar(obj, prof) {
    if (prof > 8 || obj === null) return obj;
    if (Array.isArray(obj)) return obj.filter(permitido).map(function (x) { return filtrar(x, prof + 1); });
    if (typeof obj === 'object') { for (var k in obj) if (obj.hasOwnProperty(k)) obj[k] = filtrar(obj[k], prof + 1); }
    return obj;
  }
  return SEG_json_(filtrar(dados, 0));
}

function SEG_dadosDosFilhos_(alunos) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var alvo = alunos.map(SEG_normalizar_);
  function doFilho(nome) { return alvo.indexOf(SEG_normalizar_(nome)) !== -1; }
  function fmt(d, padrao) { return d instanceof Date ? Utilities.formatDate(d, 'GMT-3', padrao) : String(d || ''); }
  function ler(nomeAba) { var a = ss.getSheetByName(nomeAba); return a ? a.getDataRange().getValues().slice(1) : []; }

  var apontamentos = [];
  ler('Registros').forEach(function (r, i) {
    if (r[0] && r[1] && doFilho(r[1])) apontamentos.push({ idLinha: i + 2, dataAtual: fmt(r[0], 'dd/MM/yyyy HH:mm'),
      aluno: String(r[1]).trim(), setor: String(r[2] || '').trim(), texto: String(r[3] || '').trim(), funcionario: String(r[4] || '').trim() });
  });
  var documentos = [];
  ler('Documentos_Secretaria').forEach(function (r) {
    if (r[0] && doFilho(r[0])) documentos.push({ aluno: String(r[0]).trim(), turma: String(r[1] || '').trim(),
      documento: String(r[2] || '').trim(), status: String(r[3] || '').trim(), data: fmt(r[4], 'dd/MM/yyyy'),
      link: String(r[5] || ''), dataEnvio: String(r[6] || ''), observacoes: String(r[7] || '') });
  });
  var ocorrencias = [];
  ler('Ocorrencias').forEach(function (r) {
    if (r[1] && doFilho(r[1])) ocorrencias.push({ data: fmt(r[0], 'dd/MM/yyyy HH:mm'), aluno: String(r[1]).trim(),
      tipo: String(r[2] || '').trim(), motivo: String(r[3] || '').trim(), autorizador: String(r[4] || '').trim() });
  });
  var atas = [];
  ler('Atas_Disciplinares').forEach(function (r) {
    if (r[1] && doFilho(r[1])) atas.push({ data: fmt(r[0], 'dd/MM/yyyy HH:mm'), aluno: String(r[1]).trim(),
      numero: String(r[2] || '').trim(), arquivo: String(r[3] || '').trim(), link: String(r[4] || '').trim() });
  });
  return { apontamentos: apontamentos, documentos: documentos, ocorrencias: ocorrencias, atas: atas };
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
  if (tentativas >= 3) return neutro;                        // máx. 3 e-mails por hora
  cache.put(chaveLimite, String(tentativas + 1), 3600);

  if (SEG_linhasDaConta_(tipo, email).length === 0) return neutro;

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
  if (!SEG_gravarSenha_(tipo, email, senha)) return { status: 'error', message: 'Conta não encontrada.' };
  cache.remove(chave);
  SEG_derrubarSessoes_(email);
  SEG_auditar_({ email: email, tipo: tipo }, 'REDEFINIR_SENHA', '');
  return { status: 'success' };
}

function SEG_linhasDaConta_(tipo, email) {
  var nomeAba = tipo === 'responsavel' ? SEG_CONFIG.ABA_RESPONSAVEIS : SEG_CONFIG.ABA_USUARIOS;
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nomeAba);
  if (!aba) return [];
  var valores = aba.getDataRange().getValues();
  var linhas = [];
  for (var i = 1; i < valores.length; i++) {
    if (String(valores[i][0] || '').trim().toLowerCase() === email) linhas.push(i + 1);
  }
  return linhas;
}

// Grava a senha (com hash) em todas as linhas da conta.
// Responsáveis têm uma linha por filho, então todas são atualizadas.
function SEG_gravarSenha_(tipo, email, senhaPura, valorPronto) {
  var nomeAba = tipo === 'responsavel' ? SEG_CONFIG.ABA_RESPONSAVEIS : SEG_CONFIG.ABA_USUARIOS;
  var col = tipo === 'responsavel' ? SEG_CONFIG.COL_RESPONSAVEL_SENHA : SEG_CONFIG.COL_USUARIO_SENHA;
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nomeAba);
  var linhas = SEG_linhasDaConta_(tipo, email);
  if (!aba || linhas.length === 0) return false;
  var valor = valorPronto || SEG_gerarHashSenha(senhaPura);
  linhas.forEach(function (l) { aba.getRange(l, col).setValue(valor); });
  return true;
}


// =====================================================================
//  HASH DE SENHAS — formato gravado: sha256$<salt>$<hash>
// =====================================================================
function SEG_sha256_(texto) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes);
}

function SEG_gerarHashSenha(senha) {
  var salt = Utilities.getUuid().replace(/-/g, '').substring(0, 16);
  var h = String(senha);
  for (var i = 0; i < 1000; i++) h = SEG_sha256_(salt + h);
  return 'sha256$' + salt + '$' + h;
}

function SEG_conferirSenha(senhaDigitada, valorPlanilha) {
  senhaDigitada = String(senhaDigitada || '');
  valorPlanilha = String(valorPlanilha || '').trim();
  if (!senhaDigitada || !valorPlanilha) return { ok: false, novoValor: null };
  if (valorPlanilha.indexOf('sha256$') === 0) {
    var partes = valorPlanilha.split('$');
    var h = senhaDigitada;
    for (var i = 0; i < 1000; i++) h = SEG_sha256_(partes[1] + h);
    return { ok: h === partes[2], novoValor: null };
  }
  // Senha antiga em texto puro (só números): mesma regra do Código.gs
  var ok = senhaDigitada === valorPlanilha ||
    (/^\d+$/.test(senhaDigitada) && senhaDigitada === valorPlanilha.replace(/\D/g, ''));
  return { ok: ok, novoValor: ok ? SEG_gerarHashSenha(senhaDigitada) : null };
}

// Opcional: execute UMA vez pelo editor para converter todas as senhas antigas de uma vez.
// (Sem isso, cada senha é convertida no primeiro login da pessoa.)
function SEG_migrarTodasAsSenhas() {
  [[SEG_CONFIG.ABA_USUARIOS, SEG_CONFIG.COL_USUARIO_SENHA], [SEG_CONFIG.ABA_RESPONSAVEIS, SEG_CONFIG.COL_RESPONSAVEL_SENHA]]
    .forEach(function (par) {
      var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(par[0]);
      if (!aba) return;
      var valores = aba.getDataRange().getValues();
      for (var i = 1; i < valores.length; i++) {
        var s = String(valores[i][par[1] - 1] || '').replace(/\D/g, '');
        var atual = String(valores[i][par[1] - 1] || '');
        if (s && atual.indexOf('sha256$') !== 0) aba.getRange(i + 1, par[1]).setValue(SEG_gerarHashSenha(s));
      }
    });
}


// =====================================================================
//  AUDITORIA
// =====================================================================
function SEG_auditar_(sessao, operacao, detalhe) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
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
  var campos = ['aluno', 'idLinha', 'email', 'turma', 'codigo', 'setor', 'idPedido', 'nome_aluno'];
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
