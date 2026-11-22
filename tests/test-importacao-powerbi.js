const fs=require('fs'),vm=require('vm'),assert=require('assert');
// Testa a importação do Power BI da tela frequencia-semana.html
const html=fs.readFileSync(require('path').join(__dirname,'..','frequencia-semana.html'),'utf8');
const code=[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
function el(){return{value:'',innerHTML:'',textContent:'',style:{},dataset:{},classList:{_s:new Set(),add(c){this._s.add(c)},remove(c){this._s.delete(c)},contains(c){return this._s.has(c)},toggle(c,f){f?this._s.add(c):this._s.delete(c)}},scrollIntoView(){},addEventListener(){}}}
const els={}; let inputs=[];
const ctx={console,JSON,Math,String,Number,Array,Object,parseFloat,parseInt,isNaN,RegExp,Promise,alert:m=>{throw new Error('alert: '+m)},
 escaparHTML:s=>String(s),SIGA_CONFIG:{APPS_SCRIPT_URL:'x'},sessionStorage:{getItem:()=>null},localStorage:{getItem:()=>null},location:{},
 document:{getElementById:id=>els[id]||(els[id]=el()),querySelector:()=>el(),querySelectorAll:q=>q.includes('freq')?inputs:(q.includes('mudou')?inputs.filter(i=>i.classList.contains('mudou')):[]),createElement:el,head:{appendChild(){}}},
 addEventListener(){}}; ctx.window=ctx;
vm.createContext(ctx); vm.runInContext(code,ctx);
const turmas=[['6º A - EF','manha',''],['6º B - EF','tarde',''],['9º C - EF','tarde',''],['1º A - NEM','manha','2625700'],['1º A - FD','manha','2674520'],['3º A - NEM','manha','2625776/775'],['3º B - NEM','manha','2625837/836'],['3º A - FD','manha','2625642/643']]
 .map((t,i)=>({linha:i+2,turma:t[0],bloco:t[1],codigo:t[2],freq:80,trofeus:0}));
vm.runInContext('dados='+JSON.stringify({turmas}),ctx);
function reset(){inputs=turmas.map((_,i)=>{const e=el();e.dataset.i=String(i);e.classList.add('freq');return e});}
// --- 1) Exportação .xlsx típica: cabeçalho com título acima, fração, nomes da SEED, linha Total
reset();
vm.runInContext(`prepararTabela(${JSON.stringify([
 ['Frequência por Turma - Ref. 17/11 a 21/11'],[],
 ['NRE','Escola','Cód. Turma','Turma','Turno','Matrículas','% Frequência'],
 ['UMUARAMA','CCM ANCHIETA',2625901,'6º ANO A','MANHÃ',32,0.9126],
 ['UMUARAMA','CCM ANCHIETA',2625902,'6º ANO B','TARDE',30,0.9329],
 ['UMUARAMA','CCM ANCHIETA',2625903,'9º ANO C','TARDE',28,0.8445],
 ['UMUARAMA','CCM ANCHIETA',2625700,'1ª SÉRIE A - NOVO ENSINO MÉDIO','MANHÃ',35,0.8186],
 ['UMUARAMA','CCM ANCHIETA',2674520,'1ª SÉRIE A - FORMAÇÃO DE DOCENTES','MANHÃ',30,0.9078],
 ['UMUARAMA','CCM ANCHIETA',2625775,'3ª SÉRIE A - NOVO ENSINO MÉDIO','MANHÃ',25,0.8921],
 ['UMUARAMA','CCM ANCHIETA',2625836,'3ª SÉRIE B - NOVO ENSINO MÉDIO','MANHÃ',24,0.8444],
 ['UMUARAMA','CCM ANCHIETA',2625643,'3ª SÉRIE A - FORMAÇÃO DE DOCENTES','MANHÃ',20,0.8629],
 ['','','','Total','','224',0.8770]])})`,ctx);
assert.strictEqual(els['col-turma'].value,'3'); assert.strictEqual(els['col-freq'].value,'6');
let r=JSON.parse(vm.runInContext('JSON.stringify(casarLinhas())',ctx));
assert.strictEqual(r.ok.length,8,'todas as 8 turmas: '+JSON.stringify(r)); assert.deepStrictEqual(r.ignoradas,['Total']);
vm.runInContext('aplicarImportacao()',ctx);
assert.deepStrictEqual(inputs.map(i=>i.value),['91,26','93,29','84,45','81,86','90,78','89,21','84,44','86,29']);
assert(inputs.every(i=>i.classList.contains('mudou')),'marcados como alterados');
// --- 2) "Copiar tabela" do Power BI (tabulado, com %), sem códigos, nomes curtos
reset(); els.colar={value:'Turma\tTurno\tFrequência %\n6º ANO A\tMANHÃ\t91,26%\n6º Ano B\tTarde\t93,29%\n1ª Série A NEM\tManhã\t81,86%\n3ª Série B NEM\tManhã\t84,44%\nTotal\t\t87,70%'};
vm.runInContext('lerColagem()',ctx);
r=JSON.parse(vm.runInContext('JSON.stringify(casarLinhas())',ctx));
assert.deepStrictEqual(r.ok.map(o=>[turmas[o.i].turma,o.f]),[['6º A - EF',91.26],['6º B - EF',93.29],['1º A - NEM',81.86],['3º B - NEM',84.44]]);
// --- 3) CSV com ; e vírgula decimal
reset();
vm.runInContext(`prepararTabela(${JSON.stringify([['Turma','Frequencia'],['9º ANO C','84,45'],['3ª SÉRIE A - FORMAÇÃO DE DOCENTES','86,29']])})`,ctx);
r=JSON.parse(vm.runInContext('JSON.stringify(casarLinhas())',ctx));
assert.deepStrictEqual(r.ok.map(o=>turmas[o.i].turma),['9º C - EF','3º A - FD']);
assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(codigosDaTurma("2625776/775"))',ctx)),['2625776','2625775']);
console.log('IMPORTAÇÃO DO POWER BI: TODOS OS TESTES PASSARAM');
