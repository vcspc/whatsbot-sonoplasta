import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import pino from 'pino';
import fs from 'node:fs';
import { config } from '../config/env.js';
import { logMessage, getSetting } from '../config/database.js';
import { jidToPhone, phoneToJid, arePhonesEqual } from '../utils/formatter.js';
import { enqueueMessage, getConversationHistory, appendConversationHistory } from '../utils/debouncer.js';
import { extractYouTubeUrls, getYouTubeVideoTitle } from './playwright.js';
import { processMessageWithGemini } from './gemini.js';
import { getPendingItemsForPhone, updateScheduleItemContent } from './scheduleManager.js';

let sock = null;
let currentQrCodeDataUrl = null;
let connectionStatus = 'DISCONNECTED'; // 'DISCONNECTED', 'SCAN_QR', 'CONNECTING', 'CONNECTED'
let reconnectAttempts = 0;

export function getWhatsAppStatus() {
  return {
    status: connectionStatus,
    qrCode: currentQrCodeDataUrl,
    phoneNumber: sock?.user?.id ? jidToPhone(sock.user.id) : null
  };
}

/**
 * Inicializa a conexão com o WhatsApp usando Baileys.
 */
export async function initWhatsApp() {
  if (!fs.existsSync(config.authDir)) {
    fs.mkdirSync(config.authDir, { recursive: true });
  }

  connectionStatus = 'CONNECTING';
  logMessage('INFO', '[WhatsApp] Iniciando cliente Baileys...');

  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);

  sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['WhatsBot Sonoplasta', 'Chrome', '1.0.0']
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      connectionStatus = 'SCAN_QR';
      logMessage('INFO', '[WhatsApp] Novo QR Code gerado para leitura.');

      try {
        currentQrCodeDataUrl = await QRCode.toDataURL(qr);
      } catch (err) {
        logMessage('ERROR', `[WhatsApp] Erro ao gerar DataURL do QR Code: ${err.message}`);
      }

      console.log('\n--- ESCANEIE O QR CODE ABAIXO NO SEU WHATSAPP ---');
      qrcodeTerminal.generate(qr, { small: true });
    }

    if (connection === 'close') {
      currentQrCodeDataUrl = null;
      connectionStatus = 'DISCONNECTED';

      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      logMessage('WARN', `[WhatsApp] Conexão encerrada. Código: ${statusCode}. Reconectar? ${shouldReconnect}`);

      if (shouldReconnect) {
        reconnectAttempts++;
        const delay = Math.min(reconnectAttempts * 3000, 20000);
        logMessage('INFO', `[WhatsApp] Tentando reconectar em ${delay / 1000}s...`);
        setTimeout(() => {
          initWhatsApp();
        }, delay);
      } else {
        logMessage('WARN', '[WhatsApp] Desconectado permanentemente (Logged out). Limpe a pasta de autenticação se desejar reiniciar.');
      }
    } else if (connection === 'open') {
      reconnectAttempts = 0;
      currentQrCodeDataUrl = null;
      connectionStatus = 'CONNECTED';
      const userPhone = sock.user?.id ? jidToPhone(sock.user.id) : '';
      logMessage('INFO', `[WhatsApp] Conexão estabelecida com sucesso! Conectado como: ${userPhone}`);
    }
  });

  // Listener de recebimento de mensagens
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' || !messages || messages.length === 0) return;

    for (const msg of messages) {
      await handleIncomingMessage(msg);
    }
  });

  return sock;
}

/**
 * Processa mensagens recebidas aplicando filtros de segurança, debouncing de 10s e inteligência artificial.
 */
