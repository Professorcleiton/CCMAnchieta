// node tests/test-horarios.js — regras da Gestão de Horários (horarios-gestao.js)
const assert = require('assert');
const H = require('../horarios-gestao.js');

const cfg = {
    recursos: [{ recurso: 'Lab. Informática', simultaneas: 1 }, { recurso: 'Tablets', simultaneas: 2 }],
    disciplinas: [
        { disciplina: 'Robótica', recurso: 'Lab. Informática', aulas: 'Todas', series: '' },
        { disciplina: 'Matemática', recurso: 'Lab. Informática', aulas: '1', series: '6, 7' },
        { disciplina: 'REC MAT', recurso: 'Tablets', aulas: '1', series: '' }
    ]
};

// séries e locais
assert.strictEqual(H.serieDaTurma('6A'), '6');
assert.strictEqual(H.serieDaTurma('3ANEM'), '3NEM');
assert.strictEqual(H.serieDaTurma('1NEM'), '1NEM');
assert.strictEqual(H.serieDaTurma('2AGRO'), '2AGRO');
assert.strictEqual(H.serieDaTurma('3FD'), '3FD');
assert.strictEqual(H.recursoDoLocal('Lab', cfg.recursos), 'Lab. Informática', 'nome antigo');
assert.strictEqual(H.recursoDoLocal('Laboratório', cfg.recursos), 'Lab. Informática');
assert.strictEqual(H.recursoDoLocal('Tablet', cfg.recursos), 'Tablets');
assert.strictEqual(H.recursoDoLocal('Sala 1', cfg.recursos), '');
assert.strictEqual(H.recursoDoLocal('', cfg.recursos), '');
assert(H.regraDaDisciplina('Matemática', '6B', cfg));
assert.strictEqual(H.regraDaDisciplina('Matemática', '8A', cfg), null, 'regra só vale para 6 e 7');

// conflitos
const outras = [
    { turno: 'Manhã', turma: '7B', dia: 'Segunda', aula: '1ª', disciplina: 'Ciências', professor: 'Davi', local: 'Lab' },
    { turno: 'Manhã', turma: '8A', dia: 'Segunda', aula: '2ª', disciplina: 'REC MAT', professor: 'Eva', local: 'Tablet' },
    { turno: 'Manhã', turma: '8B', dia: 'Segunda', aula: '3ª', disciplina: 'História', professor: 'Fábio', local: '', professor_apoio: 'Ana' },
    { turno: 'Tarde', turma: '9A', dia: 'Segunda', aula: '1ª', disciplina: 'Arte', professor: 'Ana', local: 'Lab' }
];
const grade = H.gradeVazia();
grade.Segunda['1ª'] = { disciplina: 'Matemática', professor: 'Davi', local: 'Lab. Informática' };   // prof + lab ocupados
grade.Segunda['2ª'] = { disciplina: 'REC MAT', professor: 'Gil', local: 'Tablets' };              // 1 de 2 kits: ok
grade.Segunda['3ª'] = { disciplina: 'Matemática', professor: 'Ana', local: '' };                   // Ana é apoio no 8B
grade.Terça['1ª'] = { disciplina: 'Matemática', professor: 'Ana', local: '' };                     // hora-atividade
grade.Sexta['1ª'] = { disciplina: 'Português', professor: 'Caio', local: '' };                     // restrição sexta
grade.Quarta['1ª'] = { disciplina: 'Robótica', professor: 'Hugo', local: '' };                     // devia ser no lab
const an = H.analisarGrade({
    turma: '6A', turno: 'Manhã', grade, outras, cfg,
    professores: [{ nome: 'Caio', restricoes: 'Não pode sexta-feira', max_aulas: 5 }, { nome: 'Ana', turno_pref: 'Manhã', max_aulas: 1 }],
    horasAtividade: [{ turno: 'Manhã', professor: 'Ana', dia: 'Terça', aula: '1ª' }]
});
assert.strictEqual(an.celulas['Segunda|1ª'].conflitos.length, 2, 'professor e laboratório');
assert.strictEqual(an.celulas['Segunda|2ª'], undefined, 'tablets ainda têm kit livre');
assert(an.celulas['Segunda|3ª'].conflitos[0].includes('apoio no 8B'));
assert(an.celulas['Terça|1ª'].alertas.some(a => a.includes('Hora-atividade')));
assert(an.celulas['Sexta|1ª'].alertas.some(a => a.includes('Restrição')));
assert(an.celulas['Segunda|3ª'].alertas.some(a => a.includes('2 aulas na Segunda (máx. 1)')), 'conta a aula da tarde no 9A');
assert(an.gerais.some(g => g.startsWith('Robótica: 0 de 1')));
assert(an.gerais.some(g => g.startsWith('Matemática: 1 de 1')) === false, 'Matemática já tem 1 no lab');

