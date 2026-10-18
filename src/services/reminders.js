import { formatReminderMessage } from '../utils/formatter.js';

export function getEligibleReminderItems(schedule) {
  return schedule.items.filter(item => !item.is_immutable && item.responsible_phone);
}

export function getUnsentReminderItems(schedule) {
  return getEligibleReminderItems(schedule).filter(item => item.reminder_sent_for_date !== schedule.next_run_date);
}

export function suppressAutomaticForPreviousManualReminders(db) {
  const migrationKey = 'manual_reminder_suppression_migrated';
  if (db.prepare('SELECT value FROM settings WHERE key = ?').get(migrationKey)?.value === '1') return;

  db.exec('BEGIN');
  try {
    // Registros anteriores de seleção parcial não bloqueavam o envio automático.
    db.exec(`
      UPDATE schedules SET reminder_sent = 1
      WHERE reminder_sent = 0 AND EXISTS (
        SELECT 1 FROM schedule_items
        WHERE schedule_items.schedule_id = schedules.id
          AND schedule_items.reminder_sent_for_date = schedules.next_run_date
      )
    `);
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(migrationKey, '1');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function markReminderItemsSent(db, schedule, items, { suppressAutomatic = false } = {}) {
  const update = db.prepare('UPDATE schedule_items SET reminder_sent_for_date = ? WHERE id = ? AND schedule_id = ? AND is_immutable = 0 AND responsible_phone = ?');
  db.exec('BEGIN');
  try {
    for (const item of items) update.run(schedule.next_run_date, item.id, schedule.id, item.responsible_phone);
    const remaining = db.prepare(`
      SELECT COUNT(*) AS count FROM schedule_items
      WHERE schedule_id = ? AND is_immutable = 0 AND responsible_phone IS NOT NULL AND responsible_phone <> ''
        AND (reminder_sent_for_date IS NULL OR reminder_sent_for_date <> ?)
    `).get(schedule.id, schedule.next_run_date).count;
    db.prepare('UPDATE schedules SET reminder_sent = ? WHERE id = ? AND reminder_sent = 0').run(suppressAutomatic || remaining === 0 ? 1 : 0, schedule.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function selectReminderItems(schedule, itemIds) {
  if (!Array.isArray(itemIds) || itemIds.length === 0 ||
      itemIds.some(id => !Number.isSafeInteger(id) || id <= 0) ||
      new Set(itemIds).size !== itemIds.length) {
    return null;
  }

  const selectedIds = new Set(itemIds);
  const eligibleItems = getEligibleReminderItems(schedule);
  const eligibleIds = new Set(eligibleItems.map(item => item.id));
  if (itemIds.some(id => !eligibleIds.has(id))) return null;

  return eligibleItems.filter(item => selectedIds.has(item.id));
}

export async function sendReminderMessages(schedule, items, sendMessage, shouldSend = () => true) {
  const itemsByPhone = new Map();
  for (const item of items) {
    if (!itemsByPhone.has(item.responsible_phone)) {
      itemsByPhone.set(item.responsible_phone, {
        name: item.responsible_name || 'Irmão(ã)',
        items: []
      });
    }
    itemsByPhone.get(item.responsible_phone).items.push(item);
  }

  const sentItems = [];
  let sentCount = 0;
  for (const [phone, data] of itemsByPhone.entries()) {
    if (!shouldSend()) break;
    const message = formatReminderMessage(data.name, schedule, data.items);
    try {
      if (await sendMessage(phone, message)) {
        sentCount++;
        sentItems.push(...data.items);
      }
    } catch (err) {
      console.error(`[Lembretes] Falha ao enviar para ${phone}:`, err);
    }
  }

  return { sentItems, sentCount, totalCount: itemsByPhone.size };
}