async function handleIncomingMessage(msg) {
  try {
    // 1. Ignora mensagens enviadas pelo próprio bot
    if (msg.key.fromMe) return;

    const remoteJid = msg.key.remoteJid;
    if (!remoteJid) return;

    // 2. BLOQUEIO DE GRUPOS E BROADCAST DE STATUS:
    // "Ele deve bloquear responder a mensagens de grupos e broadcast de status."
    if (
      remoteJid.endsWith('@g.us') ||
      remoteJid === 'status@broadcast' ||
      remoteJid.includes('@broadcast') ||
      msg.key.participant
    ) {
      return;
    }

    // 3. Extrai o texto da mensagem
    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      '';

    if (!text || !text.trim()) return;

    const senderPhone = jidToPhone(remoteJid);
    logMessage('INFO', `[WhatsApp] Mensagem recebida de ${senderPhone}: "${text.slice(0, 80)}"`);

    // 4. Enfileira a mensagem no debouncer de 10 segundos para mensagens picadas
    enqueueMessage(senderPhone, text, async (combinedText) => {
      await processDebouncedMessage(remoteJid, senderPhone, combinedText);
    });
  } catch (err) {
    logMessage('ERROR', `[WhatsApp] Erro no processamento de mensagem: ${err.message}`);
  }
}

/**
 * Função executada após o término da janela de 10 segundos de espera por mensagens picadas.
 */
async function processDebouncedMessage(remoteJid, senderPhone, combinedText) {
  logMessage('INFO', `[Processamento] Processando mensagem acumulada de ${senderPhone}: "${combinedText.slice(0, 100)}"`);

  // 1. Verifica se a pessoa é responsável por algum item do cronograma
  // "O bot irá receber esses itens/momentos somente da pessoa que ficou responsável e preencher os dados desse cronograma."
  const pendingItems = getPendingItemsForPhone(senderPhone);

  if (!pendingItems || pendingItems.length === 0) {
    logMessage('WARN', `[WhatsApp] Mensagem de ${senderPhone} ignorada: remetente não é responsável por nenhum momento de cronograma em aberto.`);
    return;
  }

  const responsibleName = pendingItems[0]?.responsible_name || '';

  // 2. Verifica se a mensagem contém links do YouTube para extração de título com Playwright
  const ytUrls = extractYouTubeUrls(combinedText);
  const extractedYouTubeVideos = [];

  for (const url of ytUrls) {
    const title = await getYouTubeVideoTitle(url);
    if (title) {
      extractedYouTubeVideos.push({ url, title });
    }
  }

  // 3. Carrega o histórico de conversa recente (reseta após 30min de inatividade)
  const history = getConversationHistory(senderPhone);

  // 4. Processa com a inteligência artificial do Gemini
  const aiResult = await processMessageWithGemini({
    responsibleName,
    userMessage: combinedText,
    pendingItems,
    history,
    extractedYouTubeVideos
  });

  // 5. Atualiza os itens no banco de dados SQLite
  if (Array.isArray(aiResult.updated_items) && aiResult.updated_items.length > 0) {
    for (const update of aiResult.updated_items) {
      updateScheduleItemContent(update.id, update.content);
    }
  }

  // 6. Atualiza o histórico de conversas do contato
  appendConversationHistory(senderPhone, 'user', combinedText);
  appendConversationHistory(senderPhone, 'model', aiResult.reply_message);

  // 7. Envia a resposta de confirmação de volta pelo WhatsApp
  await sendWhatsAppMessage(remoteJid, aiResult.reply_message);
}

/**
 * Envia uma mensagem de texto para um número ou JID do WhatsApp.
 */
export async function sendWhatsAppMessage(destination, text) {
  if (!sock || connectionStatus !== 'CONNECTED') {
    logMessage('WARN', `[WhatsApp] Tentativa de envio para ${destination} falhou: WhatsApp não está conectado.`);
    return false;
  }

  const jid = destination.includes('@') ? destination : phoneToJid(destination);

  try {
    await sock.sendMessage(jid, { text });
    logMessage('INFO', `[WhatsApp] Mensagem enviada com sucesso para ${destination}`);
    return true;
  } catch (err) {
    logMessage('ERROR', `[WhatsApp] Falha ao enviar mensagem para ${destination}: ${err.message}`);
    return false;
  }
}

/**
 * Desconecta a sessão atual do WhatsApp.
 */
export async function logoutWhatsApp() {
  if (sock) {
    try {
      await sock.logout();
    } catch {}
    sock = null;
    connectionStatus = 'DISCONNECTED';
    currentQrCodeDataUrl = null;
    logMessage('INFO', '[WhatsApp] Sessão desconectada com sucesso.');
  }
}
