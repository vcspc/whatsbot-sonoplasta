/**
 * Utilitário para manipulação de fusos horários e datas baseado na API nativa Intl.
 * Permite que a aplicação funcione em qualquer servidor (incluindo VPS e containers em UTC)
 * respeitando o horário local configurado pelo Sonoplasta.
 */

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';
export const DEFAULT_REMINDER_TIME = '09:00';

/**
 * Valida se a string informada é um fuso horário IANA válido suportado pelo Node.js.
 */
export function isValidTimezone(timeZone) {
  if (!timeZone || typeof timeZone !== 'string') return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Retorna o fuso horário informado se válido, ou o padrão seguro (America/Sao_Paulo).
 */
export function getSafeTimezone(timeZone) {
  return isValidTimezone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
}

/**
 * Valida se um horário está no formato HH:MM (24 horas).
 */
export function isValidTimeString(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return false;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(timeStr.trim());
}

/**
 * Retorna o horário informado se válido, ou o padrão seguro (09:00).
 */
export function getSafeReminderTime(reminderTime) {
  if (isValidTimeString(reminderTime)) {
    return reminderTime.trim();
  }
  return DEFAULT_REMINDER_TIME;
}

/**
 * Extrai as partes numéricas e formatadas de uma data em determinado fuso horário.
 *
 * @param {Date} date Objeto Date (padrão: agora)
 * @param {string} timeZone Fuso horário IANA (padrão: America/Sao_Paulo)
 * @returns {{
 *   year: number,
 *   month: number,
 *   day: number,
 *   hour: number,
 *   minute: number,
 *   second: number,
 *   dateStr: string,
 *   timeStr: string,
 *   dayOfWeek: number
 * }}
 */
export function getZonedParts(date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const safeTz = getSafeTimezone(timeZone);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });

  const parts = formatter.formatToParts(date);
  const get = type => parts.find(p => p.type === type)?.value;

  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  let hour = Number(get('hour'));
  if (hour === 24) hour = 0;
  const minute = Number(get('minute'));
  const second = Number(get('second'));

  const pad = n => String(n).padStart(2, '0');
  const dateStr = `${year}-${pad(month)}-${pad(day)}`;
  const timeStr = `${pad(hour)}:${pad(minute)}`;

  // Calcula o dia da semana civil da data local (0 = Domingo, 1 = Segunda, ..., 6 = Sábado)
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    dateStr,
    timeStr,
    dayOfWeek
  };
}

/**
 * Adiciona ou subtrai dias de uma string de data YYYY-MM-DD em aritmética civil pura.
 *
 * @param {string} dateStr Data no formato YYYY-MM-DD
 * @param {number} days Quantidade de dias a somar (ou subtrair)
 * @returns {string} Nova data no formato YYYY-MM-DD
 */
export function addDaysToDateString(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const pad = n => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/**
 * Converte uma data civil local (YYYY-MM-DD) e horário local (HH:MM)
 * em um objeto Date UTC exato no instante correspondente no fuso horário informado.
 *
 * @param {string} dateStr Data no formato YYYY-MM-DD
 * @param {string} timeStr Horário no formato HH:MM
 * @param {string} timeZone Fuso horário IANA
 * @returns {Date}
 */
export function getZonedDateTime(dateStr, timeStr, timeZone = DEFAULT_TIMEZONE) {
  const safeTz = getSafeTimezone(timeZone);
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (timeStr || '00:00').split(':').map(Number);

  const guessUtc = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
  const formatted = getZonedParts(guessUtc, safeTz);

  const diffMs = Date.UTC(y, m - 1, d, hh, mm, 0) -
    Date.UTC(formatted.year, formatted.month - 1, formatted.day, formatted.hour, formatted.minute, formatted.second);

  let exactUtc = new Date(guessUtc.getTime() + diffMs);

  // Verificação de precisão (tratamento de transição de horário)
  const check = getZonedParts(exactUtc, safeTz);
  if (check.hour !== hh || check.minute !== mm) {
    const diff2 = Date.UTC(y, m - 1, d, hh, mm, 0) -
      Date.UTC(check.year, check.month - 1, check.day, check.hour, check.minute, check.second);
    exactUtc = new Date(exactUtc.getTime() + diff2);
  }

  return exactUtc;
}

/**
 * Calcula a diferença em minutos entre o início do evento (dateStr + timeStr no fuso)
 * e o instante atual (fromDate).
 *
 * @param {string} dateStr Data do evento YYYY-MM-DD
 * @param {string} timeStr Horário do evento HH:MM
 * @param {Date} fromDate Instante de referência (padrão: agora)
 * @param {string} timeZone Fuso horário IANA
 * @returns {number} Minutos restantes (positivo se o evento for no futuro, negativo se já passou)
 */
export function getMinuteDifference(dateStr, timeStr, fromDate = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const targetDate = getZonedDateTime(dateStr, timeStr, timeZone);
  const diffMs = targetDate.getTime() - fromDate.getTime();
  return Math.floor(diffMs / (60 * 1000));
}
