// ========== GLOBAIS ==========
// let db = null;  ← REMOVA ESTA LINHA (db já está declarado no db.js)

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxEMx6NmZvQqPMmmxsrTaV1DrMHa-F16_ARFR1cjm_5v054lUtF80YWtW88g6MsyhajRg/exec';
const APPS_SCRIPT_PAT_URL = APPS_SCRIPT_URL; 
const SHEET_ID = '1UUiVcCaSb_9Lx7gdEpmBzeRQPlBwDZRouQC2pf1q8Vg';
const COLS_ALUNOS_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?sheet=Alunos`;
let usuarioLogado = null, todosOsRegistros = [], cacheAlunosPorTurma = {}, turmaSelecionadaAtiva = '';
let modalSetorAtivo = '', modalRegistrosFiltrados = [], modalItensExibidos = 50;
let totalRegistrosAnterior = 0;
let ultimoCarregamento = 0;
const CACHE_TEMPO = 30000;

// =============================================
// BANCO DE DADOS LOCAL - VERIFICAÇÃO
// =============================================

// db já está declarado no db.js - apenas verifica se está disponível
if (typeof db !== 'undefined' && db && db.db) {
    console.log('✅ Banco de dados local disponível');
} else {
    console.log('ℹ️ Banco de dados local não disponível - modo offline desativado');
}

// ==== FUNÇÕES DE INICIALIZAÇÃO E SUPORTE ====
function mostrarToast(mensagem, tipo = 'sucesso') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${tipo}`;
    let icone = tipo === 'erro' ? 'fa-circle-xmark' : tipo === 'aviso' ? 'fa-triangle-exclamation' : 'fa-circle-check';
    toast.innerHTML = `<i class="fa-solid ${icone}"></i> <span>${mensagem}</span>`;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('fade-out'); setTimeout(() => toast.remove(), 400); }, 3500);
}

// ========== SESSÃO E INICIALIZAÇÃO ==========
window.addEventListener('DOMContentLoaded', () => {
    const sessao = localStorage.getItem('sgi_ccma_session');
    if (sessao) { 
        usuarioLogado = JSON.parse(sessao); 
        inicializarPainel(); 
    }
});

async function autenticarUsuario() {
    const email = document.getElementById('user-email').value.trim().toLowerCase();
    const senha = document.getElementById('user-password').value.trim().replace(/\D/g, '');
    const err = document.getElementById('error-message'), btn = document.getElementById('btn-entrar-login');
    if (!email || !senha) return;
    
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    
    try {
        const r = await fetch(APPS_SCRIPT_URL, { 
            method: 'POST', 
            headers: { 'Content-Type': 'text/plain' }, 
            body: JSON.stringify({ operacao: "LOGIN", email, senha }) 
        });
        
        const data = await r.json();
        
        if (data.status === "success") {
            let setor = data.setor.toString().trim().toLowerCase();
            if (setor === 'direcao' || setor === 'professor' || setor === 'professores') setor = 'professores';
            
            usuarioLogado = { email, nome: data.nome, setorExibicao: 'PROFESSORES', setor, nivel: data.nivel };
            localStorage.setItem('sgi_ccma_session', JSON.stringify(usuarioLogado));
            inicializarPainel();
        } else { 
            err.style.display = 'block'; btn.disabled = false; btn.innerHTML = 'Entrar no Sistema'; 
        }
    } catch (e) { 
        err.style.display = 'block'; btn.disabled = false; btn.innerHTML = 'Entrar no Sistema'; 
        console.error('Erro no login:', e);
    }
}

function fazerLogout() { localStorage.removeItem('sgi_ccma_session'); location.reload(); }

// ========== NAVEGAÇÃO ENTRE ABAS ==========
function mostrarTab(tabSelecionada) {
    if (tabSelecionada === 'apontamentos') {
        document.getElementById('aba-apontamentos').style.display = 'block';
        document.getElementById('aba-documentos').style.display = 'none';
        document.getElementById('btn-voltar-apontamentos').style.display = 'none';
        const btnSec = document.getElementById('btn-aba-secretaria');
        if (btnSec && (usuarioLogado.nivel >= 3 || usuarioLogado.setor === 'secretaria' || usuarioLogado.setor === 'direcao')) {
            btnSec.style.display = 'inline-block';
        }
    } else if (tabSelecionada === 'documentos') {
        document.getElementById('aba-apontamentos').style.display = 'none';
        document.getElementById('aba-documentos').style.display = 'block';
        document.getElementById('btn-aba-secretaria').style.display = 'none';
        document.getElementById('btn-voltar-apontamentos').style.display = 'inline-block';
        carregarDocumentos(); 
    }
}

// ==== FUNÇÕES DE APONTAMENTO E DOCUMENTO ====
function salvarDocumento() {
    const alunoInput = document.getElementById('doc-aluno');
    const aluno = alunoInput.value.trim();
    const documento = document.getElementById('doc-tipo').value;
    const status = document.getElementById('doc-status').value;
    const turmaDoAluno = encontrarTurmaDoAluno(aluno);
    const btnSalvar = document.getElementById('btn-salvar-doc');
    const msgDoc = document.getElementById('msg-doc');

    if (!aluno) {
        mostrarToast("Por favor, digite o nome do aluno.", "aviso");
        return;
    }

    btnSalvar.innerText = "Salvando...";
    btnSalvar.disabled = true;

    const dadosParaEnviar = {
        operacao: "salvar_documento",
        aluno: aluno,
        turma: turmaDoAluno,
        documento: documento,
        status: status,
        data: new Date().toLocaleDateString('pt-BR')
    };

    fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(dadosParaEnviar)
    })
    .then(() => {
        msgDoc.innerText = "✅ Documento salvo!";
        msgDoc.style.display = "block";
        alunoInput.value = ""; 
        carregarDocumentos(); 
        
        const payloadADM = { 
            operacao: "SALVAR", 
            aluno: aluno, 
            setor: 'adm', 
            texto: `📄 Documento solicitado: ${documento} | Status: ${status}`, 
            funcionario: usuarioLogado.nome, 
            dataAtual: new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        };
        fetch(APPS_SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(payloadADM) })
        .then(() => carregarRegistrosDoServidor()); 
    })
    .finally(() => {
        btnSalvar.innerText = "Salvar no Sistema";
        btnSalvar.disabled = false;
        setTimeout(() => { msgDoc.style.display = "none"; }, 3000);
    });
}

async function carregarDocumentos() {
    const tbody = document.getElementById('tabela-documentos-body');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">Carregando...</td></tr>';

    try {
        const resposta = await fetch(APPS_SCRIPT_URL, { 
            method: 'POST', 
            headers: { 'Content-Type': 'text/plain' }, 
            body: JSON.stringify({ operacao: "listar_documentos" }) 
        });
        
        const linhasPlanilha = await resposta.json();
        tbody.innerHTML = ''; 

        if (linhasPlanilha.length <= 1) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">Nenhum documento registrado.</td></tr>';
            return;
        }

        let htmlRows = '';
        for (let i = linhasPlanilha.length - 1; i > 0; i--) {
            let linha = linhasPlanilha[i];
            
            let dataFormatada = 'Data inválida';
            if (linha[4]) {
                const d = new Date(linha[4]);
                if (!isNaN(d.getTime())) {
                    dataFormatada = d.toLocaleDateString('pt-BR');
                } else {
                    dataFormatada = linha[4];
                }
            }
            
            const linkArquivo = linha[5] ? linha[5].toString().trim() : '';
            const status = linha[3] ? linha[3].toString().trim() : 'Pendente';
            
            let botaoDownload = '-';
            if (linkArquivo && (status === 'Enviado' || status === 'Verificado')) {
                botaoDownload = `<a href="${linkArquivo}" target="_blank" style="color:#4f46e5;text-decoration:underline;font-weight:bold;">📎 Baixar</a>`;
            } else if (status === 'Pendente') {
                botaoDownload = '<span style="color:#d97706;">Pendente</span>';
            }
            
            htmlRows += `<tr>
                <td>${linha[1] || '-'}</td>
                <td>${linha[0] || '-'}</td>
                <td>${linha[2] || '-'}</td>
                <td>${status}</td>
                <td>${dataFormatada}</td>
                <td>${botaoDownload}</td>
            </tr>`;
        }
        tbody.innerHTML = htmlRows;
        
    } catch (e) { 
        console.error("Erro ao carregar documentos:", e);
        tbody.innerHTML = '<tr><td colspan="6" style="color: red; text-align: center;">Erro ao carregar documentos.</td></tr>'; 
    }
}

