import { db, logMessage, getPhoneByLid } from '../config/database.js';
import { arePhonesEqual, normalizePhone } from '../utils/formatter.js';

/**
 * Calcula a próxima data de execução no formato YYYY-MM-DD.
 */
export function calculateNextRunDate(recurrence, dayOfWeek, eventTime, fromDate = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  const formatDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const now = new Date(fromDate);
  const [eventH, eventM] = (eventTime || '19:30').split(':').map(Number);

  if (recurrence === 'DAILY') {
    const todayEvent = new Date(now.getFullYear(), now.getMonth(), now.getDate(), eventH, eventM, 0);
    if (todayEvent.getTime() > now.getTime()) {
      return formatDate(now);
    }
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return formatDate(tomorrow);
  }

  if (recurrence === 'WEEKLY') {
    const targetDay = dayOfWeek !== undefined && dayOfWeek !== null ? Number(dayOfWeek) : 0;
    const currentDay = now.getDay();
    let daysUntil = (targetDay - currentDay + 7) % 7;

    if (daysUntil === 0) {
      const todayEvent = new Date(now.getFullYear(), now.getMonth(), now.getDate(), eventH, eventM, 0);
      if (todayEvent.getTime() <= now.getTime()) {
        daysUntil = 7; // Próxima semana
      }
    }

    const nextDate = new Date(now);
    nextDate.setDate(nextDate.getDate() + daysUntil);
    return formatDate(nextDate);
  }

  // Se for ONCE ou padrão
  return formatDate(now);
}

/**
 * Retorna todos os cronogramas cadastrados com seus respectivos itens.
 */
export function getAllSchedules() {
  const schedules = db.prepare('SELECT * FROM schedules ORDER BY next_run_date ASC, event_time ASC').all();
  return schedules.map(schedule => {
    const items = db.prepare('SELECT * FROM schedule_items WHERE schedule_id = ? ORDER BY item_order ASC, item_time ASC').all(schedule.id);
    return {
      ...schedule,
      items
    };
  });
}

/**
 * Retorna um cronograma específico por ID com seus itens.
 */
export function getScheduleById(id) {
  const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id);
  if (!schedule) return null;

  const items = db.prepare('SELECT * FROM schedule_items WHERE schedule_id = ? ORDER BY item_order ASC, item_time ASC').all(schedule.id);
  return {
    ...schedule,
    items
  };
}

/**
 * Cria um novo cronograma com itens.
 */
export function createSchedule(data) {
  const { title, event_time, recurrence, day_of_week, items = [] } = data;

  const next_run_date = data.next_run_date || calculateNextRunDate(recurrence, day_of_week, event_time);

  const res = db.prepare(`
    INSERT INTO schedules (title, event_time, recurrence, day_of_week, next_run_date, reminder_sent, sonoplasta_alert_sent)
    VALUES (?, ?, ?, ?, ?, 0, 0)
  `).run(title, event_time, recurrence || 'WEEKLY', day_of_week !== undefined ? day_of_week : null, next_run_date);

  const scheduleId = res.lastInsertRowid;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const isImmutable = item.is_immutable ? 1 : 0;
    const content = item.content || '';
    const isFilled = isImmutable ? 1 : (content ? 1 : 0);

    db.prepare(`
      INSERT INTO schedule_items (
        schedule_id, item_order, item_time, name, content,
        responsible_name, responsible_phone, is_immutable, is_filled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      scheduleId,
      i + 1,
      item.item_time || event_time,
      item.name || 'Momento',
      content,
      item.responsible_name || '',
      normalizePhone(item.responsible_phone || ''),
      isImmutable,
      isFilled
    );
  }

  logMessage('INFO', `[Cronograma] Novo cronograma criado: "${title}" (ID: ${scheduleId}) para ${next_run_date}`);
  return getScheduleById(scheduleId);
}

/**
 * Atualiza um cronograma existente e seus itens.
 */
export function updateSchedule(id, data) {
  const existing = getScheduleById(id);
  if (!existing) return null;

  const title = data.title || existing.title;
  const event_time = data.event_time || existing.event_time;
  const recurrence = data.recurrence || existing.recurrence;
  const day_of_week = data.day_of_week !== undefined ? data.day_of_week : existing.day_of_week;
  const next_run_date = data.next_run_date || existing.next_run_date;

  db.prepare(`
    UPDATE schedules
    SET title = ?, event_time = ?, recurrence = ?, day_of_week = ?, next_run_date = ?
    WHERE id = ?
  `).run(title, event_time, recurrence, day_of_week, next_run_date, id);

  if (Array.isArray(data.items)) {
    // Remove itens antigos e insere os novos atualizados
    db.prepare('DELETE FROM schedule_items WHERE schedule_id = ?').run(id);

    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      const isImmutable = item.is_immutable ? 1 : 0;
      const content = item.content || '';
      const isFilled = isImmutable ? 1 : (content ? 1 : 0);

      db.prepare(`
        INSERT INTO schedule_items (
          schedule_id, item_order, item_time, name, content,
          responsible_name, responsible_phone, is_immutable, is_filled
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        i + 1,
        item.item_time || event_time,
        item.name || 'Momento',
        content,
        item.responsible_name || '',
        normalizePhone(item.responsible_phone || ''),
        isImmutable,
        isFilled
      );
    }
  }

  logMessage('INFO', `[Cronograma] Cronograma atualizado: "${title}" (ID: ${id})`);
  return getScheduleById(id);
}