// sugestão de professor
const todas = [
    { turma: '6B', disciplina: 'Geografia', professor: 'Íris' },
    { turma: '6C', disciplina: 'Geografia', professor: 'Íris' },
    { turma: '7A', disciplina: 'Geografia', professor: 'Júlio' },
    { turma: '6A', disciplina: 'Inglês', professor: 'Kátia' }
];
assert.strictEqual(H.sugerirProfessor('Inglês', '6A', H.gradeVazia(), todas, []), 'Kátia', 'quem já dá na turma');
assert.strictEqual(H.sugerirProfessor('Geografia', '6A', H.gradeVazia(), todas, []), 'Íris', 'mais turmas da mesma série');
assert.strictEqual(H.sugerirProfessor('Física', '6A', H.gradeVazia(), todas, [{ nome: 'Leo', disciplinas: 'Física, Química' }]), 'Leo', 'único habilitado');

// distribuição automática: escola com 4 turmas de manhã, professores compartilhados
const matriz = { 'Português': 5, 'Matemática': 5, 'Ciências': 3, 'História': 3, 'Geografia': 3, 'Inglês': 2, 'Arte': 2, 'Ed. Física': 2, 'Robótica': 2, 'REC MAT': 1, 'Redação': 2 };
const profDe = { 'Português': 'P1', 'Matemática': 'M1', 'Ciências': 'C1', 'História': 'H1', 'Geografia': 'G1', 'Inglês': 'I1', 'Arte': 'A1', 'Ed. Física': 'E1', 'Robótica': 'R1', 'REC MAT': 'M1', 'Redação': 'P1' };
const professores = Object.values(profDe).map(n => ({ nome: n, max_aulas: 6, geminadas: n === 'E1' ? 'Sim' : 'Não' }));
let escola = [];
for (const turma of ['6A', '6B', '7A', '7B']) {
    const aulas = [];
    Object.keys(matriz).forEach(d => {
        for (let i = 0; i < matriz[d]; i++) {
            const local = d === 'Robótica' ? 'Lab. Informática' : (d === 'REC MAT' ? 'Tablets' : '');
            aulas.push({ disciplina: d, professor: profDe[d] + (['Português', 'Matemática'].includes(d) && turma.startsWith('7') ? 'b' : ''), local });
        }
    });
    assert.strictEqual(aulas.length, 30);
    const r = H.distribuirAulas(aulas, { turma, turno: 'Manhã', outras: escola, cfg, professores, horasAtividade: [{ turno: 'Manhã', professor: 'C1', dia: 'Segunda', aula: '1ª' }] });
    assert.strictEqual(r.sobraram.length, 0, turma + ': todas as aulas couberam (' + r.sobraram.map(a => a.disciplina).join(',') + ')');
    const novas = [];
    H.DIAS.forEach(dia => H.AULAS.forEach(aula => { const c = r.grade[dia][aula]; if (c.disciplina) novas.push(Object.assign({ turno: 'Manhã', turma, dia, aula }, c)); }));
    // nenhuma disciplina mais de 2x no dia; Ed. Física geminada
    H.DIAS.forEach(dia => {
        const cont = {};
        H.AULAS.forEach(aula => { const d = r.grade[dia][aula].disciplina; cont[d] = (cont[d] || 0) + 1; });
        Object.keys(cont).forEach(d => assert(cont[d] <= 2, turma + ' ' + dia + ' ' + d + ' ' + cont[d]));
    });
    escola = escola.concat(novas);
    const an2 = H.analisarGrade({ turma, turno: 'Manhã', grade: r.grade, outras: escola.filter(h => h.turma !== turma), cfg, professores, horasAtividade: [] });
    Object.values(an2.celulas).forEach(i => assert.strictEqual(i.conflitos.length, 0, turma + ' sem conflitos'));
}
// professor C1 nunca na hora-atividade
assert(!escola.some(h => h.professor === 'C1' && h.dia === 'Segunda' && h.aula === '1ª'));
// lab nunca com 2 turmas
const labs = {};
escola.filter(h => h.local === 'Lab. Informática').forEach(h => { const k = h.dia + h.aula; labs[k] = (labs[k] || 0) + 1; });
assert(Object.values(labs).every(n => n === 1));
// geminadas de E1: as 2 aulas de cada turma no mesmo dia, seguidas
for (const turma of ['6A', '6B', '7A', '7B']) {
    const ef = escola.filter(h => h.turma === turma && h.disciplina === 'Ed. Física');
    assert.strictEqual(ef[0].dia, ef[1].dia, turma + ' Ed. Física no mesmo dia');
    assert.strictEqual(Math.abs(H.AULAS.indexOf(ef[0].aula) - H.AULAS.indexOf(ef[1].aula)), 1);
}