function inicializarPainel() {
    const telaLogin = document.getElementById('login-screen');
    if (telaLogin) telaLogin.style.display = 'none';
    const interfaceApp = document.getElementById('app-interface');
    if (interfaceApp) interfaceApp.style.display = 'flex';
    const displayUser = document.getElementById('user-display');
    if (displayUser) displayUser.innerHTML = `<i class="fa-solid fa-user-check"></i> ${usuarioLogado.nome}`;
    aplicarBloqueioSetores(usuarioLogado.setor, usuarioLogado.nivel);
    
    const btnGestao = document.getElementById('btn-abrir-admin');
    if (btnGestao) btnGestao.style.display = (usuarioLogado.nivel >= 4) ? 'inline-flex' : 'none';

    const btnPatrimonio = document.getElementById('btn-abrir-patrimonio');
    if (btnPatrimonio) btnPatrimonio.style.display = (usuarioLogado.nivel >= 4) ? 'inline-flex' : 'none';

    const btnSec = document.getElementById('btn-aba-secretaria');
    if (btnSec) {
        if (usuarioLogado.nivel >= 3 || usuarioLogado.setor === 'secretaria' || usuarioLogado.setor === 'direcao') {
            btnSec.style.display = 'flex';
        } else {
            btnSec.style.display = 'none';
        }
    }
    verificarBotaoComunicado();
    carregarAlunosETurmas(); 
    carregarRegistrosDoServidor();
    // 🆕 Aplicar controle de acesso
    aplicarControleAcesso();
    // Inicializa o status de conexão
    setTimeout(atualizarStatusConexao, 2000);
}

// ==== ALERTA EM TEMPO REAL ====
setInterval(async () => {
    if (usuarioLogado) { 
        try {
            const r = await fetch(APPS_SCRIPT_URL, { method: 'GET', cache: 'no-cache' });
            const data = await r.json();
            const contagemAtual = data.apontamentos ? data.apontamentos.length : 0;
            if (totalRegistrosAnterior !== 0 && contagemAtual !== totalRegistrosAnterior) {
                mostrarToast('Novos apontamentos!', 'sucesso');
                carregarRegistrosDoServidor();
            }
            totalRegistrosAnterior = contagemAtual;
        } catch (e) { console.log("Atualização em background falhou."); }
    }
}, 120000);

// ==== CARREGAMENTO DE ALUNOS ====
async function carregarAlunosETurmas() {
    cacheAlunosPorTurma = {};
    
    try {
        let turmasPermitidas = null;
        
        if (usuarioLogado && usuarioLogado.setor === 'professores' && usuarioLogado.nivel < 4) {
            console.log('🔍 Verificando turmas para professor:', usuarioLogado.email);
            const respTurmas = await fetch(APPS_SCRIPT_URL + '?aba=turmas_professor&email=' + encodeURIComponent(usuarioLogado.email));
            turmasPermitidas = await respTurmas.json();
            console.log('📋 Turmas permitidas:', turmasPermitidas);
            
            if (turmasPermitidas.length === 0) {
                console.log('⚠️ Nenhuma turma encontrada. Mostrando todas.');
                turmasPermitidas = null;
            }
        }
        
        const response = await fetch(COLS_ALUNOS_URL);
        const text = await response.text();
        const jsonText = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
        const data = JSON.parse(jsonText);
        
        data.table.rows.forEach(r => {
            if (r.c && r.c[1] && r.c[1].v) {
                const nome = r.c[1].v.toString().trim();
                const turma = (r.c[2] && r.c[2].v) ? r.c[2].v.toString().trim() : 'Sem Turma';
                
                if (turmasPermitidas && !turmasPermitidas.includes(turma)) return;
                
                if (!cacheAlunosPorTurma[turma]) cacheAlunosPorTurma[turma] = [];
                if (!cacheAlunosPorTurma[turma].includes(nome)) cacheAlunosPorTurma[turma].push(nome);
            }
        });
        
        console.log('📊 Turmas carregadas:', Object.keys(cacheAlunosPorTurma));
        renderizarSidebarTurmas();
    } catch (e) { console.error(e); }
}

function encontrarTurmaDoAluno(nome) {
    const nomeLimpo = nome.trim().toLowerCase();
    for (let t in cacheAlunosPorTurma) {
        if (cacheAlunosPorTurma[t].map(n => n.trim().toLowerCase()).includes(nomeLimpo)) return t;
    }
    return 'Sem Turma';
}

function alternarMenuLateral() {
    const sidebar = document.getElementById('app-sidebar');
    if (sidebar) {
        sidebar.classList.toggle('open');
    } else {
        console.error('❌ Elemento #app-sidebar não encontrado!');
    }
}

function alternarAbaMobile(setor, btn) {
    document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.sector-column').forEach(c => { c.classList.remove('active'); });
    const col = document.getElementById(`col-${setor}`);
    if (col) col.classList.add('active'); 
}

function renderizarSidebarTurmas() {
    const ul = document.getElementById('lista-turmas-sidebar');
    
    // VERIFICA SE O ELEMENTO EXISTE
    if (!ul) {
        console.error('❌ Elemento #lista-turmas-sidebar não encontrado!');
        // Tenta criar o elemento se não existir
        const sidebarTop = document.querySelector('#app-sidebar .sidebar-top');
        if (sidebarTop) {
            const newUl = document.createElement('ul');
            newUl.className = 'turmas-lista';
            newUl.id = 'lista-turmas-sidebar';
            newUl.innerHTML = '<li class="turma-item">Nenhuma turma</li>';
            sidebarTop.appendChild(newUl);
            console.log('✅ Elemento #lista-turmas-sidebar recriado!');
            // Tenta novamente
            setTimeout(renderizarSidebarTurmas, 100);
        }
        return;
    }
    
    ul.innerHTML = '';
    const turmas = Object.keys(cacheAlunosPorTurma).sort();
    if (!turmas.length) { 
        ul.innerHTML = '<li class="turma-item">Nenhuma turma</li>'; 
        return; 
    }
    turmas.forEach((turma, idx) => {
        const li = document.createElement('li');
        li.className = 'turma-item';
        li.innerHTML = `<i class="fa-solid fa-users-viewfinder"></i> ${turma}`;
        li.onclick = () => {
            document.querySelectorAll('.turma-item').forEach(el => el.classList.remove('active'));
            li.classList.add('active');
            selecionarTurma(turma);
        };
        ul.appendChild(li);
        if (idx === 0 && !turmaSelecionadaAtiva) { 
            li.classList.add('active'); 
            selecionarTurma(turma); 
        }
    });
}
function selecionarTurma(turma) {
    turmaSelecionadaAtiva = turma;
    const select = document.getElementById('select-alunos');
    select.innerHTML = '<option value="">-- Escolha o Aluno --</option>';
    
    const alunos = cacheAlunosPorTurma[turma] || [];
    alunos.sort().forEach(a => { 
        const opt = document.createElement('option'); 
        opt.value = a; 
        opt.textContent = a; 
        select.appendChild(opt); 
    });
    
    select.value = '';
    filtrarRegistrosPorAluno();
    
    // TORNA O BOTÃO DO PRÉ-CONSELHO VISÍVEL ASSIM QUE UMA TURMA É SELECIONADA
    const btnPreConselho = document.getElementById('btn-gerar-pdf-pre-conselho');
    if (btnPreConselho) {
        btnPreConselho.style.display = 'inline-flex';
    }

    document.getElementById('app-sidebar').classList.remove('open');
}