/**
 * Remove um cronograma e seus itens (CASCADE).
 */
export function deleteSchedule(id) {
  const existing = getScheduleById(id);
  if (!existing) return false;

  db.prepare('DELETE FROM schedule_items WHERE schedule_id = ?').run(id);
  db.prepare('DELETE FROM schedules WHERE id = ?').run(id);

  logMessage('INFO', `[Cronograma] Cronograma removido: ID ${id}`);
  return true;
}

/**
 * Localiza itens pendentes do cronograma atribuídos a um determinado número de telefone.
 */
export function getResponsiblePhonesForOpenItems() {
  const rows = db.prepare(`
    SELECT DISTINCT responsible_phone
    FROM schedule_items
    WHERE is_immutable = 0
      AND responsible_phone IS NOT NULL
      AND responsible_phone <> ''
  `).all();

  return rows.map(row => row.responsible_phone).filter(Boolean);
}

export function getPendingItemsForPhone(senderPhone, alternativePhones = []) {
  const allSchedules = getAllSchedules();
  const matched = [];

  const phonesToCheck = [senderPhone, ...alternativePhones].filter(Boolean);
  const mappedPhone = getPhoneByLid(senderPhone);
  if (mappedPhone) {
    phonesToCheck.push(mappedPhone);
  }

  for (const schedule of allSchedules) {
    for (const item of schedule.items) {
      // Ignora itens imutáveis
      if (item.is_immutable) continue;

      // Verifica se o telefone do remetente (ou PN resolvido a partir do LID) bate com o telefone do responsável
      if (phonesToCheck.some(phone => arePhonesEqual(phone, item.responsible_phone))) {
        matched.push({
          ...item,
          schedule_title: schedule.title,
          schedule_date: schedule.next_run_date,
          schedule_time: schedule.event_time
        });
      }
    }
  }

  return matched;
}

/**
 * Atualiza o conteúdo de um item específico do cronograma.
 */
export function updateScheduleItemContent(itemId, newContent) {
  const item = db.prepare('SELECT * FROM schedule_items WHERE id = ?').get(itemId);
  if (!item) return false;

  db.prepare(`
    UPDATE schedule_items
    SET content = ?, is_filled = 1
    WHERE id = ?
  `).run(newContent, itemId);

  logMessage('INFO', `[Cronograma] Item ID ${itemId} ("${item.name}") atualizado com conteúdo: "${newContent.slice(0, 50)}..."`);
  return true;
}

/**
 * Renova cronogramas cuja data/horário já passou.
 * Para cronogramas repetidos (DAILY ou WEEKLY):
 * - Avança para a próxima data.
 * - Limpa o conteúdo dos itens mutáveis para que possam ser preenchidos novamente.
 * - Mantém os itens imutáveis intactos!
 * - Reseta os marcadores de lembrete e alerta do sonoplasta.
 */
export function renewCompletedSchedules() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const currentTimeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const schedules = db.prepare('SELECT * FROM schedules').all();

  for (const schedule of schedules) {
    // Verifica se já passou da data ou se é hoje e já passou do horário do culto
    const isPastDate = schedule.next_run_date < todayStr;
    const isTodayPastTime = schedule.next_run_date === todayStr && schedule.event_time < currentTimeStr;

    if (isPastDate || isTodayPastTime) {
      if (schedule.recurrence === 'DAILY' || schedule.recurrence === 'WEEKLY') {
        const nextDate = calculateNextRunDate(
          schedule.recurrence,
          schedule.day_of_week,
          schedule.event_time,
          new Date(now.getTime() + 24 * 60 * 60 * 1000) // Calcula a partir de amanhã
        );

        // Atualiza a data e reseta flags de envio
        db.prepare(`
          UPDATE schedules
          SET next_run_date = ?, reminder_sent = 0, sonoplasta_alert_sent = 0
          WHERE id = ?
        `).run(nextDate, schedule.id);

        // Limpa o conteúdo APENAS dos itens mutáveis (itens imutáveis são mantidos)
        db.prepare(`
          UPDATE schedule_items
          SET content = '', is_filled = 0
          WHERE schedule_id = ? AND is_immutable = 0
        `).run(schedule.id);

        logMessage('INFO', `[Cronograma] Renovado com sucesso: "${schedule.title}" (ID: ${schedule.id}). Nova data: ${nextDate}. Itens mutáveis reiniciados.`);
      }
    }
  }
}