// hora-atividade: tabela oficial e sugestão
const tabela = {1:0,2:0,3:1,4:1,5:2,6:2,7:2,8:2,9:3,10:3,11:4,12:4,13:4,14:4,15:5,16:5,17:5,18:6,19:6,20:6,21:7,22:7,23:7,24:8,25:8,26:8,27:9,28:9,29:10,30:10};
Object.keys(tabela).forEach(n => assert.strictEqual(H.haEsperada(+n), tabela[n], n + ' aulas'));
assert.strictEqual(H.haEsperada(35), 10);
const escolaHA = [];
['Segunda', 'Terça', 'Quarta'].forEach(d => ['1ª', '2ª', '4ª', '5ª'].forEach(a => escolaHA.push({ turno: 'Manhã', turma: '6A', dia: d, aula: a, disciplina: 'Mat', professor: 'Zé' })));
escolaHA.push({ turno: 'Manhã', turma: '7A', dia: 'Quinta', aula: '1ª', disciplina: 'Mat', professor: 'Outro', professor_apoio: 'Zé' });
assert.strictEqual(H.regencia('Zé', escolaHA), 12, 'apoio não conta como regência');
const sug = H.sugerirHA('Zé', escolaHA, [{ turno: 'Manhã', dia: 'Segunda', aula: '3ª' }], { restricoes: 'não pode quarta' });
assert.strictEqual(sug.length, 3, '12 aulas → 4 H.A., já tem 1');
sug.forEach(h => {
    assert(!escolaHA.some(a => a.dia === h.dia && a.aula === h.aula && (a.professor === 'Zé' || a.professor_apoio === 'Zé')), 'não cai em aula');
    assert.notStrictEqual(h.dia, 'Quarta', 'respeita a restrição');
    assert(['Segunda', 'Terça', 'Quinta'].includes(h.dia), 'em dia que já vem à escola (quinta: apoio)');
});
assert(sug.some(h => h.dia === 'Terça' && h.aula === '3ª'), 'prefere a janela entre aulas');
assert.strictEqual(H.sugerirHA('Zé', escolaHA, sug.concat([{ turno: 'Manhã', dia: 'Segunda', aula: '3ª' }]), {}).length, 0);
console.log('HORÁRIOS: TODOS OS TESTES PASSARAM —', escola.length, 'aulas distribuídas sem conflito');
