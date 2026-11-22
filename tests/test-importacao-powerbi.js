// Testa a importação do Power BI ("Presente na Escola" da SEED) na tela frequencia-semana.html,
// com as turmas e números reais das capturas de tela de 22/11/2026.
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','frequencia-semana.html'),'utf8');
const code=[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
function el(){return{value:'',innerHTML:'',textContent:'',style:{},dataset:{},classList:{_s:new Set(),add(c){this._s.add(c)},remove(c){this._s.delete(c)},contains(c){return this._s.has(c)},toggle(c,f){f?this._s.add(c):this._s.delete(c)}},scrollIntoView(){},addEventListener(){}}}
const els={}; let inputs=[];
const ctx={console,JSON,Math,String,Number,Array,Object,parseFloat,parseInt,isNaN,RegExp,Promise,alert:m=>{throw new Error('alert: '+m)},
 escaparHTML:s=>String(s),SIGA_CONFIG:{APPS_SCRIPT_URL:'x'},sessionStorage:{getItem:()=>null},localStorage:{getItem:()=>null},location:{},
 document:{getElementById:id=>els[id]||(els[id]=el()),querySelector:()=>el(),querySelectorAll:q=>q.includes('freq')?inputs:(q.includes('mudou')?inputs.filter(i=>i.classList.contains('mudou')):[]),createElement:el,head:{appendChild(){}}},
 addEventListener(){}}; ctx.window=ctx;
vm.createContext(ctx); vm.runInContext(code,ctx);
// Aba "frequencia" da escola (captura de tela)
const planilha=[['6º A - EF',''],['6º B - EF',''],['6º C - EF',''],['7º A - EF',''],['7º B - EF',''],['7º C - EF',''],['7º D - EF',''],['8º A - EF',''],['8º B - EF',''],['8º C - EF',''],['8º D - EF',''],['9º A - EF',''],['9º B - EF',''],['9º C - EF',''],
 ['1º A - NEM','2625700'],['1º A - FD','2674520'],['1º A - AGRO','2626542'],['2º A - NEM','2625721'],['2º A - FD','2636929'],['3º A - NEM','2625776/775'],['3º A - FD','2625642/643'],['3º B - NEM','2625837/836']];
const turmas=planilha.map((t,i)=>({linha:i+2,turma:t[0],codigo:t[1],bloco:'',freq:80,trofeus:0}));
vm.runInContext('dados='+JSON.stringify({turmas}),ctx);
const reset=()=>{inputs=turmas.map((_,i)=>{const e=el();e.dataset.i=String(i);e.classList.add('freq');return e});};
// Linhas do Power BI (Turma | codturma | Alunos Ativos | (%) Presença | Σ Presenças | Σ Aulas)
const bi=[
 ['6º Série A Manhã - 2624496',2624496,30,'90,89%','28.527','31.384'],['6º Série B Tarde - 2624619',2624619,30,'93,33%','28.834','30.886'],
 ['6º Série C Tarde - 2624645',2624645,31,'93,35%','29.200','31.280'],['7º Série A Manhã - 2624519',2624519,31,'89,02%','28.408','31.911'],
 ['7º Série B Tarde - 2624665',2624665,25,'89,35%','22.405','25.075'],['7º Série C Tarde - 2624687',2624687,24,'92,45%','20.809','22.508'],
 ['7º Série D Tarde - 2624935',2624935,18,'91,30%','16.943','18.556'],['8º Série A Manhã - 2624561',2624561,31,'91,22%','29.448','32.279'],
 ['8º Série B Tarde - 2625034',2625034,25,'92,11%','24.439','26.531'],['8º Série C Tarde - 2625053',2625053,26,'89,17%','20.170','22.619'],
 ['8º Série D Tarde - 2684432',2684432,26,'84,84%','21.046','24.805'],['9º Série A Manhã - 2624594',2624594,35,'85,39%','31.364','36.727'],
 ['9º Série B Tarde - 2625310',2625310,28,'86,47%','22.231','25.709'],['9º Série C Tarde - 2628250',2628250,28,'84,46%','21.639','25.618'],
 ['1º Série A Integral - 2674520',2674520,29,'90,13%','33.313','36.961'],['1º Série A Manhã - 2626542',2626542,32,'88,93%','30.476','34.269'],
 ['1º Série A Manhã - 2625700',2625700,32,'75,79%','20.315','26.803'],['2º Série A Integral - 2636929',2636929,26,'87,08%','29.173','33.501'],
 ['2º Série A Manhã - 2625721',2625721,33,'81,79%','26.295','32.147'],
 ['3º Série A Manhã - 2625776',2625776,9,'89,94%','3.231','3.592'],['3º Série A Manhã - 2625775',2625775,9,'88,62%','4.604','5.195'],
 ['3º Série A Integral - 2625642',2625642,22,'85,81%','18.388','21.428'],['3º Série A Integral - 2625643',2625643,22,'85,52%','9.238','10.802'],
 ['3º Série B Manhã - 2625837',2625837,18,'88,84%','6.348','7.145'],['3º Série B Manhã - 2625836',2625836,18,'84,87%','9.045','10.657'],
 ['Sem Seriação B Tarde - 2738001',2738001,4,'84,39%','584','692'],['2º Período A Tarde - 2774605',2774605,1,'100,00%','48','48'],
 ['3º Período A Tarde - 2798962',2798962,1,'','',''],['',' ',587,'88,12%','542.701','615.824']];
const cab=['-','Turma','codturma','Alunos Ativos','(%) Presença','Σ Presenças','Σ Aulas','% Faltas Amparadas'];
const esperado={'6º A - EF':90.89,'7º D - EF':91.3,'9º C - EF':84.46,'1º A - NEM':75.79,'1º A - FD':90.13,'1º A - AGRO':88.93,'2º A - FD':87.08,
 '3º A - NEM':Math.round(100*(3231+4604)/(3592+5195)*100)/100,'3º A - FD':Math.round(100*(18388+9238)/(21428+10802)*100)/100,'3º B - NEM':Math.round(100*(6348+9045)/(7145+10657)*100)/100};
function conferir(rotulo){
 const r=JSON.parse(vm.runInContext('JSON.stringify(casarLinhas())',ctx));
 assert.strictEqual(r.ok.length,22,rotulo+': 22 turmas, veio '+r.ok.length+' '+JSON.stringify(r.ignoradas));
 assert.deepStrictEqual(r.ignoradas,[],rotulo+': nada fora do lugar');
 const por=Object.fromEntries(r.ok.map(o=>[turmas[o.i].turma,o.f]));
 for(const k in esperado) assert.strictEqual(por[k],esperado[k],rotulo+' '+k);
 assert.strictEqual(r.ok.filter(o=>o.linhas===2).length,3,rotulo+': 3 turmas somadas');
}
// 1) "Exportar dados" (.xlsx → números crus) 
reset();
const xlsx=[cab].concat(bi.map(l=>['',l[0],l[1],l[2],l[3]?parseFloat(l[3].replace(',','.'))/100:'',l[4]?parseInt(l[4].replace(/\./g,'')):'',l[5]?parseInt(l[5].replace(/\./g,'')):'','']));
vm.runInContext(`prepararTabela(${JSON.stringify(xlsx)})`,ctx);
assert.strictEqual(els['col-turma'].value,'1','coluna Turma'); assert.strictEqual(els['col-freq'].value,'4','coluna (%) Presença');
conferir('xlsx');
// 2) "Copiar tabela" (texto com tabulação, "90,89%" e ponto de milhar)
reset(); els.colar={value:[cab.join('\t')].concat(bi.map(l=>['',...l,''].join('\t'))).join('\n')};
vm.runInContext('lerColagem()',ctx); conferir('colar');
vm.runInContext('aplicarImportacao()',ctx);
assert.strictEqual(inputs[0].value,'90,89'); assert.strictEqual(inputs[19].value,String(esperado['3º A - NEM']).replace('.',','));
// 3) Formato EXATO do "Copiar seleção" do Presente na Escola (colado pelo professor em 22/11):
//    coluna "-" com número da linha, 18 colunas, código da escola (41004957) na coluna Escola
reset();
const cab18='-\tTurma\tcodturma\tAlunos Ativos\t(%) Presença\tΣ Presenças\tΣ Aulas\t% Faltas Amparadas\tAulas Previstas\tAulas Dadas\t(%) Aulas Dadas\tAmparo Legal Qtde\tEquivalência Seriação\tCurso\tEscola\tMunicípio\tNRE\tSaldo Aulas Dadas';
const linha18=(n,l)=>[n,l[0],l[1],l[2],l[3],l[4],l[5],'0,55%','1.110','1.069','96,3%','15','Fundamental - 6º Ano','ENS FUND - 4033','ANCHIETA, C E C-M-EF M N - 41004957','CRUZEIRO DO OESTE','UMUARAMA','-41'].join('\t');
els.colar={value:[cab18,'1\t2º Período A Tarde - 2774605\t2774605\t1\t100,00%\t48\t48\t\t54\t48\t89,6%\t\tMédio - Sem Equivalencia\tPROG ALUNO MONITOR - 3042\tANCHIETA, C E C-M-EF M N - 41004957\tCRUZEIRO DO OESTE\tUMUARAMA\t-6']
  .concat(bi.filter(l=>l[0]&&l[3]).map((l,i)=>linha18(i+2,l))).join('\n')};
vm.runInContext('lerColagem()',ctx);
assert.strictEqual(els['col-turma'].value,'1'); assert.strictEqual(els['col-freq'].value,'4');
conferir('copiar seleção (formato real)');

// 4) Cópia REAL feita pelo professor no Presente na Escola em 22/11/2026 (25 linhas, só turmas)
reset();
els.colar={value:fs.readFileSync(path.join(__dirname,'exemplos','powerbi-copiar-selecao-2026-11-22.txt'),'utf8')};
vm.runInContext('lerColagem()',ctx);
{ const r=JSON.parse(vm.runInContext('JSON.stringify(casarLinhas())',ctx));
  assert.strictEqual(r.ok.length,22,'cópia real: 22 turmas'); assert.deepStrictEqual(r.ignoradas,[]);
  const media=r.ok.reduce((a,o)=>a+o.f,0)/r.ok.length;
  assert(Math.abs(media-88.12)<0.05,'média ≈ total do Power BI (88,12%): '+media); }

// utilitários
assert.deepStrictEqual(JSON.parse(vm.runInContext('JSON.stringify(codigosDaTurma("2625776/775"))',ctx)),['2625776','2625775']);
assert.strictEqual(vm.runInContext('nomeNormalizado("7º Série D Tarde - 2624935")',ctx),vm.runInContext('nomeNormalizado("7º D - EF")',ctx));
console.log('IMPORTAÇÃO DO POWER BI (dados reais): TODOS OS TESTES PASSARAM');
