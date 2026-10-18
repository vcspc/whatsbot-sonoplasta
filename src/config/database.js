import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './env.js';

if (!fs.existsSync(config.dataDir)) {
  fs.mkdirSync(config.dataDir, { recursive: true });
}

const dbPath = path.join(config.dataDir, 'whatsbot.db');
export const db = new DatabaseSync(dbPath);

// Enable WAL and foreign keys
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    event_time TEXT NOT NULL,
    recurrence TEXT NOT NULL DEFAULT 'WEEKLY', -- DAILY, WEEKLY, ONCE
    day_of_week INTEGER,                      -- 0 (Dom) a 6 (Sab)
    next_run_date TEXT NOT NULL,              -- YYYY-MM-DD
    reminder_sent INTEGER DEFAULT 0,
    sonoplasta_alert_sent INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS schedule_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
    item_order INTEGER NOT NULL DEFAULT 0,
    item_time TEXT NOT NULL,
    name TEXT NOT NULL,
    content TEXT DEFAULT '',
    responsible_name TEXT DEFAULT '',
    responsible_phone TEXT DEFAULT '',
    is_immutable INTEGER DEFAULT 0,
    is_filled INTEGER DEFAULT 0,
    reminder_sent_for_date TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS conversation_history (
    phone TEXT PRIMARY KEY,
    history TEXT DEFAULT '[]',
    last_interaction INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS bot_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT DEFAULT (datetime('now', 'localtime')),
    level TEXT DEFAULT 'INFO',
    message TEXT
  );

  CREATE TABLE IF NOT EXISTS lid_mappings (
    lid TEXT PRIMARY KEY,
    phone TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
`);

// Cronogramas existentes podem ter sido criados antes do controle por momento.
const itemColumns = db.prepare('PRAGMA table_info(schedule_items)').all();
if (!itemColumns.some(column => column.name === 'reminder_sent_for_date')) {
  db.exec('BEGIN');
  try {
    db.exec("ALTER TABLE schedule_items ADD COLUMN reminder_sent_for_date TEXT DEFAULT ''");
    db.exec(`
      UPDATE schedule_items
      SET reminder_sent_for_date = (SELECT next_run_date FROM schedules WHERE schedules.id = schedule_items.schedule_id)
      WHERE is_immutable = 0 AND responsible_phone <> ''
        AND schedule_id IN (SELECT id FROM schedules WHERE reminder_sent = 1)
    `);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Helpers para mapeamento de LID (Linked Device ID) para Telefone Real
export function saveLidMapping(lid, phone) {
  if (!lid || !phone) return;
  const cleanLid = String(lid).replace(/\D/g, '');
  const cleanPhone = String(phone).replace(/\D/g, '');
  if (!cleanLid || !cleanPhone) return;

  try {
    db.prepare(`
      INSERT INTO lid_mappings (lid, phone)
      VALUES (?, ?)
      ON CONFLICT(lid) DO UPDATE SET phone = excluded.phone
    `).run(cleanLid, cleanPhone);
  } catch (err) {
    console.error('Erro ao salvar mapeamento LID-Phone:', err);
  }
}

export function getPhoneByLid(lid) {
  if (!lid) return null;
  const cleanLid = String(lid).replace(/\D/g, '');
  const row = db.prepare('SELECT phone FROM lid_mappings WHERE lid = ?').get(cleanLid);
  return row ? row.phone : null;
}

export function getLidByPhone(phone) {
  if (!phone) return null;
  const cleanPhone = String(phone).replace(/\D/g, '');
  const row = db.prepare('SELECT lid FROM lid_mappings WHERE phone = ?').get(cleanPhone);
  return row ? row.lid : null;
}

// Helpers for Settings
export function getSetting(key, defaultValue = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (row && row.value !== undefined && row.value !== null) {
    return row.value;
  }
  return defaultValue;
}

export function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

// Populate default settings from .env if not already set
if (config.sonoplastaPhone && !getSetting('sonoplasta_phone')) {
  setSetting('sonoplasta_phone', config.sonoplastaPhone);
}
if (config.geminiApiKey && !getSetting('gemini_api_key')) {
  setSetting('gemini_api_key', config.geminiApiKey);
}
if (config.botName && !getSetting('bot_name')) {
  setSetting('bot_name', config.botName);
}
if (!getSetting('timezone')) {
  setSetting('timezone', config.timezone || 'America/Sao_Paulo');
}
if (!getSetting('reminder_time')) {
  setSetting('reminder_time', config.reminderTime || '09:00');
}
if (config.ngrokAuthToken && !getSetting('ngrok_authtoken')) {
  setSetting('ngrok_authtoken', config.ngrokAuthToken);
}
if (config.ngrokDomain && !getSetting('ngrok_domain')) {
  setSetting('ngrok_domain', config.ngrokDomain);
}
if (!getSetting('ngrok_enabled')) {
  setSetting('ngrok_enabled', config.ngrokEnabled ? '1' : '0');
}

// Helpers de Autenticação Coletiva
export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, storedHash, salt) {
  if (!password || !storedHash || !salt) return false;
  try {
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
  } catch {
    return false;
  }
}

export function initAuthCredentials() {
  if (!getSetting('auth_username')) {
    setSetting('auth_username', config.adminUser || 'admin');
  }
  if (!getSetting('auth_password_hash') || !getSetting('auth_salt')) {
    const initialPass = config.adminPassword || 'admin123';
    const { hash, salt } = hashPassword(initialPass);
    setSetting('auth_password_hash', hash);
    setSetting('auth_salt', salt);
    console.log(`[Auth] Credenciais coletivas inicializadas: Usuário "${getSetting('auth_username')}" (Senha padrão: ${initialPass})`);
  }
}

export function validateCredentials(username, password) {
  const currentUsername = getSetting('auth_username', 'admin');
  const storedHash = getSetting('auth_password_hash', '');
  const salt = getSetting('auth_salt', '');

  if (!username || !password) return false;
  if (username.trim().toLowerCase() !== currentUsername.trim().toLowerCase()) return false;
  return verifyPassword(password, storedHash, salt);
}

export function changeCredentials(newUsername, newPassword) {
  if (newUsername && newUsername.trim()) {
    setSetting('auth_username', newUsername.trim());
  }
  if (newPassword && newPassword.trim()) {
    const { hash, salt } = hashPassword(newPassword.trim());
    setSetting('auth_password_hash', hash);
    setSetting('auth_salt', salt);
  }
  return true;
}

export function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = now + 7 * 24 * 60 * 60 * 1000; // 7 dias

  db.prepare('INSERT INTO sessions (token, created_at, expires_at) VALUES (?, ?, ?)').run(token, now, expiresAt);
  return { token, expiresAt };
}

export function isValidSession(token) {
  if (!token) return false;
  try {
    const row = db.prepare('SELECT expires_at FROM sessions WHERE token = ?').get(token);
    if (!row) return false;
    if (row.expires_at <= Date.now()) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function deleteSession(token) {
  if (!token) return;
  try {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  } catch (err) {
    console.error('Erro ao deletar sessão:', err);
  }
}

export function cleanupExpiredSessions() {
  try {
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  } catch (err) {
    console.error('Erro ao limpar sessões expiradas:', err);
  }
}

// Inicializa credenciais coletivas e limpa sessões antigas
initAuthCredentials();
cleanupExpiredSessions();

export function logMessage(level, message) {
  try {
    db.prepare('INSERT INTO bot_logs (level, message) VALUES (?, ?)').run(level, message);
    console.log(`[${level}] ${message}`);
  } catch (err) {
    console.error('Erro ao gravar log no banco:', err);
  }
}
