// Uso: node tests/test-backend.js caminho/para/Codigo.gs
// Testa backend/seguranca.gs junto com o SEU Código.gs (que não fica no repositório).
const fs=require('fs'),crypto=require('crypto'),assert=require('assert'),vm=require('vm'),path=require('path');
const s8=b=>Array.from(b,x=>x>127?x-256:x), u8=a=>Buffer.from(Array.from(a,x=>x&255));
const arquivo=process.argv[2];
if(!arquivo){console.error('Informe o caminho do Código.gs: node tests/test-backend.js Codigo.gs');process.exit(2);}
let codigo=fs.readFileSync(arquivo,'utf8');
codigo=codigo.replace('function doGet(e)','function doGetOriginal(e)').replace('function doPost(e)','function doPostOriginal(e)');
const cache={};
let gidSeq=1000;
function sheet(name,rows,gid){return{name,rows,_gid:gid||(gidSeq++),getSheetId(){return this._gid},getDataRange(){return{getValues:()=>rows.map(r=>r.slice())}},appendRow(r){rows.push(r.slice())},setFrozenRows(){},
 getLastRow(){return rows.length},deleteRow(i){rows.splice(i-1,1)},
 getRange(l,c,nr,nc){const bloco=()=>rows.slice(l-1,l-1+(nr||1)).map(r=>Array.from({length:nc||1},(_,k)=>r[c-1+k]===undefined?'':r[c-1+k]));
  return{clearContent(){for(let i=0;i<(nr||1);i++){const r=rows[l-1+i];if(r)for(let k=0;k<(nc||1);k++)r[c-1+k]='';}},setValues(v){v.forEach((linha,di)=>{rows[l-1+di]=rows[l-1+di]||[];linha.forEach((x,i)=>rows[l-1+di][c-1+i]=x)})},setValue(v){rows[l-1][c-1]=v},getValues:bloco,getDisplayValues:()=>bloco().map(r=>r.map(String)),setFontWeight(){return this},setBackground(){return this},setFontColor(){return this}}}}}
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
  formatDate:(d,tz,p)=>p==='yyyy-MM-dd'?[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'):d.toISOString()},
 PropertiesService:{_p:{},getScriptProperties(){const p=this._p;return{getProperty:k=>p[k]??null,setProperty:(k,v)=>{p[k]=v}}}},
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
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','backend','noticias.gs'),'utf8'),ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','backend','frequenciometro.gs'),'utf8'),ctx);
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
const tp2=()=>{ if(!global.__tp2) global.__tp2=P({operacao:'LOGIN',email:'novo@x.com',senha:'Anchieta2026'}).token; return global.__tp2; };
// ===== Contadores anuais (antes: só os últimos 200 da escola) =====
{
  const ano=new Date().getFullYear();
  S.Registros.rows.push([new Date(ano-1,10,5),'MARIA SOUZA','ped','do ano passado','x']);
  S.Registros.rows.push(['15/03/'+ano+' 08:10','JOÃO DA SILVA','ped','data em texto','x']);
  S.Registros.rows.push(['02/12/'+(ano-1)+' 09:00','JOÃO DA SILVA','ped','texto do ano passado','x']);
  S.Atas_Disciplinares=sheet('Atas_Disciplinares',[['data','aluno','num','arq','link']].concat(
    Array.from({length:230},(_,i)=>[new Date(ano,1,1+i%200),'MARIA SOUZA',String(i),'a.pdf','l'])).concat([[new Date(ano-1,5,1),'MARIA SOUZA','velha','a.pdf','l']]));
  S.Fatos_SEED=sheet('Fatos_SEED',[['data','aluno','tipo','desc']].concat([['10/04/'+ano,'JOÃO DA SILVA','Positivo','ok'],['10/04/'+(ano-1),'JOÃO DA SILVA','Negativo','velho']]));
  const tdirA=P({operacao:'LOGIN',email:'dir@x.com',senha:'9999'}).token;
  const D2=G({aba:'todos_os_dados',token:tdirA});
  const doAno=S.Registros.rows.slice(1).filter(r=>r[0]&&r[1]&&(r[0] instanceof Date?r[0].getFullYear()===ano:(String(r[0]).includes('/'+ano)||String(r[0]).startsWith(ano+'-')))).length;
  assert(doAno>200,'cenário com mais de 200 no ano');
  assert.strictEqual(D2.apontamentos.length,doAno,'todos os apontamentos do ano, sem corte de 200');
  assert(!D2.apontamentos.some(a=>/ano passado/.test(a.texto)),'ano anterior fora');
  assert(D2.apontamentos.some(a=>a.texto==='data em texto'),'data em texto reconhecida');
  assert.strictEqual(D2.atas.length,230,'230 atas do ano (antes: 200)');
  assert.deepStrictEqual(D2.fatos_seed.map(f=>f.tipo),['Positivo']);
  assert.strictEqual(D2.anoLetivo,ano);
  // ano letivo configurável
  ctx.PropertiesService._p.ANO_LETIVO=String(ano-1);
  const D3=G({aba:'todos_os_dados',token:tdirA});
  assert(D3.apontamentos.every(a=>!/^\d{2}\/\d{2}\/\d{4}/.test(a.dataAtual)||a.dataAtual.includes(String(ano-1))));
  delete ctx.PropertiesService._p.ANO_LETIVO;
}
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
// ===== Sessão longa do responsável (app "manter conectado") =====
{ const linha=S.Sessoes.rows.find(r=>r[0]===tpai); const dias=(new Date(linha[6])-Date.now())/86400000;
  assert(dias>29 && dias<=30,'responsável: 30 dias ('+dias+')');
  const tdirS=P({operacao:'LOGIN',email:'dir@x.com',senha:'9999'}).token; const ls=S.Sessoes.rows.find(r=>r[0]===tdirS);
  assert((new Date(ls[6])-Date.now())/3600000<=8.01,'equipe continua com 8 h'); }
