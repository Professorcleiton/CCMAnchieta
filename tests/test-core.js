const fs=require('fs');
function mkStore(){const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>m[k]=String(v),removeItem:k=>delete m[k]};}
global.sessionStorage=mkStore(); global.localStorage=mkStore();
global.document={addEventListener(){},querySelectorAll:()=>[]}; global.addEventListener=()=>{};
let navegou=null;
global.location={pathname:'/alertas.html',set href(v){navegou=v},reload(){navegou='reload'}};
const chamadas=[];
let resposta={status:'success',lista:[{aluno:'João <img src=x onerror=alert(1)>',texto:'nota > 7 & "ok" &#60;b&#62;',token:'<keep>'}]};
global.fetch=async (u,init)=>{chamadas.push({u:typeof u==='string'?u:u.url,init});return new Response(JSON.stringify(resposta),{status:200});};
global.window=global;
eval(fs.readFileSync(require('path').join(__dirname,'..','siga-core.js'),'utf8'));
const assert=require('assert');
(async()=>{
  const URL=SIGA_CONFIG.APPS_SCRIPT_URL;
  // sem sessão: sem token
  await fetch(URL+'?aba=alunos'); assert(!/token=/.test(chamadas[0].u));
  localStorage.setItem('sgi_ccma_session',JSON.stringify({token:'tok123456789012345678901',nivel:3}));
  let r=await fetch(URL+'?aba=alunos'); let d=await r.json();
  assert(chamadas[1].u.endsWith('&token=tok123456789012345678901'));
  assert.strictEqual(d.lista[0].aluno,'João ‹img src=x onerror=alert(1)›');
  assert.strictEqual(d.lista[0].texto,'nota › 7 & ”ok” ＆#60;b＆#62;');
  assert.strictEqual(d.lista[0].token,'<keep>');
  // POST adiciona token
  await fetch(URL,{method:'POST',body:JSON.stringify({operacao:'SALVAR',x:1})});
  assert.strictEqual(JSON.parse(chamadas[2].init.body).token,'tok123456789012345678901');
  // LOGIN não recebe token
  await fetch(URL,{method:'POST',body:JSON.stringify({operacao:'LOGIN',email:'a'})});
  assert(!JSON.parse(chamadas[3].init.body).token);
  // não-Apps Script passa direto
  resposta={a:'<b>'}; r=await fetch('https://cdn.example/x.json'); d=await r.json(); assert.strictEqual(d.a,'<b>');
  // unauthorized com token => encerra sessão e redireciona
  resposta={status:'unauthorized',message:'expirou'}; await fetch(URL+'?aba=x');
  assert.strictEqual(localStorage.getItem('sgi_ccma_session'),null); assert.strictEqual(navegou,'restrito.html');
  // unauthorized sem token => não redireciona (sem loop)
  navegou=null; await fetch(URL+'?aba=x'); assert.strictEqual(navegou,null);
  // lerAbaPlanilha: backend novo
  resposta={table:{rows:[{c:[null,{v:'Ana'},{v:'1A'}]}]}}; d=await lerAbaPlanilha('Alunos'); assert.strictEqual(d.table.rows[0].c[1].v,'Ana');
  // lerAbaPlanilha: backend antigo -> fallback gviz
  let n=chamadas.length; resposta={erro:'aba desconhecida'};
  global.fetch; // fetchOriginal is captured mock; next call goes to gviz URL
  d=await lerAbaPlanilha('Alunos').catch(e=>e);
  assert(chamadas[chamadas.length-1].u.includes('/gviz/tq?sheet=Alunos'));
  // escapes
  assert.strictEqual(escaparJSAttr("D'Ávila"),"D\\&#39;Ávila");
  assert.strictEqual(escaparHTML('<a href="x">'),'&lt;a href=&quot;x&quot;&gt;');
  assert.deepStrictEqual(variacoesSenha(' 12.345.678-9 '),['12.345.678-9','123456789']);
  assert.deepStrictEqual(variacoesSenha('abc123'),['abc123','123']);
  assert.strictEqual(validarNovaSenha('12345'),'A senha precisa ter pelo menos 6 caracteres.');
  assert.strictEqual(validarNovaSenha('111111'),'Escolha uma senha menos óbvia.');
  assert.strictEqual(validarNovaSenha('Anch2026'),'');
  console.log('TODOS OS TESTES PASSARAM');
})().catch(e=>{console.error('FALHOU',e);process.exit(1)});
