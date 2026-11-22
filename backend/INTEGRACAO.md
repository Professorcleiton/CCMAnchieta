# Como instalar a camada de segurança no Apps Script

Tempo estimado: 15 minutos. A camada foi testada junto com o `Código.gs` atual do SIGA. **A URL da implantação continua a mesma.**

> ⚠️ **Antes de tudo:** faça uma cópia da planilha (Arquivo → Fazer uma cópia). Ela leva junto o projeto do Apps Script e serve de backup.

## Ordem recomendada

1. Fazer o merge do PR (site novo). Ele já funciona com o backend atual.
2. Instalar a camada (passos 1 a 3). **Faça logo em seguida:** até lá, senhas novas com letras perdem as letras no backend antigo.
3. Testar (passo 4).
4. Fechar a planilha (passo 5).

## Passo 1: colar os dois arquivos novos

1. Abra a planilha → **Extensões → Apps Script**.
2. Clique em **+ → Script**, dê o nome `seguranca` e cole todo o conteúdo de `backend/seguranca.gs`.
3. Clique em **+ → Script** de novo, dê o nome `push-e-documentos` e cole todo o conteúdo de `backend/push-e-documentos.gs`.

A configuração já vem ajustada para a sua planilha: abas `Usuários` (senha na coluna E), `Responsaveis` (senha na coluna C, push na F), `Alunos` e `Sessoes`.

## Passo 2: atualizar o Código.gs

**Opção A (recomendada):** substitua todo o conteúdo do `Código.gs` pelo arquivo `Codigo.gs` que o Claude enviou na conversa. Ele **não** fica no GitHub, porque contém a chave VAPID. É o seu código com estas mudanças, todas marcadas com `SIGA v3`:

- `doGet`/`doPost` renomeados para `doGetOriginal`/`doPostOriginal`
- nova rota `upload_documento` no `doPost`
- função antiga `enviarPushNotification` removida (agora em `push-e-documentos.gs`)
- `notificarResponsaveis`: só avisa responsáveis aprovados e não derruba o salvamento se o e-mail falhar
- `VAPID_SUBJECT` corrigido

**Opção B (à mão):** faça só estas mudanças no seu `Código.gs`:

```js
function doGet(e) {        →   function doGetOriginal(e) {
function doPost(e) {       →   function doPostOriginal(e) {
```

1. **Apague** a função `enviarPushNotification` inteira. Se ela ficar, o Apps Script não sabe qual das duas usar.
2. Logo abaixo de `// 🔒 A PARTIR DAQUI: ROTAS PROTEGIDAS`, adicione:
   ```js
   if (data.operacao === "upload_documento") return jsonResponse(uploadDocumentoResponsavel(data));
   ```
3. Em `notificarResponsaveis`, logo depois de `var emailResp = ...`, adicione `if (!WP_podeNotificar_(emailResp, alunoVinculado)) continue;` e coloque o `enviarEmailNotificacao(...)` dentro de um `try { } catch (e) { }`.

## Passo 3: implantar

**Implantar → Gerenciar implantações → ✏️ (editar) → Versão: Nova versão → Implantar.**

Não crie uma implantação nova, senão a URL muda. O Google vai pedir novas autorizações: **enviar e-mail** ("Esqueci minha senha"), **conectar a serviços externos** (envio das notificações push) e **Drive** (documentos dos pais).

**Recomendado:** em **Configurações do projeto (⚙️) → Propriedades do script → Adicionar**, crie `VAPID_PRIVATE_KEY` com o valor que está no Código.gs e depois apague a linha `var VAPID_PRIVATE_KEY = ...` do Código.gs. Assim a chave sai do código.

## Passo 4: testar

- [ ] Entrar no SIGA como professor → os apontamentos carregam
- [ ] Numa aba anônima, abrir `SUA_URL/exec?aba=usuarios` → deve responder `unauthorized`
- [ ] Na aba `Usuários`, a senha de quem entrou agora começa com `sha256$` (conversão automática no primeiro login)
- [ ] Cadastrar um responsável de teste → mensagem "aguardando aprovação"
- [ ] Em **Aprovar Responsáveis** (menu do SIGA, nível 3+), aprovar o teste → ele entra e vê **só** o filho aprovado
- [ ] "Esqueci minha senha" → chega o e-mail com código
- [ ] A aba **Auditoria** foi criada e está registrando as ações
- [ ] No Portal dos Pais, enviar um PDF num documento pendente → aparece "Enviado" e o arquivo está na pasta de documentos do Drive
- [ ] No celular, entrar no Portal dos Pais → **Ativar Notificações**. No editor do Apps Script, executar `WP_testarPush` → a notificação chega. No iPhone, primeiro adicione o site à Tela de Início e abra por lá.

Os responsáveis que já tinham conta continuam entrando e aparecem como **"LEGADO - revisar"** em Aprovar Responsáveis. Peça à secretaria para revisar a lista e revogar quem não for responsável de verdade. A revogação derruba a sessão na hora.

**Para desfazer:** apague o arquivo `seguranca` e volte os nomes para `doGet`/`doPost`. Depois publique uma nova versão.

## Passo 5: fechar a planilha ao público

Só depois de testar:

1. Na planilha: **Compartilhar → Acesso geral → Restrito**.
2. No site, em `siga-core.js`, mude `PERMITIR_FALLBACK_GVIZ: true` para `false` e publique.
3. Teste numa aba anônima: `https://docs.google.com/spreadsheets/d/SEU_ID/gviz/tq?sheet=Alunos` deve pedir login.

## Opcional

- Para converter todas as senhas antigas de uma vez, sem esperar cada pessoa entrar, execute `SEG_migrarTodasAsSenhas` no editor (menu Executar).
- Para testar a camada no computador antes de publicar: `node tests/test-backend.js caminho/do/Codigo.gs`. **Nunca** suba o `Código.gs` para o GitHub, porque ele contém a chave privada VAPID.

## Ainda vale ajustar

| Onde | O que fazer |
|---|---|
| Cota de e-mail | Contas Gmail comuns enviam no máximo **100 e-mails/dia** pelo Apps Script (contas Workspace: 1.500). Em dias com muitos apontamentos, os avisos excedentes não saem. O apontamento é salvo do mesmo jeito. As notificações push não têm esse limite. |
| `criarPedidoAvaliacao` | Os anexos de prova ficam "qualquer pessoa com o link". Prefira compartilhar só com a secretaria. |
| `imprimir-comunicado.html` | Usa **outra implantação** (`APPS_SCRIPT_URL_COMUNICADOS` no `siga-core.js`). Se for uma versão antiga deste mesmo projeto, aponte para a URL principal. Se for outro projeto, ele continua aberto. |
