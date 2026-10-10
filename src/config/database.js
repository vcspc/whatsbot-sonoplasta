import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
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
    is_filled INTEGER DEFAULT 0
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
`);

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

export function logMessage(level, message) {
  try {
    db.prepare('INSERT INTO bot_logs (level, message) VALUES (?, ?)').run(level, message);
    console.log(`[${level}] ${message}`);
  } catch (err) {
    console.error('Erro ao gravar log no banco:', err);
  }
}