// ===== Provas no Portal dos Pais =====
{
  const d=n=>{const x=new Date();x.setDate(x.getDate()+n);return x;};
  const iso=x=>[x.getFullYear(),String(x.getMonth()+1).padStart(2,'0'),String(x.getDate()).padStart(2,'0')].join('-');
  const cab=['ID_Pedido','Data_Pedido','Professor_Email','Professor_Nome','Disciplina','Turma','Trimestre','Data_Prova','Valor','Conteudo_HTML','Anexos_URLs','Qtd_Copias','Observacoes','Status','Data_Status'];
  const L=(id,disc,turma,dp,valor,status)=>[id,'x','prof@x.com','Prof Ana',disc,turma,'3º Trimestre',dp,valor,'<p>QUESTÃO SECRETA 1</p>','https://drive/anexo',30,'',status,''];
  S.Pedidos_Avaliacoes=sheet('Pedidos_Avaliacoes',[cab,
    L('AV1','Matemática','6A',iso(d(3)),'10,0','Pendente'),
    L('AV2','Matemática','6A',iso(d(3)),'10,0','Impresso'),          // versão personalizada: mesma prova
    L('AV3','História','6º Ano A',d(1),'5,0','Impresso'),            // data como Date e turma por extenso
    L('AV4','Ciências','6A',iso(d(5)),'8,0','Rascunho'),
    L('AV5','Inglês','6A',iso(d(6)),'4,0','Cancelado'),
    L('AV6','Geografia','6A',iso(d(-3)),'6,0','Entregue'),           // última semana: aparece
    L('AV7','Arte','6A',iso(d(-20)),'3,0','Entregue'),               // antiga: não aparece
    L('AV8','Matemática','7B',iso(d(2)),'10,0','Pendente')]);        // outra turma
  const PV=G({aba:'provas_filhos',token:tpai});
  assert.strictEqual(PV.status,'success'); assert.strictEqual(PV.filhos.length,1);
  const f=PV.filhos[0]; assert.strictEqual(f.aluno,'JOÃO DA SILVA');
  assert.deepStrictEqual(f.provas.map(p=>p.disciplina),['Geografia','História','Matemática']);
  assert.deepStrictEqual(Object.keys(f.provas[0]).sort(),['data','disciplina','professor','trimestre','valor']);
  assert(!JSON.stringify(PV).includes('SECRETA') && !JSON.stringify(PV).includes('drive/anexo'),'conteúdo e anexos nunca saem');
  assert.strictEqual(f.provas[2].valor,'10,0'); assert.strictEqual(f.provas[2].data,iso(d(3)));
  assert.strictEqual(G({aba:'provas_filhos'}).status,'unauthorized');
}
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
// ===== Notícias =====
let N=G({aba:'noticias'}); assert.strictEqual(N.status,'success'); assert.deepStrictEqual(N.noticias,[],'pública e vazia');
assert.strictEqual(P({operacao:'NOTICIA_ADICIONAR',link:'https://www.instagram.com/p/ABC123xyz/'}).status,'unauthorized');
assert.strictEqual(P({operacao:'NOTICIA_ADICIONAR',token:tp2(),link:'https://www.instagram.com/p/ABC123xyz/'}).status,'forbidden','professor não publica');
const publicarNoticia=(link,chamada)=>P({operacao:'NOTICIA_ADICIONAR',token:tdir,link,chamada});
assert.strictEqual(publicarNoticia('https://site-malicioso.com/p/x').status,'error');
assert.strictEqual(publicarNoticia('https://www.instagram.com/ccm_anchieta/').status,'error','perfil não é postagem');
assert.strictEqual(publicarNoticia('https://www.instagram.com/p/ABC123xyz/?igsh=MWx0&utm_source=copy','Medalha na OBMEP <b>').status,'success');
assert.strictEqual(publicarNoticia('https://www.instagram.com/ccm_anchieta/reels/DEF456uvw/').status,'success');
assert.strictEqual(publicarNoticia('https://m.facebook.com/anchieta.anchieta.779/posts/pfbid02abc').status,'success');
assert(/já estava/.test(publicarNoticia('https://instagram.com/p/ABC123xyz').message),'duplicada');
ctx.CacheService.getScriptCache().remove('not_publicas');
N=G({aba:'noticias'});
assert.deepStrictEqual(N.noticias.map(n=>n.link),['https://www.facebook.com/anchieta.anchieta.779/posts/pfbid02abc','https://www.instagram.com/reel/DEF456uvw/','https://www.instagram.com/p/ABC123xyz/']);
assert.deepStrictEqual(Object.keys(N.noticias[0]).sort(),['chamada','data','id','link','rede'],'sem e-mail de quem publicou');
const gest=G({aba:'noticias_gestao',token:tdir}); assert.strictEqual(gest.length,3);
assert.strictEqual(G({aba:'noticias_gestao',token:tp2()}).status,'forbidden');
assert.strictEqual(P({operacao:'NOTICIA_OCULTAR',token:tdir,id:gest[0].id}).status,'success');
assert.strictEqual(G({aba:'noticias'}).noticias.length,2,'oculta some do site');
// ===== Frequenciômetro (abas como nas capturas de tela da escola) =====
S.frequencia=sheet('frequencia',[['Turma','Frequência','Bloco','Troféus','Código da Turma'],['6º A - EF',91.26,'manha',2,''],['1º A - NEM',81.86,'manha',0,'2625700'],['3º B - NEM',84.44,'manha',0,'2625837/836']]);
S.HistoricoGeral=sheet('HistoricoGeral',[['Semana','Media'],[1,'92.77'],[2,'92.41'],[21,87.73],[22,89.8],['Esta',0]]);
S.Alunos.rows.push(['3','PEDRO NEM','1º Ano A NEM','1NEM']);
let F=G({aba:'frequenciometro'});
assert.strictEqual(F.status,'success'); assert.strictEqual(F.frequencia.length,4); assert.strictEqual(F.frequencia[1][0],'6º A - EF');
const hist=F.historico.slice(1);
assert.deepStrictEqual(hist.map(h=>h[0]),['1','2','21','22','Esta'],'Esta calculada, sem o zero antigo');
assert.strictEqual(hist[0][1],'92,77','92.77 lido como 92,77');
assert.strictEqual(hist.at(-1)[1],((91.26+81.86+84.44)/3).toFixed(2).replace('.',','),'Esta = média atual');
assert(!JSON.stringify(F).includes('PEDRO'),'sem nomes de alunos no público');
assert.strictEqual(G({aba:'frequenciometro_alunos'}).status,'unauthorized','sem chave');
vm.runInContext('FREQ_gerarChaveTV()',ctx); const chave=ctx.PropertiesService._p.FREQ_CHAVE_TV; assert.strictEqual(chave.length,24);
assert.strictEqual(G({aba:'frequenciometro_alunos',chave:'x'.repeat(24)}).status,'unauthorized','chave errada');
let A=G({aba:'frequenciometro_alunos',chave}); assert(A.alunos.some(a=>a[1]==='PEDRO NEM'));
assert.strictEqual(P({operacao:'SORTEIO_REGISTRAR',nome:'MARIA SOUZA',turma:'7B'}).status,'unauthorized');
assert.strictEqual(P({operacao:'SORTEIO_REGISTRAR',chave,nome:'MARIA SOUZA',turma:'7B'}).status,'success');
assert.strictEqual(P({operacao:'SORTEIO_REGISTRAR',chave,nome:'JOÃO DA SILVA',turma:'6A',origem:'manual'}).status,'success');
assert.deepStrictEqual(G({aba:'frequenciometro_alunos',chave}).sorteados.sort(),['JOÃO DA SILVA','MARIA SOUZA']);
assert.strictEqual(P({operacao:'SORTEIO_LIMPAR',chave,turma:'7B'}).alterados,1);
assert.strictEqual(P({operacao:'SORTEIO_DESMARCAR',chave,nome:'JOÃO DA SILVA'}).alterados,1);
assert.strictEqual(S.Sorteios.rows.length,3,'histórico preservado (só marca NAO)');
S.Frequenciometro_Trimestres.rows[2][1]='93,4'; ctx.CacheService.getScriptCache().remove('freq_publico');
assert.deepStrictEqual(G({aba:'frequenciometro'}).trimestres.map(t=>t.fechado),[91.9,93.4,null]);
// --- Tela "Frequência da Semana"
assert.strictEqual(G({aba:'frequencia_gestao',token:tp2()}).status,'forbidden','professor não acessa');
let FG=G({aba:'frequencia_gestao',token:tdir});
assert.strictEqual(FG.proximaSemana,23); assert.strictEqual(FG.ultimaSemana.semana,22); assert.strictEqual(FG.turmas.length,3);
let SV=P({operacao:'FREQ_SALVAR',token:tdir,itens:[{linha:2,turma:'6º A - EF',freq:'95,5',trofeus:'3'},{linha:3,turma:'1º A - NEM',freq:150},{linha:4,turma:'OUTRA',freq:50}]});
assert.strictEqual(SV.status,'success'); assert.strictEqual(S.frequencia.rows[1][1],95.5); assert.strictEqual(S.frequencia.rows[1][3],3);
assert.strictEqual(S.frequencia.rows[2][1],81.86,'150% recusado'); assert.strictEqual(S.frequencia.rows[3][1],84.44,'linha trocada recusada');
assert.strictEqual(SV.gestao.pendenteFechar,true);
// fechamento automático de sexta
vm.runInContext('FREQ_fecharSemanaAutomatico()',ctx);
const h=S.HistoricoGeral.rows;
assert.deepStrictEqual(h.map(r=>r[0]).filter(x=>x!==''),['Semana',1,2,21,22,23],'semana 23 no lugar da linha Esta');
assert.strictEqual(h[5][1],Math.round((95.5+81.86+84.44)/3*100)/100);
assert.strictEqual(h[1][1],92.77,'texto 92.77 virou número');
vm.runInContext('FREQ_fecharSemanaAutomatico()',ctx);
assert.strictEqual(h.filter(r=>r[0]===24).length,0,'sem atualização na semana, não fecha de novo');
assert.strictEqual(P({operacao:'FREQ_FECHAR_SEMANA',token:tdir}).semana,24,'fechamento manual');
// --- Média ponderada (Σ presenças ÷ Σ aulas) e semana letiva do Power BI
SV=P({operacao:'FREQ_SALVAR',token:tdir,semana:42,itens:[
  {linha:2,turma:'6º A - EF',freq:'87,91',presencas:633,aulas:720},
  {linha:3,turma:'1º A - NEM',freq:'67,17',presencas:532,aulas:792},
  {linha:4,turma:'3º B - NEM',freq:'84,06',presencas:348,aulas:414}]});
