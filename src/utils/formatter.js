/**
 * Extrai apenas os dígitos de um número de telefone.
 */
export function normalizePhone(phone) {
  if (!phone) return '';
  return String(phone).replace(/\D/g, '');
}

/**
 * Converte um JID do Baileys para número de telefone puro.
 */
export function jidToPhone(jid) {
  if (!jid) return '';
  return normalizePhone(jid.split('@')[0].split(':')[0]);
}

/**
 * Converte um número de telefone para o JID do WhatsApp.
 */
export function phoneToJid(phone) {
  const digits = normalizePhone(phone);
  if (!digits) return '';
  return `${digits}@s.whatsapp.net`;
}

/**
 * Compara dois números de telefone considerando variações de 8 e 9 dígitos no Brasil.
 */
export function arePhonesEqual(phone1, phone2) {
  const p1 = normalizePhone(phone1);
  const p2 = normalizePhone(phone2);

  if (!p1 || !p2) return false;
  if (p1 === p2) return true;

  // Comparação flexível para números brasileiros (DDI 55 + DDD 2 dígitos + 8 ou 9 dígitos)
  if (p1.startsWith('55') && p2.startsWith('55')) {
    const ddd1 = p1.slice(2, 4);
    const ddd2 = p2.slice(2, 4);
    if (ddd1 === ddd2) {
      const num1 = p1.slice(4);
      const num2 = p2.slice(4);
      // Caso um tenha 9 e o outro 8 dígitos
      if ((num1.length === 9 && num2.length === 8 && num1.slice(1) === num2) ||
        (num2.length === 9 && num1.length === 8 && num2.slice(1) === num1)) {
        return true;
      }
    }
  }

  // Comparação pelos últimos 8 dígitos caso não tenha DDI/DDD
  if (p1.length >= 8 && p2.length >= 8 && p1.slice(-8) === p2.slice(-8)) {
    return true;
  }

  return false;
}

/**
 * Formata a data ISO (YYYY-MM-DD) para padrão brasileiro (DD/MM/YYYY).
 */
export function formatDateBR(dateIso) {
  if (!dateIso) return '';
  const [year, month, day] = dateIso.split('-');
  return `${day}/${month}/${year}`;
}

/**
 * Formata o cronograma completo para mensagem do WhatsApp (Markdown rico).
 * Formato estético e limpo para a sonoplastia (sem dados técnicos ou responsáveis).
 */
export function formatScheduleForWhatsApp(schedule, items) {
  const dateFormatted = formatDateBR(schedule.next_run_date);

  let message = `📋 *CRONOGRAMA DO CULTO*\n`;
  message += `⛪ *${schedule.title}*\n`;
  message += `📅 *Data:* ${dateFormatted} | ⏰ *Início:* ${schedule.event_time}\n`;
  message += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (!items || items.length === 0) {
    message += `_Nenhum momento cadastrado neste cronograma._\n`;
    return message;
  }

  // Ordena os itens pela ordem e horário
  const sortedItems = [...items].sort((a, b) => {
    if (a.item_order !== b.item_order) return a.item_order - b.item_order;
    return a.item_time.localeCompare(b.item_time);
  });

  for (const item of sortedItems) {
    const time = (item.item_time || '').slice(0, 5);
    const content = item.content && item.content.trim() ? item.content.trim().replace(/\r?\n+/g, ' / ') : '';

    if (content) {
      message += `*${time} ${item.name}:* ${content}\n`;
    } else {
      message += `*${time} ${item.name}\n*`;
    }
  }

  message += `\n━━━━━━━━━━━━━━━━━━━━\n`;
  message += `_Mensagem gerada automaticamente pelo WhatsBot Sonoplasta._`;

  return message;
}

/**
 * Mensagem de lembrete enviada na véspera para um responsável.
 */
export function formatReminderMessage(responsibleName, schedule, pendingItems) {
  const dateFormatted = formatDateBR(schedule.next_run_date);

  let msg = `Olá, *${responsibleName}*! Tudo bem? 👋\n\n`;
  msg += `Lembramos que amanhã teremos o *${schedule.title}* às *${schedule.event_time}* (${dateFormatted}).\n\n`;
  msg += `Você está responsável pelo(s) seguinte(s) momento(s):\n`;

  for (const item of pendingItems) {
    msg += `• *${item.item_time}* - *${item.name}*\n`;
  }

  msg += `\nPor favor, envie aqui o que será tocado/apresentado (nome do hino, louvor ou link do YouTube) para que possamos organizar o cronograma da sonoplastia. 🎵\n\n`;
  msg += `_Pode enviar por áudio ou texto. Obrigado!_`;

  return msg;
}
