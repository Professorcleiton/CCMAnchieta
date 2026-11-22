# 🎓 SIGA v3 — Sistema Integrado de Gestão Anchieta

> Plataforma web de gestão pedagógica, disciplinar e administrativa do **Colégio Cívico-Militar Anchieta** (Cruzeiro do Oeste/PR).
> Site: <https://www.ccmanchieta.com.br>

O SIGA conecta o Pedagógico, o Disciplinar (MEIV'S), a Secretaria, a Direção, os Professores e as famílias.

---

## 🚀 Módulos

| Módulo | Página | Quem usa |
|---|---|---|
| Site institucional | `index.html`, `equipe.html` | público |
| Central SIGA (apontamentos, dashboard, PDF para Conselho de Classe) | `restrito.html` + `script.js` | servidores |
| Pré-Conselho | `restrito.html` | professores |
| Central de Alertas (alunos em risco) | `alertas.html` | nível 3+ |
| Avaliações (pedido de impressão de provas) | `avaliacoes.html`, `avaliacoes-secretaria.html` | professores / secretaria |
| Importação SuperBI | `importar-superbi.html` | secretaria |
| Fatos Observados / Comunicado SEED | `imprimir-comunicado.html` | nível 3+ |
| Horários e Agenda do Laboratório | `meus-horarios.html`, `agenda-laboratorio.html` | professores |
| Painel Docente | `painel-docente.html` | professores |
| Patrimônio (com QR Code) | `patrimonio.html` | nível 3+ |
| Usuários da equipe | `usuarios.html`, `admin.html` | direção |
| **Aprovar responsáveis** (novo) | `aprovar-responsaveis.html` | secretaria / direção |
| Portal dos Pais | `responsaveis.html`, `painel-responsavel.html`, `horarios-filho.html` | famílias |

## 🛠️ Tecnologias

- **Front-end:** HTML5, CSS3, JavaScript puro, PWA (`sw.js`, `manifest.json`), IndexedDB para modo offline (`db.js`)
- **Back-end:** Google Apps Script
- **Banco de dados:** Google Sheets
- **Bibliotecas:** Font Awesome, html2pdf.js, Chart.js, html5-qrcode, VLibras

## 🔒 Segurança (v3)

- `siga-core.js` é carregado **primeiro em todas as páginas** e:
  - guarda a configuração única (`SIGA_CONFIG`: URL do Apps Script e ID da planilha);
  - anexa o token de sessão a toda chamada ao Apps Script;
  - neutraliza HTML vindo do servidor (proteção contra XSS);
  - oferece `escaparHTML()` e `escaparJSAttr()` para montar HTML com dados;
  - trata sessão expirada e oferece "Esqueci minha senha".
- `backend/seguranca.gs` é a camada do Apps Script que exige login, confere o nível de acesso por operação, controla o vínculo responsável ↔ aluno e registra auditoria.
  **Instalação: veja [`backend/INTEGRACAO.md`](backend/INTEGRACAO.md).**

### Regras para quem for mexer no código

1. **Nunca** coloque dados da planilha em `innerHTML` sem `escaparHTML()` (ou use `textContent`).
2. Dentro de `onclick="f('...')"`, use `escaparJSAttr()`.
3. Não escreva a URL do Apps Script nas páginas. Use `SIGA_CONFIG.APPS_SCRIPT_URL`.
4. Toda regra de permissão precisa existir **no backend**. Esconder botão é só conforto visual.
5. Ao mudar arquivos do app, suba a versão em `sw.js` (`CACHE_NAME`) e nos `?v=` dos scripts.

## 📁 Estrutura

```text
├── index.html / equipe.html / frequencia.html   # site institucional
├── restrito.html + script.js + db.js            # Central SIGA
├── siga-core.js                                 # núcleo compartilhado (config, token, XSS)
├── *.html                                       # módulos (ver tabela)
├── backend/seguranca.gs                         # camada de segurança do Apps Script
├── backend/INTEGRACAO.md                        # passo a passo de instalação
├── sw.js / manifest.json                        # PWA e notificações
├── style.css
├── img/ e Arq/                                  # imagens e PDFs
└── vercel.json / CNAME                          # hospedagem
```

## ⚖️ Licença

Copyright © 2026 Cleiton Ivaí da Silva. Veja o arquivo `LICENSE`.

## 👤 Autor

Desenvolvido por **Cleiton Ivaí da Silva**
✉️ cleiton.ivai.silva@escola.pr.gov.br · GitHub: [@professorcleiton](https://github.com/professorcleiton)

## 🧪 Testes

```bash
node tests/test-core.js      # núcleo do front-end (token, XSS, senhas)
node tests/test-backend.js   # camada de segurança do Apps Script (simulada)
```
