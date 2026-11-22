const fs=require('fs'),crypto=require('crypto'),assert=require('assert');
// ---- mocks Apps Script ----
const cache={};const CacheService={getScriptCache:()=>({get:k=>cache[k]??null,put:(k,v)=>{cache[k]=v},remove:k=>{delete cache[k]}})};
function sheet(rows){return{rows,getDataRange(){return{getValues:()=>rows.map(r=>r.slice())}},appendRow(r){rows.push(r)},setFrozenRows(){},getRange(l,c,nr,nc){return{setValues(v){for(let i=0;i<v[0].length;i++)rows[l-1][c-1+i]=v[0][i]},setValue(v){rows[l-1][c-1]=v}}}}}
const sheets={Alunos:sheet([['id','nome','turma'],[1,'João da Silva','6A'],[2,'Maria Souza','7B']]),Usuarios:sheet([['email','senha'],['prof@x.com','1234']]),Responsaveis:sheet([['email','senha'],['pai@x.com','999999']])};
const SpreadsheetApp={getActive:()=>({getSheetByName:n=>sheets[n]||null,insertSheet:n=>(sheets[n]=sheet([]))})};
const ContentService={MimeType:{JSON:'json'},createTextOutput:s=>({getContent:()=>s,setMimeType(){return this}})};
const Utilities={getUuid:()=>crypto.randomUUID(),DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1},computeDigest:(a,t)=>[...crypto.createHash('sha256').update(t).digest()],base64Encode:b=>Buffer.from(b).toString('base64'),formatDate:d=>String(d)};
const LockService={getScriptLock:()=>({waitLock(){},releaseLock(){}})};
const mails=[];const MailApp={sendEmail:o=>mails.push(o)};
// ---- backend original simulado ----
const out=o=>ContentService.createTextOutput(JSON.stringify(o));
function doGetOriginal(e){const a=e.parameter.aba||e.parameter.operacao;
  if(a==='usuarios')return out([{email:'prof@x.com'}]);
  if(a==='todos_os_dados')return out({apontamentos:[{aluno:'João da Silva',texto:'a'},{aluno:'Maria Souza',texto:'b'}],usuarios:[{email:'segredo'}]});
  return out({ok:a});}
function doPostOriginal(e){const c=JSON.parse(e.postData.contents);
  if(c.operacao==='LOGIN')return out(c.senha==='1234'?{status:'success',nome:'Prof',nivel:1,setor:'professores'}:{status:'error'});
  if(c.operacao==='LOGIN_RESPONSAVEL')return out(c.senha==='999999'?{status:'success',nome:'Pai',alunos:JSON.parse(c._alunos||'["joao da silva","Maria Souza"]')}:{status:'error'});
  if(c.operacao==='CADASTRAR_RESPONSAVEL')return out({status:'success'});
  return out({status:'success',op:c.operacao,quem:c.emailSessao});}
