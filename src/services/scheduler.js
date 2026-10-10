import cron from 'node-cron';
import { db, logMessage, getSetting } from '../config/database.js';
import { getAllSchedules, renewCompletedSchedules } from './scheduleManager.js';
import { formatScheduleForWhatsApp, formatReminderMessage } from '../utils/formatter.js';
import { sendWhatsAppMessage } from './baileys.js';

let cronJob = null;

/**
 * Inicia os agendamentos automáticos do sistema.
 */
export function initScheduler() {
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
 * Envia mensagem no dia anterior para todos os responsáveis por itens mutáveis pendentes.
 */
export async function checkEveReminders() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');

  // Calcula a data de amanhã (YYYY-MM-DD)
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;

  const schedules = getAllSchedules();

  for (const schedule of schedules) {
    // Se o culto for amanhã e o lembrete ainda não tiver sido enviado
    if (schedule.next_run_date === tomorrowStr && !schedule.reminder_sent) {
      logMessage('INFO', `[Scheduler] Disparando lembretes da véspera para o cronograma: "${schedule.title}" (${schedule.next_run_date})`);

      // Agrupa os itens pendentes mutáveis por telefone do responsável
      const itemsByPhone = new Map();

      for (const item of schedule.items) {
        if (item.is_immutable) continue; // Pula itens imutáveis
        if (!item.responsible_phone) continue;

        const phone = item.responsible_phone;
        if (!itemsByPhone.has(phone)) {
          itemsByPhone.set(phone, {
            name: item.responsible_name || 'Irmão(ã)',
            items: []
          });
        }
        itemsByPhone.get(phone).items.push(item);
      }

      // Envia a mensagem padrão de lembrete para cada responsável
      for (const [phone, data] of itemsByPhone.entries()) {
        const message = formatReminderMessage(data.name, schedule, data.items);
        await sendWhatsAppMessage(phone, message);
      }

      // Marca o cronograma como lembrete enviado
      db.prepare('UPDATE schedules SET reminder_sent = 1 WHERE id = ?').run(schedule.id);
      logMessage('INFO', `[Scheduler] Lembretes da véspera concluídos para o cronograma ID ${schedule.id}`);
    }
  }
}

/**
 * 2. Alerta para o Sonoplasta (1 hora antes do início do culto):
 * Envia o cronograma completo com formatação própria do WhatsApp para o Sonoplasta.
 */
export async function checkOneHourSonoplastaAlert() {
  const sonoplastaPhone = getSetting('sonoplasta_phone');
  if (!sonoplastaPhone) {
    return; // Sonoplasta ainda não cadastrou o número
  }

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const schedules = getAllSchedules();

  for (const schedule of schedules) {
    if (schedule.next_run_date === todayStr && !schedule.sonoplasta_alert_sent) {
      const [h, m] = schedule.event_time.split(':').map(Number);
      const eventDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);

      // Diferença em minutos entre o horário do culto e agora
      const diffMs = eventDate.getTime() - now.getTime();
      const diffMinutes = Math.floor(diffMs / (1000 * 60));

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
