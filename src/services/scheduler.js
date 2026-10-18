import cron from 'node-cron';
import { db, logMessage, getSetting } from '../config/database.js';
import { getAllSchedules, renewCompletedSchedules } from './scheduleManager.js';
import { formatScheduleForWhatsApp } from '../utils/formatter.js';
import { getUnsentReminderItems, sendReminderMessages, markReminderItemsSent, suppressAutomaticForPreviousManualReminders } from './reminders.js';
import { sendWhatsAppMessage } from './baileys.js';
import {
  getZonedParts,
  addDaysToDateString,
  getMinuteDifference,
  getSafeTimezone,
  getSafeReminderTime
} from '../utils/timezone.js';

let cronJob = null;

/**
 * Inicia os agendamentos automáticos do sistema.
 */
export function initScheduler() {
  suppressAutomaticForPreviousManualReminders(db);
  logMessage('INFO', '[Scheduler] Inicializando agendador de tarefas periódicas...');

  // Executa a cada minuto para verificar lembretes da véspera, alertas de 1h antes e renovações
  cronJob = cron.schedule('* * * * *', async () => {
    try {
      await checkEveReminders();
      await checkOneHourSonoplastaAlert();
      renewCompletedSchedules();
    } catch (err) {
      logMessage('ERROR', `[Scheduler] Erro no ciclo do agendador: ${err.message}`);
    }
  });

  // Execução imediata na inicialização
  checkEveReminders().catch(() => {});
  checkOneHourSonoplastaAlert().catch(() => {});
  renewCompletedSchedules();

  logMessage('INFO', '[Scheduler] Agendador ativo e monitorando.');
}

/**
 * 1. Lembretes da Véspera:
 * Envia mensagem no dia anterior para todos os responsáveis por itens mutáveis pendentes
 * assim que o horário configurado (default: 09:00) for atingido no fuso do Sonoplasta.
 */
export async function checkEveReminders() {
  const tz = getSafeTimezone(getSetting('timezone', 'America/Sao_Paulo'));
  const reminderTime = getSafeReminderTime(getSetting('reminder_time', '09:00'));

  const now = new Date();
  const { dateStr: todayStr, timeStr: currentTimeStr } = getZonedParts(now, tz);

  // Se ainda não atingiu o horário configurado para envio de lembretes na véspera (ex: 09:00), aguarda
  if (currentTimeStr < reminderTime) {
    return;
  }

  // Calcula a data de amanhã (YYYY-MM-DD) no fuso local
  const tomorrowStr = addDaysToDateString(todayStr, 1);

  const schedules = getAllSchedules();

  for (const schedule of schedules) {
    // Se o culto for amanhã e o lembrete ainda não tiver sido enviado
    if (schedule.next_run_date === tomorrowStr && !schedule.reminder_sent) {
      logMessage('INFO', `[Scheduler] Disparando lembretes da véspera (horário configurado: ${reminderTime}, fuso: ${tz}) para o cronograma: "${schedule.title}" (${schedule.next_run_date})`);

      const items = getUnsentReminderItems(schedule);
      if (items.length === 0) {
        markReminderItemsSent(db, schedule, []);
        continue;
      }

      const { sentItems, sentCount, totalCount } = await sendReminderMessages(
        schedule, items, sendWhatsAppMessage,
        () => !db.prepare('SELECT reminder_sent FROM schedules WHERE id = ?').get(schedule.id)?.reminder_sent
      );
      if (sentItems.length > 0) markReminderItemsSent(db, schedule, sentItems);
      logMessage('INFO', `[Scheduler] Lembretes da véspera enviados para ${sentCount} de ${totalCount} responsável(is) do cronograma ID ${schedule.id}`);
    }
  }
}

/**
 * 2. Alerta para o Sonoplasta (1 hora antes do início do culto):
 * Envia o cronograma completo com formatação própria do WhatsApp para o Sonoplasta,
 * calculado no fuso horário configurado.
 */
export async function checkOneHourSonoplastaAlert() {
  const sonoplastaPhone = getSetting('sonoplasta_phone');
  if (!sonoplastaPhone) {
    return; // Sonoplasta ainda não cadastrou o número
  }

  const tz = getSafeTimezone(getSetting('timezone', 'America/Sao_Paulo'));
  const now = new Date();
  const { dateStr: todayStr } = getZonedParts(now, tz);

  const schedules = getAllSchedules();

  for (const schedule of schedules) {
    if (schedule.next_run_date === todayStr && !schedule.sonoplasta_alert_sent) {
      // Diferença em minutos entre o início do culto no fuso local e o instante atual
      const diffMinutes = getMinuteDifference(schedule.next_run_date, schedule.event_time, now, tz);

      // Se faltar entre 0 e 65 minutos para o início do culto
      if (diffMinutes <= 65 && diffMinutes >= 0) {
        logMessage('INFO', `[Scheduler] Faltam ~${diffMinutes} minutos para o culto "${schedule.title}". Enviando cronograma para o Sonoplasta (${sonoplastaPhone})...`);

        const formattedMessage = formatScheduleForWhatsApp(schedule, schedule.items);
        const sent = await sendWhatsAppMessage(sonoplastaPhone, formattedMessage);

        if (sent) {
          db.prepare('UPDATE schedules SET sonoplasta_alert_sent = 1 WHERE id = ?').run(schedule.id);
          logMessage('INFO', `[Scheduler] Cronograma enviado com sucesso ao Sonoplasta para o culto ID ${schedule.id}`);
        }
      }
    }
  }
}
