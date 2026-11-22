/* =====================================================================
 *  SIGA — Virada do Ano Letivo (substitui a Progressão de Turmas)
 *  Passos: 1 turmas do ano e destinos · 2 turmas do ano seguinte ·
 *          3 situação de cada aluno · 4 matriz curricular · 5 conferir e virar
 *  Backend: backend/virada-ano.gs
 * ===================================================================== */
(function (global) {
    'use strict';

    const SITUACOES = ['Aprovado', 'Retido', 'Transferido', 'Desistente', 'Egresso'];

    // ---------- núcleo (mesma regra do VIR_planejar_ do backend) ----------
    const cod = v => String(v || '').toUpperCase().replace(/\s+/g, '');
    const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

    function planejar(alunos, turmasAtuais, turmasProximas, situacoes) {
        const destinoTurma = {}, prox = {};
        turmasAtuais.forEach(t => { destinoTurma[cod(t.codigo)] = cod(t.destino); });
        turmasProximas.forEach(t => { if (t.ativa !== false && cod(t.codigo)) prox[cod(t.codigo)] = t; });
        const res = { alunos: [], pendencias: [], porTurma: {}, contagem: { Aprovado: 0, Retido: 0, Transferido: 0, Desistente: 0, Egresso: 0 } };
        alunos.forEach(a => {
            const c = cod(a.codigo);
            const s = situacoes[norm(a.nome) + '|' + c] || {};
            const padrao = destinoTurma[c];
            let sit = s.situacao || (padrao === 'EGRESSO' ? 'Egresso' : 'Aprovado');
            let destino = '';
            if (sit === 'Aprovado') destino = cod(s.destino) || padrao || '';
            else if (sit === 'Retido') destino = cod(s.destino) || c;
            if (destino === 'EGRESSO') { sit = 'Egresso'; destino = ''; }
            if (sit === 'Aprovado' || sit === 'Retido') {
                if (!destino || destino === 'ESCOLHA') res.pendencias.push({ nome: a.nome, turma: c, texto: 'escolher a turma de destino' });
                else if (!prox[destino]) res.pendencias.push({ nome: a.nome, turma: c, texto: 'a turma ' + destino + ' não está nas turmas do ano seguinte' });
                else res.porTurma[destino] = (res.porTurma[destino] || 0) + 1;
            }
            res.contagem[sit] = (res.contagem[sit] || 0) + 1;
            res.alunos.push({ nome: a.nome, de: c, situacao: sit, destino });
        });
        return res;
    }

    if (typeof module !== 'undefined' && module.exports) { module.exports = { planejar }; return; }

    // ---------- tela ----------
    const URL = () => global.SIGA_CONFIG.APPS_SCRIPT_URL;
    const esc = v => global.escaparHTML(v);
    const aviso = msg => (typeof global.mostrarToast === 'function' ? global.mostrarToast(msg, 'sucesso') : alert(msg));
    const PASSOS = ['1. Turmas e destinos', '2. Turmas do ano novo', '3. Situação dos alunos', '4. Matriz curricular', '5. Conferir e virar'];
    const inp = 'padding:6px;border:1px solid #cbd5e1;border-radius:4px;font-size:13px;width:100%;box-sizing:border-box;';
    const btn = (cor) => 'background:' + cor + ';color:white;border:none;padding:9px 18px;border-radius:6px;font-weight:bold;cursor:pointer;';

    let D = null;            // dados do servidor
    let passo = 0;
    let sujo = {};           // passo → mudanças não salvas
    let sit = {};            // "nome|turma" → {nome, turma, situacao, destino}
    let turmaSit = '';
    let filtroSerie = '';

    async function abrirVirada() {
        document.getElementById('modal-virada').style.display = 'flex';
        document.getElementById('conteudo-virada').innerHTML = '<p style="text-align:center;color:#64748b;padding:40px;"><i class="fa-solid fa-spinner fa-spin"></i> Carregando turmas e alunos...</p>';
        document.getElementById('virada-rodape').innerHTML = '';
        try {
            const r = await (await fetch(URL() + '?aba=virada_dados')).json();
            if (r.status !== 'success') throw new Error(r.message || 'Resposta inesperada. O arquivo virada-ano.gs já foi instalado no Apps Script?');
            D = r;
            sit = {};
            (D.situacoes || []).forEach(s => { sit[norm(s.nome) + '|' + cod(s.turma)] = s; });
            sujo = {};
            document.getElementById('virada-anos').textContent = D.anoAtual + ' → ' + D.proximoAno;
            irPara(D.ultimaVirada && D.podeDesfazer ? 4 : 0);
        } catch (e) {
            document.getElementById('conteudo-virada').innerHTML = '<p style="color:#b91c1c;text-align:center;padding:30px;">❌ ' + esc(e.message) + '</p>';
        }
    }

    function fecharVirada() {
        if (Object.values(sujo).some(Boolean) && !confirm('Há mudanças não salvas. Fechar mesmo assim?')) return;
        document.getElementById('modal-virada').style.display = 'none';
    }

    function irPara(n) {
        passo = n;
        document.getElementById('virada-passos').innerHTML = PASSOS.map((p, i) =>
            '<button onclick="viradaIrPara(' + i + ')" style="border:none;padding:9px 14px;cursor:pointer;font-weight:bold;font-size:13px;border-radius:6px 6px 0 0;' +
            (i === passo ? 'background:white;color:#047857;border:1px solid #e2e8f0;border-bottom:1px solid white;margin-bottom:-1px;' : 'background:transparent;color:#64748b;') + '">' +
            esc(p) + (sujo[i] ? ' ✏️' : '') + '</button>').join('');
        [desenharTurmasAtuais, desenharTurmasProximas, desenharSituacoes, desenharMatriz, desenharConferir][passo]();
    }

    function rodape(html) { document.getElementById('virada-rodape').innerHTML = html; }
    function marcar(n) { if (!sujo[n]) { sujo[n] = true; irParaSemRedesenhar(); } }
    function irParaSemRedesenhar() {
        document.querySelectorAll('#virada-passos button').forEach((b, i) => { b.textContent = PASSOS[i] + (sujo[i] ? ' ✏️' : ''); });
    }

    function contarAlunos() {
        const n = {};
        D.alunos.forEach(a => { n[a.codigo] = (n[a.codigo] || 0) + 1; });
        return n;
    }

    // ---------- passo 1 ----------
    function desenharTurmasAtuais() {
        const n = contarAlunos();
        const opcoes = D.turmasProximas.map(t => cod(t.codigo)).filter(Boolean);
        let h = '<p style="margin-top:0;color:#475569;font-size:14px;">Para onde vai cada turma de <b>' + D.anoAtual + '</b>. ' +
            'Use <b>EGRESSO</b> para os formandos e <b>ESCOLHA</b> quando cada aluno escolhe a turma (9º ano → NEM, FD ou AGRO, no passo 3).</p>';
        if (!D.turmasAtuaisSalvas) h += '<div style="background:#fef3c7;padding:8px 12px;border-radius:6px;font-size:13px;margin-bottom:10px;">Lista montada a partir das abas Alunos e Horarios, com destinos sugeridos. Confira e salve.</div>';
        h += '<datalist id="vir-destinos">' + opcoes.concat(['EGRESSO', 'ESCOLHA']).map(o => '<option value="' + esc(o) + '">').join('') + '</datalist>';
        h += '<table style="width:100%;border-collapse:collapse;font-size:13px;"><tr style="background:#d1fae5;"><th style="padding:6px;width:110px;text-align:left;">Turma</th><th style="padding:6px;text-align:left;">Nome</th><th style="padding:6px;width:110px;">Turno</th><th style="padding:6px;width:70px;">Alunos</th><th style="padding:6px;width:150px;">Vai para (' + D.proximoAno + ')</th><th style="width:36px;"></th></tr>';
        D.turmasAtuais.forEach((t, i) => {
            const destinoOk = !t.destino || ['EGRESSO', 'ESCOLHA'].includes(cod(t.destino)) || opcoes.includes(cod(t.destino));
            h += '<tr style="border-bottom:1px solid #f1f5f9;">' +
                '<td style="padding:3px;"><input style="' + inp + 'font-weight:bold;" value="' + esc(t.codigo) + '" onchange="viradaEditar(\'turmasAtuais\',' + i + ',\'codigo\',this.value)"></td>' +
                '<td style="padding:3px;"><input style="' + inp + '" value="' + esc(t.nome) + '" onchange="viradaEditar(\'turmasAtuais\',' + i + ',\'nome\',this.value)"></td>' +
                '<td style="padding:3px;">' + selTurno('turmasAtuais', i, t.turno) + '</td>' +
                '<td style="padding:3px;text-align:center;">' + (n[t.codigo] || 0) + '</td>' +
                '<td style="padding:3px;"><input list="vir-destinos" style="' + inp + (destinoOk ? '' : 'border-color:#f59e0b;background:#fffbeb;') + '" value="' + esc(t.destino) + '" placeholder="—" onchange="viradaEditar(\'turmasAtuais\',' + i + ',\'destino\',this.value)"></td>' +
                '<td><button title="Excluir" onclick="viradaRemover(\'turmasAtuais\',' + i + ')" style="background:none;border:none;cursor:pointer;font-size:16px;">🗑️</button></td></tr>';
            if (!destinoOk) h += '<tr><td></td><td colspan="5" style="font-size:11px;color:#b45309;padding:0 6px 6px;">A turma ' + esc(cod(t.destino)) + ' ainda não está na lista do ano novo (passo 2).</td></tr>';
        });
        h += '</table><button onclick="viradaAdicionar(\'turmasAtuais\')" style="margin-top:8px;background:#d1fae5;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;">➕ Turma</button>';
        document.getElementById('conteudo-virada').innerHTML = h;
        rodape('<button onclick="viradaSalvarTurmas(\'atual\')" style="' + btn('#059669') + '">💾 Salvar turmas de ' + D.anoAtual + '</button><button onclick="viradaIrPara(1)" style="' + btn('#64748b') + '">Próximo →</button>');
    }

    function selTurno(lista, i, valor) {
        return '<select style="' + inp + '" onchange="viradaEditar(\'' + lista + '\',' + i + ',\'turno\',this.value)">' +
            ['', 'Manhã', 'Tarde'].map(t => '<option value="' + t + '"' + (t === valor ? ' selected' : '') + '>' + (t || '—') + '</option>').join('') + '</select>';
    }

    // ---------- passo 2 ----------
    function desenharTurmasProximas() {
        const plano = planejar(D.alunos, D.turmasAtuais, D.turmasProximas, sit);
        let h = '<p style="margin-top:0;color:#475569;font-size:14px;">Turmas que vão existir em <b>' + D.proximoAno + '</b>. Inclua (ex.: 9D, 3º B NEM) ou exclua à vontade. ' +
            'A coluna <b>Previstos</b> conta os alunos que já têm esta turma como destino; o 6º ano novo entra depois, pelo cadastro de alunos.</p>';
        if (!D.turmasProximasSalvas) h += '<div style="background:#fef3c7;padding:8px 12px;border-radius:6px;font-size:13px;margin-bottom:10px;">Sugestão a partir dos destinos do passo 1. Confira e salve.</div>';
        h += '<table style="width:100%;border-collapse:collapse;font-size:13px;"><tr style="background:#d1fae5;"><th style="padding:6px;width:110px;text-align:left;">Turma</th><th style="padding:6px;text-align:left;">Nome</th><th style="padding:6px;width:90px;">Série</th><th style="padding:6px;width:110px;">Turno</th><th style="padding:6px;width:80px;">Previstos</th><th style="width:36px;"></th></tr>';
        D.turmasProximas.forEach((t, i) => {
            const prev = plano.porTurma[cod(t.codigo)] || 0;
            h += '<tr style="border-bottom:1px solid #f1f5f9;">' +
                '<td style="padding:3px;"><input style="' + inp + 'font-weight:bold;" value="' + esc(t.codigo) + '" onchange="viradaEditar(\'turmasProximas\',' + i + ',\'codigo\',this.value)"></td>' +
                '<td style="padding:3px;"><input style="' + inp + '" value="' + esc(t.nome) + '" onchange="viradaEditar(\'turmasProximas\',' + i + ',\'nome\',this.value)"></td>' +
                '<td style="padding:3px;"><input style="' + inp + '" value="' + esc(t.serie) + '" onchange="viradaEditar(\'turmasProximas\',' + i + ',\'serie\',this.value)"></td>' +
                '<td style="padding:3px;">' + selTurno('turmasProximas', i, t.turno) + '</td>' +
                '<td style="padding:3px;text-align:center;font-weight:bold;color:' + (prev ? '#047857' : '#94a3b8') + ';">' + prev + '</td>' +
                '<td><button title="Excluir" onclick="viradaRemover(\'turmasProximas\',' + i + ')" style="background:none;border:none;cursor:pointer;font-size:16px;">🗑️</button></td></tr>';
        });
        h += '</table><button onclick="viradaAdicionar(\'turmasProximas\')" style="margin-top:8px;background:#d1fae5;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;">➕ Turma</button>';
        document.getElementById('conteudo-virada').innerHTML = h;
        rodape('<button onclick="viradaIrPara(0)" style="' + btn('#64748b') + '">← Voltar</button><button onclick="viradaSalvarTurmas(\'proximo\')" style="' + btn('#059669') + '">💾 Salvar turmas de ' + D.proximoAno + '</button><button onclick="viradaIrPara(2)" style="' + btn('#64748b') + '">Próximo →</button>');
    }

    function editar(lista, i, campo, valor) {
        const t = D[lista][i];
        if (campo === 'codigo' || campo === 'destino') valor = cod(valor);
        const antigo = t[campo];
        t[campo] = valor;
        if (lista === 'turmasProximas' && campo === 'codigo' && antigo) {
            // renomeou uma turma do ano novo: os destinos acompanham
            D.turmasAtuais.forEach(x => { if (cod(x.destino) === cod(antigo)) x.destino = valor; });
            Object.values(sit).forEach(s => { if (cod(s.destino) === cod(antigo)) s.destino = valor; });
            marcar(0);
        }
        if (lista === 'turmasProximas' && campo === 'codigo' && !t.nome) t.nome = nomeSugerido(valor);
        if (lista === 'turmasProximas' && campo === 'codigo' && !t.serie) t.serie = global.HorariosNucleo ? global.HorariosNucleo.serieDaTurma(valor) : '';
        marcar(lista === 'turmasAtuais' ? 0 : 1);
        if (campo === 'destino' || campo === 'codigo') irPara(passo);
    }
    function nomeSugerido(c) {
        let m = c.match(/^(\d)([A-Z])$/);
        if (m) return m[1] + 'º Ano ' + m[2];
        m = c.match(/^(\d)([A-Z]?)(NEM|FD|AGRO)$/);
        return m ? m[1] + 'º Ano ' + (m[2] ? m[2] + ' ' : '') + m[3] : c;
    }
    function adicionar(lista) {
        D[lista].push({ codigo: '', nome: '', serie: '', turno: '', destino: '', ativa: true });
        marcar(lista === 'turmasAtuais' ? 0 : 1);
        irPara(passo);
    }
    function remover(lista, i) {
        const t = D[lista][i];
        if (lista === 'turmasAtuais' && contarAlunos()[t.codigo] && !confirm('A turma ' + t.codigo + ' tem alunos. Tirar da lista mesmo assim? (os alunos ficarão sem destino)')) return;
        D[lista].splice(i, 1);
        marcar(lista === 'turmasAtuais' ? 0 : 1);
        irPara(passo);
    }

    async function post(corpo) {
        const r = await global.fetchAutenticado(URL(), corpo);
        return r.json();
    }

    async function salvarTurmas(qual) {
        const ano = qual === 'atual' ? D.anoAtual : D.proximoAno;
        const lista = qual === 'atual' ? D.turmasAtuais : D.turmasProximas;
        try {
            const r = await post({ operacao: 'VIRADA_SALVAR_TURMAS', ano, turmas: lista.filter(t => cod(t.codigo)) });
            if (r.status !== 'success') { alert('❌ ' + (r.message || 'Não foi possível salvar.')); return false; }
            if (qual === 'atual') { D.turmasAtuaisSalvas = true; sujo[0] = false; } else { D.turmasProximasSalvas = true; sujo[1] = false; }
            aviso('✅ Turmas de ' + ano + ' salvas.');
            irPara(passo);
            return true;
        } catch (e) { alert('❌ Erro de conexão.'); return false; }
    }

    // ---------- passo 3 ----------
    function desenharSituacoes() {
        const n = contarAlunos();
        const turmas = D.turmasAtuais.filter(t => n[t.codigo]);
        if (!turmaSit || !turmas.some(t => t.codigo === turmaSit)) {
            const escolha = turmas.find(t => cod(t.destino) === 'ESCOLHA');
            turmaSit = (escolha || turmas[0] || {}).codigo || '';
        }
        const plano = planejar(D.alunos, D.turmasAtuais, D.turmasProximas, sit);
        const pendPorTurma = {};
        plano.pendencias.forEach(p => { pendPorTurma[p.turma] = (pendPorTurma[p.turma] || 0) + 1; });
        const foraPadrao = {};
        Object.values(sit).forEach(s => { if (s.situacao !== 'Aprovado' || s.destino) foraPadrao[cod(s.turma)] = (foraPadrao[cod(s.turma)] || 0) + 1; });

        let h = '<p style="margin-top:0;color:#475569;font-size:14px;">Todo aluno sobe para o destino da turma (<b>Aprovado</b>). Marque só as exceções: <b>Retido</b>, <b>Transferido</b>, <b>Desistente</b>, ou um destino diferente. No 9º ano, escolha a turma de cada aluno.</p>';
        h += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">' + turmas.map(t =>
            '<button onclick="viradaTurmaSit(\'' + esc(t.codigo) + '\')" style="border:1px solid ' + (t.codigo === turmaSit ? '#059669' : '#cbd5e1') + ';background:' + (t.codigo === turmaSit ? '#d1fae5' : 'white') + ';padding:6px 10px;border-radius:6px;cursor:pointer;font-size:13px;">' +
            '<b>' + esc(t.codigo) + '</b> ' + (pendPorTurma[t.codigo] ? '<span style="color:#b91c1c;">● ' + pendPorTurma[t.codigo] + '</span>' : (foraPadrao[t.codigo] ? '<span style="color:#b45309;">✎ ' + foraPadrao[t.codigo] + '</span>' : '')) + '</button>').join('') + '</div>';

        const t = D.turmasAtuais.find(x => x.codigo === turmaSit);
        if (t) {
            const padrao = cod(t.destino);
            const opcoes = D.turmasProximas.filter(x => x.ativa !== false && cod(x.codigo)).map(x => cod(x.codigo));
            const alunos = D.alunos.filter(a => a.codigo === turmaSit).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
            h += '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px;font-size:13px;">' +
                '<span><b>' + esc(t.codigo) + '</b> → padrão: <b>' + esc(padrao || '— sem destino —') + '</b> · ' + alunos.length + ' alunos</span>' +
                '<span style="margin-left:auto;">Todos aprovados vão para: <select id="vir-todos" style="padding:5px;border:1px solid #cbd5e1;border-radius:4px;"><option value="">(padrão da turma)</option>' +
                opcoes.map(o => '<option>' + esc(o) + '</option>').join('') + '</select> <button onclick="viradaAplicarTodos()" style="background:#d1fae5;border:none;padding:6px 10px;border-radius:6px;cursor:pointer;">Aplicar</button></span></div>';
            h += '<table style="width:100%;border-collapse:collapse;font-size:13px;"><tr style="background:#d1fae5;"><th style="padding:6px;text-align:left;">Aluno</th><th style="padding:6px;width:160px;">Situação</th><th style="padding:6px;width:170px;">Destino</th></tr>';
            alunos.forEach(a => {
                const k = norm(a.nome) + '|' + a.codigo;
                const s = sit[k] || { situacao: padrao === 'EGRESSO' ? 'Egresso' : 'Aprovado', destino: '' };
                const p = plano.alunos.find(x => x.nome === a.nome && x.de === a.codigo) || {};
                const pend = plano.pendencias.find(x => x.nome === a.nome && x.turma === a.codigo);
                const precisaDestino = s.situacao === 'Aprovado' || s.situacao === 'Retido';
                h += '<tr style="border-bottom:1px solid #f1f5f9;' + (pend ? 'background:#fef2f2;' : (s.situacao !== 'Aprovado' && s.situacao !== 'Egresso' ? 'background:#fffbeb;' : '')) + '">' +
                    '<td style="padding:4px 6px;">' + esc(a.nome) + (pend ? '<div style="font-size:11px;color:#b91c1c;">' + esc(pend.texto) + '</div>' : '') + '</td>' +
                    '<td style="padding:3px;"><select style="' + inp + '" data-k="' + esc(k) + '" data-nome="' + esc(a.nome) + '" onchange="viradaSit(this,\'situacao\',this.value)">' +
                    SITUACOES.map(x => '<option' + (x === s.situacao ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></td>' +
                    '<td style="padding:3px;">' + (precisaDestino ? '<select style="' + inp + '" data-k="' + esc(k) + '" data-nome="' + esc(a.nome) + '" onchange="viradaSit(this,\'destino\',this.value)">' +
                        '<option value="">' + (s.situacao === 'Retido' ? 'mesma série (' + esc(a.codigo) + ')' : (padrao && padrao !== 'ESCOLHA' ? 'padrão (' + esc(padrao) + ')' : '— escolha —')) + '</option>' +
                        opcoes.map(o => '<option' + (o === cod(s.destino) ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>'
                        : '<span style="color:#64748b;font-size:12px;">sai da lista de alunos</span>') +
                    (p.destino && precisaDestino ? '' : '') + '</td></tr>';
            });
            h += '</table>';
        } else {
            h += '<p style="color:#64748b;">Nenhuma turma com alunos.</p>';
        }
        document.getElementById('conteudo-virada').innerHTML = h;
        rodape('<span style="margin-right:auto;font-size:13px;color:' + (plano.pendencias.length ? '#b91c1c' : '#047857') + ';">' +
            (plano.pendencias.length ? '● ' + plano.pendencias.length + ' aluno(s) sem destino' : '✓ Todos os alunos têm destino') + '</span>' +
            '<button onclick="viradaIrPara(1)" style="' + btn('#64748b') + '">← Voltar</button><button onclick="viradaSalvarSituacoes()" style="' + btn('#059669') + '">💾 Salvar situações</button><button onclick="viradaIrPara(3)" style="' + btn('#64748b') + '">Próximo →</button>');
    }

    function mudarSit(el, campo, valor) {
        const k = el.dataset.k, turma = k.split('|').pop();
        const t = D.turmasAtuais.find(x => x.codigo === turma) || {};
        const s = sit[k] = sit[k] || { nome: el.dataset.nome, turma, situacao: cod(t.destino) === 'EGRESSO' ? 'Egresso' : 'Aprovado', destino: '' };
        s[campo] = valor;
        if (campo === 'situacao' && !(valor === 'Aprovado' || valor === 'Retido')) s.destino = '';
        marcar(2);
        desenharSituacoes();
    }

    function aplicarTodos() {
        const destino = document.getElementById('vir-todos').value;
        D.alunos.filter(a => a.codigo === turmaSit).forEach(a => {
            const k = norm(a.nome) + '|' + a.codigo;
            const s = sit[k] = sit[k] || { nome: a.nome, turma: a.codigo, situacao: 'Aprovado', destino: '' };
            if (s.situacao === 'Aprovado') s.destino = destino;
        });
        marcar(2);
        desenharSituacoes();
    }

    async function salvarSituacoes() {
        const itens = Object.values(sit).filter(s => s.situacao !== 'Aprovado' || s.destino).map(s => ({ nome: s.nome, turma: s.turma, situacao: s.situacao, destino: s.destino }));
        try {
            const r = await post({ operacao: 'VIRADA_SALVAR_SITUACOES', itens });
            if (r.status !== 'success') { alert('❌ ' + (r.message || 'Não foi possível salvar.')); return false; }
            sujo[2] = false;
            aviso('✅ Situações salvas (' + itens.length + ' exceções).');
            irPara(passo);
            return true;
        } catch (e) { alert('❌ Erro de conexão.'); return false; }
    }

    // ---------- passo 4 ----------
    function desenharMatriz() {
        const m = D.matriz.linhas;
        const series = [...new Set(m.map(l => l.serie))];
        let h = '<p style="margin-top:0;color:#475569;font-size:14px;">Aulas por semana de cada disciplina, em cada série. É a base do Auto-Preencher da Gestão de Horários para turmas novas. Inclua ou exclua disciplinas à vontade.</p>';
        if (!D.matriz.salva) h += '<div style="background:#fef3c7;padding:8px 12px;border-radius:6px;font-size:13px;margin-bottom:10px;">Calculada pela grade de horários de ' + D.anoAtual + ' (o número mais comum entre as turmas da série). A coluna Observação mostra onde as turmas são diferentes.</div>';
        h += '<div style="margin-bottom:10px;font-size:13px;">Série: <select onchange="viradaFiltroSerie(this.value)" style="padding:5px;border:1px solid #cbd5e1;border-radius:4px;"><option value="">Todas</option>' +
            series.map(s => '<option' + (s === filtroSerie ? ' selected' : '') + '>' + esc(s) + '</option>').join('') + '</select></div>';
        const total = {};
        m.forEach(l => { total[l.serie] = (total[l.serie] || 0) + (parseInt(l.aulas, 10) || 0); });
        h += '<table style="width:100%;border-collapse:collapse;font-size:13px;"><tr style="background:#d1fae5;"><th style="padding:6px;width:90px;text-align:left;">Série</th><th style="padding:6px;text-align:left;">Disciplina</th><th style="padding:6px;width:90px;">Aulas</th><th style="padding:6px;text-align:left;">Observação</th><th style="width:36px;"></th></tr>';
        let ultima = null;
        m.forEach((l, i) => {
            if (filtroSerie && l.serie !== filtroSerie) return;
            if (l.serie !== ultima && ultima !== null && !filtroSerie) h += '<tr><td colspan="5" style="height:6px;"></td></tr>';
            ultima = l.serie;
            h += '<tr style="border-bottom:1px solid #f1f5f9;">' +
                '<td style="padding:3px;"><input style="' + inp + '" value="' + esc(l.serie) + '" onchange="viradaMatriz(' + i + ',\'serie\',this.value)"></td>' +
                '<td style="padding:3px;"><input style="' + inp + '" value="' + esc(l.disciplina) + '" onchange="viradaMatriz(' + i + ',\'disciplina\',this.value)"></td>' +
                '<td style="padding:3px;"><input type="number" min="0" max="30" style="' + inp + '" value="' + esc(l.aulas) + '" onchange="viradaMatriz(' + i + ',\'aulas\',this.value)"></td>' +
                '<td style="padding:3px;"><input style="' + inp + 'color:#64748b;" value="' + esc(l.obs || '') + '" onchange="viradaMatriz(' + i + ',\'obs\',this.value)"></td>' +
                '<td><button title="Excluir" onclick="viradaMatriz(' + i + ',null)" style="background:none;border:none;cursor:pointer;font-size:16px;">🗑️</button></td></tr>';
        });
        h += '</table><button onclick="viradaMatriz(-1)" style="margin-top:8px;background:#d1fae5;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;">➕ Disciplina</button>';
        h += '<div style="margin-top:12px;font-size:12px;color:#475569;"><b>Total por série:</b> ' + Object.keys(total).map(s => esc(s) + ': <b style="color:' + (total[s] === 30 ? '#047857' : '#b45309') + ';">' + total[s] + '</b>').join(' · ') + ' (a grade tem 30 aulas por semana)</div>';
        document.getElementById('conteudo-virada').innerHTML = h;
        rodape('<button onclick="viradaIrPara(2)" style="' + btn('#64748b') + '">← Voltar</button><button onclick="viradaSalvarMatriz()" style="' + btn('#059669') + '">💾 Salvar matriz</button><button onclick="viradaIrPara(4)" style="' + btn('#64748b') + '">Próximo →</button>');
    }

    function editarMatriz(i, campo, valor) {
        const m = D.matriz.linhas;
        if (i === -1) m.push({ serie: filtroSerie || '', disciplina: '', aulas: 1, obs: '' });
        else if (campo === null) m.splice(i, 1);
        else m[i][campo] = campo === 'aulas' ? parseInt(valor, 10) || 0 : valor;
        marcar(3);
        if (i === -1 || campo === null || campo === 'aulas' || campo === 'serie') desenharMatriz();
    }

    async function salvarMatriz() {
        try {
            const r = await post({ operacao: 'VIRADA_SALVAR_MATRIZ', linhas: D.matriz.linhas });
            if (r.status !== 'success') { alert('❌ ' + (r.message || 'Não foi possível salvar.')); return; }
            D.matriz.salva = true; sujo[3] = false;
            aviso('✅ Matriz curricular salva (' + r.linhas + ' linhas).');
            irPara(passo);
        } catch (e) { alert('❌ Erro de conexão.'); }
    }

    // ---------- passo 5 ----------
    function desenharConferir() {
        const plano = planejar(D.alunos, D.turmasAtuais, D.turmasProximas, sit);
        const c = plano.contagem;
        const card = (n, t, cor) => '<div style="flex:1;min-width:120px;background:' + cor + ';border-radius:8px;padding:10px 12px;"><div style="font-size:24px;font-weight:bold;">' + n + '</div><div style="font-size:12px;">' + t + '</div></div>';
        let h = '';
        const u = D.ultimaVirada;
        if (u) {
            h += '<div style="background:' + (D.podeDesfazer ? '#ecfdf5' : '#f8fafc') + ';border:1px solid #a7f3d0;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:13px;">' +
                '<b>Última virada:</b> ' + esc(u.de) + ' → ' + esc(u.para) + ' em ' + esc(new Date(u.em).toLocaleString('pt-BR')) + ' por ' + esc(u.por) + ' (' + esc(u.status) + ').<br>' + esc(u.resumo) +
                (u.backup ? '<br><a href="' + esc(u.backup) + '" target="_blank" rel="noopener">📄 Cópia de segurança da planilha</a>' : '') +
                (D.podeDesfazer ? '<br><button onclick="viradaDesfazer()" style="margin-top:8px;' + btn('#b91c1c') + '">↩️ Desfazer esta virada</button> <span style="color:#64748b;">Volta a lista de alunos, as abas arquivadas e o ano letivo. Alunos cadastrados depois continuam.</span>' : '') + '</div>';
        }
        h += '<h4 style="margin:0 0 8px;">O que vai acontecer em ' + D.anoAtual + ' → ' + D.proximoAno + '</h4>';
        h += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">' + card(c.Aprovado, 'aprovados (sobem)', '#d1fae5') + card(c.Retido, 'retidos', '#fef3c7') +
            card(c.Egresso, 'egressos (saem)', '#e0e7ff') + card(c.Transferido + c.Desistente, 'transferidos/desistentes (saem)', '#fee2e2') + '</div>';

        const pend = [];
        if (!D.turmasAtuaisSalvas || sujo[0]) pend.push('Salvar as turmas de ' + D.anoAtual + ' (passo 1)');
        if (!D.turmasProximasSalvas || sujo[1]) pend.push('Salvar as turmas de ' + D.proximoAno + ' (passo 2)');
        if (sujo[2]) pend.push('Salvar as situações dos alunos (passo 3)');
        plano.pendencias.slice(0, 15).forEach(p => pend.push(p.nome + ' (' + p.turma + '): ' + p.texto));
        if (plano.pendencias.length > 15) pend.push('... e mais ' + (plano.pendencias.length - 15) + ' aluno(s)');

        h += '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:14px;"><tr style="background:#d1fae5;"><th style="padding:6px;text-align:left;">Turma ' + D.proximoAno + '</th><th style="padding:6px;text-align:left;">Nome</th><th style="padding:6px;">Turno</th><th style="padding:6px;">Alunos</th><th style="padding:6px;text-align:left;">Atenção</th></tr>';
        D.turmasProximas.filter(t => cod(t.codigo)).forEach(t => {
            const n = plano.porTurma[cod(t.codigo)] || 0;
            const alerta = n === 0 ? (/^6[A-Z]$/.test(cod(t.codigo)) ? 'recebe o 6º ano novo (matrícula)' : 'nenhum aluno vindo') : (n > 40 ? 'turma cheia (' + n + ')' : '');
            h += '<tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:5px 6px;font-weight:bold;">' + esc(t.codigo) + '</td><td style="padding:5px 6px;">' + esc(t.nome) + '</td><td style="padding:5px 6px;text-align:center;">' + esc(t.turno || '—') + '</td>' +
                '<td style="padding:5px 6px;text-align:center;font-weight:bold;">' + n + '</td><td style="padding:5px 6px;color:#b45309;font-size:12px;">' + esc(alerta) + '</td></tr>';
        });
        h += '</table>';

        h += '<h4 style="margin:0 0 6px;">Recomeçar os contadores do ano</h4><p style="font-size:12px;color:#64748b;margin:0 0 6px;">A aba é copiada para "Nome_' + D.anoAtual + '" e fica só com o cabeçalho.</p>' +
            '<label style="display:block;font-size:13px;margin:4px 0;"><input type="checkbox" id="vir-arq-impressoes" checked> Limite de impressões de provas (Controle_Impressoes)</label>' +
            '<label style="display:block;font-size:13px;margin:4px 0;"><input type="checkbox" id="vir-arq-preConselho" checked> Pré-Conselho</label>' +
            '<label style="display:block;font-size:13px;margin:4px 0;"><input type="checkbox" id="vir-arq-frequenciometro" checked> Frequenciômetro: sorteios, trimestres e evolução semanal</label>';
        h += '<div style="background:#f8fafc;border-radius:8px;padding:10px 14px;margin-top:12px;font-size:12px;color:#475569;">Ao virar: é criada uma <b>cópia de segurança</b> da planilha no Drive; a turma de cada aluno em ' + D.anoAtual + ' fica guardada na aba <b>Alunos_Historico</b>; egressos, transferidos e desistentes saem da lista de alunos; o ano letivo do SIGA passa a ser ' + D.proximoAno + ' (contadores de apontamentos e atas recomeçam). Faça isso depois do último conselho de classe de ' + D.anoAtual + '. Dá para desfazer por 30 dias.</div>';

        if (pend.length) h += '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;margin-top:12px;font-size:13px;"><b style="color:#b91c1c;">Antes de virar:</b><br>' + pend.map(esc).join('<br>') + '</div>';
        document.getElementById('conteudo-virada').innerHTML = h;
        const pode = !pend.length;
        rodape('<button onclick="viradaIrPara(3)" style="' + btn('#64748b') + 'margin-right:auto;">← Voltar</button>' +
            '<input id="vir-confirmar" placeholder="digite ' + D.proximoAno + '" style="padding:8px;border:1px solid #cbd5e1;border-radius:6px;width:130px;"' + (pode ? '' : ' disabled') + '>' +
            '<button onclick="viradaExecutar()" style="' + btn(pode ? '#059669' : '#94a3b8') + '"' + (pode ? '' : ' disabled') + '>🎓 Virar para ' + D.proximoAno + '</button>');
    }

    async function executar() {
        const conf = (document.getElementById('vir-confirmar').value || '').trim();
        if (conf !== String(D.proximoAno)) { alert('Digite ' + D.proximoAno + ' no campo ao lado para confirmar.'); return; }
        if (!confirm('Virar o ano letivo de ' + D.anoAtual + ' para ' + D.proximoAno + '?\n\nA lista de alunos será atualizada. Uma cópia de segurança será criada antes.')) return;
        const arquivar = {};
        ['impressoes', 'preConselho', 'frequenciometro'].forEach(k => { arquivar[k] = document.getElementById('vir-arq-' + k).checked; });
        rodape('<span style="color:#475569;"><i class="fa-solid fa-spinner fa-spin"></i> Fazendo a cópia de segurança e atualizando os alunos... (pode levar 1 minuto)</span>');
        try {
            const r = await post({ operacao: 'VIRADA_EXECUTAR', confirmar: conf, arquivar });
            if (r.status === 'success') {
                alert('🎓 Ano letivo ' + r.anoNovo + ' iniciado!\n\n' + r.alunosNoAnoNovo + ' alunos nas turmas novas.\nAprovados: ' + r.contagem.Aprovado + ' · Retidos: ' + r.contagem.Retido + ' · Egressos: ' + r.contagem.Egresso +
                    '\n\nPróximos passos: cadastrar o 6º ano novo e montar os horários na Gestão de Horários.');
                abrirVirada();
            } else if (r.status === 'pendencias') {
                alert('⚠️ Ainda há alunos sem destino:\n\n' + r.pendencias.slice(0, 20).join('\n'));
                desenharConferir();
            } else {
                alert('❌ ' + (r.message || 'Não foi possível virar o ano.'));
                desenharConferir();
            }
        } catch (e) {
            alert('❌ A conexão caiu. Abra a Virada de novo para conferir se ela foi feita antes de tentar outra vez.');
            desenharConferir();
        }
    }

    async function desfazer() {
        if (!confirm('Desfazer a virada de ' + D.ultimaVirada.de + ' → ' + D.ultimaVirada.para + '?\n\nOs alunos voltam para as turmas de ' + D.ultimaVirada.de + ', as abas arquivadas voltam e o ano letivo volta a ser ' + D.ultimaVirada.de + '.')) return;
        try {
            const r = await post({ operacao: 'VIRADA_DESFAZER' });
            if (r.status === 'success') { alert('↩️ Virada desfeita. ' + r.alunos + ' alunos de volta' + (r.mantidos ? ' (+' + r.mantidos + ' cadastrados depois, mantidos)' : '') + '.'); abrirVirada(); }
            else alert('❌ ' + (r.message || 'Não foi possível desfazer.'));
        } catch (e) { alert('❌ Erro de conexão.'); }
    }

    Object.assign(global, {
        abrirVirada, fecharVirada,
        viradaIrPara: irPara, viradaEditar: editar, viradaAdicionar: adicionar, viradaRemover: remover,
        viradaSalvarTurmas: salvarTurmas, viradaTurmaSit: t => { turmaSit = t; desenharSituacoes(); },
        viradaSit: mudarSit, viradaAplicarTodos: aplicarTodos, viradaSalvarSituacoes: salvarSituacoes,
        viradaFiltroSerie: s => { filtroSerie = s; desenharMatriz(); }, viradaMatriz: editarMatriz, viradaSalvarMatriz: salvarMatriz,
        viradaExecutar: executar, viradaDesfazer: desfazer
    });
})(typeof window !== 'undefined' ? window : globalThis);