assert.strictEqual(SV.status,'success'); assert.deepStrictEqual(S.frequencia.rows[0].slice(5,7),['Σ Presenças','Σ Aulas'],'cabeçalhos F/G criados');
assert.deepStrictEqual(S.frequencia.rows[1].slice(5,7),[633,720]);
const pond=100*(633+532+348)/(720+792+414);
assert.strictEqual(SV.gestao.metodoMedia,'ponderada'); assert(Math.abs(SV.gestao.mediaAtual-pond)<1e-9,'média ponderada');
assert.strictEqual(SV.gestao.semanaAtual,42,'semana letiva guardada');
ctx.CacheService.getScriptCache().remove('freq_publico');
F=G({aba:'frequenciometro'}); assert.strictEqual(F.medias.metodo,'ponderada'); assert(Math.abs(F.medias.escola-pond)<1e-9);
assert(Math.abs(F.medias.manha-pond)<1e-9,'todas manhã no teste'); assert.strictEqual(F.medias.tarde,null);
// digitar à mão uma turma (sem Σ) volta para média simples, sem ponderar com número velho
SV=P({operacao:'FREQ_SALVAR',token:tdir,itens:[{linha:2,turma:'6º A - EF',freq:'88'}]});
assert.deepStrictEqual(S.frequencia.rows[1].slice(5,7),['',''],'F/G limpos'); assert.strictEqual(SV.gestao.metodoMedia,'simples');
P({operacao:'FREQ_SALVAR',token:tdir,itens:[{linha:2,turma:'6º A - EF',freq:'87,91',presencas:633,aulas:720}]});
// fechar com a semana letiva escolhida
let FS=P({operacao:'FREQ_FECHAR_SEMANA',token:tdir,semana:42}); assert.strictEqual(FS.semana,42);
let semanasHist=S.HistoricoGeral.rows.slice(1).map(r=>r[0]).filter(x=>x!=='');
assert.deepStrictEqual(semanasHist,[1,2,21,22,23,24,42],'42 depois das antigas, em ordem');
assert.strictEqual(G({aba:'frequencia_gestao',token:tdir}).semanaAtual,43,'próxima = 43');
// preencher semanas que faltaram (33 a 41) e corrigir/apagar
let HS=P({operacao:'FREQ_HISTORICO_SALVAR',token:tdir,semanas:[{semana:41,media:'84,66'},{semana:33,media:'90.98'},{semana:37,media:81.42},{semana:24,apagar:true},{semana:99,media:50},{semana:38,media:'abc'}]});
assert.strictEqual(HS.status,'success'); assert.strictEqual(HS.message,'4 semana(s) gravada(s).');
semanasHist=S.HistoricoGeral.rows.slice(1).filter(r=>r[0]!=='').map(r=>[r[0],r[1]]);
assert.deepStrictEqual(semanasHist.map(r=>r[0]),[1,2,21,22,23,33,37,41,42]);
assert.strictEqual(semanasHist.find(r=>r[0]===33)[1],90.98);
assert.strictEqual(P({operacao:'FREQ_HISTORICO_SALVAR',token:tp2(),semanas:[{semana:40,media:84}]}).status,'forbidden');
ctx.CacheService.getScriptCache().remove('freq_publico');
F=G({aba:'frequenciometro'}); assert.deepStrictEqual(F.historico.slice(1).map(h=>h[0]),['1','2','21','22','23','33','37','41','42','Esta']);
console.log('INTEGRAÇÃO COM O CÓDIGO.GS REAL: TODOS OS TESTES PASSARAM —',S.Auditoria.rows.length-1,'linhas de auditoria');
