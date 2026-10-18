import { Router } from 'express';
import {
  getAllSchedules,
  getScheduleById,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  updateScheduleItemContent
} from '../services/scheduleManager.js';
import { getSetting, setSetting, db } from '../config/database.js';
import { formatScheduleForWhatsApp } from '../utils/formatter.js';
import { selectReminderItems, sendReminderMessages, markReminderItemsSent } from '../services/reminders.js';
import { sendWhatsAppMessage } from '../services/baileys.js';
import { getSafeTimezone, getSafeReminderTime, getZonedParts } from '../utils/timezone.js';
import { getNgrokStatus, restartNgrokTunnel } from '../services/ngrok.js';

const router = Router();

// --- CRONOGRAMAS ---

// Listar todos os cronogramas
router.get('/schedules', (req, res) => {
  try {
    const schedules = getAllSchedules();
    res.json({ success: true, schedules });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Obter cronograma por ID
router.get('/schedules/:id', (req, res) => {
  try {
    const schedule = getScheduleById(req.params.id);
    if (!schedule) {
      return res.status(404).json({ success: false, error: 'Cronograma não encontrado' });
    }
    res.json({ success: true, schedule });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Criar cronograma
router.post('/schedules', (req, res) => {
  try {
    const created = createSchedule(req.body);
    res.status(201).json({ success: true, schedule: created });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Atualizar cronograma
router.put('/schedules/:id', (req, res) => {
  try {
    const updated = updateSchedule(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Cronograma não encontrado' });
    }
    res.json({ success: true, schedule: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Excluir cronograma
router.delete('/schedules/:id', (req, res) => {
  try {
    const deleted = deleteSchedule(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Cronograma não encontrado' });
    }
    res.json({ success: true, message: 'Cronograma excluído com sucesso' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Atualizar conteúdo de um item avulso
router.patch('/items/:id', (req, res) => {
  try {
    const { content } = req.body;
    const ok = updateScheduleItemContent(req.params.id, content || '');
    if (!ok) {
      return res.status(404).json({ success: false, error: 'Item não encontrado' });
    }
    res.json({ success: true, message: 'Item atualizado com sucesso' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Disparo manual do cronograma para o Sonoplasta (para testes ou envio antecipado)
router.post('/schedules/:id/send-now', async (req, res) => {
  try {
    const schedule = getScheduleById(req.params.id);
    if (!schedule) {
      return res.status(404).json({ success: false, error: 'Cronograma não encontrado' });
    }

    const sonoplastaPhone = getSetting('sonoplasta_phone');
    if (!sonoplastaPhone) {
      return res.status(400).json({ success: false, error: 'Número do Sonoplasta não configurado nas configurações.' });
    }

    const formattedMessage = formatScheduleForWhatsApp(schedule, schedule.items);
    const sent = await sendWhatsAppMessage(sonoplastaPhone, formattedMessage);

    if (sent) {
      db.prepare('UPDATE schedules SET sonoplasta_alert_sent = 1 WHERE id = ?').run(schedule.id);
      res.json({ success: true, message: `Cronograma enviado para o Sonoplasta (${sonoplastaPhone})!` });
    } else {
      res.status(500).json({ success: false, error: 'Falha ao enviar mensagem. Verifique se o WhatsApp está conectado.' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Disparo manual dos lembretes para os responsáveis deste cronograma
router.post('/schedules/:id/remind-now', async (req, res) => {
  try {
    const schedule = getScheduleById(req.params.id);
    if (!schedule) {
      return res.status(404).json({ success: false, error: 'Cronograma não encontrado' });
    }

    const items = selectReminderItems(schedule, req.body?.item_ids);

    if (!items) {
      return res.status(400).json({ success: false, error: 'Selecione momentos válidos deste cronograma com telefone do responsável.' });
    }

    // Suspende o automático antes do primeiro envio para não alcançar outros responsáveis.
    markReminderItemsSent(db, schedule, [], { suppressAutomatic: true });
    const { sentItems, sentCount, totalCount } = await sendReminderMessages(schedule, items, sendWhatsAppMessage);
    if (sentItems.length > 0) markReminderItemsSent(db, schedule, sentItems, { suppressAutomatic: true });

    if (sentCount < totalCount) {
      return res.status(502).json({
        success: false,
        error: `Lembretes enviados para ${sentCount} de ${totalCount} responsável(is). Verifique a conexão do WhatsApp e tente novamente para os demais.`,
        sent_item_ids: sentItems.map(item => item.id)
      });
    }
    res.json({ success: true, message: `Lembretes enviados para ${sentCount} responsável(is).` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- RELÓGIO & TEMPO ---

router.get('/time', (req, res) => {
  try {
    const tz = getSafeTimezone(getSetting('timezone', 'America/Sao_Paulo'));
    const reminderTime = getSafeReminderTime(getSetting('reminder_time', '09:00'));
    const now = new Date();
    const parts = getZonedParts(now, tz);

    res.json({
      success: true,
      timezone: tz,
      reminder_time: reminderTime,
      timestamp: now.getTime(),
      date: parts.dateStr,
      time: `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}`,
      day_of_week: parts.dayOfWeek
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- SISTEMA / NGROK ---

router.get('/system/ngrok', (req, res) => {
  try {
    const status = getNgrokStatus();
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/system/ngrok/restart', async (req, res) => {
  try {
    const url = await restartNgrokTunnel();
    const status = getNgrokStatus();
    res.json({
      success: true,
      message: url ? `Túnel iniciado com sucesso: ${url}` : 'Tentativa de reinício concluída.',
      ...status
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- CONFIGURAÇÕES ---

router.get('/settings', (req, res) => {
  try {
    res.json({
      success: true,
      settings: {
        sonoplasta_phone: getSetting('sonoplasta_phone', ''),
        gemini_api_key: getSetting('gemini_api_key', '') ? '••••••••' + getSetting('gemini_api_key').slice(-4) : '',
        has_gemini_key: Boolean(getSetting('gemini_api_key', '')),
        bot_name: getSetting('bot_name', 'WhatsBot Sonoplasta'),
        timezone: getSafeTimezone(getSetting('timezone', 'America/Sao_Paulo')),
        reminder_time: getSafeReminderTime(getSetting('reminder_time', '09:00')),
        ngrok_authtoken: getSetting('ngrok_authtoken', '') ? '••••••••' + getSetting('ngrok_authtoken').slice(-4) : '',
        has_ngrok_token: Boolean(getSetting('ngrok_authtoken', '')),
        ngrok_domain: getSetting('ngrok_domain', ''),
        ngrok_enabled: getSetting('ngrok_enabled', '1') !== '0',
        auth_username: getSetting('auth_username', 'admin')
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/settings', (req, res) => {
  try {
    const {
      sonoplasta_phone,
      gemini_api_key,
      bot_name,
      timezone,
      reminder_time,
      ngrok_authtoken,
      ngrok_domain,
      ngrok_enabled
    } = req.body;

    let shouldRestartNgrok = false;

    if (sonoplasta_phone !== undefined) {
      setSetting('sonoplasta_phone', sonoplasta_phone);
    }
    if (gemini_api_key && !gemini_api_key.startsWith('••••')) {
      setSetting('gemini_api_key', gemini_api_key);
    }
    if (bot_name !== undefined) {
      setSetting('bot_name', bot_name);
    }
    if (timezone !== undefined) {
      setSetting('timezone', getSafeTimezone(timezone));
    }
    if (reminder_time !== undefined) {
      setSetting('reminder_time', getSafeReminderTime(reminder_time));
    }
    if (ngrok_authtoken !== undefined && !ngrok_authtoken.startsWith('••••')) {
      setSetting('ngrok_authtoken', ngrok_authtoken.trim());
      shouldRestartNgrok = true;
    }
    if (ngrok_domain !== undefined) {
      setSetting('ngrok_domain', ngrok_domain.trim());
      shouldRestartNgrok = true;
    }
    if (ngrok_enabled !== undefined) {
      setSetting('ngrok_enabled', ngrok_enabled ? '1' : '0');
      shouldRestartNgrok = true;
    }

    if (shouldRestartNgrok) {
      restartNgrokTunnel().catch(err => {
        console.error('[Ngrok] Erro ao reiniciar túnel após salvar configurações:', err.message);
      });
    }

    res.json({ success: true, message: 'Configurações salvas com sucesso' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- LOGS ---

router.get('/logs', (req, res) => {
  try {
    const logs = db.prepare('SELECT * FROM bot_logs ORDER BY id DESC LIMIT 100').all();
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