// ==== BUSCA E CARREGAMENTO DE DADOS (COM ATAS) ====
async function carregarRegistrosDoServidor() {
    const agora = Date.now();
    if (agora - ultimoCarregamento < CACHE_TEMPO && todosOsRegistros.length > 0) {
        atualizarGraficosMural();
        if (document.getElementById('select-alunos').value) filtrarRegistrosPorAluno();
        return;
    }
    ultimoCarregamento = agora;
    
    try {
        const resposta = await fetch(APPS_SCRIPT_URL + "?aba=todos_os_dados"); 
        const data = await resposta.json(); 
        
        todosOsRegistros = [];

        (data.apontamentos || []).forEach(row => {
            todosOsRegistros.push({
                idLinha: row.idLinha,
                aluno: row.aluno,
                setor: row.setor,
                texto: row.texto,
                funcionario: row.funcionario,
                dataAtual: row.dataAtual,
                tipo: 'apontamento'
            });
        });

        if (data.documentos) {
            data.documentos.forEach(doc => {
                var linkDownload = doc.link ? ' <a href="' + doc.link + '" target="_blank" style="color:#4f46e5;text-decoration:underline;">📎 Baixar</a>' : '';
                todosOsRegistros.push({
                    aluno: doc.aluno,
                    setor: 'adm',
                    texto: '📄 Documento: ' + doc.documento + ' - Status: ' + doc.status + linkDownload,
                    funcionario: 'Secretaria',
                    dataAtual: doc.data,
                    tipo: 'documento'
                });
            });
        }

        if (data.ocorrencias) {
            data.ocorrencias.forEach(oc => {
                var icone = oc.tipo === "Saída Antecipada" ? "🚪" : "⏰";
                var horario = oc.data ? oc.data.split(' ')[1] : '';
                todosOsRegistros.push({
                    aluno: oc.aluno,
                    setor: 'adm',
                    texto: icone + ' ' + oc.tipo + ': ' + oc.motivo + ' | Autorizado por: ' + oc.autorizador + ' | Horário: ' + horario,
                    funcionario: oc.autorizador || 'Secretaria',
                    dataAtual: oc.data,
                    tipo: 'ocorrencia'
                });
            });
        }

        if (data.atas) {
            data.atas.forEach(ata => {
                var linkHtml = (usuarioLogado && usuarioLogado.nivel >= 3) ?
                    ' <a href="' + ata.link + '" target="_blank" style="color:#4f46e5;text-decoration:underline;">📎 Ver Ata</a>' : '';
                todosOsRegistros.push({
                    aluno: ata.aluno,
                    setor: 'adm',
                    texto: '📁 Ata Disciplinar nº ' + ata.numero + ': ' + ata.aluno + ' — ' + ata.data + linkHtml,
                    funcionario: 'Coordenação',
                    dataAtual: ata.data,
                    tipo: 'ata'
                });
            });
        }

        if (data.fatos_seed) {
            data.fatos_seed.forEach(fato => {
                var isPositivo = fato.tipo.toLowerCase().indexOf('positivo') !== -1;
                var iconeFato = isPositivo ? '🌟' : '⚠️';
                var corFato = isPositivo ? '#16a34a' : '#dc2626';

                todosOsRegistros.push({
                    aluno: fato.aluno,
                    setor: 'pedagogico',
                    texto: '<div style="background-color:#f8fafc;border-left:4px solid ' + corFato + ';padding:10px;margin-top:5px;border-radius:4px;border:1px solid #e2e8f0;">' +
                           '<strong style="color:' + corFato + ';font-size:13px;">' + iconeFato + ' Fato ' + fato.tipo + ' (SEED-PR)</strong><br>' +
                           '<span style="font-size:13px;color:#334155;">' + fato.descricao + '</span>' +
                           '</div>',
                    funcionario: 'Sistema Estadual',
                    dataAtual: fato.data,
                    tipo: 'fato_seed'
                });
            });
        }

        atualizarGraficosMural();
        if (document.getElementById('select-alunos').value) filtrarRegistrosPorAluno();

    } catch (e) { 
        console.error("Erro ao carregar dados:", e); 
    }
}

function atualizarGraficosMural() {
    const total = todosOsRegistros.length;
    const meivs = todosOsRegistros.filter(r => r.setor.toLowerCase() === 'meivs').length;
    const pedagogico = todosOsRegistros.filter(r => r.setor.toLowerCase() === 'pedagogico').length;
    const adm = todosOsRegistros.filter(r => r.setor.toLowerCase() === 'adm').length;
    const professores = todosOsRegistros.filter(r => r.setor.toLowerCase() === 'professores' || r.setor.toLowerCase() === 'direcao').length;

    document.getElementById('dash-val-total').innerText = total;
    document.getElementById('dash-val-meivs').innerText = meivs;
    document.getElementById('dash-val-pedagogico').innerText = pedagogico;
    document.getElementById('dash-val-adm').innerText = adm;
    document.getElementById('dash-val-professores').innerText = professores;

    const pctMeivs = total === 0 ? 0 : Math.round((meivs / total) * 100);
    const pctPed = total === 0 ? 0 : Math.round((pedagogico / total) * 100);
    const pctAdm = total === 0 ? 0 : Math.round((adm / total) * 100);
    const pctProf = total === 0 ? 0 : Math.round((professores / total) * 100);

    document.getElementById('dash-bar-meivs').style.width = pctMeivs + '%';
    document.getElementById('dash-pct-meivs').innerText = pctMeivs + '%';
    document.getElementById('dash-bar-pedagogico').style.width = pctPed + '%';
    document.getElementById('dash-pct-pedagogico').innerText = pctPed + '%';
    document.getElementById('dash-bar-adm').style.width = pctAdm + '%';
    document.getElementById('dash-pct-adm').innerText = pctAdm + '%';
    document.getElementById('dash-bar-professores').style.width = pctProf + '%';
    document.getElementById('dash-pct-professores').innerText = pctProf + '%';
}

