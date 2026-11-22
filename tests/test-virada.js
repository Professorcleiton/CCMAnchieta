// node tests/test-virada.js — prévia da Virada do Ano (mesma regra do backend)
const assert = require('assert');
const { planejar } = require('../virada-ano.js');

const alunos = [
    { nome: 'Ana', codigo: '6A' }, { nome: 'Beto', codigo: '6A' }, { nome: 'Caio', codigo: '9A' },
    { nome: 'Dani', codigo: '9A' }, { nome: 'Eva', codigo: '3ANEM' }, { nome: 'Fábio', codigo: '8D' }
];
const atuais = [
    { codigo: '6A', destino: '7A' }, { codigo: '9A', destino: 'ESCOLHA' }, { codigo: '3ANEM', destino: 'EGRESSO' }, { codigo: '8D', destino: '9D' }
];
const proximas = [{ codigo: '7A' }, { codigo: '1NEM' }, { codigo: '1AGRO' }, { codigo: '6A' }];

let p = planejar(alunos, atuais, proximas, {});
assert.strictEqual(p.contagem.Egresso, 1);
assert.strictEqual(p.porTurma['7A'], 2);
assert.deepStrictEqual(p.pendencias.map(x => x.nome), ['Caio', 'Dani', 'Fábio'], '9º sem escolha e 9D inexistente');
assert(p.pendencias.find(x => x.nome === 'Fábio').texto.includes('9D'));

const sit = {
    'caio|9A': { situacao: 'Aprovado', destino: '1NEM' },
    'dani|9A': { situacao: 'Transferido' },
    'beto|6A': { situacao: 'Retido' },
    'fabio|8D': { situacao: 'Aprovado', destino: '1agro' }   // nome sem acento na chave, destino minúsculo
};
p = planejar(alunos, atuais, proximas.concat([{ codigo: '9D', ativa: false }]), sit);
assert.deepStrictEqual(p.contagem, { Aprovado: 3, Retido: 1, Transferido: 1, Desistente: 0, Egresso: 1 });
assert.deepStrictEqual(p.porTurma, { '7A': 1, '1NEM': 1, '6A': 1, '1AGRO': 1 });
assert.strictEqual(p.pendencias.length, 0);
assert.strictEqual(p.alunos.find(a => a.nome === 'Beto').destino, '6A', 'retido fica na série');
console.log('VIRADA DO ANO: TODOS OS TESTES PASSARAM');
