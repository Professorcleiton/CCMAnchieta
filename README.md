# CCMAnchieta
# 🎓 SIGA v2 — Sistema Integrado de Gestão Anchieta

> **Plataforma Web de Gestão Pedagógica, Disciplinar e Administrativa Escolar**

O **SIGA v2** é um sistema centralizado para acompanhamento de estudantes, registro de ocorrências e geração de pareceres para o Conselho de Classe. Ele conecta em tempo real as demandas do setor Pedagógico, Disciplinar (MEIV'S), Administrativo e do Corpo Docente.

---

## 🚀 Funcionalidades Principais

* 🔐 **Autenticação e Controle de Acesso por Níveis:** Sistema de login seguro com restrição de edição/leitura por cargo (Direção, Pedagógico, MEIV'S, Secretaria e Professores).
* 📋 **Feed Cronológico de Apontamentos:** Registro individualizado de ocorrências por aluno com carimbo de data, hora e responsável pelo lançamento.
* 📊 **Dashboard & Métricas em Tempo Real:** Visualização gráfica da distribuição de ocorrências e indicadores gerais da instituição.
* 📄 **Emissão Automática de PDF Oficial:** Geração da *Ficha de Acompanhamento Individual do Estudante* formatada para Conselho de Classe, pronta para impressão e assinatura dos responsáveis.
* 🔎 **Relatórios Dinâmicos por Departamento:** Janela modal interativa para auditoria e leitura rápida de históricos de cada setor.

---

## 🛠️ Tecnologias Utilizadas

* **Front-end:** HTML5, CSS3 (Design Responsivo / Mobile First), JavaScript Puro (ES6+)
* **Back-end & API:** Google Apps Script (Serverless)
* **Banco de Dados:** Google Sheets API / Google Visualization API (GViz)
* **Bibliotecas:** 
  * [FontAwesome](https://fontawesome.com/) (Iconografia)
  * [html2pdf.js](https://html2pdf.com/) (Renderização de relatórios PDF)

---

## 📁 Estrutura do Projeto

```text
├── index.html        # Interface principal, modais e telas de login
├── style.css         # Estilização visual, regras responsivas e componentes
├── app.js            # Lógica do sistema, integração com backend e geração de PDF
└── LICENSE           # Termos de uso e direitos autorais do software
⚙️ Como Funciona a Arquitetura
Front-end (Navegador): Consome dados de estudantes via API pública do Google Sheets (GViz) e realiza requisições POST/GET para o backend.
Back-end (Apps Script): Processa a autenticação, faz a validação dos cargos/permissões e manipula os registros diretamente nas planilhas do Google Drive.
Segurança: O sistema aplica regras de leitura e escrita dinâmicas no cliente e no servidor de acordo com o nível hierárquico do usuário logado.
⚖️ Direitos Autorais e Licença
Copyright © 2026 [Seu Nome Completo]. Todos os direitos reservados.
Este software é um projeto de propriedade intelectual proprietária e fechada.
É estritamente proibida a cópia, modificação, redistribuição, venda ou sublicenciamento do código-fonte, total ou parcial, sem autorização prévia por escrito do autor.
O uso deste sistema foi concedido exclusivamente para a rotina interna do Colégio Cívico-Militar Anchieta.
👤 Autor
Desenvolvido por Cleiton Ivaí da Silva
✉️ Contato:cleiton.ivai.silva@escola.pr.gov.br
🌐 GitHub: @professorcleiton