function formatarDataEHora(s) {
    if (!s) return ''; s = s.toString().trim();
    if (s.match(/^[A-Za-z]{3}\s[A-Za-z]{3}/) || s.includes('GMT')) {
        const d = new Date(s); if (!isNaN(d)) return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}`;
    }
    if (s.includes('-')) {
        const partes = s.split(' '), data = partes[0].split('-');
        const hora = partes[1] ? ' às ' + partes[1].substring(0,5) : '';
        if (data[0].length === 4) return `${data[2]}/${data[1]}/${data[0]}${hora}`;
    }
    if (s.includes('/')) return s.replace(' ', ' às ');
    return s;
}

function filtrarRegistrosPorAluno() {
    const select = document.getElementById('select-alunos');
    const mural = document.getElementById('welcome-dashboard-mural');
    const mini = document.getElementById('student-mini-dash');
    const grid = document.getElementById('siga-columns-grid'); 
    const pdf = document.getElementById('btn-gerar-pdf-oficial');
    const tabs = document.getElementById('mobile-tabs-container');

    // 1. Validação segura da seleção de aluno
    const aluno = select ? select.value : '';
    const valorInvalido = !aluno || aluno === "" || aluno === "Selecione uma turma..." || aluno === "Selecione um aluno...";

    if (valorInvalido) {
        if (mural) mural.style.display = 'flex';
        if (mini) mini.style.display = 'none';
        if (grid) grid.style.display = ''; 
        if (pdf) pdf.style.display = 'none';
        if (tabs) tabs.style.display = 'none';
        return;
    }

    // Normaliza o nome do aluno selecionado (remove acentos e espaços, converte para minúsculas)
    const alunoNormalizado = aluno.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

    // 2. Exibição segura dos elementos da tela
    if (mural) mural.style.display = 'none';
    if (mini) mini.style.display = 'flex';
    if (grid) grid.style.display = 'grid';
    if (pdf) pdf.style.display = 'inline-flex';
    if (tabs) tabs.style.display = 'flex'; 

    // 3. Verificação segura do setor do usuário
    const setorUser = (typeof usuarioLogado !== 'undefined' && usuarioLogado && usuarioLogado.setor) ? usuarioLogado.setor : 'meivs';
    let abaPadrao = setorUser === 'professores' ? 'direcao' : setorUser;
    if (!['meivs', 'pedagogico', 'adm', 'direcao'].includes(abaPadrao)) abaPadrao = 'meivs';

    const colAtiva = document.getElementById(`col-${abaPadrao}`);
    if (colAtiva) {
        document.querySelectorAll('.sector-column').forEach(c => c.classList.remove('active'));
        colAtiva.classList.add('active');
    }
    
    const btnAtivo = document.querySelector(`.tab-button[onclick*="'${abaPadrao}'"]`);
    if (btnAtivo) {
        document.querySelectorAll('#mobile-tabs-container .tab-button').forEach(b => b.classList.remove('active'));
        btnAtivo.classList.add('active');
    }

    // 4. Limpeza dos feeds por setor
    ['meivs','pedagogico','adm','direcao'].forEach(s => {
        const feed = document.getElementById(`feed-${s}`);
        if (feed) feed.innerHTML = '';
    });

    let cm = 0, cp = 0, ca = 0, cf = 0;
    let docs = 0, ocorr = 0, atas = 0;

    // 5. Filtro e renderização dos cards
    if (typeof todosOsRegistros !== 'undefined' && Array.isArray(todosOsRegistros)) {
        todosOsRegistros.forEach(r => {
            // Normaliza o nome do registro para comparação
            const nomeRegistro = (r.aluno || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
            
            if (nomeRegistro === alunoNormalizado) {
                if (r.tipo === 'documento') {
                    docs++;
                } else if (r.tipo === 'ocorrencia') {
                    ocorr++;
                } else if (r.tipo === 'ata') {
                    atas++;
                } else {
                    let setor = r.setor;
                    if (setor === 'meivs') cm++;
                    else if (setor === 'pedagogico') cp++;
                    else if (setor === 'adm') ca++;
                    else if (setor === 'professores' || setor === 'direcao') cf++;
                }
                
                let setorExibicao = r.setor;
                if (setorExibicao === 'professores') setorExibicao = 'direcao';
                
                const feed = document.getElementById(`feed-${setorExibicao}`);
                if (feed) {
                    const card = document.createElement('div'); 
                    card.className = 'post-card';
                    
                    const nivelUser = (typeof usuarioLogado !== 'undefined' && usuarioLogado) ? usuarioLogado.nivel : 0;
                    const botoes = (nivelUser >= 3) ? 
                        `<div class="card-actions"><button class="btn-action-card btn-edit-card" onclick="editarRegistroServidor(${r.idLinha}, '${r.setor}')"><i class="fa-solid fa-pen-to-square"></i> Editar</button><button class="btn-action-card btn-delete-card" onclick="excluirRegistroServidor(${r.idLinha})"><i class="fa-solid fa-trash-can"></i> Apagar</button></div>` : '';
                    
                    const dataStr = (typeof formatarDataEHora === 'function') ? formatarDataEHora(r.dataAtual) : r.dataAtual;

                    card.innerHTML = `<p class="post-text" id="text-card-${r.idLinha}">${r.texto}</p><div class="post-footer"><span><i class="fa-solid fa-user"></i>${r.funcionario || 'SIGA'}</span><span><i class="fa-solid fa-clock"></i>${dataStr}</span></div>${botoes}`;
                    feed.appendChild(card);
                }
            }
        });
    }

    // 6. Atualização de contadores e barras com verificação de elemento
    const total = cm + cp + ca + cf + docs + ocorr + atas;
    const elTotal = document.getElementById('dash-total-count');
    if (elTotal) elTotal.innerText = total;
    
    const atualizarContador = (idBar, label, cor, valor) => {
        const bar = document.querySelector('.' + idBar);
        if (bar) bar.style.width = '0%';
        const container = document.querySelector('.mini-chart-bar-container');
        if (container) {
            const labels = container.querySelectorAll('.mini-label-chart');
            labels.forEach(l => {
                if (l.textContent.trim().startsWith(label)) {
                    l.innerHTML = label + ' <span style="background:' + cor + ';color:white;padding:2px 8px;border-radius:10px;font-size:11px;">' + valor + '</span>';
                }
            });
        }
    };

    atualizarContador('bar-meivs', 'MEIVS', '#0284c7', cm);
    atualizarContador('bar-pedag', 'PEDAG', '#0d9488', cp);
    atualizarContador('bar-adm', 'ADM', '#4f46e5', ca);
    atualizarContador('bar-profs', 'PROFS', '#b91c1c', cf);
    atualizarContador('docs-bar', 'DOCS', '#8b5cf6', docs);
    atualizarContador('ocorr-bar', 'OCORR', '#f59e0b', ocorr);
    atualizarContador('atas-bar', 'ATAS', '#dc2626', atas);
}

function verificarTeclaEnter(e, setor) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); salvarPost(setor); } }

// =============================================
// SALVAR APONTAMENTO (COM SUPORTE OFFLINE)
// =============================================

async function salvarPost(setor) {
    const textarea = document.getElementById(`text-${setor}`);
    const texto = textarea.value.trim();
    const aluno = document.getElementById('select-alunos').value;
    const btn = document.getElementById(`btn-${setor}`);

    if (!texto || !aluno) {
        mostrarToast('Selecione um aluno e digite algo antes de salvar.', 'aviso');
        return;
    }

    btn.disabled = true;
    
    const agora = new Date();
    const data = agora.toLocaleDateString('pt-BR') + ' ' + 
                 agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    
    const dadosApontamento = {
        aluno: aluno,
        setor: setor === 'direcao' ? 'professores' : setor,
        texto: texto,
        funcionario: usuarioLogado.nome,
        dataAtual: data
    };

    try {
        // VERIFICA SE ESTÁ ONLINE
        if (navigator.onLine) {
            // ONLINE: Salva direto no servidor
            console.log('📡 Online - salvando no servidor...');
            const result = await salvarNoServidor(dadosApontamento);
            
            if (result.status === 'success') {
                mostrarToast('✅ Apontamento salvo!', 'sucesso');
                textarea.value = '';
                fecharCaixaTexto(setor);
                // Recarrega os dados para mostrar o novo apontamento
                await carregarRegistrosDoServidor();
                // Filtra para o aluno atual
                if (document.getElementById('select-alunos').value) {
                    filtrarRegistrosPorAluno();
                }
            } else {
                mostrarToast('❌ Erro ao salvar. Tente novamente.', 'erro');
            }
        } else {
            // OFFLINE: Salva localmente
            console.log('📡 Offline - salvando localmente...');
            
            if (db && db.db) {
                const apontamentoLocal = await db.salvarApontamento(dadosApontamento);
                console.log('✅ Apontamento salvo localmente:', apontamentoLocal);
                
                // Mostra na tela com indicação de pendente
                mostrarApontamentoLocal(apontamentoLocal);
                mostrarToast('✅ Apontamento salvo localmente! (será sincronizado quando a internet voltar)', 'sucesso');
                
                textarea.value = '';
                fecharCaixaTexto(setor);
            } else {
                mostrarToast('❌ Banco de dados local não disponível.', 'erro');
            }
        }
        
    } catch (error) {
        console.error('❌ Erro ao salvar apontamento:', error);
        mostrarToast('❌ Erro ao salvar. Tente novamente.', 'erro');
    } finally {
        btn.disabled = false;
    }
}
async function salvarNoServidor(dados) {
    const payload = {
        operacao: "SALVAR",
        aluno: dados.aluno,
        setor: dados.setor,
        texto: dados.texto,
        funcionario: dados.funcionario,
        dataAtual: dados.dataAtual
    };
    
    console.log('📤 Enviando para o servidor:', payload);
    
    try {
        const response = await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(payload)
        });
        
        const resultado = await response.json();
        console.log('📥 Resposta do servidor:', resultado);
        
        if (resultado.status === 'success') {
            console.log('✅ Apontamento salvo no servidor!');
        } else {
            console.error('❌ Erro no servidor:', resultado);
        }
        
        return resultado;
    } catch (error) {
        console.error('❌ Erro de rede:', error);
        return { status: 'error', message: error.toString() };
    }
}

async function excluirRegistroServidor(id) {
    if (!id || !confirm('Apagar?')) return;
    try {
        await fetch(APPS_SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ operacao: "EXCLUIR", idLinha: id }) });
        todosOsRegistros = todosOsRegistros.filter(r => r.idLinha !== id); filtrarRegistrosPorAluno();
        mostrarToast('Registro apagado com sucesso.', 'sucesso');
    } catch (e) { 
        mostrarToast('Erro ao tentar apagar o registro.', 'erro'); 
    }
}

async function editarRegistroServidor(id, setor) {
    if (!id) return;
    const el = document.getElementById(`text-card-${id}`);
    const novo = prompt('Editar:', el.innerText);
    if (!novo || !novo.trim()) return;
    try {
        await fetch(APPS_SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ operacao: "EDITAR", idLinha: id, texto: novo.trim() }) });
        const reg = todosOsRegistros.find(r => r.idLinha === id); if (reg) reg.texto = novo.trim();
        filtrarRegistrosPorAluno();
        mostrarToast('Registro editado com sucesso!', 'sucesso');
    } catch (e) { 
        mostrarToast('Erro ao tentar editar.', 'erro'); 
    }
}

// ==== MODO ESCURO ====
function alternarTema() {
    const body = document.body;
    const btnIcone = document.getElementById('btn-icone-tema');
    
    body.classList.toggle('dark-mode');
    
    if (body.classList.contains('dark-mode')) {
        btnIcone.innerHTML = '<i class="fa-solid fa-sun" style="color: #eab308;"></i>';
        localStorage.setItem('sgi_ccma_tema', 'escuro');
    } else {
        btnIcone.innerHTML = '<i class="fa-solid fa-moon"></i>';
        localStorage.setItem('sgi_ccma_tema', 'claro');
    }
}

window.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem('sgi_ccma_tema') === 'escuro') {
        document.body.classList.add('dark-mode');
        const btnIcone = document.getElementById('btn-icone-tema');
        if (btnIcone) btnIcone.innerHTML = '<i class="fa-solid fa-sun" style="color: #eab308;"></i>';
    }
});

// ==== PDFS ====
function gerarFichaIndividualConselho() {
    const aluno = document.getElementById('select-alunos').value;
    if (!aluno) return;
    
    let html = `<div style="padding:25px;font-family:'Segoe UI',Arial;color:#000;background:#fff;">
        <div style="display:flex;justify-content:space-between;border-bottom:3px double #005088;padding-bottom:12px;margin-bottom:20px;">
            <div><h4 style="margin:0;font-size:13px;color:#475569;">SECRETARIA DE ESTADO DA EDUCAÇÃO - SEED</h4><h4 style="margin:2px 0 0;font-size:12px;color:#64748b;">NÚCLEO REGIONAL DE EDUCAÇÃO DE UMUARAMA</h4><h2 style="margin:5px 0 0;color:#005088;font-size:18px;">COLÉGIO CÍVICO-MILITAR ANCHIETA</h2></div>
            <div><span style="font-size:10px;border:1px solid #005088;padding:4px 8px;border-radius:4px;">DOCUMENTO INTERNO</span></div>
        </div>
        <h3 style="text-align:center;margin-bottom:25px;">Ficha de Acompanhamento Individual do Estudante</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <tr><td style="padding:6px;border:1px solid #94a3b8;background:#f8fafc;font-weight:bold;">Estudante:</td><td style="padding:6px;border:1px solid #94a3b8;">${aluno}</td><td style="padding:6px;border:1px solid #94a3b8;background:#f8fafc;font-weight:bold;">Turma:</td><td style="padding:6px;border:1px solid #94a3b8;">${turmaSelecionadaAtiva}</td></tr>
        </table>
        <h4 style="font-size:13px;color:#005088;margin-top:15px;">Histórico de Apontamentos</h4>`;
        
    // Normaliza o nome do aluno (ignora acentos e maiúsculas/minúsculas)
const alunoNormalizado = aluno.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

['meivs','pedagogico','adm','direcao'].forEach(setor => {
    const registros = todosOsRegistros.filter(r => {
        const nomeRegistro = (r.aluno || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        return nomeRegistro === alunoNormalizado && (r.setor === setor || (setor === 'direcao' && (r.setor === 'professores' || r.setor === 'direcao')));
    });
        if (registros.length) {
            html += `<div style="margin-top:10px;background:#f1f5f9;padding:5px 10px;border-radius:4px;font-weight:bold;border-left:5px solid #005088;">${setor.toUpperCase()}</div>`;
            registros.forEach(p => html += `<div style="margin:8px 0;padding:8px 12px;background:#fff;border-bottom:1px solid #e2e8f0;"><div>${p.texto}</div><div style="font-size:10px;color:#64748b;text-align:right;">${p.funcionario} | ${formatarDataEHora(p.dataAtual)}</div></div>`);
        }
    });
    
    html += `</div>`;
    
    const elementoParaImprimir = document.createElement('div');
    elementoParaImprimir.innerHTML = html;

    const opcoesPdf = { 
        margin: 12, 
        filename: `Ficha_Conselho_${aluno.replace(/ /g,'_')}.pdf`, 
        image: { type: 'jpeg', quality: 0.98 }, 
        html2canvas: { scale: 2 }, 
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } 
    };

    html2pdf().set(opcoesPdf).from(elementoParaImprimir).toPdf().get('pdf').then(function (pdf) {
        window.open(pdf.output('bloburl'), '_blank');
    });
}

// ==== CONTROLE DE BLOQUEIOS ====
function aplicarBloqueioSetores(setor, nivel) {
    const setoresDefinidos = ['meivs', 'pedagogico', 'adm', 'direcao'];
    
    setoresDefinidos.forEach(s => {
        const ta = document.getElementById(`text-${s}`);
        const btn = document.getElementById(`btn-${s}`);
        const tabBtn = document.querySelector(`.tab-button[onclick*="'${s}'"]`);
        
        let liberado = false;
        
        if (nivel >= 4) { 
            liberado = true; 
        } 
        else if (nivel >= 2) { 
            liberado = true; 
        } 
        else {
            if (setor === s || (setor === 'professores' && s === 'direcao')) { 
                liberado = true; 
            }
        }
        
        if (liberado) {
            if (ta) ta.disabled = false; 
            if (btn) btn.disabled = false;
            if (tabBtn) tabBtn.style.display = 'inline-block';
        } else {
            if (ta) ta.disabled = true; 
            if (btn) btn.disabled = true;
            if (tabBtn) tabBtn.style.display = 'none';
        }
    });
}

// ==== MODAL RELATÓRIO ====
function abrirModalRelatorio(setorFiltrado) {
    modalSetorAtivo = setorFiltrado; modalItensExibidos = 50;
    document.getElementById('modal-relatorio-setor').style.display = 'flex';
    document.getElementById('modal-relatorio-titulo').innerHTML = setorFiltrado === 'geral' ? 'Relatório Geral' : setorFiltrado.toUpperCase();
    let registros = setorFiltrado === 'geral' ? todosOsRegistros : todosOsRegistros.filter(r => r.setor === setorFiltrado || (setorFiltrado === 'direcao' && (r.setor === 'professores' || r.setor === 'direcao')));
    modalRegistrosFiltrados = [...registros].reverse();
    const container = document.getElementById('modal-relatorio-lista');
    container.innerHTML = `<div style="padding:10px;"><input type="text" id="busca-modal" placeholder="Filtrar..." oninput="filtrarBuscaModal(false)" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px;"></div><div id="modal-lista-itens-scroll" style="max-height:420px;overflow-y:auto;"></div><div id="modal-container-botao-mais" style="text-align:center;padding:15px;"></div>`;
    renderizarItensModal(modalRegistrosFiltrados);
}

