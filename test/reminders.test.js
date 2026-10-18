import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import {
  getEligibleReminderItems,
  getUnsentReminderItems,
  selectReminderItems,
  sendReminderMessages,
  markReminderItemsSent,
  suppressAutomaticForPreviousManualReminders
} from '../src/services/reminders.js';

function makeSchedule() {
  return {
    id: 1,
    title: 'Culto de Teste',
    event_time: '19:30',
    next_run_date: '2026-10-18',
    items: [
      { id: 11, schedule_id: 1, item_order: 1, item_time: '19:30', name: 'Abertura', responsible_name: 'Ana', responsible_phone: '5511999991111', is_immutable: 0, reminder_sent_for_date: '' },
      { id: 12, schedule_id: 1, item_order: 2, item_time: '20:00', name: 'Louvor', responsible_name: 'Ana', responsible_phone: '5511999991111', is_immutable: 0, reminder_sent_for_date: '' },
      { id: 13, schedule_id: 1, item_order: 3, item_time: '20:30', name: 'Mensagem', responsible_name: 'Bruno', responsible_phone: '5511999992222', is_immutable: 0, reminder_sent_for_date: '' },
      { id: 14, schedule_id: 1, item_order: 4, item_time: '21:00', name: 'Oração', responsible_name: 'Carol', responsible_phone: '5511999993333', is_immutable: 1, reminder_sent_for_date: '' },
      { id: 15, schedule_id: 1, item_order: 5, item_time: '21:30', name: 'Avisos', responsible_name: 'Davi', responsible_phone: '', is_immutable: 0, reminder_sent_for_date: '' }
    ]
  };
}

test('somente itens elegíveis do cronograma podem ser selecionados', () => {
  const schedule = makeSchedule();
  assert.deepEqual(getEligibleReminderItems(schedule).map(item => item.id), [11, 12, 13]);
  assert.deepEqual(selectReminderItems(schedule, [13, 11]).map(item => item.id), [11, 13]);
  for (const invalid of [undefined, null, [], [14], [15], [999], [11, 999], [11, 11], ['11'], [11.5], [0], {}]) {
    assert.equal(selectReminderItems(schedule, invalid), null);
  }
});

test('envia apenas os momentos selecionados para o telefone de cada responsável', async () => {
  const schedule = makeSchedule();
  const sends = [];
  const selected = selectReminderItems(schedule, [12, 13]);
  const result = await sendReminderMessages(schedule, selected, async (phone, message) => {
    sends.push({ phone, message });
    return true;
  });

  assert.deepEqual(sends.map(send => send.phone), ['5511999991111', '5511999992222']);
  assert.match(sends[0].message, /Louvor/);
  assert.doesNotMatch(sends[0].message, /Abertura|Mensagem/);
  assert.match(sends[1].message, /Mensagem/);
  assert.doesNotMatch(sends[1].message, /Abertura|Louvor/);
  assert.deepEqual(result.sentItems.map(item => item.id), [12, 13]);
  assert.equal(result.sentCount, 2);
});

test('agrupa momentos do mesmo telefone e registra apenas envios bem-sucedidos', async () => {
  const schedule = makeSchedule();
  const sends = [];
  const result = await sendReminderMessages(schedule, selectReminderItems(schedule, [11, 12, 13]), async (phone, message) => {
    sends.push({ phone, message });
    return phone === '5511999991111';
  });

  assert.equal(sends.length, 2);
  assert.match(sends[0].message, /Abertura/);
  assert.match(sends[0].message, /Louvor/);
  assert.deepEqual(result.sentItems.map(item => item.id), [11, 12]);
  assert.equal(result.sentCount, 1);
  assert.equal(result.totalCount, 2);
});

