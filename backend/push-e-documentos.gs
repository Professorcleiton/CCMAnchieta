/**
 * =====================================================================
 *  SIGA v3 — Notificações push (Web Push padrão) e envio de documentos
 * =====================================================================
 *  Cole este conteúdo num arquivo novo do Apps Script chamado
 *  "push-e-documentos" (ao lado de "seguranca" e do Código.gs).
 *
 *  1) PUSH
 *     O Código.gs antigo usava a API "fcm/send" do Firebase, que o Google
 *     desligou em 2024, e uma FCM_SERVER_KEY que nem estava definida.
 *     Aqui o envio usa o padrão Web Push com VAPID (RFC 8292), que funciona
 *     no Chrome, Edge, Firefox, Android e iPhone (Safari 16.4+, com o site
 *     adicionado à tela de início).
 *
 *     Por privacidade (LGPD), a notificação NÃO leva o texto da ocorrência:
 *     aparece "Nova atualização no SIGA" e, ao tocar, abre o Portal.
 *     O detalhe continua indo por e-mail e aparece no Portal após o login.
 *     Isso evita que a ocorrência do aluno apareça na tela bloqueada.
 *
 *  2) DOCUMENTOS
 *     Implementa a operação "upload_documento", que o Portal dos Pais chamava,
 *     mas que não existia no backend.
 *
 *  Chaves VAPID: este arquivo lê a chave privada das Propriedades do script
 *  (Configurações do projeto → Propriedades do script → VAPID_PRIVATE_KEY).
 *  Se não encontrar, usa a constante VAPID_PRIVATE_KEY do Código.gs.
 * =====================================================================
 */

var WP_CONFIG = {
  ASSUNTO_VAPID: 'mailto:anchietacivicomilitar@gmail.com', // precisa ser "mailto:email" sem espaços
  TTL_SEGUNDOS: 24 * 60 * 60,                               // por quanto tempo o serviço guarda a notificação
  COL_PUSH_RESPONSAVEIS: 6,                                 // coluna F da aba Responsaveis

  DOC_TAMANHO_MAX_MB: 5,
  DOC_EXTENSOES: ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'doc', 'docx'],
  DOC_EMAIL_SECRETARIA: 'secretaria@ccmanchieta.com.br'     // aviso de documento recebido ('' para desligar)
};


// =====================================================================
//  PUSH — função chamada pelo notificarResponsaveis() do Código.gs
//  (mesma assinatura da antiga, que deve ser APAGADA do Código.gs)
// =====================================================================
function enviarPushNotification(tokenPush, titulo, mensagem, url) {
  if (!tokenPush) return 0;
  var inscricao;
  try { inscricao = JSON.parse(tokenPush); } catch (e) { return 0; }
  if (!inscricao || !inscricao.endpoint || !/^https:\/\//.test(inscricao.endpoint)) return 0;

  try {
    var resp = UrlFetchApp.fetch(inscricao.endpoint, {
      method: 'post',
      headers: {
        'TTL': String(WP_CONFIG.TTL_SEGUNDOS),
        'Urgency': 'high',
        'Authorization': 'vapid t=' + WP_jwtVapid_(inscricao.endpoint) + ', k=' + WP_chavePublica_()
      },
      payload: '',
      muteHttpExceptions: true
    });
    var codigo = resp.getResponseCode();
    // 404/410 = inscrição expirada ou o usuário desativou: remove da planilha
    if (codigo === 404 || codigo === 410) WP_removerInscricao_(tokenPush);
    if (codigo >= 400) console.warn('Push recusado (' + codigo + '): ' + resp.getContentText().substring(0, 200));
    return codigo;
  } catch (e) {
    console.error('Erro ao enviar push: ' + e.toString().substring(0, 200));
    return 0;
  }
}

function WP_removerInscricao_(tokenPush) {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Responsaveis');
  if (!aba) return;
  var dados = aba.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][WP_CONFIG.COL_PUSH_RESPONSAVEIS - 1] || '') === tokenPush) {
      aba.getRange(i + 1, WP_CONFIG.COL_PUSH_RESPONSAVEIS).setValue('');
    }
  }
}