function renderizarItensModal(lista) {
    const container = document.getElementById('modal-lista-itens-scroll');
    const btnContainer = document.getElementById('modal-container-botao-mais');
    container.innerHTML = ''; btnContainer.innerHTML = '';
    if (!lista.length) { container.innerHTML = '<p style="text-align:center;color:#64748b;">Nenhum registro.</p>'; return; }
    const limitados = lista.slice(0, modalItensExibidos);
    limitados.forEach(r => {
        const div = document.createElement('div'); div.className = 'modal-list-item';
        div.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:11px;color:#64748b;"><span>${formatarDataEHora(r.dataAtual)}</span><span>${r.funcionario}</span></div><div style="font-size:14px;margin:4px 0;"><strong>${r.aluno}</strong> <span style="background:#e0f2fe;padding:2px 6px;border-radius:4px;font-size:11px;">${encontrarTurmaDoAluno(r.aluno)}</span></div><div style="font-style:italic;">${r.texto}</div>`;
        container.appendChild(div);
    });
    if (lista.length > modalItensExibidos) {
        const btn = document.createElement('button');
        btn.innerText = `Exibir mais (${lista.length - modalItensExibidos} pendentes)`;
        btn.style = "background:#0f172a;color:white;border:none;padding:10px 22px;border-radius:6px;cursor:pointer;";
        btn.onclick = () => { modalItensExibidos += 50; filtrarBuscaModal(true); };
        btnContainer.appendChild(btn);
    }
}

function filtrarBuscaModal(manter) {
    const termo = document.getElementById('busca-modal').value.toLowerCase();
    let lista = termo ? modalRegistrosFiltrados.filter(r => r.aluno.toLowerCase().includes(termo) || encontrarTurmaDoAluno(r.aluno).toLowerCase().includes(termo) || r.texto.toLowerCase().includes(termo)) : modalRegistrosFiltrados;
    if (!manter) modalItensExibidos = 50;
    renderizarItensModal(lista);
}

function fecharModalRelatorio() { document.getElementById('modal-relatorio-setor').style.display = 'none'; }
function fecharModalRelatorioEvent(e) { if (e.target.id === 'modal-relatorio-setor') fecharModalRelatorio(); }
function fecharModalSelecaoEvent(e) { if (e.target.id === 'modal-selecionar-turma') document.getElementById('modal-selecionar-turma').style.display = 'none'; }

// ==== PAINEL DE ADMINISTRAÇÃO ====
function abrirPainelAdmin() {
    document.getElementById('modal-admin').style.display = 'flex';
    const select = document.getElementById('admin-nova-turma');
    select.innerHTML = '<option value="">-- Escolha a nova turma --</option><option value="EXCLUIR" style="color: red; font-weight: bold;">❌ EXCLUIR ALUNO DO SISTEMA</option>';
    
    Object.keys(cacheAlunosPorTurma).sort().forEach(t => {
        select.innerHTML += `<option value="${t}">${t}</option>`;
    });
}

