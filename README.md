# WhatsBot Sonoplasta 🎵⛪

Bot inteligente de WhatsApp construído com **@whiskeysockets/baileys**, **Google Gemini AI**, **Playwright** e **Node.js**, com um **Painel Web Frontend** completo para a equipe de sonoplastia de igrejas organizarem e automatizarem o preenchimento de cronogramas de cultos.

---

## ✨ Funcionalidades Principais

1. **Painel Web do Sonoplasta (Dashboard Responsivo)**:
   - Gerenciamento de cronogramas de cultos com horários, momentos, pessoas responsáveis e telefones.
   - Recorrência configurável: **Semanal** (com seleção do dia da semana) ou **Diária**.
   - Definição de **Itens Imutáveis / Fixos**: momentos que possuem conteúdo pré-definido permanente (ex: "Oração de Abertura") e que o bot não precisa solicitar a ninguém.
   - Visualização em tempo real do QR Code do WhatsApp para conexão direta no navegador.
   - Configuração do telefone do Sonoplasta e chave da API do Gemini.
   - Envio imediato do cronograma ao Sonoplasta e seleção dos momentos para **Lembrar Agora**: marque apenas os momentos desejados e clique no botão do cronograma. O lembrete inclui somente os selecionados e é enviado apenas aos telefones dos respectivos responsáveis; momentos fixos ou sem telefone não podem ser selecionados.

2. **Lembretes Automáticos na Véspera**:
   - O bot identifica os cronogramas que acontecerão no dia seguinte.
   - Envia automaticamente mensagens no WhatsApp para cada responsável lembrando do culto e solicitando o que será tocado/apresentado. Após iniciar um envio manual para o cronograma, o automático não envia lembretes aos outros momentos da mesma data.

3. **Inteligência Artificial (Google Gemini) com Contexto e Histórico**:
   - Interpreta respostas enviadas em linguagem natural pelos responsáveis (ex: *"Oi, o hino inicial vai ser Harpa 15 e o final vai ser o 120"*).
   - Mapeia e atualiza automaticamente os itens correspondentes no banco de dados.
   - **Janela de 10 segundos (Mensagens Picadas)**: Aguarda 10 segundos antes de responder caso o contato envie várias mensagens curtas em sequência, unificando o texto antes do processamento.
   - **Reset de Histórico após 30 minutos**: Limpa o histórico de conversação do contato caso passem 30 minutos sem interação, mantendo o histórico leve e contextualizado.

4. **Extração Automática de Título de Vídeos do YouTube (Playwright)**:
   - Se o responsável enviar um link do YouTube (`youtube.com` ou `youtu.be`), o bot usa o **Playwright headless** para acessar o link, extrair o título real do vídeo e registrar o título no cronograma.

5. **Filtros de Segurança e Privacidade**:
   - Bloqueia e ignora mensagens vindas de grupos (`@g.us`) e atualizações de status/broadcast (`status@broadcast`).
   - Aceita o preenchimento de itens **somente** das pessoas cadastradas como responsáveis por aquele momento.

6. **Envio do Cronograma 1h Antes para o Sonoplasta**:
   - 1 hora antes do início do culto, o bot monta o cronograma completo formatado com Markdown do WhatsApp (com horários, nomes, louvores, links e responsáveis) e envia diretamente para o WhatsApp do Sonoplasta.

7. **Renovação Automática Pós-Culto**:
   - Quando a data e horário do culto passam, para cronogramas que se repetem (semanalmente ou diariamente), a data é avançada para o próximo evento.
   - O conteúdo dos itens mutáveis é limpo para que o bot possa solicitar novamente no próximo ciclo, enquanto os itens **imutáveis** permanecem intactos.

---

## 🚀 Como Executar

### 1. Pré-requisitos
- Node.js versão 22.5.0 ou superior (necessário para o módulo nativo `node:sqlite`)
- Navegador Chromium para o Playwright

### 2. Instalação das Dependências

```bash
npm install
npx playwright install chromium
```

### 3. Configuração do `.env`

Copie o `.env.example` para `.env` ou configure no próprio painel web:

```env
PORT=3000
GEMINI_API_KEY=sua_chave_do_google_gemini
SONOPLASTA_PHONE=5511999998888
BOT_NAME=WhatsBot Sonoplasta
```

> **Dica**: Caso ainda não tenha uma chave do Gemini, você pode obtê-la gratuitamente no [Google AI Studio](https://aistudio.google.com/). O sistema possui fallback heurístico inteligente enquanto a chave não for informada.

### 4. Iniciar a Aplicação

```bash
npm start
```

Ou em modo desenvolvimento com auto-reload:

```bash
npm run dev
```

Abra o navegador em: **`http://localhost:3000`**

### Seleção de lembretes via API

`POST /api/schedules/:id/remind-now` exige autenticação e um corpo JSON com os IDs dos momentos selecionados, por exemplo `{"item_ids":[12,15]}`. A lista não pode estar vazia e todos os IDs precisam pertencer ao cronograma e corresponder a momentos mutáveis com telefone cadastrado. O servidor agrupa os momentos selecionados por telefone, envia uma mensagem para cada número e registra o sucesso por momento e data. Ao iniciar um envio manual, o lembrete automático dos outros momentos é suspenso até a próxima ocorrência do cronograma; ainda é possível selecionar e lembrar esses outros momentos manualmente.

---

## 📱 Conectando o WhatsApp

1. Acesse o painel em `http://localhost:3000`.
2. Clique no botão de status do WhatsApp no topo superior direito.
3. Abra o **WhatsApp** no seu smartphone > **Aparelhos conectados** > **Conectar um aparelho**.
4. Aponte a câmera para o QR Code exibido na tela (também é impresso no terminal).
5. O bot estará conectado e pronto para funcionar!

---

## 🌐 Hospedagem em VPS Linux (24/7)

Para colocar a aplicação rodando 24 horas por dia em uma VPS (Ubuntu/Debian) com **PM2**, **Nginx**, **SSL gratuito (HTTPS)** e persistência automática, consulte o guia completo em:

👉 **[Guia Completo de Instalação e Deploy em VPS (DEPLOY_VPS.md)](./DEPLOY_VPS.md)**

---

## 📂 Estrutura do Código

```
whatsbot-soplasta/
├── src/
│   ├── config/
│   │   ├── env.js                # Carregamento de variáveis de ambiente
│   │   └── database.js           # Banco SQLite integrado (node:sqlite)
│   ├── services/
│   │   ├── baileys.js            # Conexão WhatsApp Baileys, eventos e filtros
│   │   ├── gemini.js             # Integração com IA Gemini e interpretação de intenções
│   │   ├── playwright.js         # Scraper headless Playwright para YouTube
│   │   ├── scheduleManager.js    # CRUD, regras de negócios e renovação de cronogramas
│   │   ├── reminders.js          # Seleção, envio e controle de lembretes por momento
│   │   └── scheduler.js          # Agendador Cron (lembretes véspera e envio 1h antes)
│   ├── utils/
│   │   ├── debouncer.js          # Buffer de 10s e reset de histórico de 30min
│   │   └── formatter.js          # Formatação de Markdown do WhatsApp e números
│   ├── routes/
│   │   ├── api.js                # API REST para o Frontend
│   │   └── whatsapp.js           # Endpoints de status e QR Code
│   └── server.js                 # Servidor Express e inicialização
└── public/                       # Frontend Web do Sonoplasta
    ├── index.html                # Painel de controle
    ├── css/styles.css            # Estilos customizados
    └── js/app.js                 # Lógica do painel e consumo da API
```