// Teste rápido: execute pelo editor depois de ativar as notificações no seu celular.
function WP_testarPush() {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Responsaveis');
  var dados = aba.getDataRange().getValues();
  for (var i = dados.length - 1; i >= 1; i--) {
    var t = String(dados[i][WP_CONFIG.COL_PUSH_RESPONSAVEIS - 1] || '');
    if (t) {
      Logger.log('Enviando para ' + dados[i][0] + ' → código ' + enviarPushNotification(t));
      return;
    }
  }
  Logger.log('Nenhuma inscrição push encontrada na aba Responsaveis (coluna F).');
}


// =====================================================================
//  VAPID: JWT assinado com ES256 (ECDSA P-256 + SHA-256)
//  O Apps Script não tem ECDSA nativo; a curva é calculada com BigInt.
// =====================================================================
function WP_chavePublica_() {
  return (typeof VAPID_PUBLIC_KEY !== 'undefined') ? VAPID_PUBLIC_KEY : '';
}

function WP_chavePrivada_() {
  var prop = PropertiesService.getScriptProperties().getProperty('VAPID_PRIVATE_KEY');
  if (prop) return prop.trim();
  if (typeof VAPID_PRIVATE_KEY !== 'undefined') return VAPID_PRIVATE_KEY;
  throw new Error('VAPID_PRIVATE_KEY não configurada.');
}

