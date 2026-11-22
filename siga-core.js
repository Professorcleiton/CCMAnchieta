// =============================================
// SIGA - Núcleo compartilhado (siga-core.js)
// Carregue ANTES de qualquer outro script da página:
//   <script src="siga-core.js?v=13"></script>
//
// O que este arquivo faz:
//  1. Centraliza a configuração (URL do Apps Script, ID da planilha).
//  2. Anexa o token de sessão a TODA chamada ao Apps Script (GET e POST),
//     para que o backend possa recusar pedidos sem login.
//  3. Neutraliza HTML vindo do servidor (proteção contra XSS armazenado).
//  4. Trata sessão expirada/inválida de forma uniforme.
//  5. Oferece lerAbaPlanilha(): lê abas pelo Apps Script autenticado e só
//     usa a leitura pública (GViz) como plano B enquanto o backend não
//     for atualizado.
// =============================================
(function (global) {
    'use strict';

    // ---------- 1. CONFIGURAÇÃO ÚNICA ----------
    // Ao reimplantar o Apps Script, troque a URL SOMENTE aqui.
    const SIGA_CONFIG = Object.freeze({
        APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbym9DGWB6hBj7nEmoWFM0vmErbzbq4VVobxY4PYRVEsgPmu7A98OxjLfiFY6D4E_ESUXw/exec',
        // Implantação separada usada hoje por imprimir-comunicado.html.
        // Se for uma versão antiga do mesmo script, aponte para APPS_SCRIPT_URL.
        APPS_SCRIPT_URL_COMUNICADOS: 'https://script.google.com/macros/s/AKfycbxEMx6NmZvQqPMmmxsrTaV1DrMHa-F16_ARFR1cjm_5v054lUtF80YWtW88g6MsyhajRg/exec',
        SHEET_ID: '1UUiVcCaSb_9Lx7gdEpmBzeRQPlBwDZRouQC2pf1q8Vg',
        // Depois de publicar o backend novo e deixar a planilha PRIVADA,
        // mude para false: o site deixa de tentar a leitura pública.
        PERMITIR_FALLBACK_GVIZ: true,
        VERSAO: '3.0.0'
    });

    const CHAVE_SESSAO_SERVIDOR = 'sgi_ccma_session';
    const CHAVE_SESSAO_RESPONSAVEL = 'resp_logado';

    // ---------- 2. ESCAPE / NEUTRALIZAÇÃO ----------
    // Para montar HTML com dados: `<td>${escaparHTML(nome)}</td>`
    function escaparHTML(valor) {
        if (valor === null || valor === undefined) return '';
        return String(valor)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Para dados dentro de onclick="f('...')": escapa para string JS E para atributo HTML.
    function escaparJSAttr(valor) {
        if (valor === null || valor === undefined) return '';
        const js = String(valor)
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/\r?\n/g, '\\n');
        return escaparHTML(js);
    }

    // Aplicada automaticamente a toda resposta do servidor.
    // Troca < e > por sinais parecidos (‹ ›), impedindo a criação de tags,
    // e desarma entidades HTML (&#..; / &nome;). Texto comum não muda.
    function neutralizarTexto(s) {
        if (typeof s !== 'string') return s;
        if (!/[<>&"]/.test(s)) return s;
        return s
            .replace(/</g, '‹')
            .replace(/>/g, '›')
            .replace(/&(#?[a-zA-Z0-9]+);/g, '＆$1;')
            .replace(/"/g, '”');
    }

    function sanitizarProfundo(obj, profundidade) {
        profundidade = profundidade || 0;
        if (profundidade > 20 || obj === null || obj === undefined) return obj;
        if (typeof obj === 'string') return neutralizarTexto(obj);
        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) obj[i] = sanitizarProfundo(obj[i], profundidade + 1);
            return obj;
        }
        if (typeof obj === 'object') {
            for (const k in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, k)) {
                    // Não mexe em conteúdo binário/base64 nem em tokens
                    if (k === 'token' || k === 'arquivo' || k === 'base64') continue;
                    obj[k] = sanitizarProfundo(obj[k], profundidade + 1);
                }
            }
        }
        return obj;
    }

    // ---------- 3. SESSÃO ----------
    function lerJSON(storage, chave) {
        try { return JSON.parse(storage.getItem(chave) || 'null'); } catch (e) { return null; }
    }

    function obterSessao() {
        return lerJSON(sessionStorage, CHAVE_SESSAO_SERVIDOR)
            || lerJSON(localStorage, CHAVE_SESSAO_SERVIDOR)
            || lerJSON(sessionStorage, CHAVE_SESSAO_RESPONSAVEL);
    }

    function obterToken() {
        const s = obterSessao();
        return (s && s.token) ? s.token : '';
    }

    function encerrarSessaoLocal(motivo) {
        const eraResponsavel = !!sessionStorage.getItem(CHAVE_SESSAO_RESPONSAVEL);
        sessionStorage.removeItem(CHAVE_SESSAO_SERVIDOR);
        localStorage.removeItem(CHAVE_SESSAO_SERVIDOR);
        sessionStorage.removeItem(CHAVE_SESSAO_RESPONSAVEL);
        try { sessionStorage.setItem('siga_aviso_login', motivo || 'Sua sessão expirou. Entre novamente.'); } catch (e) {}
        const destino = eraResponsavel ? 'responsaveis.html' : 'restrito.html';
        const pagina = location.pathname.split('/').pop() || 'index.html';
        if (pagina === 'index.html' || pagina === 'responsaveis.html') return;
        if (pagina === destino) location.reload();
        else location.href = destino;
    }

    // Mostra, na tela de login, o motivo de a sessão ter sido encerrada
    document.addEventListener('DOMContentLoaded', function () {
        let aviso = null;
        try { aviso = sessionStorage.getItem('siga_aviso_login'); } catch (e) {}
        if (!aviso) return;
        sessionStorage.removeItem('siga_aviso_login');
        const div = document.createElement('div');
        div.setAttribute('role', 'alert');
        div.textContent = '⏰ ' + aviso;
        div.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:99999;background:#f59e0b;color:#1f2937;padding:10px 18px;border-radius:8px;font:600 14px system-ui,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.2);max-width:90vw;text-align:center;';
        document.body.appendChild(div);
        setTimeout(function () { div.remove(); }, 6000);
    });

    // ---------- 4. FETCH SEGURO (intercepta chamadas ao Apps Script) ----------
    const fetchOriginal = global.fetch.bind(global);

    function ehAppsScript(url) {
        return typeof url === 'string' && url.indexOf('script.google.com/macros/') !== -1;
    }

    function anexarTokenNaURL(url, token) {
        if (!token || /[?&]token=/.test(url)) return url;
        return url + (url.indexOf('?') === -1 ? '?' : '&') + 'token=' + encodeURIComponent(token);
    }

    function anexarTokenNoCorpo(body, token) {
        if (!token || typeof body !== 'string') return body;
        try {
            const obj = JSON.parse(body);
            if (obj && typeof obj === 'object' && !Array.isArray(obj) && !obj.token) {
                obj.token = token;
                return JSON.stringify(obj);
            }
        } catch (e) { /* corpo não-JSON: envia como está */ }
        return body;
    }

    const OPERACOES_PUBLICAS = /"operacao"\s*:\s*"(LOGIN|LOGIN_RESPONSAVEL|CADASTRAR_RESPONSAVEL|RECUPERAR_SENHA|REDEFINIR_SENHA)"/;

    global.fetch = async function (input, init) {
        const url = (typeof input === 'string') ? input : (input && input.url);
        if (!ehAppsScript(url)) return fetchOriginal(input, init);

        const token = obterToken();
        init = Object.assign({}, init || {});
        const metodo = (init.method || 'GET').toUpperCase();
        let urlFinal = url;

        if (metodo === 'GET') {
            urlFinal = anexarTokenNaURL(url, token);
        } else if (typeof init.body === 'string' && !OPERACOES_PUBLICAS.test(init.body)) {
            init.body = anexarTokenNoCorpo(init.body, token);
        }

        const resposta = await fetchOriginal(typeof input === 'string' ? urlFinal : new Request(urlFinal, input), init);

        // Lê, sanitiza e devolve uma nova Response equivalente
        let texto;
        try { texto = await resposta.text(); } catch (e) { return resposta; }
        let dados;
        try { dados = JSON.parse(texto); } catch (e) {
            return new Response(texto, { status: resposta.status, statusText: resposta.statusText, headers: resposta.headers });
        }

        // Só encerra se havia token (evita loop de recarga em páginas sem login)
        if (token && dados && (dados.status === 'unauthorized' || dados.status === 'token_invalido' || dados.status === 'sessao_expirada')) {
            encerrarSessaoLocal(dados.message);
        }

        sanitizarProfundo(dados);
        return new Response(JSON.stringify(dados), {
            status: resposta.status,
            statusText: resposta.statusText,
            headers: { 'Content-Type': 'application/json' }
        });
    };

    // ---------- 5. LEITURA DE ABAS ----------
    // Retorna o mesmo formato da GViz ({ table: { rows: [{ c: [{v}] }] } })
    // para que o código existente continue funcionando sem alterações.
    async function lerAbaPlanilha(nomeAba) {
        try {
            const r = await global.fetch(SIGA_CONFIG.APPS_SCRIPT_URL + '?aba=tabela&nome=' + encodeURIComponent(nomeAba));
            const d = await r.json();
            if (d && d.table && Array.isArray(d.table.rows)) return d;
        } catch (e) {
            console.warn('lerAbaPlanilha: backend ainda não suporta ?aba=tabela (' + nomeAba + ')', e);
        }

        if (!SIGA_CONFIG.PERMITIR_FALLBACK_GVIZ) {
            throw new Error('Não foi possível carregar a aba ' + nomeAba + ' pelo servidor.');
        }

        // PLANO B (temporário): leitura pública. Só funciona enquanto a planilha
        // estiver compartilhada — desligue com PERMITIR_FALLBACK_GVIZ = false.
        const url = 'https://docs.google.com/spreadsheets/d/' + SIGA_CONFIG.SHEET_ID + '/gviz/tq?sheet=' + encodeURIComponent(nomeAba);
        const resp = await fetchOriginal(url);
        const text = await resp.text();
        const data = JSON.parse(text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1));
        return sanitizarProfundo(data);
    }

    // ---------- 6. VALIDAÇÃO DE SENHA ----------
    // Aceita letras e números. Senhas antigas só numéricas continuam válidas no login.
    function validarNovaSenha(senha) {
        if (!senha || senha.length < 6) return 'A senha precisa ter pelo menos 6 caracteres.';
        if (/^(\d)\1+$/.test(senha) || senha === '123456' || senha === '654321') return 'Escolha uma senha menos óbvia.';
        return '';
    }

    // Login compatível: tenta a senha como digitada e, se falhar, só os números
    // (regra antiga, para quem digitava o RG com pontos e traço).
    function variacoesSenha(digitada) {
        const v = [];
        const bruta = (digitada || '').trim();
        const numeros = bruta.replace(/\D/g, '');
        if (bruta) v.push(bruta);
        if (numeros && numeros !== bruta) v.push(numeros);
        return v;
    }

    // ---------- 7. RECUPERAÇÃO DE SENHA ----------
    // tipo: 'servidor' ou 'responsavel'. O backend envia um código de 6 dígitos
    // por e-mail (válido por 15 min) e depois aceita a nova senha.
    function abrirRecuperacaoSenha(tipo) {
        const antigo = document.getElementById('siga-modal-recuperacao');
        if (antigo) antigo.remove();

        const fundo = document.createElement('div');
        fundo.id = 'siga-modal-recuperacao';
        fundo.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.6);z-index:99998;display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,sans-serif;';
        fundo.innerHTML =
            '<div role="dialog" aria-modal="true" aria-labelledby="siga-rec-titulo" style="background:#fff;color:#1e293b;border-radius:12px;max-width:380px;width:100%;padding:22px;box-shadow:0 10px 30px rgba(0,0,0,.3);text-align:left;">' +
            '<h3 id="siga-rec-titulo" style="margin:0 0 6px;color:#005088;font-size:18px;">Recuperar senha</h3>' +
            '<p id="siga-rec-texto" style="font-size:13px;color:#64748b;margin:0 0 14px;">Informe o e-mail cadastrado. Enviaremos um código de verificação.</p>' +
            '<div id="siga-rec-passo1">' +
            '<input id="siga-rec-email" type="email" placeholder="seu@email.com" autocomplete="email" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px;box-sizing:border-box;">' +
            '</div>' +
            '<div id="siga-rec-passo2" style="display:none;">' +
            '<input id="siga-rec-codigo" inputmode="numeric" maxlength="6" placeholder="Código de 6 dígitos" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px;margin-bottom:8px;box-sizing:border-box;">' +
            '<input id="siga-rec-senha" type="password" autocomplete="new-password" placeholder="Nova senha (mín. 6 caracteres)" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px;margin-bottom:8px;box-sizing:border-box;">' +
            '<input id="siga-rec-senha2" type="password" autocomplete="new-password" placeholder="Repita a nova senha" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px;box-sizing:border-box;">' +
            '</div>' +
            '<div id="siga-rec-msg" aria-live="polite" style="font-size:13px;margin:10px 0;min-height:18px;"></div>' +
            '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
            '<button type="button" id="siga-rec-cancelar" style="padding:9px 14px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;cursor:pointer;">Cancelar</button>' +
            '<button type="button" id="siga-rec-ok" style="padding:9px 14px;border:none;background:#005088;color:#fff;border-radius:6px;cursor:pointer;font-weight:600;">Enviar código</button>' +
            '</div></div>';
        document.body.appendChild(fundo);

        const $ = function (id) { return document.getElementById(id); };
        let passo = 1, email = '';
        const fechar = function () { fundo.remove(); };
        $('siga-rec-cancelar').onclick = fechar;
        fundo.addEventListener('click', function (e) { if (e.target === fundo) fechar(); });
        $('siga-rec-email').focus();

        async function enviar(payload) {
            const r = await global.fetch(SIGA_CONFIG.APPS_SCRIPT_URL, {
                method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(payload)
            });
            return r.json();
        }

        $('siga-rec-ok').onclick = async function () {
            const msg = $('siga-rec-msg'), btn = $('siga-rec-ok');
            msg.style.color = '#dc2626';
            try {
                btn.disabled = true;
                if (passo === 1) {
                    email = $('siga-rec-email').value.trim().toLowerCase();
                    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = 'Digite um e-mail válido.'; return; }
                    msg.style.color = '#64748b'; msg.textContent = 'Enviando…';
                    await enviar({ operacao: 'RECUPERAR_SENHA', email: email, tipo: tipo });
                    // Resposta sempre neutra: não revela se o e-mail existe
                    passo = 2;
                    $('siga-rec-passo1').style.display = 'none';
                    $('siga-rec-passo2').style.display = 'block';
                    $('siga-rec-texto').textContent = 'Se o e-mail estiver cadastrado, você receberá um código em instantes (confira o spam).';
                    btn.textContent = 'Trocar senha';
                    msg.textContent = '';
                    $('siga-rec-codigo').focus();
                } else {
                    const codigo = $('siga-rec-codigo').value.trim();
                    const senha = $('siga-rec-senha').value;
                    if (!/^\d{6}$/.test(codigo)) { msg.textContent = 'O código tem 6 dígitos.'; return; }
                    const problema = validarNovaSenha(senha);
                    if (problema) { msg.textContent = problema; return; }
                    if (senha !== $('siga-rec-senha2').value) { msg.textContent = 'As senhas não conferem.'; return; }
                    msg.style.color = '#64748b'; msg.textContent = 'Salvando…';
                    const d = await enviar({ operacao: 'REDEFINIR_SENHA', email: email, tipo: tipo, codigo: codigo, novaSenha: senha });
                    if (d.status === 'success') {
                        msg.style.color = '#16a34a';
                        msg.textContent = '✅ Senha alterada! Você já pode entrar.';
                        setTimeout(fechar, 1800);
                    } else {
                        msg.style.color = '#dc2626';
                        msg.textContent = d.message || 'Código inválido ou expirado.';
                    }
                }
            } catch (e) {
                msg.style.color = '#dc2626';
                msg.textContent = 'Erro de conexão. Tente novamente.';
            } finally {
                btn.disabled = false;
            }
        };
    }

    // ---------- EXPORTA ----------
    global.abrirRecuperacaoSenha = abrirRecuperacaoSenha;
    global.SIGA_CONFIG = SIGA_CONFIG;
    global.escaparHTML = escaparHTML;
    global.escaparJSAttr = escaparJSAttr;
    global.neutralizarTexto = neutralizarTexto;
    global.sanitizarDados = sanitizarProfundo;
    global.obterTokenSIGA = obterToken;
    global.encerrarSessaoSIGA = encerrarSessaoLocal;
    global.lerAbaPlanilha = lerAbaPlanilha;
    global.validarNovaSenha = validarNovaSenha;
    global.variacoesSenha = variacoesSenha;
})(window);