function fecharModalAdmin() { document.getElementById('modal-admin').style.display = 'none'; }
function fecharModalAdminEvent(e) { if (e.target.id === 'modal-admin') fecharModalAdmin(); }

async function executarAcaoAluno() {
    const nomeAluno = document.getElementById('admin-nome-aluno').value.trim();
    const novaTurma = document.getElementById('admin-nova-turma').value;
    const btn = document.getElementById('btn-exec-admin');

    if (!nomeAluno || !novaTurma) return mostrarToast('Preencha o nome do aluno e escolha uma ação.', 'aviso');
    
    const operacao = novaTurma === 'EXCLUIR' ? 'ALUNO_EXCLUIR' : 'ALUNO_TRANSFERIR';
    if (operacao === 'ALUNO_EXCLUIR' && !confirm(`Tem certeza que deseja EXCLUIR ${nomeAluno} do sistema?`)) return;
    
    btn.disabled = true;
    btn.innerHTML = 'Processando...';

    const payload = {
        operacao: operacao,
        nome_aluno: nomeAluno,
        nova_turma: novaTurma,
        emailOperador: usuarioLogado.email 
    };

    try {
        const response = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) });
        const result = await response.json();
        
        if (result.status === 'success') {
            mostrarToast('Ação concluída com sucesso! Atualizando base...', 'sucesso');
            document.getElementById('admin-nome-aluno').value = '';
            fecharModalAdmin();
            await carregarAlunosETurmas();
        } else if (result.status === 'not_found') {
            mostrarToast('Aluno não encontrado na base de dados.', 'erro');
        } else {
            mostrarToast('Sem permissão para esta ação.', 'erro');
        }
    } catch (e) {
        mostrarToast('Erro de comunicação com o servidor.', 'erro');
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Confirmar Ação';
    }
}

// ==== GESTÃO DE USUÁRIOS DA EQUIPE ====
async function salvarUsuarioAdmin() {
    const email = document.getElementById('admin-user-email').value.trim();
    const nome = document.getElementById('admin-user-nome').value.trim();
    const setor = document.getElementById('admin-user-setor').value;
    const nivel = document.getElementById('admin-user-nivel').value;
    const senha = document.getElementById('admin-user-senha').value.trim();

    if (!email || !nome) return mostrarToast('Preencha pelo menos o E-mail e o Nome.', 'aviso');

    const btn = document.getElementById('btn-save-user');
    btn.disabled = true; btn.innerHTML = 'Processando...';

    const payload = {
        operacao: 'USER_SALVAR',
        emailOperador: usuarioLogado.email, 
        email: email,
        nome: nome,
        setor: setor,
        nivel: nivel,
        senha: senha
    };

    try {
        const resp = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) });
        const result = await resp.json();
        
        if (result.status === 'success' || result.status === 'updated') {
            mostrarToast(result.status === 'success' ? 'Novo usuário cadastrado!' : 'Usuário atualizado!', 'sucesso');
            document.getElementById('admin-user-email').value = '';
            document.getElementById('admin-user-nome').value = '';
            document.getElementById('admin-user-senha').value = '';
        } else {
            mostrarToast('Você não tem permissão para esta ação.', 'erro');
        }
    } catch(e) {
        mostrarToast('Erro ao salvar usuário. Verifique a conexão.', 'erro');
    } finally {
        btn.disabled = false; btn.innerHTML = 'Salvar Usuário';
    }
}

async function deletarUsuarioAdmin() {
    const email = document.getElementById('admin-user-email').value.trim();
    if (!email) return mostrarToast('Digite o E-mail do usuário que deseja excluir.', 'aviso');
    
    if (!confirm(`ALERTA: Tem certeza que deseja REVOGAR O ACESSO de ${email}?`)) return;

    const btn = document.getElementById('btn-del-user');
    btn.disabled = true; btn.innerHTML = 'Excluindo...';

    try {
        const resp = await fetch(APPS_SCRIPT_URL, { 
            method: 'POST', 
            body: JSON.stringify({ operacao: 'USER_DELETAR', emailOperador: usuarioLogado.email, email: email }) 
        });
        const result = await resp.json();
        
        if (result.status === 'success') {
            mostrarToast('Acesso revogado com sucesso.', 'sucesso');
            document.getElementById('admin-user-email').value = '';
            document.getElementById('admin-user-nome').value = '';
        } else if (result.status === 'not_found') {
            mostrarToast('Usuário não encontrado na base de dados.', 'aviso');
        } else {
            mostrarToast('Não autorizado.', 'erro');
        }
    } catch(e) {
        mostrarToast('Erro de comunicação.', 'erro');
    } finally {
        btn.disabled = false; btn.innerHTML = 'Excluir';
    }
}

// ==== MÓDULO PRÉ-CONSELHO ====
function abrirPreConselho() {
    document.getElementById('modal-pre-conselho').style.display = 'flex';
    document.getElementById('pc-professor').value = usuarioLogado.nome;
    
    const selectTurma = document.getElementById('pc-turma');
    selectTurma.innerHTML = '<option value="">Selecione a Turma...</option>';
    Object.keys(cacheAlunosPorTurma).sort().forEach(t => {
        selectTurma.innerHTML += `<option value="${t}">${t}</option>`;
    });
}

async function enviarPreConselho() {
    const turma = document.getElementById('pc-turma').value;
    const disciplina = document.getElementById('pc-disciplina').value.trim();
    
    if (!turma || !disciplina) {
        return mostrarToast('Preencha a Disciplina e selecione a Turma.', 'aviso');
    }

    const btn = document.getElementById('btn-save-conselho');
    btn.disabled = true; 
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando...';

    const checkboxes = document.querySelectorAll('#pc-q12-checkboxes input:checked');
    let instrumentos = Array.from(checkboxes).map(cb => cb.value);
    const outros = document.getElementById('pc-q12-outros').value.trim();
    if (outros) instrumentos.push(`Outros: ${outros}`);

    const payload = {
        operacao: 'PRE_CONSELHO_SALVAR',
        professor: usuarioLogado.nome,
        disciplina: disciplina,
        turma: turma,
        trimestre: document.getElementById('pc-trimestre').value,
        q1: document.getElementById('pc-q1').value,
        q2: document.getElementById('pc-q2').value,
        q3: document.getElementById('pc-q3').value,
        q4: document.getElementById('pc-q4').value,
        q5: document.getElementById('pc-q5').value,
        q6: document.getElementById('pc-q6').value.trim(),
        q7: document.getElementById('pc-q7').value.trim(),
        q8: document.getElementById('pc-q8').value.trim(),
        q9: document.getElementById('pc-q9').value.trim(),
        q10: document.getElementById('pc-q10').value.trim(),
        q11: document.getElementById('pc-q11').value.trim(),
        q12: instrumentos.join(', '),
        q14: document.getElementById('pc-q14').value,
        q16: document.getElementById('pc-q16').value.trim(),
        q17: document.getElementById('pc-q17').value,
        q18: document.getElementById('pc-q18').value.trim()
    };

    try {
        const resp = await fetch(APPS_SCRIPT_URL, { 
            method: 'POST', 
            headers: { 'Content-Type': 'text/plain' }, 
            body: JSON.stringify(payload) 
        });
        
        const result = await resp.json();
        
        if (result.status === 'success') {
            mostrarToast('Avaliação enviada com sucesso!', 'sucesso');
            
            document.querySelectorAll('#modal-pre-conselho input, #modal-pre-conselho textarea').forEach(el => {
                if(el.type === 'checkbox') el.checked = false;
                else el.value = '';
            });

            setTimeout(() => {
                document.getElementById('modal-pre-conselho').style.display = 'none';
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Enviar Avaliação da Turma';
            }, 1000);
            
        } else {
            throw new Error(result.message || 'Erro no servidor');
        }
    } catch(e) {
        mostrarToast('Falha ao enviar: ' + e.message, 'erro');
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Tentar Novamente';
    }
}