function WP_jwtVapid_(endpoint) {
  var aud = endpoint.match(/^https:\/\/[^\/]+/)[0];
  var cache = CacheService.getScriptCache();
  var chave = 'vapid_jwt_' + Utilities.base64EncodeWebSafe(aud).replace(/=+$/, '');
  var guardado = cache.get(chave);
  if (guardado) return guardado;

  var exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;   // máximo permitido: 24h
  var cabecalho = WP_b64url_(WP_utf8_(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  var corpo = WP_b64url_(WP_utf8_(JSON.stringify({ aud: aud, exp: exp, sub: WP_CONFIG.ASSUNTO_VAPID })));
  var entrada = cabecalho + '.' + corpo;

  var d = WP_bytesParaBigInt_(WP_b64urlDecode_(WP_chavePrivada_()));
  var assinatura = WP_assinarES256_(WP_utf8_(entrada), d);
  var jwt = entrada + '.' + WP_b64url_(assinatura);

  cache.put(chave, jwt, 11 * 60 * 60);
  return jwt;
}

// --- Curva P-256 (secp256r1) ---
var WP_P = BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff');
var WP_N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
var WP_GX = BigInt('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296');
var WP_GY = BigInt('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5');

function WP_mod_(a, m) { var r = a % m; return r < BigInt(0) ? r + m : r; }

function WP_inv_(a, m) {           // inverso modular (Euclides estendido)
  var t = BigInt(0), novoT = BigInt(1), r = m, novoR = WP_mod_(a, m), q, tmp;
  while (novoR !== BigInt(0)) {
    q = r / novoR;
    tmp = t - q * novoT; t = novoT; novoT = tmp;
    tmp = r - q * novoR; r = novoR; novoR = tmp;
  }
  return WP_mod_(t, m);
}

// Pontos em coordenadas jacobianas [X, Y, Z]; Z = 0 é o ponto no infinito
function WP_dobrar_(p) {
  var P = WP_P, X = p[0], Y = p[1], Z = p[2];
  if (Z === BigInt(0) || Y === BigInt(0)) return [BigInt(0), BigInt(1), BigInt(0)];
  var YY = WP_mod_(Y * Y, P);
  var S = WP_mod_(BigInt(4) * X * YY, P);
  var ZZ = WP_mod_(Z * Z, P);
  var M = WP_mod_(BigInt(3) * (X - ZZ) * (X + ZZ), P);     // a = -3
  var X3 = WP_mod_(M * M - BigInt(2) * S, P);
  var Y3 = WP_mod_(M * (S - X3) - BigInt(8) * YY * YY, P);
  var Z3 = WP_mod_(BigInt(2) * Y * Z, P);
  return [X3, Y3, Z3];
}

function WP_somar_(p, q) {
  var P = WP_P;
  if (p[2] === BigInt(0)) return q;
  if (q[2] === BigInt(0)) return p;
  var Z1Z1 = WP_mod_(p[2] * p[2], P), Z2Z2 = WP_mod_(q[2] * q[2], P);
  var U1 = WP_mod_(p[0] * Z2Z2, P), U2 = WP_mod_(q[0] * Z1Z1, P);
  var S1 = WP_mod_(p[1] * q[2] * Z2Z2, P), S2 = WP_mod_(q[1] * p[2] * Z1Z1, P);
  if (U1 === U2) return (S1 === S2) ? WP_dobrar_(p) : [BigInt(0), BigInt(1), BigInt(0)];
  var H = WP_mod_(U2 - U1, P), R = WP_mod_(S2 - S1, P);
  var HH = WP_mod_(H * H, P), HHH = WP_mod_(H * HH, P), V = WP_mod_(U1 * HH, P);
  var X3 = WP_mod_(R * R - HHH - BigInt(2) * V, P);
  var Y3 = WP_mod_(R * (V - X3) - S1 * HHH, P);
  var Z3 = WP_mod_(p[2] * q[2] * H, P);
  return [X3, Y3, Z3];
}

function WP_multiplicarG_(k) {
  var resultado = [BigInt(0), BigInt(1), BigInt(0)];
  var base = [WP_GX, WP_GY, BigInt(1)];
  while (k > BigInt(0)) {
    if (k & BigInt(1)) resultado = WP_somar_(resultado, base);
    base = WP_dobrar_(base);
    k = k >> BigInt(1);
  }
  var zInv = WP_inv_(resultado[2], WP_P);
  var zInv2 = WP_mod_(zInv * zInv, WP_P);
  return WP_mod_(resultado[0] * zInv2, WP_P);   // só a coordenada x é necessária
}

// ECDSA com k determinístico (RFC 6979): não depende de gerador aleatório
function WP_assinarES256_(mensagemBytes, d) {
  var hash = WP_sha256_(mensagemBytes);
  var z = WP_mod_(WP_bytesParaBigInt_(hash), WP_N);
  var x = WP_bigIntParaBytes_(d), h1 = WP_bigIntParaBytes_(z);
  var V = [], K = [], i;
  for (i = 0; i < 32; i++) { V.push(1); K.push(0); }
  K = WP_hmac_(K, V.concat([0], x, h1)); V = WP_hmac_(K, V);
  K = WP_hmac_(K, V.concat([1], x, h1)); V = WP_hmac_(K, V);
  while (true) {
    V = WP_hmac_(K, V);
    var k = WP_bytesParaBigInt_(V);
    if (k > BigInt(0) && k < WP_N) {
      var r = WP_mod_(WP_multiplicarG_(k), WP_N);
      if (r !== BigInt(0)) {
        var s = WP_mod_(WP_inv_(k, WP_N) * (z + r * d), WP_N);
        if (s !== BigInt(0)) return WP_bigIntParaBytes_(r).concat(WP_bigIntParaBytes_(s));
      }
    }
    K = WP_hmac_(K, V.concat([0])); V = WP_hmac_(K, V);
  }
}

// --- Bytes / codificação (arrays de 0..255) ---
function WP_comSinal_(b) { return b.map(function (x) { return x > 127 ? x - 256 : x; }); }
function WP_semSinal_(b) { var r = []; for (var i = 0; i < b.length; i++) r.push(b[i] & 255); return r; }
function WP_sha256_(b) { return WP_semSinal_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, WP_comSinal_(b))); }
function WP_hmac_(chave, valor) {
  return WP_semSinal_(Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_256, WP_comSinal_(valor), WP_comSinal_(chave)));
}
function WP_utf8_(s) { return WP_semSinal_(Utilities.newBlob(s).getBytes()); }
function WP_b64url_(b) { return Utilities.base64EncodeWebSafe(WP_comSinal_(b)).replace(/=+$/, ''); }
function WP_b64urlDecode_(s) {
  s = String(s).trim();
  while (s.length % 4) s += '=';
  return WP_semSinal_(Utilities.base64DecodeWebSafe(s));
}
function WP_bytesParaBigInt_(b) {
  var hex = b.map(function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  return BigInt('0x' + (hex || '0'));
}
function WP_bigIntParaBytes_(n) {
  var hex = n.toString(16);
  while (hex.length < 64) hex = '0' + hex;
  var r = [];
  for (var i = 0; i < 64; i += 2) r.push(parseInt(hex.substr(i, 2), 16));
  return r;
}


// =====================================================================
//  QUEM PODE SER NOTIFICADO (usado pelo notificarResponsaveis corrigido)
// =====================================================================
// Com a camada de segurança instalada, só responsáveis com vínculo APROVADO
// para aquele aluno recebem e-mail/push. Contas antigas ainda sem registro de
// vínculo seguem a regra LIBERAR_RESPONSAVEIS_LEGADO.
function WP_podeNotificar_(email, aluno) {
  if (typeof SEG_buscarVinculo_ !== 'function') return true;   // camada não instalada
  var v = SEG_buscarVinculo_(String(email || '').trim().toLowerCase());
  if (!v) return !!(typeof SEG_CONFIG !== 'undefined' && SEG_CONFIG.LIBERAR_RESPONSAVEIS_LEGADO);
  if (v.status !== 'APROVADO') return false;
  var alvo = SEG_normalizar_(aluno);
  return v.alunosAprovados.some(function (a) { return SEG_normalizar_(a) === alvo; });
}


// =====================================================================
//  DOCUMENTOS — operação "upload_documento" do Portal dos Pais
// =====================================================================
function uploadDocumentoResponsavel(data) {
  var sessao = validarToken(data.token);   // função do Código.gs
  if (!sessao) return { status: 'unauthorized', message: 'Sessão expirada. Entre novamente.' };
  var email = String(sessao.email).toLowerCase();

  var aluno = String(data.aluno || '').trim();
  var documento = String(data.documento || '').trim().substring(0, 120);
  var nomeOriginal = String(data.nomeArquivo || 'documento').trim();
  if (!aluno || !documento || !data.arquivo) return { status: 'error', message: 'Dados incompletos.' };

  // Quem pode enviar: o responsável aprovado daquele aluno, ou um servidor nível 2+
  if (sessao.setor === 'responsavel') {
    if (!WP_podeNotificar_(email, aluno) || !WP_responsavelTemAluno_(email, aluno)) {
      return { status: 'forbidden', message: 'Aluno não vinculado a este responsável.' };
    }
  } else if ((parseInt(sessao.nivel, 10) || 0) < 2) {
    return { status: 'forbidden', message: 'Sem permissão.' };
  }

  var ext = (nomeOriginal.split('.').pop() || '').toLowerCase();
  if (WP_CONFIG.DOC_EXTENSOES.indexOf(ext) === -1) {
    return { status: 'error', message: 'Tipo de arquivo não aceito. Envie PDF, foto (JPG/PNG) ou Word.' };
  }

  var bytes;
  try { bytes = Utilities.base64Decode(String(data.arquivo)); } catch (e) { return { status: 'error', message: 'Arquivo corrompido.' }; }
  if (bytes.length > WP_CONFIG.DOC_TAMANHO_MAX_MB * 1024 * 1024) {
    return { status: 'error', message: 'Arquivo maior que ' + WP_CONFIG.DOC_TAMANHO_MAX_MB + ' MB.' };
  }
  if (!WP_conteudoConfere_(bytes, ext)) {
    return { status: 'error', message: 'O conteúdo do arquivo não corresponde à extensão .' + ext + '.' };
  }

  var tipos = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    heic: 'image/heic', doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  var agora = new Date();
  var carimbo = Utilities.formatDate(agora, 'GMT-3', 'yyyy-MM-dd_HHmm');
  var nomeFinal = (aluno + ' - ' + documento + ' - ' + carimbo).replace(/[\\\/:*?"<>|]/g, '-') + '.' + ext;

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var pasta = DriveApp.getFolderById(PASTA_DOCUMENTOS_ID);   // constante do Código.gs
    var arquivo = pasta.createFile(Utilities.newBlob(bytes, tipos[ext], nomeFinal));
    // Fica com o compartilhamento da pasta (privado). NÃO é aberto "para qualquer pessoa com o link".
    arquivo.setDescription('Enviado pelo Portal dos Pais por ' + email + ' em ' +
      Utilities.formatDate(agora, 'GMT-3', 'dd/MM/yyyy HH:mm') + ' (arquivo original: ' + nomeOriginal + ')');

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var aba = ss.getSheetByName('Documentos_Secretaria');
    if (!aba) {
      aba = ss.insertSheet('Documentos_Secretaria');
      aba.appendRow(['Aluno', 'Turma', 'Documento', 'Status', 'Data', 'Link Drive', 'Data Envio', 'Observações']);
    }
    var dataHora = Utilities.formatDate(agora, 'GMT-3', 'dd/MM/yyyy HH:mm');
    var obs = 'Enviado pelo responsável (' + email + ')';
    var linhas = aba.getDataRange().getValues();
    var alvoAluno = removerAcentos(aluno).toLowerCase(), alvoDoc = documento.toLowerCase();
    var atualizou = false;

    // Se havia pedido "Pendente" desse documento, marca como Enviado
    for (var i = linhas.length - 1; i >= 1; i--) {
      if (removerAcentos(String(linhas[i][0] || '').trim()).toLowerCase() === alvoAluno &&
          String(linhas[i][2] || '').trim().toLowerCase() === alvoDoc &&
          String(linhas[i][3] || '').trim() === 'Pendente') {
        aba.getRange(i + 1, 4).setValue('Enviado');
        aba.getRange(i + 1, 6).setValue(arquivo.getUrl());
        aba.getRange(i + 1, 7).setValue(dataHora);
        aba.getRange(i + 1, 8).setValue(obs);
        atualizou = true;
        break;
      }
    }
    if (!atualizou) {
      aba.appendRow([aluno, encontrarTurmaDoAluno(aluno), documento, 'Enviado',
        Utilities.formatDate(agora, 'GMT-3', 'dd/MM/yyyy'), arquivo.getUrl(), dataHora, obs]);
    }
  } finally {
    lock.releaseLock();
  }

  if (WP_CONFIG.DOC_EMAIL_SECRETARIA) {
    try {
      MailApp.sendEmail(WP_CONFIG.DOC_EMAIL_SECRETARIA, '📄 Documento recebido — ' + aluno,
        'O responsável ' + email + ' enviou "' + documento + '" para o(a) aluno(a) ' + aluno + '.\n\n' +
        'O arquivo está na pasta de documentos do Drive e na aba Documentos_Secretaria.\n\nSIGA - CCM Anchieta');
    } catch (e) { console.warn('Aviso à secretaria não enviado: ' + e); }
  }

  return { status: 'success', message: 'Documento enviado! A secretaria vai conferir.' };
}

function WP_responsavelTemAluno_(email, aluno) {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Responsaveis');
  if (!aba) return false;
  var alvo = removerAcentos(aluno).toLowerCase().trim();
  var dados = aba.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][0] || '').trim().toLowerCase() === email &&
        removerAcentos(String(dados[i][4] || '')).toLowerCase().trim() === alvo) return true;
  }
  // Com a camada instalada, o vínculo aprovado também vale
  return typeof SEG_buscarVinculo_ === 'function' && WP_podeNotificar_(email, aluno) && !!SEG_buscarVinculo_(email);
}

// Confere a "assinatura" dos primeiros bytes (evita um .exe renomeado para .pdf)
function WP_conteudoConfere_(bytes, ext) {
  var b = WP_semSinal_(bytes.slice(0, 12));
  function comeca(arr) { for (var i = 0; i < arr.length; i++) if (b[i] !== arr[i]) return false; return true; }
  switch (ext) {
    case 'pdf': return comeca([0x25, 0x50, 0x44, 0x46]);                         // %PDF
    case 'png': return comeca([0x89, 0x50, 0x4E, 0x47]);
    case 'jpg': case 'jpeg': return comeca([0xFF, 0xD8, 0xFF]);
    case 'webp': return comeca([0x52, 0x49, 0x46, 0x46]);                        // RIFF
    case 'docx': return comeca([0x50, 0x4B, 0x03, 0x04]);                        // ZIP
    case 'doc': return comeca([0xD0, 0xCF, 0x11, 0xE0]);
    case 'heic': return b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70; // ftyp
    default: return false;
  }
}
