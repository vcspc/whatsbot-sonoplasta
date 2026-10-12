import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config/env.js';
import { logMessage } from './config/database.js';
import apiRoutes from './routes/api.js';
import whatsappRoutes from './routes/whatsapp.js';
import authRoutes from './routes/auth.js';
import { requireAuth } from './middlewares/auth.js';
import { initWhatsApp } from './services/baileys.js';
import { initScheduler } from './services/scheduler.js';
import { closeBrowser } from './services/playwright.js';
import { startNgrokTunnel, stopNgrokTunnel } from './services/ngrok.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Rotas de Autenticação (Login público, verificação e troca de senha)
app.use('/api/auth', authRoutes);

// Rotas da API e WhatsApp protegidas por autenticação
app.use('/api', requireAuth, apiRoutes);
app.use('/api/whatsapp', requireAuth, whatsappRoutes);

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

  // Inicializa o túnel Ngrok para acesso remoto pela internet
  startNgrokTunnel().catch(err => {
    logMessage('ERROR', `[Servidor] Erro ao iniciar Ngrok: ${err.message}`);
  });

  // Inicializa a conexão com o WhatsApp via Baileys
  initWhatsApp().catch(err => {
    logMessage('ERROR', `[Servidor] Erro ao iniciar WhatsApp: ${err.message}`);
  });
});

// Encerramento gracioso
const shutdown = async () => {
  console.log('\n[Servidor] Encerrando aplicação...');
  await stopNgrokTunnel();
  await closeBrowser();
  server.close(() => {
    console.log('[Servidor] Encerrado com sucesso.');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
