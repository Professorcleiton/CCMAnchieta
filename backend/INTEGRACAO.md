# Como instalar a camada de segurança no Apps Script

Tempo estimado: 15 minutos. A camada foi testada junto com o `Código.gs` atual do SIGA. **A URL da implantação continua a mesma.**

> ⚠️ **Antes de tudo:** faça uma cópia da planilha (Arquivo → Fazer uma cópia). Ela leva junto o projeto do Apps Script e serve de backup.

## Ordem recomendada

1. Fazer o merge do PR (site novo). Ele já funciona com o backend atual.
2. Instalar a camada (passos 1 a 3). **Faça logo em seguida:** até lá, senhas novas com letras perdem as letras no backend antigo.
3. Testar (passo 4).
4. Fechar a planilha (passo 5).

## Passo 1: colar o arquivo

1. Abra a planilha → **Extensões → Apps Script**.
2. Clique em **+ → Script** e dê o nome `seguranca`.
3. Cole todo o conteúdo de `backend/seguranca.gs`.

A configuração já vem ajustada para a sua planilha: abas `Usuários` (senha na coluna E), `Responsaveis` (senha na coluna C), `Alunos` e `Sessoes`.

## Passo 2: renomear duas linhas no Código.gs

```js
function doGet(e) {        →   function doGetOriginal(e) {
function doPost(e) {       →   function doPostOriginal(e) {
```

Não mude mais nada. A camada nova recebe cada pedido, confere token e permissão e só então chama o seu código. Ela reaproveita `salvarSessao()`, `validarToken()` e `registrarTentativaLogin()`, então a aba `Sessoes` continua sendo usada.

## Passo 3: implantar

**Implantar → Gerenciar implantações → ✏️ (editar) → Versão: Nova versão → Implantar.**

Não crie uma implantação nova, senão a URL muda. O Google vai pedir autorização para **enviar e-mail**, que é usada no "Esqueci minha senha".

## Passo 4: testar

- [ ] Entrar no SIGA como professor → os apontamentos carregam
- [ ] Numa aba anônima, abrir `SUA_URL/exec?aba=usuarios` → deve responder `unauthorized`
- [ ] Na aba `Usuários`, a senha de quem entrou agora começa com `sha256$` (conversão automática no primeiro login)
- [ ] Cadastrar um responsável de teste → mensagem "aguardando aprovação"
- [ ] Em **Aprovar Responsáveis** (menu do SIGA, nível 3+), aprovar o teste → ele entra e vê **só** o filho aprovado
- [ ] "Esqueci minha senha" → chega o e-mail com código
- [ ] A aba **Auditoria** foi criada e está registrando as ações

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

## Problemas antigos que esta camada NÃO resolve (precisam de ajuste no Código.gs)

| Onde | Problema |
|---|---|
| `upload_documento` | O site dos pais chama essa operação, mas ela **não existe** no `doPost`. O envio de documentos pelos pais sempre falha. |
| `enviarPushNotification` | Usa `FCM_SERVER_KEY`, que não está definida, e a API antiga do FCM (`fcm/send`), que o Google desligou em 2024. **As notificações push não estão chegando**, só os e-mails. |
| `VAPID_PRIVATE_KEY` | Está escrita no código. Mova para **Configurações do projeto → Propriedades do script** e leia com `PropertiesService`. |
| `criarPedidoAvaliacao` | Os anexos de prova ficam "qualquer pessoa com o link". Prefira compartilhar só com a secretaria. |
| `imprimir-comunicado.html` | Usa **outra implantação** (`APPS_SCRIPT_URL_COMUNICADOS` no `siga-core.js`). Se for uma versão antiga deste mesmo projeto, aponte para a URL principal. Se for outro projeto, ele continua aberto. |
