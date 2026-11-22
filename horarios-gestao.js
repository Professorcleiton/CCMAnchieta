/* =====================================================================
 *  SIGA — Gestão de Horários (modal do restrito.html)
 *
 *  • disciplina, professor e local escolhidos separadamente
 *  • conflitos de verdade: professor em duas turmas, recurso lotado
 *  • alertas: hora-atividade, máximo de aulas/dia, turno preferido,
 *    restrições do cadastro, aulas que deviam estar no laboratório
 *  • professor de apoio e local preservados
 *  • Auto-Preencher que respeita os conflitos e as preferências
 *  • recursos (Lab, Tablets...) e as disciplinas que usam cada um,
 *    editáveis na tela (aba "Recursos" / "Recursos_Disciplinas")
 * ===================================================================== */
(function (global) {
    'use strict';

    const DIAS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];
    const AULAS = ['1ª', '2ª', '3ª', '4ª', '5ª', '6ª'];
    const HORARIOS_FIXOS = {
        'Manhã': ['06:55-07:45', '07:45-08:35', '08:35-09:30', '09:40-10:30', '10:30-11:20', '11:20-12:10'],
        'Tarde': ['12:55-13:45', '13:45-14:35', '14:35-15:30', '15:40-16:30', '16:30-17:20', '17:20-18:10']
    };
    const INTERVALO = { 'Manhã': '09:30-09:40', 'Tarde': '15:30-15:40' };
    const RECURSOS_PADRAO = {
        recursos: [{ recurso: 'Lab. Informática', simultaneas: 1, obs: '' }, { recurso: 'Tablet', simultaneas: 1, obs: '' }],
        disciplinas: []
    };

    // ------------------------------------------------------------------
    //  Funções puras (testadas em tests/test-horarios.js)
    // ------------------------------------------------------------------
    function norm(s) {
        return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function listaDisciplinas(texto) {
        return String(texto || '').split(/[,;\/\n]+/).map(t => t.trim()).filter(Boolean);
    }

    /** Recurso ocupado por um "local" ('' = sala comum). Aceita nomes antigos ("Lab", "Tablets"). */
    function recursoDoLocal(local, recursos) {
        const l = norm(local);
        if (!l || l.indexOf('sala') === 0) return '';
        for (const r of recursos) if (norm(r.recurso) === l) return r.recurso;
        for (const r of recursos) {
            const n = norm(r.recurso);
            if ((l.startsWith('lab') && n.startsWith('lab')) || (l.startsWith('tablet') && n.startsWith('tablet'))) return r.recurso;
        }
        return '';
    }

    /** Série de uma turma pelo código: 6A → "6", 3ANEM → "3NEM", 1AGRO → "1AGRO". */
    function serieDaTurma(codigo) {
        const c = String(codigo || '').toUpperCase().replace(/\s+/g, '');
        let m = c.match(/^(\d)(NEM|FD|AGRO)$/) || c.match(/^(\d)[A-Z](NEM|FD|AGRO)$/) || c.match(/^(\d)([A-Z]{2,})$/);
        if (m) return m[1] + m[2];
        m = c.match(/^(\d)[A-Z]?$/);
        if (m) return m[1];
        return c;
    }

    /** Regras de recurso que valem para uma disciplina numa turma. */
    function regraDaDisciplina(disciplina, turma, cfg) {
        const d = norm(disciplina);
        const serie = norm(serieDaTurma(turma));
        return (cfg.disciplinas || []).find(r => {
            if (norm(r.disciplina) !== d) return false;
            const series = listaDisciplinas(r.series).map(norm);
            return !series.length || series.includes(serie) || series.includes(norm(turma));
        }) || null;
    }

    /**
     * Analisa a grade em edição.
     * ctx: { turma, turno, grade, outras (linhas de outras turmas do mesmo turno),
     *        cfg (recursos), professores [{nome, turno_pref, max_aulas, restricoes, geminadas}],
     *        horasAtividade [{turno, professor, dia, aula}], todasDoProfessor (opcional) }
     * Devolve { celulas: {"dia|aula": {conflitos:[], alertas:[]}}, gerais: [] }
     */
    function analisarGrade(ctx) {
        const { turma, turno, grade, outras = [], cfg = RECURSOS_PADRAO, professores = [], horasAtividade = [] } = ctx;
        const res = { celulas: {}, gerais: [] };
        const ocup = {};
        outras.forEach(o => {
            if (o.turno !== turno || o.turma === turma) return;
            const k = o.dia + '|' + o.aula;
            (ocup[k] = ocup[k] || []).push(o);
        });
        const limite = {};
        (cfg.recursos || []).forEach(r => { limite[r.recurso] = Math.max(1, parseInt(r.simultaneas, 10) || 1); });
        const profPorNome = {};
        professores.forEach(p => { profPorNome[norm(p.nome)] = p; });
        const haPorChave = {};
        horasAtividade.forEach(h => {
            if (h.turno && h.turno !== turno) return;
            haPorChave[norm(h.professor) + '|' + h.dia + '|' + h.aula] = h.tipo || 'Hora-atividade';
        });

        // aulas de cada professor por dia (esta turma + outras turmas, todos os turnos que conhecemos)
        const aulasDia = {};
        const contar = (prof, dia) => { const k = norm(prof) + '|' + dia; aulasDia[k] = (aulasDia[k] || 0) + 1; };
        (ctx.todasDoProfessor || outras).forEach(o => { if (o.professor && o.turma !== turma) contar(o.professor, o.dia); });
        DIAS.forEach(dia => AULAS.forEach(aula => {
            const c = grade[dia] && grade[dia][aula];
            if (c && c.disciplina && c.professor) contar(c.professor, dia);
        }));

        const usoRecursoDisc = {};   // disciplina → {total, noRecurso}
        DIAS.forEach(dia => AULAS.forEach(aula => {
            const c = grade[dia] && grade[dia][aula];
            if (!c || !c.disciplina) return;
            const k = dia + '|' + aula;
            const info = { conflitos: [], alertas: [] };
            const prof = norm(c.professor);
            const outrasAqui = ocup[k] || [];

            if (prof) {
                outrasAqui.forEach(o => {
                    if (norm(o.professor) === prof) info.conflitos.push(c.professor + ' já tem aula no ' + o.turma);
                    else if (norm(o.professor_apoio) === prof) info.conflitos.push(c.professor + ' é apoio no ' + o.turma);
                });
                if (haPorChave[prof + '|' + dia + '|' + aula]) info.alertas.push('Hora-atividade de ' + c.professor);
                const p = profPorNome[prof];
                if (p) {
                    const max = parseInt(p.max_aulas, 10) || 0;
                    if (max && aulasDia[prof + '|' + dia] > max) info.alertas.push(c.professor + ': ' + aulasDia[prof + '|' + dia] + ' aulas na ' + dia + ' (máx. ' + max + ')');
                    if (p.turno_pref && p.turno_pref !== 'Ambos' && norm(p.turno_pref) !== norm(turno)) info.alertas.push(c.professor + ' prefere o turno ' + p.turno_pref);
                    const restr = norm(p.restricoes);
                    if (restr && restr.includes(norm(dia))) info.alertas.push('Restrição: ' + p.restricoes);
                }
            } else {
                info.alertas.push('Sem professor');
            }

            const rec = recursoDoLocal(c.local, cfg.recursos || []);
            if (rec) {
                const usando = outrasAqui.filter(o => recursoDoLocal(o.local, cfg.recursos || []) === rec);
                if (usando.length >= (limite[rec] || 1)) info.conflitos.push(rec + ' ocupado: ' + usando.map(o => o.turma).join(', '));
            }

            const regra = regraDaDisciplina(c.disciplina, turma, cfg);
            if (regra) {
                const u = usoRecursoDisc[c.disciplina] = usoRecursoDisc[c.disciplina] || { regra, total: 0, noRecurso: 0 };
                u.total++;
                if (rec === regra.recurso) u.noRecurso++;
            }
            if (info.conflitos.length || info.alertas.length) res.celulas[k] = info;
        }));

        Object.keys(usoRecursoDisc).forEach(disc => {
            const u = usoRecursoDisc[disc];
            const precisa = u.regra.aulas === 'Todas' ? u.total : Math.min(u.total, parseInt(u.regra.aulas, 10) || 0);
            if (u.noRecurso < precisa) {
                res.gerais.push(disc + ': ' + u.noRecurso + ' de ' + precisa + ' aula(s) marcadas em ' + u.regra.recurso);
            }
        });
        return res;
    }

    /** Professor sugerido para uma disciplina numa turma. */
    function sugerirProfessor(disciplina, turma, grade, todas, professores) {
        const d = norm(disciplina);
        for (const dia of DIAS) for (const aula of AULAS) {
            const c = grade[dia] && grade[dia][aula];
            if (c && norm(c.disciplina) === d && c.professor) return c.professor;
        }
        const daTurma = todas.find(h => h.turma === turma && norm(h.disciplina) === d && h.professor);
        if (daTurma) return daTurma.professor;
        const habilitados = professores.filter(p => listaDisciplinas(p.disciplinas).map(norm).includes(d));
        if (habilitados.length === 1) return habilitados[0].nome;
        // quem dá essa disciplina em mais turmas da mesma série
        const serie = serieDaTurma(turma), conta = {};
        todas.forEach(h => { if (norm(h.disciplina) === d && h.professor && serieDaTurma(h.turma) === serie) conta[h.professor] = (conta[h.professor] || 0) + 1; });
        const melhor = Object.keys(conta).sort((a, b) => conta[b] - conta[a])[0];
        return melhor || '';
    }

    /**
     * Distribui as aulas numa grade vazia.
     * aulas: [{disciplina, professor, local}] ; devolve { grade, sobraram: [...] }
     */
    function distribuirAulas(aulas, ctx) {
        const { turma, turno, outras = [], cfg = RECURSOS_PADRAO, professores = [], horasAtividade = [] } = ctx;
        const grade = gradeVazia();
        const ocup = {};
        outras.forEach(o => { if (o.turno === turno && o.turma !== turma) { const k = o.dia + '|' + o.aula; (ocup[k] = ocup[k] || []).push(o); } });
        const limite = {};
        (cfg.recursos || []).forEach(r => { limite[r.recurso] = Math.max(1, parseInt(r.simultaneas, 10) || 1); });
        const ha = {};
        horasAtividade.forEach(h => { if (!h.turno || h.turno === turno) ha[norm(h.professor) + '|' + h.dia + '|' + h.aula] = true; });
        const perfil = {};
        professores.forEach(p => { perfil[norm(p.nome)] = p; });
        const aulasDia = {};
        outras.forEach(o => { if (o.professor && o.turma !== turma) { const k = norm(o.professor) + '|' + o.dia; aulasDia[k] = (aulasDia[k] || 0) + 1; } });

        const livre = (dia, aula, a) => {
            if (grade[dia][aula].disciplina) return false;
            const k = dia + '|' + aula, prof = norm(a.professor), aqui = ocup[k] || [];
            if (prof) {
                if (aqui.some(o => norm(o.professor) === prof || norm(o.professor_apoio) === prof)) return false;
                if (ha[prof + '|' + dia + '|' + aula]) return false;
                const p = perfil[prof];
                const max = p ? parseInt(p.max_aulas, 10) || 0 : 0;
                if (max && (aulasDia[prof + '|' + dia] || 0) >= max) return false;
                if (p && p.restricoes && norm(p.restricoes).includes(norm(dia))) return false;
            }
            const rec = recursoDoLocal(a.local, cfg.recursos || []);
            if (rec && aqui.filter(o => recursoDoLocal(o.local, cfg.recursos || []) === rec).length >= (limite[rec] || 1)) return false;
            return true;
        };
        const noDia = (dia, disc) => AULAS.filter(a => grade[dia][a].disciplina === disc).length;
        const colocar = (dia, aula, a) => {
            grade[dia][aula] = { disciplina: a.disciplina, professor: a.professor || '', local: a.local || '' };
            if (a.professor) { const k = norm(a.professor) + '|' + dia; aulasDia[k] = (aulasDia[k] || 0) + 1; }
        };

        // Agrupa por disciplina+professor; recursos e professores mais ocupados primeiro
        const grupos = {};
        aulas.forEach(a => {
            const k = a.disciplina + '|' + (a.professor || '');
            (grupos[k] = grupos[k] || { disciplina: a.disciplina, professor: a.professor || '', itens: [] }).itens.push(a);
        });
        const ocupacaoProf = p => outras.filter(o => norm(o.professor) === norm(p)).length;
        const ordem = Object.values(grupos).sort((x, y) => {
            const rx = x.itens.some(i => recursoDoLocal(i.local, cfg.recursos || [])) ? 1 : 0;
            const ry = y.itens.some(i => recursoDoLocal(i.local, cfg.recursos || [])) ? 1 : 0;
            if (rx !== ry) return ry - rx;
            const gem = g => (g.itens.length > 1 && perfil[norm(g.professor)] && /^s/i.test(String(perfil[norm(g.professor)].geminadas || ''))) ? 1 : 0;
            if (gem(x) !== gem(y)) return gem(y) - gem(x);
            const ox = ocupacaoProf(x.professor), oy = ocupacaoProf(y.professor);
            if (ox !== oy) return oy - ox;
            return y.itens.length - x.itens.length;
        });

        const sobraram = [];
        ordem.forEach(g => {
            const p = perfil[norm(g.professor)];
            const gostaGeminada = p && /^s/i.test(String(p.geminadas || ''));
            // recurso primeiro dentro do grupo
            const fila = g.itens.slice().sort((a, b) => (recursoDoLocal(b.local, cfg.recursos || []) ? 1 : 0) - (recursoDoLocal(a.local, cfg.recursos || []) ? 1 : 0));
            while (fila.length) {
                const a = fila.shift();
                // dias com menos aulas desta disciplina primeiro
                const dias = DIAS.slice().sort((d1, d2) => noDia(d1, g.disciplina) - noDia(d2, g.disciplina));
                let posto = false;
                if (gostaGeminada && fila.length) {
                    const b = fila[0];
                    for (const dia of dias) {
                        if (noDia(dia, g.disciplina) > 0) continue;
                        for (let i = 0; i < AULAS.length - 1 && !posto; i++) {
                            if (i === 2) continue; // não junta 3ª e 4ª (intervalo no meio)
                            if (livre(dia, AULAS[i], a) && livre(dia, AULAS[i + 1], b)) {
                                colocar(dia, AULAS[i], a); colocar(dia, AULAS[i + 1], b); fila.shift(); posto = true;
                            }
                        }
                        if (posto) break;
                    }
                }
                for (const dia of dias) {
                    if (posto) break;
                    if (noDia(dia, g.disciplina) >= 2) continue;
                    for (const aula of AULAS) {
                        if (livre(dia, aula, a)) { colocar(dia, aula, a); posto = true; break; }
                    }
                }
                if (!posto) posto = trocar(a);
                if (!posto) sobraram.push(a);
            }
        });
        return { grade, sobraram };

        function retirar(dia, aula) {
            const c = grade[dia][aula];
            if (c.professor) { const k = norm(c.professor) + '|' + dia; aulasDia[k] = Math.max(0, (aulasDia[k] || 0) - 1); }
            grade[dia][aula] = { disciplina: '', professor: '', local: '' };
            return c;
        }
        function geminada(dia, aula) {
            const i = AULAS.indexOf(aula), d = grade[dia][aula].disciplina;
            return (i > 0 && grade[dia][AULAS[i - 1]].disciplina === d) || (i < AULAS.length - 1 && grade[dia][AULAS[i + 1]].disciplina === d);
        }
        // Não achou horário: tira outra aula do lugar e a muda para um horário vago
        function trocar(a) {
            for (const dia of DIAS) for (const aula of AULAS) {
                const b = grade[dia][aula];
                if (!b.disciplina || b.disciplina === a.disciplina || geminada(dia, aula)) continue;
                const tirada = retirar(dia, aula);
                if (noDia(dia, a.disciplina) < 2 && livre(dia, aula, a)) {
                    for (const d2 of DIAS) {
                        if (noDia(d2, tirada.disciplina) >= 2) continue;
                        for (const a2 of AULAS) {
                            if ((d2 !== dia || a2 !== aula) && livre(d2, a2, tirada)) {
                                colocar(d2, a2, tirada); colocar(dia, aula, a); return true;
                            }
                        }
                    }
                }
                colocar(dia, aula, tirada);
            }
            return false;
        }
    }

    function gradeVazia() {
        const g = {};
        DIAS.forEach(dia => { g[dia] = {}; AULAS.forEach(aula => { g[dia][aula] = { disciplina: '', professor: '', local: '', professor_apoio: '' }; }); });
        return g;
    }


    // ------------------------------------------------------------------
    //  Hora-atividade
    // ------------------------------------------------------------------
    // Tabela oficial: aulas de regência (índice) → horas-atividade
    const TABELA_HA = [0, 0, 0, 1, 1, 2, 2, 2, 2, 3, 3, 4, 4, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 10, 10];
    function haEsperada(aulas) {
        const n = Math.max(0, parseInt(aulas, 10) || 0);
        return n < TABELA_HA.length ? TABELA_HA[n] : TABELA_HA[TABELA_HA.length - 1];
    }
    /** Aulas do professor (titular conta como regência; apoio só ocupa o horário). */
    function aulasDoProfessor(nome, todas) {
        const n = norm(nome);
        return todas.filter(h => norm(h.professor) === n || norm(h.professor_apoio) === n)
            .map(h => Object.assign({}, h, { apoio: norm(h.professor) !== n }));
    }
    function regencia(nome, todas) { return aulasDoProfessor(nome, todas).filter(a => !a.apoio).length; }

    /**
     * Sugere horários de hora-atividade que faltam.
     * ha: horas-atividade atuais do professor [{turno, dia, aula, tipo}]
     * Prefere: turno e dias em que o professor já está na escola, "janelas" entre aulas,
     * no máximo 2 por dia, espalhando pela semana; evita dias das restrições do cadastro.
     */
    function sugerirHA(nome, todas, ha, perfil, tipo) {
        const aulas = aulasDoProfessor(nome, todas);
        const falta = haEsperada(aulas.filter(a => !a.apoio).length) - ha.length;
        if (falta <= 0) return [];
        const ocupado = new Set(aulas.map(a => a.turno + '|' + a.dia + '|' + a.aula).concat(ha.map(h => h.turno + '|' + h.dia + '|' + h.aula)));
        const porTurno = {};
        aulas.forEach(a => { porTurno[a.turno] = (porTurno[a.turno] || 0) + 1; });
        const turnos = Object.keys(porTurno).length ? Object.keys(porTurno).sort((x, y) => porTurno[y] - porTurno[x]) : ['Manhã'];
        const restr = norm(perfil && perfil.restricoes);
        const novas = [];
        const haNoDia = (t, d) => ha.concat(novas).filter(h => h.turno === t && h.dia === d).length;
        for (let k = 0; k < falta; k++) {
            let melhor = null, melhorNota = -Infinity;
            turnos.forEach((t, ti) => DIAS.forEach(d => {
                if (restr && restr.includes(norm(d))) return;
                const aulasDia = aulas.filter(a => a.turno === t && a.dia === d).map(a => AULAS.indexOf(a.aula));
                if (haNoDia(t, d) >= 2) return;
                AULAS.forEach((au, i) => {
                    const chave = t + '|' + d + '|' + au;
                    if (ocupado.has(chave)) return;
                    let nota = 0;
                    if (aulasDia.length) nota += 4;                                   // já está na escola
                    if (aulasDia.some(x => x < i) && aulasDia.some(x => x > i)) nota += 3; // janela entre aulas
                    else if (aulasDia.some(x => Math.abs(x - i) === 1)) nota += 2;     // colada numa aula
                    nota -= haNoDia(t, d) * 2;                                         // espalha pela semana
                    nota -= ti * 3;                                                    // turno principal primeiro
                    if (nota > melhorNota) { melhorNota = nota; melhor = { turno: t, dia: d, aula: au, tipo: tipo || 'H.A. - Planejamento' }; }
                });
            }));
            if (!melhor) break;
            novas.push(melhor);
            ocupado.add(melhor.turno + '|' + melhor.dia + '|' + melhor.aula);
        }
        return novas;
    }

    const nucleo = { haEsperada, aulasDoProfessor, regencia, sugerirHA, DIAS, AULAS, HORARIOS_FIXOS, norm, listaDisciplinas, recursoDoLocal, serieDaTurma, regraDaDisciplina,
        analisarGrade, sugerirProfessor, distribuirAulas, gradeVazia };
    if (typeof module !== 'undefined' && module.exports) { module.exports = nucleo; return; }
    global.HorariosNucleo = nucleo;

    // ------------------------------------------------------------------
    //  Tela
    // ------------------------------------------------------------------
    const URL = () => (global.SIGA_CONFIG && global.SIGA_CONFIG.APPS_SCRIPT_URL) || global.APPS_SCRIPT_URL;
    const esc = v => (typeof global.escaparHTML === 'function' ? global.escaparHTML(v) : String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    const toast = (msg) => (typeof global.mostrarToast === 'function' && document.getElementById('toast-container') ? global.mostrarToast(msg, 'sucesso') : alert(msg));

    const est = {
        carregado: false, todas: [], professores: [], cfg: RECURSOS_PADRAO, cfgPadrao: true, ha: [], turmas: [],
        turma: '', turno: 'Manhã', grade: gradeVazia(), alterado: false, matriz: [],
        modo: 'turma', prof: '', haEdit: [], haAlterado: false
    };

    async function getJSON(params) {
        const r = await fetch(URL() + '?' + params);
        return r.json();
    }

    async function carregarBase(forcar) {
        if (est.carregado && !forcar) return;
        const [alunos, horarios, usuarios, recursos, ha, plano] = await Promise.all([
            getJSON('aba=alunos').catch(() => []),
            getJSON('aba=horarios').catch(() => ({})),
            getJSON('aba=usuarios').catch(() => []),
            getJSON('aba=recursos').catch(() => null),
            getJSON('aba=horas_atividade').catch(() => []),
            getJSON('aba=planejamento_ano').catch(() => null)
        ]);
        est.matriz = (plano && plano.status === 'success' && plano.matriz) ? plano.matriz.linhas || [] : [];
        est.todas = (horarios && horarios.horarios) || [];
        est.professores = (Array.isArray(usuarios) ? usuarios : []).filter(u => /prof|dire|pedag/i.test(u.setor || '') || u.disciplinas);
        if (recursos && recursos.status === 'success') { est.cfg = recursos; est.cfgPadrao = !!recursos.padrao; }
        est.ha = Array.isArray(ha) ? ha : [];
        const turmas = new Set();
        (Array.isArray(alunos) ? alunos : []).forEach(a => a.turma_codigo && turmas.add(a.turma_codigo));
        est.todas.forEach(h => h.turma && turmas.add(h.turma));
        if (plano && plano.status === 'success') (plano.turmas || []).concat(plano.turmasProximas || []).forEach(t => t.codigo && t.ativa !== false && turmas.add(t.codigo));
        est.turmas = [...turmas].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
        est.carregado = true;
    }

    function preencherTurmas() {
        const sel = document.getElementById('gestao-turma');
        sel.innerHTML = '<option value="">Selecione uma turma...</option>' +
            est.turmas.map(t => '<option value="' + esc(t) + '"' + (t === est.turma ? ' selected' : '') + '>' + esc(t) + '</option>').join('') +
            '<option value="__nova__">➕ Outra turma...</option>';
    }

    async function abrirGestaoHorarios() {
        document.getElementById('modal-gestao-horarios').style.display = 'flex';
        document.getElementById('gestao-turma').innerHTML = '<option value="">Carregando...</option>';
        try {
            await carregarBase(true);
            preencherTurmas();
            if (est.modo === 'professor') { preencherProfessores(); est.haEdit = haDe(est.prof); est.haAlterado = false; renderizarProfessor(); }
            else if (est.turma) carregarGradeEdicao();
        } catch (e) {
            console.error(e);
            document.getElementById('container-grade').innerHTML = '<p style="color:#ef4444;text-align:center;padding:30px;">Erro ao carregar os horários.</p>';
        }
    }

    function trocarTurmaGestao() {
        const sel = document.getElementById('gestao-turma');
        if (est.alterado && !confirm('Há mudanças não salvas nesta turma. Trocar mesmo assim?')) { sel.value = est.turma; return; }
        if (sel.value === '__nova__') {
            const nova = (prompt('Código da nova turma (ex.: 9D, 2AGRO, 3BNEM):') || '').trim().toUpperCase();
            if (!nova) { sel.value = est.turma; return; }
            if (!est.turmas.includes(nova)) est.turmas.push(nova);
            est.turma = nova;
            preencherTurmas();
        } else {
            est.turma = sel.value;
        }
        // turno em que a turma já tem aulas
        const ja = est.todas.find(h => h.turma === est.turma);
        if (ja && ja.turno) document.getElementById('gestao-turno').value = ja.turno;
        carregarGradeEdicao(true);
    }

    function carregarGradeEdicao(semPerguntar) {
        if (est.modo === 'professor') { est.turno = document.getElementById('gestao-turno').value; return renderizarProfessor(); }
        const turno = document.getElementById('gestao-turno').value;
        if (!semPerguntar && est.alterado && turno !== est.turno && !confirm('Há mudanças não salvas. Trocar de turno mesmo assim?')) {
            document.getElementById('gestao-turno').value = est.turno; return;
        }
        est.turno = turno;
        est.turma = document.getElementById('gestao-turma').value === '__nova__' ? est.turma : (document.getElementById('gestao-turma').value || est.turma);
        est.grade = gradeVazia();
        est.alterado = false;
        if (!est.turma) {
            document.getElementById('container-grade').innerHTML = '<div style="text-align:center;padding:40px;color:#64748b;">Selecione uma turma.</div>';
            document.getElementById('painel-conflitos').innerHTML = '';
            return;
        }
        est.todas.filter(h => h.turma === est.turma && h.turno === est.turno).forEach(h => {
            if (est.grade[h.dia] && est.grade[h.dia][h.aula]) {
                est.grade[h.dia][h.aula] = { disciplina: h.disciplina || '', professor: h.professor || '', local: h.local || '', professor_apoio: h.professor_apoio || '' };
            }
        });
        renderizarGrade();
    }

    function disciplinasConhecidas() {
        const s = new Set();
        est.todas.forEach(h => h.disciplina && s.add(h.disciplina));
        est.professores.forEach(p => listaDisciplinas(p.disciplinas).forEach(d => s.add(d)));
        (est.cfg.disciplinas || []).forEach(d => d.disciplina && s.add(d.disciplina));
        return [...s].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    }

    function nomesProfessores() {
        const s = new Set(est.professores.map(p => p.nome).filter(Boolean));
        est.todas.forEach(h => h.professor && s.add(h.professor));
        return [...s].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    }

    function ctxAnalise() {
        return { turma: est.turma, turno: est.turno, grade: est.grade, outras: est.todas.filter(h => h.turno === est.turno),
            todasDoProfessor: est.todas, cfg: est.cfg, professores: est.professores, horasAtividade: est.ha };
    }

    function renderizarGrade() {
        const analise = analisarGrade(ctxAnalise());
        const disciplinas = disciplinasConhecidas();
        const todosProf = nomesProfessores();
        const recursos = (est.cfg.recursos || []).map(r => r.recurso);
        const estiloSel = 'width:100%;padding:3px;border:1px solid #cbd5e1;border-radius:4px;font-size:11px;margin-bottom:2px;';

        let html = '<table style="width:100%;border-collapse:collapse;font-size:12px;background:white;">';
        html += '<thead><tr style="background:#7c3aed;color:white;"><th style="padding:8px;">Aula</th>';
        DIAS.forEach(d => { html += '<th style="padding:8px;">' + d + '</th>'; });
        html += '</tr></thead><tbody>';

        AULAS.forEach((aula, i) => {
            html += '<tr><td style="padding:6px;background:#f8fafc;font-weight:bold;text-align:center;white-space:nowrap;">' + aula +
                '<br><small style="font-weight:normal;color:#64748b;">' + HORARIOS_FIXOS[est.turno][i] + '</small></td>';
            DIAS.forEach(dia => {
                const c = est.grade[dia][aula];
                const info = analise.celulas[dia + '|' + aula];
                const bg = !c.disciplina ? '#f0fdf4' : (info && info.conflitos.length ? '#fee2e2' : (info && info.alertas.length ? '#fef3c7' : '#ffffff'));
                const a = "'" + dia + "','" + aula + "'";
                html += '<td style="padding:4px;background:' + bg + ';border:1px solid #e2e8f0;min-width:150px;vertical-align:top;">';

                html += '<select aria-label="Disciplina" onchange="atualizarCelula(' + a + ',\'disciplina\',this.value)" style="' + estiloSel + 'font-weight:bold;">';
                html += '<option value="">— Vago —</option>';
                if (c.disciplina && !disciplinas.includes(c.disciplina)) html += '<option selected>' + esc(c.disciplina) + '</option>';
                disciplinas.forEach(d => { html += '<option value="' + esc(d) + '"' + (d === c.disciplina ? ' selected' : '') + '>' + esc(d) + '</option>'; });
                html += '<option value="__nova__">➕ Outra disciplina...</option></select>';

                if (c.disciplina) {
                    const d = norm(c.disciplina);
                    const habil = est.professores.filter(p => listaDisciplinas(p.disciplinas).map(norm).includes(d)).map(p => p.nome);
                    const outros = todosProf.filter(n => !habil.includes(n));
                    html += '<select aria-label="Professor" onchange="atualizarCelula(' + a + ',\'professor\',this.value)" style="' + estiloSel + '">';
                    html += '<option value="">👨‍🏫 sem professor</option>';
                    if (c.professor && !todosProf.includes(c.professor)) html += '<option selected>' + esc(c.professor) + '</option>';
                    const opt = n => '<option value="' + esc(n) + '"' + (n === c.professor ? ' selected' : '') + '>' + esc(n) + '</option>';
                    if (habil.length) html += '<optgroup label="Dão ' + esc(c.disciplina) + '">' + habil.map(opt).join('') + '</optgroup><optgroup label="Outros">' + outros.map(opt).join('') + '</optgroup>';
                    else html += todosProf.map(opt).join('');
                    html += '</select>';

                    html += '<select aria-label="Local" onchange="atualizarCelula(' + a + ',\'local\',this.value)" style="' + estiloSel + '">';
                    const recAtual = recursoDoLocal(c.local, est.cfg.recursos || []);
                    html += '<option value=""' + (!recAtual && !c.local ? ' selected' : '') + '>🏫 Sala</option>';
                    if (c.local && !recAtual) html += '<option selected>' + esc(c.local) + '</option>';
                    recursos.forEach(r => { html += '<option value="' + esc(r) + '"' + (r === recAtual ? ' selected' : '') + '>🖥️ ' + esc(r) + '</option>'; });
                    html += '</select>';
                    if (c.professor_apoio) html += '<div style="font-size:10px;color:#64748b;">🤝 ' + esc(c.professor_apoio) + '</div>';
                }
                if (info) {
                    info.conflitos.forEach(t => { html += '<div style="font-size:10px;color:#b91c1c;">🔴 ' + esc(t) + '</div>'; });
                    info.alertas.forEach(t => { html += '<div style="font-size:10px;color:#b45309;">🟡 ' + esc(t) + '</div>'; });
                }
                html += '</td>';
            });
            html += '</tr>';
            if (aula === '3ª') html += '<tr style="background:#fef3c7;"><td colspan="6" style="text-align:center;font-weight:bold;padding:5px;">☕ INTERVALO — ' + INTERVALO[est.turno] + '</td></tr>';
        });
        html += '</tbody></table>';
        document.getElementById('container-grade').innerHTML = html;
        renderizarPainel(analise);
    }

    function renderizarPainel(analise) {
        const painel = document.getElementById('painel-conflitos');
        let conflitos = 0, alertas = 0;
        Object.values(analise.celulas).forEach(i => { conflitos += i.conflitos.length; alertas += i.alertas.length; });
        let aulas = 0, porDisc = {};
        DIAS.forEach(dia => AULAS.forEach(aula => {
            const c = est.grade[dia][aula];
            if (c.disciplina) { aulas++; porDisc[c.disciplina] = (porDisc[c.disciplina] || 0) + 1; }
        }));
        let html = '<div style="display:flex;gap:10px;flex-wrap:wrap;font-size:13px;margin-bottom:8px;">' +
            '<span style="background:#ede9fe;padding:6px 10px;border-radius:6px;"><b>' + aulas + '</b> de 30 aulas preenchidas</span>' +
            '<span style="background:' + (conflitos ? '#fee2e2' : '#dcfce7') + ';padding:6px 10px;border-radius:6px;">' + (conflitos ? '🔴 <b>' + conflitos + '</b> conflito(s)' : '🟢 Sem conflitos') + '</span>' +
            (alertas ? '<span style="background:#fef3c7;padding:6px 10px;border-radius:6px;">🟡 <b>' + alertas + '</b> alerta(s)</span>' : '') +
            (est.alterado ? '<span style="background:#fde68a;padding:6px 10px;border-radius:6px;">✏️ Mudanças não salvas</span>' : '') +
            '</div>';
        if (analise.gerais.length) html += '<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:8px 12px;font-size:12px;margin-bottom:8px;"><b>Recursos:</b><br>' + analise.gerais.map(esc).join('<br>') + '</div>';
        const resumo = Object.keys(porDisc).sort((a, b) => a.localeCompare(b, 'pt-BR')).map(d => esc(d) + ': <b>' + porDisc[d] + '</b>').join(' · ');
        if (resumo) html += '<div style="font-size:12px;color:#475569;"><b>Aulas por disciplina:</b> ' + resumo + '</div>';
        painel.innerHTML = html;
    }

    function atualizarCelula(dia, aula, campo, valor) {
        const c = est.grade[dia][aula];
        if (campo === 'disciplina') {
            if (valor === '__nova__') {
                valor = (prompt('Nome da disciplina:') || '').trim();
                if (!valor) { renderizarGrade(); return; }
            }
            if (!valor) {
                est.grade[dia][aula] = { disciplina: '', professor: '', local: '', professor_apoio: c.professor_apoio || '' };
            } else {
                const mesma = norm(c.disciplina) === norm(valor);
                c.disciplina = valor;
                if (!mesma) {
                    c.professor = sugerirProfessor(valor, est.turma, est.grade, est.todas, est.professores) || c.professor || '';
                    const regra = regraDaDisciplina(valor, est.turma, est.cfg);
                    if (regra) {
                        let jaNoRecurso = 0;
                        DIAS.forEach(d => AULAS.forEach(au => {
                            const x = est.grade[d][au];
                            if ((d !== dia || au !== aula) && norm(x.disciplina) === norm(valor) && recursoDoLocal(x.local, est.cfg.recursos) === regra.recurso) jaNoRecurso++;
                        }));
                        const precisa = regra.aulas === 'Todas' ? Infinity : parseInt(regra.aulas, 10) || 0;
                        c.local = jaNoRecurso < precisa ? regra.recurso : '';
                    } else if (recursoDoLocal(c.local, est.cfg.recursos)) {
                        c.local = '';
                    }
                }
            }
        } else {
            c[campo] = valor;
        }
        est.alterado = true;
        renderizarGrade();
    }

    function gradeParaEnvio() {
        const g = {};
        DIAS.forEach(dia => { g[dia] = {}; AULAS.forEach(aula => { g[dia][aula] = Object.assign({}, est.grade[dia][aula]); }); });
        return g;
    }

    async function salvarGradeAtual(ignorarConflitos) {
        if (!est.turma) { alert('Selecione uma turma primeiro.'); return; }
        const analise = analisarGrade(ctxAnalise());
        const lista = [];
        Object.keys(analise.celulas).forEach(k => analise.celulas[k].conflitos.forEach(t => lista.push(k.replace('|', ' ') + ': ' + t)));
        if (lista.length && !ignorarConflitos) {
            if (!confirm('⚠️ Esta grade tem ' + lista.length + ' conflito(s):\n\n' + lista.slice(0, 12).join('\n') + (lista.length > 12 ? '\n...' : '') + '\n\nSalvar mesmo assim?')) return;
            ignorarConflitos = true;
        }
        const btn = document.getElementById('btn-salvar-grade');
        btn.disabled = true; btn.innerText = '⏳ Salvando...';
        try {
            const resp = await global.fetchAutenticado(URL(), { operacao: 'SALVAR_GRADE', turma: est.turma, turno: est.turno, grade: gradeParaEnvio(), ignorarConflitos: !!ignorarConflitos });
            const r = await resp.json();
            if (r.status === 'conflito') {
                // alguém mudou outra turma enquanto você editava
                const txt = (r.conflitos || []).map(c => c.dia + ' ' + c.aula + ': ' + c.texto).join('\n');
                if (confirm('⚠️ O servidor encontrou conflitos com outras turmas:\n\n' + txt + '\n\nSalvar mesmo assim?')) {
                    btn.disabled = false; btn.innerText = '💾 Salvar';
                    return salvarGradeAtual(true);
                }
            } else if (r.status === 'success') {
                // atualiza a cópia local para os conflitos das outras turmas ficarem certos
                est.todas = est.todas.filter(h => !(h.turma === est.turma && h.turno === est.turno));
                DIAS.forEach(dia => AULAS.forEach((aula, i) => {
                    const c = est.grade[dia][aula];
                    if (c.disciplina) est.todas.push(Object.assign({ turno: est.turno, turma: est.turma, dia, aula, horario: HORARIOS_FIXOS[est.turno][i] }, c));
                }));
                if (!est.turmas.includes(est.turma)) est.turmas.push(est.turma);
                est.alterado = false;
                renderizarGrade();
                toast('✅ Grade salva!' + (r.aulas !== undefined ? ' (' + r.aulas + ' aulas)' : ''), 'success');
            } else {
                alert('❌ Erro: ' + (r.message || 'Falha ao salvar.'));
            }
        } catch (e) {
            alert('❌ Erro de conexão.');
        } finally {
            btn.disabled = false; btn.innerText = '💾 Salvar';
        }
    }

    function aulasDeReferencia() {
        // 1) a própria turma (qualquer turno); 2) uma turma da mesma série
        let base = est.todas.filter(h => h.turma === est.turma && h.disciplina);
        let origem = est.turma;
        if (!base.length) {
            const serie = serieDaTurma(est.turma);
            const daMatriz = (est.matriz || []).filter(l => norm(l.serie) === norm(serie) && (parseInt(l.aulas, 10) || 0) > 0);
            if (daMatriz.length) {
                const total = daMatriz.reduce((t, l) => t + (parseInt(l.aulas, 10) || 0), 0);
                if (confirm('A turma ' + est.turma + ' ainda não tem aulas.\nUsar a matriz curricular da série ' + serie + ' (' + total + ' aulas: ' + daMatriz.map(l => l.disciplina + ' ' + l.aulas).join(', ') + ')?')) {
                    const aulas = [];
                    daMatriz.forEach(l => {
                        const prof = sugerirProfessor(l.disciplina, est.turma, gradeVazia(), est.todas, est.professores);
                        for (let i = 0; i < (parseInt(l.aulas, 10) || 0); i++) aulas.push({ disciplina: l.disciplina, professor: prof, local: '' });
                    });
                    return aplicarRegrasRecurso(aulas);
                }
            }
            const candidatas = [...new Set(est.todas.filter(h => serieDaTurma(h.turma) === serie).map(h => h.turma))].sort();
            const escolha = candidatas.length ? prompt('A turma ' + est.turma + ' ainda não tem aulas.\nCopiar as disciplinas de qual turma?\n\n' + candidatas.join(', '), candidatas[0]) : prompt('A turma ' + est.turma + ' ainda não tem aulas.\nDigite a turma que servirá de modelo:');
            if (!escolha) return null;
            origem = escolha.trim().toUpperCase();
            base = est.todas.filter(h => h.turma === origem && h.disciplina);
            if (!base.length) { alert('A turma ' + origem + ' não tem aulas cadastradas.'); return null; }
        }
        // turmas novas: o professor é sugerido de novo (pode ser outro)
        const aulas = base.map(h => ({
            disciplina: h.disciplina,
            professor: origem === est.turma ? (h.professor || '') : sugerirProfessor(h.disciplina, est.turma, gradeVazia(), est.todas.filter(x => x.turma !== origem), est.professores),
            local: recursoDoLocal(h.local, est.cfg.recursos || []) || ''
        }));
        return aplicarRegrasRecurso(aulas);
    }

    // aplica as regras de recurso (ex.: Matemática 1 aula/semana no laboratório)
    function aplicarRegrasRecurso(aulas) {
        const porDisc = {};
        aulas.forEach(a => (porDisc[a.disciplina] = porDisc[a.disciplina] || []).push(a));
        Object.keys(porDisc).forEach(d => {
            const regra = regraDaDisciplina(d, est.turma, est.cfg);
            const lista = porDisc[d];
            if (!regra) return;
            const precisa = regra.aulas === 'Todas' ? lista.length : Math.min(lista.length, parseInt(regra.aulas, 10) || 0);
            lista.forEach((a, i) => { a.local = i < precisa ? regra.recurso : (a.local === regra.recurso ? '' : a.local); });
        });
        return aulas;
    }

    function autoPreencherGrade() {
        if (!est.turma) { alert('Selecione uma turma primeiro.'); return; }
        const aulas = aulasDeReferencia();
        if (!aulas) return;
        if (!confirm('⚡ O Auto-Preencher vai redistribuir ' + aulas.length + ' aulas da turma ' + est.turma + ' (' + est.turno + '), ' +
            'evitando conflitos com as outras turmas, horas-atividade e limites dos professores.\n\nA grade atual na tela será substituída (nada é gravado até você clicar em Salvar). Continuar?')) return;
        const apoio = {};
        DIAS.forEach(d => AULAS.forEach(a => { if (est.grade[d][a].professor_apoio) apoio[d + '|' + a] = est.grade[d][a].professor_apoio; }));
        const r = distribuirAulas(aulas, ctxAnalise());
        Object.keys(apoio).forEach(k => { const [d, a] = k.split('|'); r.grade[d][a].professor_apoio = apoio[k]; });
        est.grade = r.grade;
        est.alterado = true;
        renderizarGrade();
        if (r.sobraram.length) {
            alert('⚠️ ' + r.sobraram.length + ' aula(s) não couberam sem conflito:\n\n' + r.sobraram.map(a => a.disciplina + (a.professor ? ' (' + a.professor + ')' : '')).join('\n') + '\n\nColoque-as à mão nos horários vagos (verdes).');
        } else {
            toast('✅ Grade montada sem conflitos. Confira e clique em Salvar.', 'success');
        }
    }

    function limparGrade() {
        if (!confirm('Tem certeza que deseja limpar TODA a grade desta turma? (só é gravado ao clicar em Salvar)')) return;
        est.grade = gradeVazia();
        est.alterado = true;
        renderizarGrade();
    }

    function fecharModalGestaoHorarios(e) {
        if (e.target.id === 'modal-gestao-horarios') document.getElementById('modal-gestao-horarios').style.display = 'none';
    }

    // ------------------------------------------------------------------
    //  Recursos (Lab, Tablets...) e disciplinas que usam cada um
    // ------------------------------------------------------------------
    let edicaoRec = null;

    async function abrirRecursos() {
        document.getElementById('modal-recursos').style.display = 'flex';
        const area = document.getElementById('conteudo-recursos');
        area.innerHTML = '<p style="text-align:center;color:#64748b;">Carregando...</p>';
        try {
            const r = await getJSON('aba=recursos');
            if (r && r.status === 'success') { est.cfg = r; est.cfgPadrao = !!r.padrao; }
        } catch (e) { /* usa o que já tem */ }
        edicaoRec = JSON.parse(JSON.stringify({ recursos: est.cfg.recursos || [], disciplinas: est.cfg.disciplinas || [] }));
        desenharRecursos();
    }

    function desenharRecursos() {
        const area = document.getElementById('conteudo-recursos');
        const inp = 'padding:6px;border:1px solid #cbd5e1;border-radius:4px;font-size:13px;width:100%;box-sizing:border-box;';
        const nomes = edicaoRec.recursos.map(r => r.recurso).filter(Boolean);
        let h = '';
        if (est.cfgPadrao) h += '<div style="background:#fef3c7;padding:8px 12px;border-radius:6px;font-size:13px;margin-bottom:12px;">Estas listas ainda são as que estavam fixas no sistema. Ajuste e salve: elas passam a ficar nas abas <b>Recursos</b> e <b>Recursos_Disciplinas</b> da planilha.</div>';
        h += '<h4 style="margin:0 0 6px;">Recursos</h4><p style="font-size:12px;color:#64748b;margin:0 0 8px;">Espaços ou equipamentos que só podem ser usados por algumas turmas ao mesmo tempo (ex.: Lab. Informática = 1; Tablets = número de kits).</p>';
        h += '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;"><tr style="background:#ede9fe;"><th style="padding:6px;text-align:left;">Nome</th><th style="padding:6px;width:130px;">Turmas ao mesmo tempo</th><th style="padding:6px;text-align:left;">Observação</th><th></th></tr>';
        edicaoRec.recursos.forEach((r, i) => {
            h += '<tr><td style="padding:3px;"><input style="' + inp + '" value="' + esc(r.recurso) + '" onchange="editarRecurso(\'recursos\',' + i + ',\'recurso\',this.value)"></td>' +
                '<td style="padding:3px;"><input type="number" min="1" max="99" style="' + inp + '" value="' + esc(r.simultaneas) + '" onchange="editarRecurso(\'recursos\',' + i + ',\'simultaneas\',this.value)"></td>' +
                '<td style="padding:3px;"><input style="' + inp + '" value="' + esc(r.obs || '') + '" onchange="editarRecurso(\'recursos\',' + i + ',\'obs\',this.value)"></td>' +
                '<td><button title="Excluir" onclick="removerRecurso(\'recursos\',' + i + ')" style="background:none;border:none;cursor:pointer;font-size:16px;">🗑️</button></td></tr>';
        });
        h += '</table><button onclick="adicionarRecurso(\'recursos\')" style="margin:-8px 0 18px;background:#ede9fe;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;">➕ Novo recurso</button>';

        h += '<h4 style="margin:0 0 6px;">Disciplinas que usam recursos</h4><p style="font-size:12px;color:#64748b;margin:0 0 8px;">Ex.: as plataformas obrigatórias. "Todas" = todas as aulas da disciplina no recurso; um número = quantas aulas por semana. Séries vazio = vale para todas (ou escreva, separado por vírgula: 6, 7, 1NEM, 9A...).</p>';
        h += '<table style="width:100%;border-collapse:collapse;font-size:13px;"><tr style="background:#ede9fe;"><th style="padding:6px;text-align:left;">Disciplina</th><th style="padding:6px;text-align:left;">Recurso</th><th style="padding:6px;width:110px;">Aulas/semana</th><th style="padding:6px;text-align:left;">Séries</th><th></th></tr>';
        const disciplinas = disciplinasConhecidas();
        h += '<datalist id="lista-disciplinas-rec">' + disciplinas.map(d => '<option value="' + esc(d) + '">').join('') + '</datalist>';
        edicaoRec.disciplinas.forEach((d, i) => {
            h += '<tr><td style="padding:3px;"><input list="lista-disciplinas-rec" style="' + inp + '" value="' + esc(d.disciplina) + '" onchange="editarRecurso(\'disciplinas\',' + i + ',\'disciplina\',this.value)"></td>' +
                '<td style="padding:3px;"><select style="' + inp + '" onchange="editarRecurso(\'disciplinas\',' + i + ',\'recurso\',this.value)">' +
                (nomes.includes(d.recurso) ? '' : '<option value="">— escolha —</option>') +
                nomes.map(n => '<option' + (n === d.recurso ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select></td>' +
                '<td style="padding:3px;"><input list="lista-aulas-rec" style="' + inp + '" value="' + esc(d.aulas) + '" onchange="editarRecurso(\'disciplinas\',' + i + ',\'aulas\',this.value)"></td>' +
                '<td style="padding:3px;"><input style="' + inp + '" placeholder="todas" value="' + esc(d.series || '') + '" onchange="editarRecurso(\'disciplinas\',' + i + ',\'series\',this.value)"></td>' +
                '<td><button title="Excluir" onclick="removerRecurso(\'disciplinas\',' + i + ')" style="background:none;border:none;cursor:pointer;font-size:16px;">🗑️</button></td></tr>';
        });
        h += '</table><datalist id="lista-aulas-rec"><option value="Todas"><option value="1"><option value="2"></datalist>';
        h += '<button onclick="adicionarRecurso(\'disciplinas\')" style="margin-top:8px;background:#ede9fe;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;">➕ Nova disciplina</button>';
        area.innerHTML = h;
    }

    function editarRecurso(lista, i, campo, valor) {
        const antigo = edicaoRec[lista][i][campo];
        edicaoRec[lista][i][campo] = valor;
        // renomeou um recurso: leva as disciplinas junto
        if (lista === 'recursos' && campo === 'recurso') edicaoRec.disciplinas.forEach(d => { if (d.recurso === antigo) d.recurso = valor; });
        if (lista === 'recursos') desenharRecursos();
    }
    function adicionarRecurso(lista) {
        edicaoRec[lista].push(lista === 'recursos' ? { recurso: '', simultaneas: 1, obs: '' } : { disciplina: '', recurso: (edicaoRec.recursos[0] || {}).recurso || '', aulas: '1', series: '' });
        desenharRecursos();
    }
    function removerRecurso(lista, i) {
        const item = edicaoRec[lista][i];
        if (lista === 'recursos' && edicaoRec.disciplinas.some(d => d.recurso === item.recurso) &&
            !confirm('Há disciplinas usando "' + item.recurso + '". Excluir o recurso e essas linhas?')) return;
        edicaoRec[lista].splice(i, 1);
        if (lista === 'recursos') edicaoRec.disciplinas = edicaoRec.disciplinas.filter(d => d.recurso !== item.recurso);
        desenharRecursos();
    }

    async function salvarRecursos() {
        const btn = document.getElementById('btn-salvar-recursos');
        btn.disabled = true; btn.innerText = '⏳ Salvando...';
        try {
            const resp = await global.fetchAutenticado(URL(), { operacao: 'RECURSOS_SALVAR', recursos: edicaoRec.recursos, disciplinas: edicaoRec.disciplinas });
            const r = await resp.json();
            if (r.status === 'success') {
                est.cfg = { status: 'success', recursos: edicaoRec.recursos.filter(x => x.recurso), disciplinas: edicaoRec.disciplinas.filter(x => x.disciplina) };
                est.cfgPadrao = false;
                document.getElementById('modal-recursos').style.display = 'none';
                if (est.turma) renderizarGrade();
                toast('✅ Recursos salvos!', 'success');
            } else {
                alert('❌ ' + (r.message || 'Não foi possível salvar.'));
            }
        } catch (e) {
            alert('❌ Erro de conexão.');
        } finally {
            btn.disabled = false; btn.innerText = '💾 Salvar recursos';
        }
    }


    // ------------------------------------------------------------------
    //  Modo "Professores": hora-atividade
    // ------------------------------------------------------------------
    const TIPOS_HA = ['H.A. - Planejamento', 'H.A. - Formação', 'H.A. - Atendimento', 'H.A. - Concentrada'];

    function trocarModoGestao(modo) {
        if (modo === est.modo) return;
        if ((est.alterado || est.haAlterado) && !confirm('Há mudanças não salvas. Trocar mesmo assim?')) return;
        est.modo = modo; est.alterado = false; est.haAlterado = false;
        document.getElementById('btn-modo-turma').style.opacity = modo === 'turma' ? '1' : '.55';
        document.getElementById('btn-modo-prof').style.opacity = modo === 'professor' ? '1' : '.55';
        document.querySelectorAll('.so-turma').forEach(el => { el.style.display = modo === 'turma' ? '' : 'none'; });
        document.querySelectorAll('.so-prof').forEach(el => { el.style.display = modo === 'professor' ? '' : 'none'; });
        if (modo === 'professor') { preencherProfessores(); renderizarProfessor(); }
        else { carregarGradeEdicao(true); }
    }

    function haDe(nome) { return est.ha.filter(h => norm(h.professor) === norm(nome)).map(h => ({ turno: h.turno || 'Manhã', dia: h.dia, aula: h.aula, tipo: h.tipo || 'H.A. - Planejamento' })); }

    function preencherProfessores() {
        const nomes = [...new Set(est.todas.map(h => h.professor).filter(Boolean).concat(est.professores.map(p => p.nome)))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
        const sel = document.getElementById('gestao-professor');
        sel.innerHTML = '<option value="">Selecione um professor...</option>' + nomes.map(n => {
            const r = regencia(n, est.todas), e = haEsperada(r), m = haDe(n).length;
            const marca = !r ? '' : (m === e ? ' ✓' : (m < e ? ' ⚠️' : ' ▲'));
            return '<option value="' + esc(n) + '"' + (n === est.prof ? ' selected' : '') + '>' + esc(n) + ' — ' + r + ' aulas, H.A. ' + m + '/' + e + marca + '</option>';
        }).join('');
    }

    function trocarProfessorGestao() {
        if (est.haAlterado && !confirm('Há horas-atividade não salvas. Trocar de professor mesmo assim?')) { document.getElementById('gestao-professor').value = est.prof; return; }
        est.prof = document.getElementById('gestao-professor').value;
        est.haEdit = haDe(est.prof);
        est.haAlterado = false;
        const aulas = aulasDoProfessor(est.prof, est.todas);
        if (aulas.length && !aulas.some(a => a.turno === est.turno)) { est.turno = aulas[0].turno; document.getElementById('gestao-turno').value = est.turno; }
        renderizarProfessor();
    }

    function renderizarProfessor() {
        const cont = document.getElementById('container-grade');
        if (!est.prof) {
            cont.innerHTML = '<div style="text-align:center;padding:30px;color:#64748b;">Escolha um professor para ver a semana dele e marcar as horas-atividade.</div>';
            renderizarResumoHA();
            return;
        }
        const aulas = aulasDoProfessor(est.prof, est.todas);
        const perfil = est.professores.find(p => norm(p.nome) === norm(est.prof)) || {};
        let html = '<table style="width:100%;border-collapse:collapse;font-size:12px;background:white;"><thead><tr style="background:#7c3aed;color:white;"><th style="padding:8px;">Aula</th>';
        DIAS.forEach(d => { html += '<th style="padding:8px;">' + d + '</th>'; });
        html += '</tr></thead><tbody>';
        AULAS.forEach((aula, i) => {
            html += '<tr><td style="padding:6px;background:#f8fafc;font-weight:bold;text-align:center;">' + aula + '<br><small style="font-weight:normal;color:#64748b;">' + HORARIOS_FIXOS[est.turno][i] + '</small></td>';
            DIAS.forEach(dia => {
                const aqui = aulas.filter(a => a.turno === est.turno && a.dia === dia && a.aula === aula);
                const ha = est.haEdit.find(h => h.turno === est.turno && h.dia === dia && h.aula === aula);
                const a = "'" + dia + "','" + aula + "'";
                let bg = '#f0fdf4', conteudo = '';
                aqui.forEach(x => { conteudo += '<div style="font-weight:bold;color:#1e293b;">' + esc(x.turma) + (x.apoio ? ' <small>(apoio)</small>' : '') + '</div><div style="color:#475569;font-size:11px;">' + esc(x.disciplina) + '</div>'; });
                if (aqui.length) bg = '#eef2ff';
                if (ha) {
                    bg = aqui.length ? '#fee2e2' : '#f3e8ff';
                    conteudo += '<select onchange="mudarTipoHA(' + a + ',this.value)" style="width:100%;font-size:11px;padding:2px;border:1px solid #c4b5fd;border-radius:4px;margin-top:2px;">' +
                        TIPOS_HA.concat(TIPOS_HA.includes(ha.tipo) ? [] : [ha.tipo]).map(t => '<option' + (t === ha.tipo ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select>' +
                        '<button onclick="alternarHA(' + a + ')" style="margin-top:2px;width:100%;font-size:11px;border:none;background:#ede9fe;border-radius:4px;cursor:pointer;">✕ tirar H.A.</button>';
                    if (aqui.length) conteudo += '<div style="color:#b91c1c;font-size:10px;">🔴 H.A. em horário de aula</div>';
                } else if (!aqui.length) {
                    const restrito = perfil.restricoes && norm(perfil.restricoes).includes(norm(dia));
                    conteudo = '<button onclick="alternarHA(' + a + ')" style="width:100%;height:100%;min-height:38px;border:1px dashed #c4b5fd;background:transparent;color:#7c3aed;border-radius:4px;cursor:pointer;font-size:11px;">+ H.A.' + (restrito ? '<br><small style="color:#b45309;">restrição</small>' : '') + '</button>';
                }
                html += '<td style="padding:4px;background:' + bg + ';border:1px solid #e2e8f0;min-width:120px;vertical-align:top;">' + conteudo + '</td>';
            });
            html += '</tr>';
            if (aula === '3ª') html += '<tr style="background:#fef3c7;"><td colspan="6" style="text-align:center;font-weight:bold;padding:4px;">☕ INTERVALO — ' + INTERVALO[est.turno] + '</td></tr>';
        });
        html += '</tbody></table>';
        cont.innerHTML = html;
        renderizarResumoHA();
    }

    function renderizarResumoHA() {
        const painel = document.getElementById('painel-conflitos');
        let html = '';
        if (est.prof) {
            const r = regencia(est.prof, est.todas), e = haEsperada(r), m = est.haEdit.length;
            const outroTurno = est.haEdit.filter(h => h.turno !== est.turno).length;
            const cor = m === e ? '#dcfce7' : (m < e ? '#fef3c7' : '#e0e7ff');
            html += '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:13px;margin-bottom:10px;">' +
                '<span style="background:#ede9fe;padding:6px 10px;border-radius:6px;"><b>' + r + '</b> aulas de regência</span>' +
                '<span style="background:' + cor + ';padding:6px 10px;border-radius:6px;">H.A.: <b>' + m + '</b> de <b>' + e + '</b> pela tabela' + (m < e ? ' — faltam ' + (e - m) : m > e ? ' — ' + (m - e) + ' a mais' : ' ✓') + '</span>' +
                (outroTurno ? '<span style="color:#64748b;">(' + outroTurno + ' no outro turno)</span>' : '') +
                (est.haAlterado ? '<span style="background:#fde68a;padding:6px 10px;border-radius:6px;">✏️ não salvo</span>' : '') +
                '<button onclick="sugerirHAProfessor()" style="background:#7c3aed;color:white;border:none;padding:7px 12px;border-radius:6px;cursor:pointer;font-weight:bold;margin-left:auto;">✨ Sugerir as que faltam</button>' +
                '<button onclick="salvarHAProfessor()" id="btn-salvar-ha" style="background:#22c55e;color:white;border:none;padding:7px 12px;border-radius:6px;cursor:pointer;font-weight:bold;">💾 Salvar H.A.</button></div>';
        }
        // visão geral da escola
        const nomes = [...new Set(est.todas.map(h => h.professor).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
        const linhas = nomes.map(n => { const r = regencia(n, est.todas); return { n, r, e: haEsperada(r), m: haDe(n).length }; }).filter(x => x.r);
        const pend = linhas.filter(x => x.m !== x.e);
        html += '<details' + (est.prof ? '' : ' open') + ' style="font-size:12px;"><summary style="cursor:pointer;font-weight:bold;">Todos os professores — ' + (pend.length ? pend.length + ' com H.A. diferente da tabela' : 'todos de acordo com a tabela ✓') + '</summary>' +
            '<table style="width:100%;border-collapse:collapse;margin-top:6px;"><tr style="background:#ede9fe;"><th style="text-align:left;padding:4px;">Professor</th><th>Aulas</th><th>H.A. pela tabela</th><th>H.A. marcadas</th><th></th></tr>' +
            linhas.map(x => '<tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:4px;">' + esc(x.n) + '</td><td style="text-align:center;">' + x.r + '</td><td style="text-align:center;">' + x.e + '</td>' +
                '<td style="text-align:center;font-weight:bold;color:' + (x.m === x.e ? '#15803d' : '#b45309') + ';">' + x.m + '</td>' +
                '<td><button onclick="abrirProfessorHA(\'' + esc(x.n).replace(/'/g, '&#39;') + '\')" style="border:none;background:#ede9fe;border-radius:4px;cursor:pointer;padding:2px 8px;">abrir</button></td></tr>').join('') + '</table></details>';
        painel.innerHTML = html;
    }

    function abrirProfessorHA(nome) {
        const sel = document.getElementById('gestao-professor');
        sel.value = nome;
        if (sel.value !== nome) return;
        trocarProfessorGestao();
    }

    function alternarHA(dia, aula) {
        const i = est.haEdit.findIndex(h => h.turno === est.turno && h.dia === dia && h.aula === aula);
        if (i >= 0) est.haEdit.splice(i, 1);
        else est.haEdit.push({ turno: est.turno, dia, aula, tipo: TIPOS_HA[0] });
        est.haAlterado = true;
        renderizarProfessor();
    }
    function mudarTipoHA(dia, aula, tipo) {
        const h = est.haEdit.find(x => x.turno === est.turno && x.dia === dia && x.aula === aula);
        if (h) { h.tipo = tipo; est.haAlterado = true; renderizarResumoHA(); }
    }
    function sugerirHAProfessor() {
        const perfil = est.professores.find(p => norm(p.nome) === norm(est.prof));
        const novas = sugerirHA(est.prof, est.todas, est.haEdit, perfil);
        if (!novas.length) { alert('Nada a sugerir: o professor já tem as horas-atividade da tabela (ou não há horário livre).'); return; }
        est.haEdit = est.haEdit.concat(novas);
        est.haAlterado = true;
        renderizarProfessor();
        toast('✨ ' + novas.length + ' hora(s)-atividade sugeridas. Confira e clique em Salvar H.A.');
    }
    async function salvarHAProfessor(ignorar) {
        const btn = document.getElementById('btn-salvar-ha');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Salvando...'; }
        try {
            const r = await (await global.fetchAutenticado(URL(), { operacao: 'HA_SALVAR', professor: est.prof, itens: est.haEdit, ignorarConflitos: !!ignorar })).json();
            if (r.status === 'conflito') {
                if (confirm('⚠️ Hora-atividade em horário de aula:\n\n' + r.conflitos.map(c => c.dia + ' ' + c.aula + ' — ' + c.texto).join('\n') + '\n\nSalvar mesmo assim?')) return salvarHAProfessor(true);
            } else if (r.status === 'success') {
                est.ha = est.ha.filter(h => norm(h.professor) !== norm(est.prof))
                    .concat(est.haEdit.map(h => Object.assign({ professor: est.prof, horario: HORARIOS_FIXOS[h.turno][AULAS.indexOf(h.aula)] }, h)));
                est.haAlterado = false;
                preencherProfessores();
                renderizarProfessor();
                toast('✅ Horas-atividade de ' + est.prof + ' salvas (' + r.horas + ').');
            } else alert('❌ ' + (r.message || 'Não foi possível salvar.'));
        } catch (e) { alert('❌ Erro de conexão.'); }
        finally { const b = document.getElementById('btn-salvar-ha'); if (b) { b.disabled = false; b.textContent = '💾 Salvar H.A.'; } }
    }

    Object.assign(global, { trocarModoGestao, trocarProfessorGestao, abrirProfessorHA, alternarHA, mudarTipoHA, sugerirHAProfessor, salvarHAProfessor, abrirGestaoHorarios, trocarTurmaGestao, carregarGradeEdicao, atualizarCelula, salvarGradeAtual,
        autoPreencherGrade, limparGrade, fecharModalGestaoHorarios, abrirRecursos, editarRecurso, adicionarRecurso,
        removerRecurso, salvarRecursos });
})(typeof window !== 'undefined' ? window : globalThis);
