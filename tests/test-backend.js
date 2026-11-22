// Uso: node tests/test-backend.js caminho/para/Codigo.gs
// Testa backend/seguranca.gs junto com o SEU Código.gs (que não fica no repositório).
const fs=require('fs'),crypto=require('crypto'),assert=require('assert'),vm=require('vm'),path=require('path');
const s8=b=>Array.from(b,x=>x>127?x-256:x), u8=a=>Buffer.from(Array.from(a,x=>x&255));
const arquivo=process.argv[2];
if(!arquivo){console.error('Informe o caminho do Código.gs: node tests/test-backend.js Codigo.gs');process.exit(2);}
let codigo=fs.readFileSync(arquivo,'utf8');
codigo=codigo.replace('function doGet(e)','function doGetOriginal(e)').replace('function doPost(e)','function doPostOriginal(e)');
const cache={};
function sheet(name,rows){return{name,rows,getDataRange(){return{getValues:()=>rows.map(r=>r.slice())}},appendRow(r){rows.push(r.slice())},setFrozenRows(){},
 getLastRow(){return rows.length},deleteRow(i){rows.splice(i-1,1)},
 getRange(l,c,nr,nc){return{setValues(v){for(let i=0;i<v[0].length;i++){rows[l-1]=rows[l-1]||[];rows[l-1][c-1+i]=v[0][i]}},setValue(v){rows[l-1][c-1]=v},getValues(){return rows.slice(l-1,l-1+(nr||1)).map(r=>[r[c-1]])},setFontWeight(){return this},setBackground(){return this},setFontColor(){return this}}}}}
const S={};
function add(n,rows){S[n]=sheet(n,rows)}
add('Usuários',[['email','nome','setor','nivel','senha'],['prof@x.com','Prof Ana','professores',1,'1234'],['sec@x.com','Secretaria','secretaria',3,'5555'],['dir@x.com','Diretor','direcao',4,'9999']]);
add('Alunos',[['id','nome','turma','cod'],[1,'JOÃO DA SILVA','6º Ano A','6A'],[2,'MARIA SOUZA','7º Ano B','7B']]);
add('Responsaveis',[['email','nome','senha','tel','aluno','push'],['pai@x.com','Pai','999999','44999','JOÃO DA SILVA','']]);
const regs=[['data','aluno','setor','texto','func']];
for(let i=0;i<250;i++) regs.push([new Date(2026,0,1),'MARIA SOUZA','ped','m'+i,'x']);
regs.splice(1,0,[new Date(2026,0,1),'JOÃO DA SILVA','ped','velho <b>','Prof']);
add('Registros',regs);
const ctx={console,Date,Math,JSON,String,Number,Array,Object,parseInt,Set,
 CacheService:{getScriptCache:()=>({get:k=>cache[k]??null,put:(k,v)=>{cache[k]=v},remove:k=>{delete cache[k]}})},
 SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:n=>S[n]||null,insertSheet:n=>(S[n]=sheet(n,[])),getSheets:()=>Object.values(S)})},
 ContentService:{MimeType:{JSON:'json',TEXT:'text',JAVASCRIPT:'js'},createTextOutput:s=>({c:s,getContent(){return this.c},setMimeType(){return this}})},
 Utilities:{getUuid:()=>crypto.randomUUID(),DigestAlgorithm:{SHA_256:1},MacAlgorithm:{HMAC_SHA_256:1},Charset:{UTF_8:1},
  computeDigest:(a,t)=>s8(crypto.createHash('sha256').update(typeof t==='string'?Buffer.from(t):u8(t)).digest()),
  computeHmacSignature:(a,v,k)=>s8(crypto.createHmac('sha256',u8(k)).update(u8(v)).digest()),
  base64Encode:b=>u8(b).toString('base64'),base64Decode:s=>s8(Buffer.from(s,'base64')),
  base64EncodeWebSafe:b=>(typeof b==='string'?Buffer.from(b):u8(b)).toString('base64').replace(/\+/g,'-').replace(/\//g,'_'),
  base64DecodeWebSafe:s=>s8(Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/'),'base64')),
  newBlob:(d,t,n)=>typeof d==='string'?{getBytes:()=>s8(Buffer.from(d,'utf8'))}:{bytes:d,type:t,name:n},
  formatDate:(d)=>d.toISOString()},
 PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})},
 DriveApp:{arquivos:[],getFolderById(){const self=this;return{createFile(b){const f={nome:b.name,tipo:b.type,setDescription(){},getUrl:()=>'https://drive.google.com/file/d/'+self.arquivos.length};self.arquivos.push(f);return f}}}},
 UrlFetchApp:{calls:[],fetch(u,o){this.calls.push({u,o});return{getResponseCode:()=>201,getContentText:()=>''}}},
 LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
 MailApp:{sent:[],falhar:false,sendEmail(o,a,b){if(this.falhar)throw new Error('Cota diária de e-mail excedida');this.sent.push(typeof o==='object'?o:{to:o,subject:a,body:b})}},
 Logger:{log(){}}};
