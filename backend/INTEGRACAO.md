# Como instalar a camada de segurança no Apps Script

Tempo estimado: 20–30 minutos. **Faça numa segunda versão da implantação. A URL continua a mesma** e o site não precisa mudar.

> ⚠️ **Antes de tudo:** faça uma cópia da planilha (Arquivo → Fazer uma cópia) e do projeto do Apps Script, para poder voltar atrás.

## Ordem recomendada

1. Publicar o site novo (este Pull Request). Ele funciona com o backend **antigo**, porque o token extra é simplesmente ignorado.
2. Instalar a camada no backend (passos abaixo).
3. Testar.
4. Fechar a planilha (passo 6).
5. Hash de senhas (passo 7, opcional mas recomendado).

## Passo 1: colar o arquivo

1. Abra a planilha → **Extensões → Apps Script**.
2. Clique em **+ → Script** e dê o nome `seguranca`.
3. Cole todo o conteúdo de `backend/seguranca.gs`.

## Passo 2: renomear as funções atuais

No seu arquivo principal (normalmente `Código.gs`):

```js
function doGet(e) {      // ANTES
function doGetOriginal(e) {   // DEPOIS

function doPost(e) {     // ANTES
function doPostOriginal(e) {  // DEPOIS
```

Não mude mais nada. A camada nova recebe o pedido, confere tudo e só então chama o seu código.

## Passo 3: conferir a configuração

No topo de `seguranca.gs`, em `SEG_CONFIG`, confira se os nomes das abas batem com a sua planilha:

| Item | Valor padrão | Observação |
|---|---|---|
| `ABA_ALUNOS` | `Alunos` | coluna B = nome, coluna C = turma |
| `ABA_USUARIOS` | `Usuarios` | precisa ter colunas com cabeçalho `email` e `senha` |
| `ABA_RESPONSAVEIS` | `Responsaveis` | idem |

Em `SEG_NIVEL_MINIMO`, confira os níveis de cada operação (3 = secretaria, 4 = direção, 5 = master). Operações não listadas exigem só estar logado.

## Passo 4: implantar

**Implantar → Gerenciar implantações → ✏️ (editar) → Versão: Nova versão → Implantar.**

Não crie uma implantação nova, senão a URL muda.

Na primeira execução, o Google vai pedir autorização para **enviar e-mail** (necessário para o "Esqueci minha senha").

## Passo 5: testar

- [ ] Entrar no SIGA como professor → os apontamentos carregam
- [ ] Abrir uma aba anônima e acessar `SUA_URL/exec?aba=usuarios` → deve responder `unauthorized`
- [ ] Professor nível 1 tentando excluir usuário → "sem permissão"
- [ ] Cadastrar um responsável de teste → mensagem "aguardando aprovação"
- [ ] Em **Aprovar Responsáveis** (menu do SIGA, nível 3+), aprovar o teste → ele entra e vê **só** o filho aprovado
- [ ] "Esqueci minha senha" → chega o e-mail com código
- [ ] Aba **Auditoria** foi criada e está registrando as ações

Todos os responsáveis que já tinham conta continuam entrando (`LIBERAR_RESPONSAVEIS_LEGADO: true`). Eles aparecem como **"APROVADO (LEGADO - revisar)"**. Peça à secretaria para revisar essa lista e revogar quem não for responsável de verdade.

## Passo 6: fechar a planilha ao público

Só depois de testar:

1. Na planilha: **Compartilhar → Acesso geral → Restrito**.
2. No site, em `siga-core.js`, mude `PERMITIR_FALLBACK_GVIZ: true` para `false` e publique.
3. Teste numa aba anônima: `https://docs.google.com/spreadsheets/d/SEU_ID/gviz/tq?sheet=Alunos` deve pedir login.

## Passo 7 (recomendado): senhas com hash

Hoje as senhas provavelmente estão em texto puro na planilha. Para guardar só o "hash":

1. No seu código de LOGIN e LOGIN_RESPONSAVEL, troque a comparação de senha. Por exemplo:

   ```js
   // ANTES (exemplo)
   if (linha[colSenha] == dados.senha) { ...login ok... }

   // DEPOIS
   var r = SEG_conferirSenha(dados.senha, linha[colSenha]);
   if (r.ok) {
     if (r.novoValor) aba.getRange(numLinha, colSenha + 1).setValue(r.novoValor); // migra sozinho
     ...login ok...
   }
   ```

2. No cadastro de usuário (`USER_SALVAR`) e de responsável (`CADASTRAR_RESPONSAVEL`), salve `SEG_gerarHashSenha(senha)` em vez da senha.
3. Em `SEG_CONFIG`, mude `SALVAR_SENHA_COM_HASH` para `true`.
4. (Opcional) Execute `SEG_migrarTodasAsSenhas` uma vez pelo editor, para converter todas de uma vez.

## Atenção: segunda implantação

`imprimir-comunicado.html` usa **outra URL** de Apps Script (`APPS_SCRIPT_URL_COMUNICADOS` no `siga-core.js`).

- Se for uma versão antiga do mesmo projeto, aponte essa variável para a URL principal.
- Se for outro projeto, ele continua aberto. Instale esta camada lá também ou migre a função para o projeto principal. As sessões são separadas por projeto.

## Também vale revisar no seu código

- Garanta que `?aba=usuarios` **nunca** devolva a coluna de senha.
- Use `corpo.emailSessao` e `corpo.nivelSessao` (preenchidos pela camada a partir do token) em vez de `corpo.email`/`corpo.nivel` quando precisar saber **quem** está fazendo a ação.
