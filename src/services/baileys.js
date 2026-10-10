import makeWASocket, {
  DisconnectReason,
  isLidUser,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import pino from 'pino';
import fs from 'node:fs';
import { config } from '../config/env.js';
import { logMessage, saveLidMapping, getPhoneByLid } from '../config/database.js';
import { jidToPhone, phoneToJid } from '../utils/formatter.js';
import { enqueueMessage, getConversationHistory, appendConversationHistory } from '../utils/debouncer.js';
import { extractYouTubeUrls, getYouTubeVideoTitle } from './playwright.js';
import { processMessageWithGemini } from './gemini.js';
import { getPendingItemsForPhone, getResponsiblePhonesForOpenItems, updateScheduleItemContent } from './scheduleManager.js';

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

    const senderIdentity = await resolveSenderIdentity(msg);
    logMessage('INFO', `[WhatsApp] Mensagem recebida de ${senderIdentity.logLabel}: "${text.slice(0, 80)}"`);
    if (senderIdentity.lid && !senderIdentity.primaryPhone) {
      const resolvedPhone = await resolveUnknownLidByResponsiblePhones(senderIdentity.lid);
      if (resolvedPhone) {
        senderIdentity.primaryPhone = resolvedPhone;
        senderIdentity.debounceKey = resolvedPhone;
        senderIdentity.logLabel = `${resolvedPhone} (LID ${senderIdentity.lid})`;
      }
    }

    // 4. Enfileira a mensagem no debouncer de 10 segundos para mensagens picadas
    enqueueMessage(senderIdentity.debounceKey, text, async (combinedText) => {
      await processDebouncedMessage(remoteJid, senderIdentity, combinedText);
    });
  } catch (err) {
    logMessage('ERROR', `[WhatsApp] Erro no processamento de mensagem: ${err.message}`);
  }
}

/**
 * Resolve a identidade real do remetente quando o WhatsApp entrega mensagens usando LID (@lid)
 * em vez do número de telefone tradicional (@s.whatsapp.net).
 */
async function resolveSenderIdentity(msg) {
  const candidates = [
    msg.key.remoteJid,
    msg.key.remoteJidAlt,
    msg.key.participant,
    msg.key.participantAlt
  ].filter(Boolean);

  let lid = '';
  let lidJid = '';
  const phoneCandidates = [];

  for (const jid of candidates) {
    if (isLidUser(jid) || jid.endsWith('@lid') || jid.includes('@lid')) {
      lid = jidToPhone(jid);
      lidJid = jid;
    } else if (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us')) {
      phoneCandidates.push(jidToPhone(jid));
    }
  }

  // Se o Baileys já armazenou o relacionamento LID -> PN, usa essa fonte oficial primeiro.
  if (lidJid && sock?.signalRepository?.lidMapping?.getPNForLID) {
    try {
      const pnJid = await sock.signalRepository.lidMapping.getPNForLID(lidJid);
      if (pnJid) {
        const resolvedPhone = jidToPhone(pnJid);
        phoneCandidates.unshift(resolvedPhone);
        saveLidMapping(lid, resolvedPhone);
      }
    } catch (err) {
      logMessage('WARN', `[WhatsApp] Não foi possível resolver PN para LID ${lidJid}: ${err.message}`);
    }
  }

  // Fallback: mapeamento local persistido em SQLite.
  if (lid) {
    const mappedPhone = getPhoneByLid(lid);
    if (mappedPhone) {
      phoneCandidates.unshift(mappedPhone);
    }
  }

  const uniquePhones = Array.from(new Set(phoneCandidates.filter(Boolean)));
  const primaryPhone = uniquePhones[0] || '';
  const alternativePhones = uniquePhones.slice(1);
  const debounceKey = primaryPhone || lid || jidToPhone(msg.key.remoteJid || '');
  const logLabel = primaryPhone
    ? `${primaryPhone}${lid ? ` (LID ${lid})` : ''}`
    : (lid ? `${lid} (LID sem PN resolvido)` : debounceKey);

  return {
    primaryPhone,
    alternativePhones,
    lid,
    lidJid,
    debounceKey,
    logLabel
  };
}

/**
 * Tenta resolver um LID desconhecido consultando os responsáveis cadastrados em cronogramas abertos.
 * Isso cobre casos em que a primeira mensagem chega só como @lid e o Baileys ainda não populou o mapping.
 */
async function resolveUnknownLidByResponsiblePhones(lid) {
  if (!lid || !sock?.signalRepository?.lidMapping?.getLIDForPN) return null;

  const lidDigits = jidToPhone(lid);
  const responsiblePhones = getResponsiblePhonesForOpenItems();

  for (const phone of responsiblePhones) {
    try {
      const lidJid = await sock.signalRepository.lidMapping.getLIDForPN(phoneToJid(phone));
      if (lidJid && jidToPhone(lidJid) === lidDigits) {
        saveLidMapping(lidDigits, phone);
        logMessage('INFO', `[WhatsApp] LID ${lidDigits} associado ao telefone responsável ${phone}.`);
        return phone;
      }
    } catch (err) {
      logMessage('WARN', `[WhatsApp] Falha ao comparar LID ${lidDigits} com responsável ${phone}: ${err.message}`);
    }
  }

  return null;
}

/**
 * Função executada após o término da janela de 10 segundos de espera por mensagens picadas.
 */
async function processDebouncedMessage(remoteJid, senderIdentity, combinedText) {
  logMessage('INFO', `[Processamento] Processando mensagem acumulada de ${senderIdentity.logLabel}: "${combinedText.slice(0, 100)}"`);

  // 1. Verifica se a pessoa é responsável por algum item do cronograma.
  // Em contas recentes o WhatsApp pode entregar mensagens usando LID (@lid) em vez do número (@s.whatsapp.net).
  // Por isso a busca considera: número resolvido via Baileys, número vindo do remoteJidAlt e mapeamentos LID salvos.
  const pendingItems = getPendingItemsForPhone(senderIdentity.primaryPhone, senderIdentity.alternativePhones);

  if (!pendingItems || pendingItems.length === 0) {
    logMessage('WARN', `[WhatsApp] Mensagem de ${senderIdentity.logLabel} ignorada: remetente não é responsável por nenhum momento de cronograma em aberto.`);
    return;
  }

  const historyKey = senderIdentity.primaryPhone || senderIdentity.lid || senderIdentity.debounceKey;
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
  const history = getConversationHistory(historyKey);

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
  appendConversationHistory(historyKey, 'user', combinedText);
  appendConversationHistory(historyKey, 'model', aiResult.reply_message);

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