vm.createContext(ctx);
vm.runInContext(codigo,ctx);
if(!vm.runInContext('typeof PASTA_DOCUMENTOS_ID',ctx).includes('string')) vm.runInContext("var PASTA_DOCUMENTOS_ID='x'",ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','backend','seguranca.gs'),'utf8'),ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','backend','push-e-documentos.gs'),'utf8'),ctx);
const G=p=>JSON.parse(ctx.doGet({parameter:p}).getContent());
const P=b=>{const o=ctx.doPost({parameter:{},postData:{contents:JSON.stringify(b)}}).getContent();try{return JSON.parse(o)}catch(e){return o}};
// --- acesso anônimo bloqueado
for (const a of ['usuarios','todos_os_dados','alunos','patrimonio','']) assert.strictEqual(G({aba:a}).status,'unauthorized',a);
assert.strictEqual(G({operacao:'LOGIN_RESPONSAVEL',email:'pai@x.com',senha:'999999'}).status,'unauthorized'); // rota GET antiga fechada
// --- login servidor (senha antiga) + migração para hash
let L=P({operacao:'LOGIN',email:'prof@x.com',senha:'1234'}); assert.strictEqual(L.status,'success'); assert.strictEqual(L.nivel,1);
assert(S['Usuários'].rows[1][4].startsWith('sha256$'),'senha migrada');
L=P({operacao:'LOGIN',email:'prof@x.com',senha:'1234'}); assert.strictEqual(L.status,'success','login após migração');
assert.strictEqual(P({operacao:'LOGIN',email:'prof@x.com',senha:'0000'}).status,'invalid');
const tp=L.token; assert(S.Sessoes.rows.some(r=>r[0]===tp),'token na aba Sessoes');
// sessão sobrevive sem cache (cai para validarToken do Código.gs)
for (const k of Object.keys(cache)) if(k.startsWith('sess_')) delete cache[k];
assert.strictEqual(G({aba:'horarios',token:tp}).status,'error'); // Horarios não existe no mock -> resposta do código original
assert.strictEqual(G({aba:'usuarios',token:tp}).status,'forbidden');
// professor não lê rascunhos de outro
let capt=null; const orig=ctx.listarRascunhosProfessor; ctx.listarRascunhosProfessor=e=>{capt=e;return[]};
vm.runInContext('listarRascunhosProfessor=this.listarRascunhosProfessor',ctx);
G({aba:'avaliacoes_rascunhos',email:'outro@x.com',token:tp}); assert.strictEqual(capt,'prof@x.com');
// professor nível 1 não pode SALVAR (original exige 2) nem excluir usuário
assert.strictEqual(P({operacao:'SALVAR',token:tp,aluno:'MARIA SOUZA',texto:'x'}).status,'forbidden');
assert.strictEqual(P({operacao:'USER_DELETAR',token:tp,email:'dir@x.com'}).status,'forbidden');
// --- secretaria / direção
const ts=P({operacao:'LOGIN',email:'sec@x.com',senha:'5555'}).token;
assert(Array.isArray(G({aba:'usuarios',token:ts})));
assert.strictEqual(P({operacao:'SALVAR',token:ts,aluno:'JOÃO DA SILVA',setor:'ped',texto:'novo'}).status,'success');
assert.strictEqual(S.Registros.rows.at(-1)[4],'Secretaria','autor vem da sessão');
const td=P({operacao:'LOGIN',email:'dir@x.com',senha:'9999'}).token;
assert.strictEqual(P({operacao:'USER_SALVAR',token:td,email:'novo@x.com',nome:'Novo',setor:'professores',nivel:1,senha:'Anchieta2026'}).status,'success');
assert.strictEqual(P({operacao:'LOGIN',email:'novo@x.com',senha:'Anchieta2026'}).status,'success','senha alfanumérica');
assert.strictEqual(P({operacao:'LOGIN',email:'novo@x.com',senha:'2026'}).status,'invalid','não aceita só os números');
let t=G({aba:'tabela',nome:'Alunos',token:tp}); assert.strictEqual(t.table.rows[0].c[1].v,'JOÃO DA SILVA');
// --- responsável legado
let R=P({operacao:'LOGIN_RESPONSAVEL',email:'pai@x.com',senha:'999999'}); assert.strictEqual(R.status,'success'); assert.deepStrictEqual(R.alunos,['JOÃO DA SILVA']);
assert(S.Responsaveis.rows[1][2].startsWith('sha256$'));
let D=G({operacao:'todos_os_dados',token:R.token});
assert.deepStrictEqual(Object.keys(D),['apontamentos','documentos','ocorrencias','atas']);
assert(D.apontamentos.length>=1 && D.apontamentos.every(a=>a.aluno==='JOÃO DA SILVA'),'só o filho');
assert(D.apontamentos.some(a=>a.texto==='velho <b>'),'registro antigo (fora dos 200) aparece');
assert.strictEqual(G({aba:'alunos',token:R.token}).length,1);
assert.strictEqual(G({operacao:'fatos_emitidos',alunos:'MARIA SOUZA',token:R.token}).status,'forbidden');
assert.strictEqual(P({operacao:'SALVAR',token:R.token}).status,'forbidden');
// push: token de sessão em tokenSessao, e-mail forçado
assert.strictEqual(P({operacao:'salvar_token_push',email:'vitima@x.com',token:'{"endpoint":"x"}',tokenSessao:R.token}).status,'success');
assert.strictEqual(S.Responsaveis.rows[1][5],'{"endpoint":"x"}');
assert.strictEqual(P({operacao:'salvar_token_push',email:'pai@x.com',token:'{"endpoint":"y"}'}).status,'unauthorized');
// --- cadastro novo -> pendente -> aprovação
let C=P({operacao:'CADASTRAR_RESPONSAVEL',email:'mae@x.com',nome:'Mãe',senha:'Familia2026',telefone:'(44) 99999-0000',filhos:['maria souza','Fulano Inexistente']});
assert.strictEqual(C.status,'pending'); assert(/Fulano/.test(C.message));
assert(S.Responsaveis.rows.filter(r=>r[0]==='mae@x.com').every(r=>String(r[2]).startsWith('sha256$')));
assert.strictEqual(P({operacao:'CADASTRAR_RESPONSAVEL',email:'mae@x.com',nome:'X',senha:'outra123',telefone:'(44) 99999-0000',filhos:['maria souza']}).status,'error','e-mail duplicado');
assert.strictEqual(P({operacao:'CADASTRAR_RESPONSAVEL',email:'pai2@x.com',nome:'X',senha:'abc',telefone:'44999990000',filhos:['maria souza']}).status,'error','senha curta');
assert.strictEqual(P({operacao:'LOGIN_RESPONSAVEL',email:'mae@x.com',senha:'Familia2026'}).status,'pending');
let lista=G({aba:'responsaveis_cadastros',token:ts}); const mae=lista.find(v=>v.email==='mae@x.com');
assert.strictEqual(mae.filhos[0].nomeOficial,'MARIA SOUZA'); assert.strictEqual(mae.filhos[1].encontrado,false);
assert.strictEqual(P({operacao:'APROVAR_RESPONSAVEL',token:tp,email:'mae@x.com',alunos:['MARIA SOUZA']}).status,'forbidden','professor não aprova');
assert.strictEqual(P({operacao:'APROVAR_RESPONSAVEL',token:ts,email:'mae@x.com',alunos:['MARIA SOUZA']}).status,'success');
R=P({operacao:'LOGIN_RESPONSAVEL',email:'mae@x.com',senha:'Familia2026'}); assert.deepStrictEqual(R.alunos,['MARIA SOUZA']);
// revogar derruba a sessão na hora
P({operacao:'RECUSAR_RESPONSAVEL',token:ts,email:'mae@x.com'});
assert.strictEqual(G({operacao:'todos_os_dados',token:R.token}).status,'unauthorized');
assert.strictEqual(P({operacao:'LOGIN_RESPONSAVEL',email:'mae@x.com',senha:'Familia2026'}).status,'invalid');
// --- recuperação de senha (responsável com várias linhas)
P({operacao:'RECUPERAR_SENHA',email:'pai@x.com',tipo:'responsavel'});
const cod=ctx.MailApp.sent.at(-1).body.match(/: (\d{6})/)[1];
assert.strictEqual(P({operacao:'REDEFINIR_SENHA',email:'pai@x.com',tipo:'responsavel',codigo:cod,novaSenha:'NovaSenha1'}).status,'success');
assert.strictEqual(P({operacao:'LOGIN_RESPONSAVEL',email:'pai@x.com',senha:'NovaSenha1'}).status,'success');
// --- bloqueio por tentativas (usa o do Código.gs)
for(let i=0;i<3;i++) P({operacao:'LOGIN',email:'sec@x.com',senha:'errada'});
assert.strictEqual(P({operacao:'LOGIN',email:'sec@x.com',senha:'5555'}).status,'blocked');
// logout
P({operacao:'LOGOUT',token:tp}); assert.strictEqual(G({aba:'alunos',token:tp}).status,'unauthorized');
// ===== Documentos (upload_documento) =====
const tpai=P({operacao:'LOGIN_RESPONSAVEL',email:'pai@x.com',senha:'NovaSenha1'}).token;
const pdf=Buffer.concat([Buffer.from('%PDF-1.4\n'),crypto.randomBytes(100)]).toString('base64');
let U=P({operacao:'upload_documento',token:tpai,aluno:'JOÃO DA SILVA',documento:'Comprovante de Residência',nomeArquivo:'conta.pdf',arquivo:pdf});
assert.strictEqual(U.status,'success',JSON.stringify(U));
const docs=S.Documentos_Secretaria.rows; assert.strictEqual(docs.at(-1)[0],'JOÃO DA SILVA'); assert.strictEqual(docs.at(-1)[3],'Enviado'); assert(/drive.google.com/.test(docs.at(-1)[5]));
assert(ctx.MailApp.sent.some(m=>/Documento recebido/.test(m.subject||'')),'aviso à secretaria');
// pedido Pendente existente é atualizado em vez de criar linha nova
docs.push(['JOÃO DA SILVA','6º Ano A','RG','Pendente','01/01/2026','','','']); const nDocs=docs.length;
assert.strictEqual(P({operacao:'upload_documento',token:tpai,aluno:'JOÃO DA SILVA',documento:'RG',nomeArquivo:'rg.pdf',arquivo:pdf}).status,'success');
assert.strictEqual(docs.length,nDocs); assert.strictEqual(docs.at(-1)[3],'Enviado');
assert.strictEqual(P({operacao:'upload_documento',token:tpai,aluno:'MARIA SOUZA',documento:'RG',nomeArquivo:'rg.pdf',arquivo:pdf}).status,'forbidden','filho de outro');
assert.strictEqual(P({operacao:'upload_documento',token:tpai,aluno:'JOÃO DA SILVA',documento:'RG',nomeArquivo:'virus.exe',arquivo:pdf}).status,'error','extensão');
assert.strictEqual(P({operacao:'upload_documento',token:tpai,aluno:'JOÃO DA SILVA',documento:'RG',nomeArquivo:'falso.pdf',arquivo:Buffer.from('MZ....').toString('base64')}).status,'error','conteúdo falso');
assert.strictEqual(P({operacao:'upload_documento',aluno:'JOÃO DA SILVA',documento:'RG',nomeArquivo:'a.pdf',arquivo:pdf}).status,'unauthorized');
assert.strictEqual(ctx.DriveApp.arquivos.length,2);
// ===== Push =====
const sub=JSON.stringify({endpoint:'https://fcm.googleapis.com/fcm/send/abc123',keys:{p256dh:'x',auth:'y'}});
assert.strictEqual(P({operacao:'salvar_token_push',email:'pai@x.com',token:sub,tokenSessao:tpai}).status,'success');
// mãe recusada também tem push salvo — não pode receber
S.Responsaveis.rows.filter(r=>r[0]==='mae@x.com').forEach(r=>r[5]=JSON.stringify({endpoint:'https://fcm.googleapis.com/fcm/send/mae'}));
ctx.UrlFetchApp.calls.length=0; ctx.MailApp.sent.length=0;
const tsec=P({operacao:'LOGIN',email:'sec@x.com',senha:'5555'});
// (sec está bloqueada pelo teste anterior) -> usa direção
const tdir=P({operacao:'LOGIN',email:'dir@x.com',senha:'9999'}).token;
assert.strictEqual(P({operacao:'SALVAR',token:tdir,aluno:'JOÃO DA SILVA',setor:'ped',texto:'Esqueceu o material'}).status,'success');
assert.strictEqual(ctx.UrlFetchApp.calls.length,1,'1 push (pai)'); const call=ctx.UrlFetchApp.calls[0];
assert(call.u.endsWith('/abc123')); assert(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/.test(call.o.headers.Authorization)); assert.strictEqual(call.o.payload,'');
assert(ctx.MailApp.sent.some(m=>m.to==='pai@x.com'),'e-mail ao pai');
P({operacao:'SALVAR',token:tdir,aluno:'MARIA SOUZA',setor:'ped',texto:'x'});
assert(!ctx.UrlFetchApp.calls.some(c=>c.u.endsWith('/mae')),'recusada não recebe push');
assert(!ctx.MailApp.sent.some(m=>m.to==='mae@x.com'),'recusada não recebe e-mail');
// cota de e-mail estourada não derruba o apontamento
ctx.MailApp.falhar=true; const antes=S.Registros.rows.length;
assert.strictEqual(P({operacao:'SALVAR',token:tdir,aluno:'JOÃO DA SILVA',setor:'ped',texto:'y'}).status,'success');
assert.strictEqual(S.Registros.rows.length,antes+1); ctx.MailApp.falhar=false;
// inscrição expirada (410) é removida
ctx.UrlFetchApp.fetch=function(u,o){return{getResponseCode:()=>410,getContentText:()=>'gone'}};
P({operacao:'SALVAR',token:tdir,aluno:'JOÃO DA SILVA',setor:'ped',texto:'z'});
assert.strictEqual(S.Responsaveis.rows.find(r=>r[0]==='pai@x.com')[5],'','inscrição expirada removida');
console.log('INTEGRAÇÃO COM O CÓDIGO.GS REAL: TODOS OS TESTES PASSARAM —',S.Auditoria.rows.length-1,'linhas de auditoria');
