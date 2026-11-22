# Como instalar a camada de segurança no Apps Script

Tempo estimado: 15 minutos. A camada foi testada junto com o `Código.gs` atual do SIGA. **A URL da implantação continua a mesma.**

> ⚠️ **Antes de tudo:** faça uma cópia da planilha (Arquivo → Fazer uma cópia). Ela leva junto o projeto do Apps Script e serve de backup.

## Ordem recomendada

1. Fazer o merge do PR (site novo). Ele já funciona com o backend atual.
2. Instalar a camada (passos 1 a 3). **Faça logo em seguida:** até lá, senhas novas com letras perdem as letras no backend antigo.
3. Testar (passo 4).
4. Fechar a planilha (passo 5).

## Passo 1: colar os arquivos novos

1. Abra a planilha → **Extensões → Apps Script**.
2. Clique em **+ → Script**, dê o nome `seguranca` e cole todo o conteúdo de `backend/seguranca.gs`.
3. Clique em **+ → Script** de novo, dê o nome `push-e-documentos` e cole todo o conteúdo de `backend/push-e-documentos.gs`.
4. Clique em **+ → Script** mais uma vez, dê o nome `noticias` e cole todo o conteúdo de `backend/noticias.gs`.
5. E mais um: nome `frequenciometro`, conteúdo de `backend/frequenciometro.gs`.
6. E outro: nome `horarios`, conteúdo de `backend/horarios.gs` (Gestão de Horários e recursos do laboratório).
7. E outro: nome `virada-ano`, conteúdo de `backend/virada-ano.gs` (Virada do Ano Letivo).

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
- [ ] No SIGA, abrir **Notícias do Site** (nível 3+), colar o link de uma postagem do Instagram e publicar. Em até 5 minutos, a seção "Acontece no Anchieta" aparece na página inicial.
- [ ] No celular, entrar no Portal dos Pais → **Ativar Notificações**. No editor do Apps Script, executar `WP_testarPush` → a notificação chega. No iPhone, primeiro adicione o site à Tela de Início e abra por lá.

Os responsáveis que já tinham conta continuam entrando e aparecem como **"LEGADO - revisar"** em Aprovar Responsáveis. Peça à secretaria para revisar a lista e revogar quem não for responsável de verdade. A revogação derruba a sessão na hora.

**Para desfazer:** apague o arquivo `seguranca` e volte os nomes para `doGet`/`doPost`. Depois publique uma nova versão.

## Passo 4b: ligar o Frequenciômetro

As abas `frequencia`, `HistoricoGeral` e `Alunos` já estão na planilha do SIGA, e o `frequenciometro.gs` está configurado para elas. Não precisa mudar nada no código.

1. No editor, escolha **`FREQ_diagnosticar`** e clique em **Executar**. O registro precisa mostrar **OK** para Frequência, Alunos e Histórico.
2. Execute **`FREQ_instalarFechamentoSemanal`**. Ele faz duas coisas: corrige as semanas gravadas como texto ("92.77") e passa a fechar a semana sozinho toda sexta às 18h.
3. Execute **`FREQ_gerarChaveTV`** e abra **uma vez** em cada TV o endereço `https://anchietafrequencia.vercel.app/?chave=...` que aparece no registro.
4. Faça o merge do PR do repositório **frequenciometro**.
5. Teste um sorteio. O nome aparece na aba **Sorteios**.
6. Depois que a TV estiver mostrando os dados novos, **interrompa a publicação da planilha antiga** do frequenciômetro: **Arquivo → Compartilhar → Publicar na Web → Interromper publicação**. Em seguida, no `index.html` do frequenciometro, mude `USAR_PLANILHA_PUBLICADA` para `false`.
7. Na aba **Frequenciometro_Trimestres**, preencha a média de cada trimestre quando ele fechar.

### Atualização semanal (sem abrir a planilha)

**SIGA → Frequência da Semana** (nível 3+):
- **Power BI (Presente na Escola):** a exportação está bloqueada pela SEED. Use a cópia: na tabela, clique na primeira turma, **arraste até a última**, depois **botão direito → Copiar → Copiar seleção**, e cole na caixa da tela. As turmas são reconhecidas pelo código (coluna E da aba `frequencia`) ou pelo nome. Confira os valores e clique em **Salvar**. A TV mostra os números novos em até 10 minutos;
- no topo da tela, confira a **Semana letiva**. Ela é a mesma do filtro "SEMANA LETIVA" do Power BI;
- a média da escola é **Σ presenças ÷ Σ aulas**, com os totais da importação gravados nas colunas F e G da aba `frequencia`. Se alguma turma for digitada à mão, a média vira simples até a próxima importação;
- toda **sexta às 18h**, se houve atualização na semana, a média entra no `HistoricoGeral` com o número da semana letiva;
- no card **Histórico semanal**, dá para preencher semanas que faltaram, corrigir ou apagar;
- para registrar antes, use o botão **Fechar semana agora**.

A linha **"Esta"** do gráfico agora é calculada sozinha com a média atual. A linha "Esta" antiga da planilha pode ser apagada; se ficar, o sistema a ignora e a substitui no próximo fechamento.

## Passo 4c: horários e laboratório (horarios.gs)

Depois de colar o `horarios.gs` e o `seguranca.gs` atualizado, **implante uma nova versão** (Passo 3). Não precisa mexer no Código.gs: o `SALVAR_GRADE` dele deixa de ser usado.

1. SIGA → **Gestão de Horários → 🖥️ Recursos**: confira o laboratório, os tablets (quantos kits) e as disciplinas que usam cada um (plataformas obrigatórias). Clique em **Salvar recursos**. São criadas as abas **Recursos** e **Recursos_Disciplinas**, que também podem ser editadas direto na planilha.
2. Abra uma turma e salve. A grade anterior fica guardada na aba **Horarios_Historico** (data, quem salvou e as aulas).
3. A **Agenda do Laboratório** passa a mostrar "Livre" sempre que o recurso estiver vago, e tem uma aba para cada recurso.

## Passo 4d: Virada do Ano Letivo (virada-ano.gs)

Substitui a antiga "Progressão de Turmas". SIGA → **Virada do Ano Letivo** (nível 4). Tudo pode ser preparado e salvo aos poucos; nada muda nos alunos até o passo 5.

1. **Turmas e destinos**: para onde vai cada turma (6A → 7A, 3º ano → `EGRESSO`, 9º ano → `ESCOLHA`). Aba `Turmas_Ano`.
2. **Turmas do ano novo**: incluir ou excluir turmas (ex.: 9D, 3º B NEM).
3. **Situação dos alunos**: marcar só as exceções (Retido, Transferido, Desistente) e escolher a turma dos alunos do 9º. Aba `Situacao_Final`.
4. **Matriz curricular**: aulas por semana de cada disciplina em cada série. Vem calculada pela grade atual e serve de base para o Auto-Preencher das turmas novas. Aba `Matriz_Curricular`.
5. **Conferir e virar**: prévia por turma. Ao confirmar:
   - é criada uma cópia da planilha no Drive;
   - a turma de cada aluno vai para `Alunos_Historico`;
   - egressos, transferidos e desistentes saem da lista;
   - os contadores escolhidos (impressões, Pré-Conselho, frequenciômetro) são arquivados em `Nome_2026`;
   - a propriedade `ANO_LETIVO` passa para o ano novo.

   Dá para **desfazer por 30 dias**; quem foi matriculado depois da virada continua na lista.

Faça a virada depois do último conselho de classe. A partir dela, os contadores de apontamentos e atas passam a contar o ano novo.

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
