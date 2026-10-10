import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config/env.js';
import { logMessage } from './config/database.js';
import apiRoutes from './routes/api.js';
import whatsappRoutes from './routes/whatsapp.js';
import { initWhatsApp } from './services/baileys.js';
import { initScheduler } from './services/scheduler.js';
import { closeBrowser } from './services/playwright.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Rotas da API
app.use('/api', apiRoutes);
app.use('/api/whatsapp', whatsappRoutes);

// Fallback SPA
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Inicialização do Servidor
const server = app.listen(config.port, () => {
  logMessage('INFO', `[Servidor] Painel Web do Sonoplasta rodando em http://localhost:${config.port}`);
  console.log(`\n========================================================`);
  console.log(`🎶 WhatsBot Sonoplasta - Painel Web Disponível em:`);
  console.log(`👉 http://localhost:${config.port}`);
  console.log(`========================================================\n`);

  // Inicializa o agendador de lembretes e relatórios
  initScheduler();

  // Inicializa a conexão com o WhatsApp via Baileys
  initWhatsApp().catch(err => {
    logMessage('ERROR', `[Servidor] Erro ao iniciar WhatsApp: ${err.message}`);
  });
});

// Encerramento gracioso
const shutdown = async () => {
  console.log('\n[Servidor] Encerrando aplicação...');
  await closeBrowser();
  server.close(() => {
    console.log('[Servidor] Encerrado com sucesso.');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
