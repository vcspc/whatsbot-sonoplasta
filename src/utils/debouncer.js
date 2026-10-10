import { db, logMessage } from '../config/database.js';

// Mapa em memória para o debounce de 10 segundos: phone -> { timer, messages: [] }
const debounceMap = new Map();

const DEBOUNCE_DELAY_MS = 10000; // 10 segundos
const HISTORY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutos

/**
 * Adiciona uma mensagem ao buffer de debounce de um remetente.
 * Se nenhuma nova mensagem chegar em 10 segundos, o callback `onDebounced` é executado com as mensagens acumuladas.
 *
 * @param {string} phone - Número do remetente
 * @param {string} text - Texto da mensagem recebida
 * @param {Function} onDebounced - Callback assíncrono chamado após 10s: async (combinedText) => {}
 */
export function enqueueMessage(phone, text, onDebounced, delayMs = DEBOUNCE_DELAY_MS) {
  const existing = debounceMap.get(phone);

  if (existing) {
    clearTimeout(existing.timer);
    existing.messages.push(text);
    if (onDebounced) {
      existing.callback = onDebounced;
    }
    logMessage('INFO', `[Debouncer] Mensagem picada recebida de ${phone}. Total acumulado: ${existing.messages.length}`);

    existing.timer = setTimeout(async () => {
      debounceMap.delete(phone);
      const combinedText = existing.messages.join('\n').trim();
      const cb = existing.callback || onDebounced;
      try {
        if (cb) await cb(combinedText);
      } catch (err) {
        logMessage('ERROR', `[Debouncer] Erro ao processar mensagem acumulada de ${phone}: ${err.message}`);
      }
    }, delayMs);
  } else {
    const entry = {
      messages: [text],
      callback: onDebounced,
      timer: null
    };

    entry.timer = setTimeout(async () => {
      debounceMap.delete(phone);
      const combinedText = entry.messages.join('\n').trim();
      const cb = entry.callback || onDebounced;
      try {
        if (cb) await cb(combinedText);
      } catch (err) {
        logMessage('ERROR', `[Debouncer] Erro ao processar mensagem acumulada de ${phone}: ${err.message}`);
      }
    }, delayMs);

    debounceMap.set(phone, entry);
    logMessage('INFO', `[Debouncer] Aguardando ${delayMs / 1000}s para possíveis mensagens picadas de ${phone}...`);
  }
}

/**
 * Obtém o histórico de conversa do contato.
 * Reseta automaticamente se tiver passado mais de 30 minutos desde a última interação.
 *
 * @param {string} phone
 * @returns {Array<{ role: 'user' | 'model', text: string }>}
 */
export function getConversationHistory(phone) {
  try {
    const row = db.prepare('SELECT history, last_interaction FROM conversation_history WHERE phone = ?').get(phone);
    if (!row) {
      return [];
    }

    const now = Date.now();
    const lastInteraction = row.last_interaction || 0;

    // Se passou mais de 30 minutos sem interação, reseta o histórico
    if (now - lastInteraction > HISTORY_TIMEOUT_MS) {
      logMessage('INFO', `[Histórico] 30 minutos de inatividade atingidos para ${phone}. Resetando histórico.`);
      db.prepare('UPDATE conversation_history SET history = ?, last_interaction = ? WHERE phone = ?').run('[]', now, phone);
      return [];
    }

    return JSON.parse(row.history || '[]');
  } catch (err) {
    logMessage('ERROR', `[Histórico] Erro ao carregar histórico de ${phone}: ${err.message}`);
    return [];
  }
}

/**
 * Salva mensagens no histórico do contato e atualiza o timestamp da última interação.
 *
 * @param {string} phone
 * @param {string} role - 'user' ou 'model'
 * @param {string} text
 */
export function appendConversationHistory(phone, role, text) {
  try {
    const currentHistory = getConversationHistory(phone);
    currentHistory.push({
      role,
      text,
      timestamp: Date.now()
    });

    // Mantém no máximo as últimas 20 mensagens no histórico
    const trimmedHistory = currentHistory.slice(-20);

    db.prepare(`
      INSERT INTO conversation_history (phone, history, last_interaction)
      VALUES (?, ?, ?)
      ON CONFLICT(phone) DO UPDATE SET
        history = excluded.history,
        last_interaction = excluded.last_interaction
    `).run(phone, JSON.stringify(trimmedHistory), Date.now());
  } catch (err) {
    logMessage('ERROR', `[Histórico] Erro ao salvar histórico de ${phone}: ${err.message}`);
  }
}

/**
 * Limpa explicitamente o histórico de um contato.
 */
export function resetConversationHistory(phone) {
  try {
    db.prepare(`
      INSERT INTO conversation_history (phone, history, last_interaction)
      VALUES (?, '[]', ?)
      ON CONFLICT(phone) DO UPDATE SET history = '[]', last_interaction = ?
    `).run(phone, Date.now(), Date.now());
    logMessage('INFO', `[Histórico] Histórico de ${phone} resetado.`);
  } catch (err) {
    logMessage('ERROR', `[Histórico] Erro ao resetar histórico de ${phone}: ${err.message}`);
  }
}