async function gerarRelatorioPreConselho(turmaSelecionada) {
    const todosRegistrosPC = await carregarRegistrosPreConselho(); 
    const turmaLimpa = turmaSelecionada.toString().trim().toLowerCase();

    const dadosTurma = todosRegistrosPC.filter(r => 
        r.turma && r.turma.toString().trim().toLowerCase() === turmaLimpa
    );

    if (dadosTurma.length === 0) {
        mostrarToast('Nenhum registro encontrado na aba Pré-Conselho para a turma ' + turmaSelecionada, 'aviso');
        return;
    }

    let html = `
        <div style="font-family: Arial, sans-serif; padding: 40px; color: #000;">
            <h2 style="text-align:center; border-bottom: 2px solid #000; padding-bottom: 10px;">Relatório de Pré-Conselho - ${turmaSelecionada}</h2>
            
            ${dadosTurma.map(r => `
                <div style="margin-bottom: 40px; border: 1px solid #ccc; padding: 20px; border-radius: 8px; page-break-inside: avoid;">
                    <h3 style="background: #e9ecef; padding: 10px; margin-top: 0; border-radius: 5px;">
                        Disciplina: ${r.disciplina || 'N/A'} | Professor: ${r.professor || 'N/A'}
                    </h3>
                    <p style="font-size: 14px; color: #555;"><strong>Trimestre:</strong> ${r.trimestre || 'N/A'} | <strong>Data de Envio:</strong> ${r.data || 'N/A'}</p>
                    
                    <hr style="border-top: 1px dashed #ccc; margin: 15px 0;">
                    
                    <h4 style="color: #2c3e50; margin-bottom: 8px;">1. Rendimento da Turma (Quantitativo)</h4>
                    <p style="margin: 5px 0;"><strong>Abaixo da Média:</strong> ${r.q1 || '0'} | <strong>Básico:</strong> ${r.q2 || '0'} | <strong>Adequado:</strong> ${r.q3 || '0'} | <strong>Avançado:</strong> ${r.q4 || '0'}</p>
                    
                    <h4 style="color: #2c3e50; margin-bottom: 8px; margin-top: 15px;">2. Análise da Turma</h4>
                    <p style="margin: 5px 0;"><strong>Comprometimento:</strong> ${r.q5 || 'N/A'}</p>
                    <p style="margin: 5px 0;"><strong>Pontos Positivos:</strong> ${r.q6 || 'N/A'}</p>
                    <p style="margin: 5px 0;"><strong>Pontos Negativos/Dificuldades:</strong> ${r.q7 || 'N/A'}</p>
                    <p style="margin: 5px 0;"><strong>Sugestões de Melhoria:</strong> ${r.q8 || 'N/A'}</p>
                    
                    <h4 style="color: #2c3e50; margin-bottom: 8px; margin-top: 15px;">3. Alunos em Destaque Negativo</h4>
                    <p style="margin: 5px 0;"><strong>Alunos Abaixo da Média e Motivos:</strong> ${r.q9 || 'N/A'}</p>
                    
                    <h4 style="color: #2c3e50; margin-bottom: 8px; margin-top: 15px;">4. Metodologia e Avaliação</h4>
                    <p style="margin: 5px 0;"><strong>Metodologia Aplicada:</strong> ${r.q10 || 'N/A'}</p>
                    <p style="margin: 5px 0;"><strong>Recursos Utilizados:</strong> ${r.q11 || 'N/A'}</p>
                    <p style="margin: 5px 0;"><strong>Instrumentos de Avaliação:</strong> ${r.q12 || 'N/A'}</p>
                    <p style="margin: 5px 0;"><strong>Houve Avaliação Específica?</strong> ${r.q14 || 'N/A'}</p>
                    
                    <h4 style="color: #2c3e50; margin-bottom: 8px; margin-top: 15px;">5. Recuperação de Estudos</h4>
                    <p style="margin: 5px 0;"><strong>Como foi a Recuperação:</strong> ${r.q16 || 'N/A'}</p>
                    <p style="margin: 5px 0;"><strong>Usou Instrumentos Diferenciados?</strong> ${r.q17 || 'N/A'}</p>
                    <p style="margin: 5px 0;"><strong>Plano de Recuperação Paralela:</strong> ${r.q18 || 'N/A'}</p>
                </div>
            `).join('')}
        </div>
    `;

    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    setTimeout(() => {
        win.print();
    }, 500);
}

function abrirModalTurmasPreConselho() {
    const select = document.getElementById('select-turma-relatorio');
    select.innerHTML = '<option value="">-- Escolha uma Turma --</option>';
    
    Object.keys(cacheAlunosPorTurma).sort().forEach(turma => {
        const opt = document.createElement('option');
        opt.value = turma;
        opt.textContent = turma;
        select.appendChild(opt);
    });
    
    document.getElementById('modal-selecionar-turma').style.display = 'flex';
}

function confirmarGeracaoRelatorio() {
    const turma = document.getElementById('select-turma-relatorio').value;
    if (!turma) {
        mostrarToast('Por favor, selecione uma turma!', 'aviso');
        return;
    }
    document.getElementById('modal-selecionar-turma').style.display = 'none';
    gerarRelatorioPreConselho(turma); 
}