test('o disparo manual não autoriza o automático a enviar para responsáveis não selecionados', async () => {
  const schedule = makeSchedule();
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE schedules (id INTEGER PRIMARY KEY, reminder_sent INTEGER DEFAULT 0);
      CREATE TABLE schedule_items (id INTEGER PRIMARY KEY, schedule_id INTEGER, is_immutable INTEGER,
        responsible_phone TEXT, reminder_sent_for_date TEXT);
      INSERT INTO schedules (id) VALUES (1);
    `);
    const insert = db.prepare('INSERT INTO schedule_items VALUES (?, ?, ?, ?, ?)');
    for (const item of schedule.items) {
      insert.run(item.id, item.schedule_id, item.is_immutable, item.responsible_phone, item.reminder_sent_for_date);
    }

    const sends = [];
    const items = selectReminderItems(schedule, [11]);
    markReminderItemsSent(db, schedule, [], { suppressAutomatic: true });
    assert.equal(db.prepare('SELECT reminder_sent FROM schedules WHERE id = 1').get().reminder_sent, 1);
    const { sentItems } = await sendReminderMessages(schedule, items, async phone => {
      sends.push(phone);
      return true;
    });
    markReminderItemsSent(db, schedule, sentItems, { suppressAutomatic: true });

    assert.deepEqual(sends, ['5511999991111']);
    assert.equal(db.prepare('SELECT reminder_sent FROM schedules WHERE id = 1').get().reminder_sent, 1);
    assert.deepEqual(db.prepare('SELECT id FROM schedule_items WHERE reminder_sent_for_date = ?').all(schedule.next_run_date).map(row => row.id), [11]);
    assert.equal(db.prepare('SELECT reminder_sent_for_date FROM schedule_items WHERE id = 13').get().reminder_sent_for_date, '');

    const anotherManualSend = await sendReminderMessages(schedule, selectReminderItems(schedule, [13]), async phone => {
      sends.push(phone);
      return true;
    });
    assert.deepEqual(sends, ['5511999991111', '5511999992222']);
    markReminderItemsSent(db, schedule, anotherManualSend.sentItems, { suppressAutomatic: true });
    assert.equal(db.prepare('SELECT reminder_sent FROM schedules WHERE id = 1').get().reminder_sent, 1);
    markReminderItemsSent(db, schedule, [], { suppressAutomatic: false });
    assert.equal(db.prepare('SELECT reminder_sent FROM schedules WHERE id = 1').get().reminder_sent, 1);
  } finally {
    db.close();
  }
});

test('a atualização protege seleções manuais feitas antes da correção', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE schedules (id INTEGER PRIMARY KEY, next_run_date TEXT, reminder_sent INTEGER DEFAULT 0);
      CREATE TABLE schedule_items (id INTEGER PRIMARY KEY, schedule_id INTEGER, reminder_sent_for_date TEXT);
      INSERT INTO schedules VALUES (1, '2026-10-18', 0), (2, '2026-10-18', 0), (3, '2026-10-18', 0);
      INSERT INTO schedule_items VALUES (11, 1, '2026-10-18'), (12, 1, ''), (21, 2, ''), (31, 3, '2026-10-11');
    `);
    suppressAutomaticForPreviousManualReminders(db);
    assert.deepEqual(db.prepare('SELECT reminder_sent FROM schedules ORDER BY id').all().map(row => row.reminder_sent), [1, 0, 0]);
    suppressAutomaticForPreviousManualReminders(db);
    assert.deepEqual(db.prepare('SELECT reminder_sent FROM schedules ORDER BY id').all().map(row => row.reminder_sent), [1, 0, 0]);
  } finally {
    db.close();
  }
});

test('o automático interrompe envios se um envio manual começar durante o lote', async () => {
  const schedule = makeSchedule();
  const sent = [];
  let blocked = false;
  const result = await sendReminderMessages(schedule, selectReminderItems(schedule, [11, 13]), async phone => {
    sent.push(phone);
    blocked = true;
    return true;
  }, () => !blocked);
  assert.deepEqual(sent, ['5511999991111']);
  assert.deepEqual(result.sentItems.map(item => item.id), [11]);
});

test('o automático não repete itens já lembrados e envia os restantes sem disparo manual', () => {
  const schedule = makeSchedule();
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE schedules (id INTEGER PRIMARY KEY, reminder_sent INTEGER DEFAULT 0);
      CREATE TABLE schedule_items (id INTEGER PRIMARY KEY, schedule_id INTEGER, is_immutable INTEGER,
        responsible_phone TEXT, reminder_sent_for_date TEXT);
      INSERT INTO schedules (id) VALUES (1);
    `);
    const insert = db.prepare('INSERT INTO schedule_items VALUES (?, ?, ?, ?, ?)');
    for (const item of schedule.items) {
      insert.run(item.id, item.schedule_id, item.is_immutable, item.responsible_phone, item.reminder_sent_for_date);
    }

    markReminderItemsSent(db, schedule, selectReminderItems(schedule, [11]));
    assert.equal(db.prepare('SELECT reminder_sent FROM schedules WHERE id = 1').get().reminder_sent, 0);
    schedule.items[0].reminder_sent_for_date = schedule.next_run_date;
    assert.deepEqual(getUnsentReminderItems(schedule).map(item => item.id), [12, 13]);

    markReminderItemsSent(db, schedule, selectReminderItems(schedule, [12, 13]));
    assert.equal(db.prepare('SELECT reminder_sent FROM schedules WHERE id = 1').get().reminder_sent, 1);
    assert.deepEqual(db.prepare('SELECT id FROM schedule_items WHERE reminder_sent_for_date = ? ORDER BY id').all(schedule.next_run_date).map(row => row.id), [11, 12, 13]);

    schedule.next_run_date = '2026-10-25';
    assert.deepEqual(getUnsentReminderItems(schedule).map(item => item.id), [11, 12, 13]);
  } finally {
    db.close();
  }
});