eval(fs.readFileSync(require('path').join(__dirname,'..','backend','seguranca.gs'),'utf8'));
const G=p=>JSON.parse(doGet({parameter:p}).getContent());
const P=b=>JSON.parse(doPost({postData:{contents:JSON.stringify(b)}}).getContent());
// sem token
assert.strictEqual(G({aba:'usuarios'}).status,'unauthorized');
assert.strictEqual(P({operacao:'EXCLUIR'}).status,'unauthorized');
// login servidor
let L=P({operacao:'LOGIN',email:'PROF@x.com',senha:'1234'}); assert.strictEqual(L.status,'success'); const tp=L.token;
assert.strictEqual(P({operacao:'LOGIN',email:'prof@x.com',senha:'errada'}).status,'error');
assert.strictEqual(G({aba:'usuarios',token:tp}).status,'forbidden');          // nível 1 < 3
assert.deepStrictEqual(G({aba:'horarios',token:tp}),{ok:'horarios'});
assert.strictEqual(P({operacao:'USER_DELETAR',token:tp}).status,'forbidden');
assert.strictEqual(P({operacao:'SALVAR',token:tp,email:'falso@x'}).quem,'prof@x.com'); // email da sessão
let t=G({aba:'tabela',nome:'Alunos',token:tp}); assert.strictEqual(t.table.rows[1].c[1].v,'Maria Souza');
assert.strictEqual(G({aba:'tabela',nome:'Usuarios',token:tp}).status,'forbidden');
// responsável legado: entra, alunos resolvidos
let R=P({operacao:'LOGIN_RESPONSAVEL',email:'pai@x.com',senha:'999999'}); assert.strictEqual(R.status,'success');
assert.deepStrictEqual(R.alunos,['João da Silva','Maria Souza']);
// secretaria revoga Maria -> aprova só João
cache['sess_'+'s'.repeat(30)]=JSON.stringify({email:'sec@x',nivel:3,tipo:'servidor',alunos:[]});
const ts='s'.repeat(30);
let lista=G({aba:'responsaveis_cadastros',token:ts}); assert.strictEqual(lista[0].aprovadoPor,'LEGADO - revisar');
assert.strictEqual(P({operacao:'APROVAR_RESPONSAVEL',token:ts,email:'pai@x.com',alunos:['João da Silva','Inventado']}).status,'success');
R=P({operacao:'LOGIN_RESPONSAVEL',email:'pai@x.com',senha:'999999'}); assert.deepStrictEqual(R.alunos,['João da Silva']);
const tr=R.token;
let D=G({operacao:'todos_os_dados',token:tr});
assert.deepStrictEqual(D,{apontamentos:[{aluno:'João da Silva',texto:'a'}]});       // filtrado e sem "usuarios"
assert.strictEqual(G({aba:'usuarios',token:tr}).status,'forbidden');
assert.strictEqual(G({operacao:'listar_documentos_aluno',aluno:'Maria Souza',token:tr}).status,'forbidden');
assert.strictEqual(P({operacao:'EXCLUIR',token:tr}).status,'forbidden');
// cadastro novo -> pendente -> login pendente
assert.strictEqual(P({operacao:'CADASTRAR_RESPONSAVEL',email:'novo@x.com',nome:'N',telefone:'44',filhos:'["maria souza"]'}).status,'pending');
sheets.Responsaveis.rows.push(['novo@x.com','999999']);
assert.strictEqual(P({operacao:'LOGIN_RESPONSAVEL',email:'novo@x.com',senha:'999999'}).status,'pending');
lista=G({aba:'responsaveis_cadastros',token:ts}); const novo=lista.find(v=>v.email==='novo@x.com');
assert.strictEqual(novo.filhos[0].encontrado,true); assert.strictEqual(novo.filhos[0].nomeOficial,'Maria Souza');
// recusar
P({operacao:'RECUSAR_RESPONSAVEL',token:ts,email:'novo@x.com'});
assert.strictEqual(P({operacao:'LOGIN_RESPONSAVEL',email:'novo@x.com',senha:'999999'}).status,'error');
// recuperação de senha
assert.strictEqual(P({operacao:'RECUPERAR_SENHA',email:'prof@x.com',tipo:'servidor'}).status,'success');
assert.strictEqual(P({operacao:'RECUPERAR_SENHA',email:'naoexiste@x.com',tipo:'servidor'}).status,'success'); // neutro
assert.strictEqual(mails.length,1); const cod=mails[0].body.match(/: (\d{6})/)[1];
assert.strictEqual(P({operacao:'REDEFINIR_SENHA',email:'prof@x.com',tipo:'servidor',codigo:'000000',novaSenha:'Nova2026'}).status,'error');
assert.strictEqual(P({operacao:'REDEFINIR_SENHA',email:'prof@x.com',tipo:'servidor',codigo:cod,novaSenha:'Nova2026'}).status,'success');
assert.strictEqual(sheets.Usuarios.rows[1][1],'Nova2026');
assert.strictEqual(P({operacao:'REDEFINIR_SENHA',email:'prof@x.com',tipo:'servidor',codigo:cod,novaSenha:'Outra2026'}).status,'error'); // uso único
// hash
const h=SEG_gerarHashSenha('abc123'); assert(SEG_conferirSenha('abc123',h).ok); assert(!SEG_conferirSenha('abc124',h).ok);
const leg=SEG_conferirSenha('1234','1234'); assert(leg.ok && leg.novoValor.startsWith('sha256$'));
// logout
P({operacao:'LOGOUT',token:tp}); assert.strictEqual(G({aba:'horarios',token:tp}).status,'unauthorized');
assert(sheets.Auditoria.rows.length>5);
console.log('BACKEND: TODOS OS TESTES PASSARAM —', sheets.Auditoria.rows.length-1,'linhas de auditoria');