async function carregarRegistrosPreConselho() {
    const SHEET_PRE_CONSELHO_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?sheet=Pre_Conselho`; 

    try {
        const response = await fetch(SHEET_PRE_CONSELHO_URL);
        const text = await response.text();
        const jsonText = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
        const data = JSON.parse(jsonText);
        
        return data.table.rows.map(r => ({
            data: r.c[0]?.v || '',
            professor: r.c[1]?.v || '',
            disciplina: r.c[2]?.v || '',
            turma: r.c[3]?.v?.toString().trim() || '',
            trimestre: r.c[4]?.v || '',
            q1: r.c[5]?.v || '',
            q2: r.c[6]?.v || '',
            q3: r.c[7]?.v || '',
            q4: r.c[8]?.v || '',
            q5: r.c[9]?.v || '',
            q6: r.c[10]?.v || '',
            q7: r.c[11]?.v || '',
            q8: r.c[12]?.v || '',
            q9: r.c[13]?.v || '',
            q10: r.c[14]?.v || '',
            q11: r.c[15]?.v || '',
            q12: r.c[16]?.v || '',
            q14: r.c[17]?.v || '',
            q16: r.c[18]?.v || '',
            q17: r.c[19]?.v || '',
            q18: r.c[20]?.v || '' 
        }));
    } catch (e) {
        console.error("Erro ao carregar Pré-Conselho:", e);
        return [];
    }
}

function abrirCaixaTexto(setor) {
    const selectAlunos = document.getElementById('select-alunos');
    const alunoSelecionado = selectAlunos.options[selectAlunos.selectedIndex]?.text || '';
    const alunoValor = selectAlunos.value;

    if (!alunoValor || alunoValor === "Selecione uma turma..." || alunoValor === "") {
        alert("⚠️ Por favor, selecione um ALUNO na barra superior antes de criar um apontamento!");
        selectAlunos.focus(); 
        return; 
    }

    const titulos = {
        'meivs': '<i class="fa-solid fa-shield-halved"></i> MEIV\'S',
        'pedagogico': '<i class="fa-solid fa-book-open"></i> Pedagógico',
        'adm': '<i class="fa-solid fa-folder-open"></i> ADM',
        'direcao': '<i class="fa-solid fa-chalkboard-user"></i> Professores'
    };

    const h3 = document.querySelector('#overlay-text-' + setor + ' h3');
    if (h3) {
        h3.innerHTML = titulos[setor] + '<br><span style="font-size: 16px; color: #475569; display: block; margin-top: 8px; font-weight: normal;">Para o aluno(a): <strong>' + alunoSelecionado + '</strong></span>';
    }

    document.getElementById('overlay-text-' + setor).style.display = 'flex';
    document.getElementById('text-' + setor).focus();
}

function fecharCaixaTexto(setor) {
    document.getElementById('overlay-text-' + setor).style.display = 'none';
    document.getElementById('text-' + setor).value = ''; 
}

// ==== MÓDULO DE OCORRÊNCIAS (SAÍDA ANTECIPADA / ENTRADA ATRASADA) ====
function abrirModalSaida() {
    const modal = document.getElementById('modal-saida');
    const selectAluno = document.getElementById('saida-aluno');
    
    document.getElementById('saida-motivo').value = '';
    document.getElementById('ocorrencia-tipo').value = 'Saída Antecipada';
    
    const agora = new Date();
    const hora = String(agora.getHours()).padStart(2, '0');
    const minutos = String(agora.getMinutes()).padStart(2, '0');
    document.getElementById('ocorrencia-horario').value = hora + ':' + minutos;
    
    selectAluno.innerHTML = '<option value="">-- Selecione o Aluno --</option>';
    let todosAlunos = [];
    for (let turma in cacheAlunosPorTurma) {
        todosAlunos = todosAlunos.concat(cacheAlunosPorTurma[turma]);
    }
    todosAlunos = [...new Set(todosAlunos)].sort();
    todosAlunos.forEach(nome => {
        const opt = document.createElement('option');
        opt.value = nome;
        opt.textContent = nome;
        selectAluno.appendChild(opt);
    });

    modal.style.display = 'flex';
}

function fecharModalSaida() {
    document.getElementById('modal-saida').style.display = 'none';
}

function fecharModalSaidaEvent(event) {
    if (event.target === document.getElementById('modal-saida')) {
        fecharModalSaida();
    }
}

async function registrarSaidaAntecipada() {
    const aluno = document.getElementById('saida-aluno').value;
    const tipo = document.getElementById('ocorrencia-tipo').value;
    const horario = document.getElementById('ocorrencia-horario').value;
    const motivo = document.getElementById('saida-motivo').value.trim();
    const autorizador = document.getElementById('saida-autorizador').value;

    if (!aluno) {
        mostrarToast('Selecione um aluno!', 'aviso');
        return;
    }
    if (!horario) {
        mostrarToast('Informe o horário da ocorrência.', 'aviso');
        return;
    }

    const agora = new Date();
    const data = agora.toLocaleDateString('pt-BR');
    const dataHora = data + ' ' + horario;

    const payload = {
        operacao: "registrar_ocorrencia",
        aluno: aluno,
        tipo: tipo,
        horario: horario,
        motivo: motivo,
        autorizador: autorizador,
        data: dataHora
    };

    try {
        await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(payload)
        });
        mostrarToast(tipo + ' registrada com sucesso!', 'sucesso');
        fecharModalSaida();
        await carregarRegistrosDoServidor();
    } catch (e) {
        mostrarToast('Erro ao registrar a ocorrência.', 'erro');
    }
}

// =============================================
// FUNÇÕES OFFLINE E SINCRONIZAÇÃO (VERSÃO LIMPA)
// =============================================

// Mostra apontamento local na tela
function mostrarApontamentoLocal(apontamento) {
    const setorExibicao = apontamento.setor === 'professores' ? 'direcao' : apontamento.setor;
    const feed = document.getElementById(`feed-${setorExibicao}`);
    
    if (feed) {
        // Verifica se já existe um card com este idLocal
        const existente = feed.querySelector(`.post-card-local[data-id-local="${apontamento.idLocal}"]`);
        if (existente) {
            existente.remove();
        }
        
        const card = document.createElement('div');
        card.className = 'post-card post-card-local';
        card.dataset.idLocal = apontamento.idLocal;
        card.style.borderLeft = '4px solid #f59e0b';
        card.style.background = '#fffbeb';
        
        card.innerHTML = `
            <p class="post-text">${apontamento.texto}</p>
            <div class="post-footer">
                <span><i class="fa-solid fa-user"></i> ${apontamento.funcionario || 'SIGA'}</span>
                <span><i class="fa-solid fa-clock"></i> ${apontamento.dataAtual} 
                    <span style="font-size: 10px; color: #f59e0b; margin-left: 5px;">
                        ⏳ pendente
                    </span>
                </span>
            </div>
        `;
        feed.prepend(card);
    }
}

function atualizarStatusApontamento(idLocal, sincronizado) {
    const cards = document.querySelectorAll(`.post-card-local[data-id-local="${idLocal}"]`);
    cards.forEach(card => {
        if (sincronizado) {
            card.style.borderLeft = '4px solid #22c55e';
            card.style.background = '#f0fdf4';
            const span = card.querySelector('.post-footer span:last-child');
            if (span) {
                const text = span.innerHTML.replace('⏳ pendente', '✅ sincronizado');
                span.innerHTML = text;
            }
        }
    });
}

let estaSincronizando = false;


async function sincronizarApontamentos() {
    if (!db || !db.db || estaSincronizando || !navigator.onLine) {
        console.log('ℹ️ Sincronização ignorada');
        return;
    }
    estaSincronizando = true;
    
    try {
        const pendentes = await db.getApontamentosNaoSincronizados();
        console.log(`📤 ${pendentes.length} apontamentos pendentes de sincronização`);
        
        if (!pendentes || pendentes.length === 0) {
            estaSincronizando = false;
            return;
        }
        
        let sincronizados = 0;
        let erros = 0;
        
        for (const apontamento of pendentes) {
            console.log(`🔄 Sincronizando:`, apontamento);
            
            try {
                // Remove campos que não devem ir para o servidor
                const dadosParaEnviar = {
                    aluno: apontamento.aluno,
                    setor: apontamento.setor,
                    texto: apontamento.texto,
                    funcionario: apontamento.funcionario,
                    dataAtual: apontamento.dataAtual
                };
                
                const result = await salvarNoServidor(dadosParaEnviar);
                console.log(`📥 Resultado:`, result);
                
                if (result.status === 'success') {
                    await db.marcarApontamentoSincronizado(apontamento.idLocal);
                    sincronizados++;
                    console.log(`✅ Apontamento ${apontamento.idLocal} sincronizado!`);
                    // Atualiza o card visual
                    atualizarStatusApontamento(apontamento.idLocal, true);
                } else {
                    erros++;
                    console.error(`❌ Falha ao sincronizar:`, result);
                }
            } catch (error) {
                erros++;
                console.error(`❌ Erro ao sincronizar apontamento:`, error);
            }
        }
        
        if (sincronizados > 0) {
            mostrarToast(`📡 ${sincronizados} apontamento(s) sincronizado(s)!`, 'sucesso');
            // Recarrega os dados para mostrar os apontamentos salvos
            await carregarRegistrosDoServidor();
            if (document.getElementById('select-alunos').value) {
                filtrarRegistrosPorAluno();
            }
        }
        
        if (erros > 0) {
            console.warn(`⚠️ ${erros} apontamento(s) falharam na sincronização`);
        }
        
    } catch (error) {
        console.error('❌ Erro na sincronização:', error);
    } finally {
        estaSincronizando = false;
        atualizarStatusConexao();
    }
}

// =============================================
// INDICADOR DE CONEXÃO
// =============================================

function atualizarStatusConexao() {
    const statusDiv = document.getElementById('status-conexao');
    const statusTexto = document.getElementById('status-texto');
    const statusIcone = document.getElementById('status-icone');
    const statusPendentes = document.getElementById('status-pendentes');
    
    if (!statusDiv) return;
    
    if (navigator.onLine) {
        statusDiv.style.display = 'block';
        statusDiv.style.background = '#f0fdf4';
        statusDiv.style.border = '1px solid #22c55e';
        statusIcone.style.color = '#22c55e';
        statusTexto.textContent = 'Online';
        
        // Verifica se tem pendentes
        if (db && db.db) {
            db.getApontamentosNaoSincronizados().then(pendentes => {
                if (pendentes && pendentes.length > 0) {
                    statusPendentes.style.display = 'inline';
                    statusPendentes.textContent = `📤 ${pendentes.length} pendente(s)`;
                } else {
                    statusPendentes.style.display = 'none';
                }
            }).catch(() => {
                statusPendentes.style.display = 'none';
            });
        } else {
            statusPendentes.style.display = 'none';
        }
    } else {
        statusDiv.style.display = 'block';
        statusDiv.style.background = '#fef2f2';
        statusDiv.style.border = '1px solid #dc2626';
        statusIcone.style.color = '#dc2626';
        statusTexto.textContent = 'Offline (salvando localmente)';
        statusPendentes.style.display = 'none';
    }
}

// =============================================
// EVENTOS DE CONEXÃO
// =============================================

window.addEventListener('online', function() {
    console.log('📡 Internet voltou! Sincronizando...');
    mostrarToast('📡 Conexão restabelecida! Sincronizando...', 'sucesso');
    setTimeout(sincronizarApontamentos, 2000);
    setTimeout(atualizarStatusConexao, 1000);
});

window.addEventListener('offline', function() {
    console.log('📡 Internet caiu! Modo offline ativado.');
    mostrarToast('⚠️ Modo offline. Dados serão salvos localmente.', 'aviso');
    setTimeout(atualizarStatusConexao, 500);
});

// Sincroniza a cada 30 segundos
setInterval(() => {
    if (navigator.onLine) {
        sincronizarApontamentos();
    }
}, 30000);

// Sincroniza ao carregar
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(() => {
        if (navigator.onLine) {
            sincronizarApontamentos();
        }
        atualizarStatusConexao();
    }, 3000);
});

// Atualiza status a cada 10 segundos
setInterval(atualizarStatusConexao, 10000);

console.log('🔄 SIGA inicializado com sucesso!');
console.log('📦 Banco de dados local:', db ? '✅ Disponível' : '❌ Indisponível');
