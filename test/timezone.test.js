import { db, setSetting, getSetting } from '../src/config/database.js';
import {
  isValidTimezone,
  getSafeTimezone,
  isValidTimeString,
  getSafeReminderTime,
  getZonedParts,
  addDaysToDateString,
  getZonedDateTime,
  getMinuteDifference,
  DEFAULT_TIMEZONE,
  DEFAULT_REMINDER_TIME
} from '../src/utils/timezone.js';
import {
  calculateNextRunDate,
  renewCompletedSchedules,
  createSchedule,
  getScheduleById,
  deleteSchedule
} from '../src/services/scheduleManager.js';

let failedTests = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`✅ [PASS] ${testName}`);
  } else {
    console.error(`❌ [FAIL] ${testName}`);
    failedTests++;
  }
}

async function runTimezoneTests() {
  console.log('\n======================================================');
  console.log('🌍 TESTES DE FUSO HORÁRIO E HORÁRIOS DE LEMBRETE');
  console.log('======================================================\n');

  // 1. Validação de Fuso Horário
  console.log('1. Validação de Fusos Horários (IANA):');
  assert(isValidTimezone('America/Sao_Paulo'), 'America/Sao_Paulo é válido');
  assert(isValidTimezone('America/Manaus'), 'America/Manaus é válido');
  assert(isValidTimezone('UTC'), 'UTC é válido');
  assert(isValidTimezone('Europe/Lisbon'), 'Europe/Lisbon é válido');
  assert(!isValidTimezone('Fuso_Inexistente'), 'Fuso inexistente retorna false');
  assert(!isValidTimezone(''), 'String vazia retorna false');
  assert(!isValidTimezone(null), 'Null retorna false');
  assert(getSafeTimezone('Invalido') === DEFAULT_TIMEZONE, 'Fallback para America/Sao_Paulo em fuso inválido');
  assert(getSafeTimezone('America/Manaus') === 'America/Manaus', 'Preserva fuso válido');

  // 2. Validação de Horário de Lembrete
  console.log('\n2. Validação de Horário do Lembrete:');
  assert(isValidTimeString('09:00'), '09:00 é formato válido');
  assert(isValidTimeString('23:59'), '23:59 é formato válido');
  assert(isValidTimeString('00:00'), '00:00 é formato válido');
  assert(!isValidTimeString('24:00'), '24:00 é inválido');
  assert(!isValidTimeString('9:00'), '9:00 sem zero à esquerda é inválido');
  assert(!isValidTimeString('abc'), 'Texto aleatório é inválido');
  assert(getSafeReminderTime('10:30') === '10:30', 'Preserva horário válido');
  assert(getSafeReminderTime('invalido') === DEFAULT_REMINDER_TIME, 'Fallback para 09:00 em horário inválido');
  assert(getSafeReminderTime('') === DEFAULT_REMINDER_TIME, 'Fallback para 09:00 em string vazia');

  // 3. Extração de Partes por Fuso Horário
  console.log('\n3. Extração e Resolução de Horário Local em Instante UTC Fixo:');
  // Instante fixo: Domingo 2026-10-11 às 01:30:00 UTC
  const fixedUtcDate = new Date('2026-10-11T01:30:00.000Z');

  // Em America/Sao_Paulo (UTC-3), ainda é Sábado 2026-10-10 às 22:30 (dia da semana 6 = Sábado)
  const spParts = getZonedParts(fixedUtcDate, 'America/Sao_Paulo');
  assert(spParts.dateStr === '2026-10-10', 'Data em SP é 2026-10-10 (ainda véspera)');
  assert(spParts.timeStr === '22:30', 'Horário em SP é 22:30');
  assert(spParts.dayOfWeek === 6, 'Dia da semana em SP é 6 (Sábado)');

  // Em America/Manaus (UTC-4), é Sábado 2026-10-10 às 21:30 (dia da semana 6 = Sábado)
  const manausParts = getZonedParts(fixedUtcDate, 'America/Manaus');
  assert(manausParts.dateStr === '2026-10-10', 'Data em Manaus é 2026-10-10');
  assert(manausParts.timeStr === '21:30', 'Horário em Manaus é 21:30');

  // Em UTC, é Domingo 2026-10-11 às 01:30 (dia da semana 0 = Domingo)
  const utcParts = getZonedParts(fixedUtcDate, 'UTC');
  assert(utcParts.dateStr === '2026-10-11', 'Data em UTC é 2026-10-11');
  assert(utcParts.timeStr === '01:30', 'Horário em UTC é 01:30');
  assert(utcParts.dayOfWeek === 0, 'Dia da semana em UTC é 0 (Domingo)');

  // Em Tóquio (UTC+9), já é Domingo 2026-10-11 às 10:30
  const tokyoParts = getZonedParts(fixedUtcDate, 'Asia/Tokyo');
  assert(tokyoParts.dateStr === '2026-10-11', 'Data em Tóquio é 2026-10-11');
  assert(tokyoParts.timeStr === '10:30', 'Horário em Tóquio é 10:30');

  // 4. Aritmética de Datas em String (addDaysToDateString)
  console.log('\n4. Aritmética de Calendário Civil (addDaysToDateString):');
  assert(addDaysToDateString('2026-10-10', 1) === '2026-10-11', 'Soma 1 dia');
  assert(addDaysToDateString('2026-10-31', 1) === '2026-11-01', 'Virada de mês (outubro -> novembro)');
  assert(addDaysToDateString('2026-12-31', 1) === '2027-01-01', 'Virada de ano (dezembro -> janeiro)');
  assert(addDaysToDateString('2024-02-28', 1) === '2024-02-29', 'Ano bissexto (28 fev -> 29 fev)');
  assert(addDaysToDateString('2024-02-29', 1) === '2024-03-01', 'Ano bissexto (29 fev -> 01 mar)');
  assert(addDaysToDateString('2026-10-10', -1) === '2026-10-09', 'Subtrai 1 dia');

  // 5. Diferença de Minutos e Alerta de 1 Hora Antes (getMinuteDifference)
  console.log('\n5. Diferença em Minutos para Alerta de 1h antes:');
  // Culto em São Paulo no dia 2026-10-11 às 19:30
  // Simular instante atual: 2026-10-11 às 18:40 em SP (50 minutos antes)
  // Em SP (UTC-3), 18:40 é 21:40 UTC
  const fiftyMinBeforeUtc = new Date('2026-10-11T21:40:00.000Z');
  const diff1 = getMinuteDifference('2026-10-11', '19:30', fiftyMinBeforeUtc, 'America/Sao_Paulo');
  assert(diff1 === 50, `Diferença de exatamente 50 minutos calculada corretamente: ${diff1}`);
  assert(diff1 <= 65 && diff1 >= 0, 'Dispara alerta de sonoplasta na janela [0..65] min');

  // Simular instante atual: 120 minutos antes (17:30 em SP = 20:30 UTC)
  const twoHoursBeforeUtc = new Date('2026-10-11T20:30:00.000Z');
  const diff2 = getMinuteDifference('2026-10-11', '19:30', twoHoursBeforeUtc, 'America/Sao_Paulo');
  assert(diff2 === 120, `Diferença de 120 minutos calculada: ${diff2}`);
  assert(!(diff2 <= 65 && diff2 >= 0), 'Não dispara alerta quando faltam mais de 65 min');

  // Simular instante atual: 10 minutos após o início do culto (19:40 em SP = 22:40 UTC)
  const tenMinAfterUtc = new Date('2026-10-11T22:40:00.000Z');
  const diff3 = getMinuteDifference('2026-10-11', '19:30', tenMinAfterUtc, 'America/Sao_Paulo');
  assert(diff3 === -10, `Diferença negativa após início do culto: ${diff3}`);
  assert(!(diff3 <= 65 && diff3 >= 0), 'Não dispara alerta após o culto já ter iniciado');

  // 6. Cálculo da Próxima Data de Execução (calculateNextRunDate)
  console.log('\n6. Cálculo da Próxima Data com Fuso Horário:');
  // Cenário: Domingo 2026-10-11 às 01:30 UTC.
  // Em SP é SÁBADO 2026-10-10 às 22:30.
  // Culto de Domingo (day_of_week: 0) às 19:00:
  // Como em SP ainda é sábado, o culto de domingo deve ser AMANHÃ (2026-10-11)!
  const nextSundayFromSatNight = calculateNextRunDate('WEEKLY', 0, '19:00', fixedUtcDate, 'America/Sao_Paulo');
  assert(nextSundayFromSatNight === '2026-10-11', `Culto de domingo agendado para amanhã em SP: ${nextSundayFromSatNight}`);

  // Se calculássemos no fuso UTC diretamente, no servidor já seria Domingo às 01:30.
  // Em UTC, domingo às 19:00 seria HOJE (2026-10-11). Mas em SP é sábado, e o resultado deve ser consistente!
  // Agora: culto de SÁBADO às 19:00 em SP.
  // Como já são 22:30 de sábado em SP, o culto das 19:00 de sábado já passou!
  // Portanto, deve avançar 7 dias para o próximo sábado (2026-10-17):
  const nextSaturdayPastTime = calculateNextRunDate('WEEKLY', 6, '19:00', fixedUtcDate, 'America/Sao_Paulo');
  assert(nextSaturdayPastTime === '2026-10-17', `Culto de sábado que já passou avança para a próxima semana: ${nextSaturdayPastTime}`);

  // Culto DIÁRIO às 23:00 em SP:
  // Como são 22:30 de sábado em SP, o culto das 23:00 ainda vai acontecer hoje (2026-10-10):
  const dailyToday = calculateNextRunDate('DAILY', null, '23:00', fixedUtcDate, 'America/Sao_Paulo');
  assert(dailyToday === '2026-10-10', `Culto diário antes das 23:00 permanece hoje: ${dailyToday}`);

  // Culto DIÁRIO às 22:00 em SP:
  // Como já são 22:30 de sábado em SP, o culto das 22:00 já passou, então deve ser amanhã (2026-10-11):
  const dailyTomorrow = calculateNextRunDate('DAILY', null, '22:00', fixedUtcDate, 'America/Sao_Paulo');
  assert(dailyTomorrow === '2026-10-11', `Culto diário depois das 22:00 avança para amanhã: ${dailyTomorrow}`);

  // 7. Teste de Configuração no Banco de Dados
  console.log('\n7. Persistência de Settings no Banco de Dados:');
  setSetting('timezone', 'America/Manaus');
  assert(getSetting('timezone') === 'America/Manaus', 'Configuração de timezone salva com sucesso');

  setSetting('reminder_time', '08:30');
  assert(getSetting('reminder_time') === '08:30', 'Configuração de reminder_time salva com sucesso');

  // Restaura padrão
  setSetting('timezone', 'America/Sao_Paulo');
  setSetting('reminder_time', '09:00');
  assert(getSetting('timezone') === 'America/Sao_Paulo', 'Timezone restaurado para America/Sao_Paulo');
  assert(getSetting('reminder_time') === '09:00', 'Reminder time restaurado para 09:00');

  // 8. Teste de Renovação Automática com Fuso Horário
  console.log('\n8. Renovação de Cronograma Respeitando Fuso Horário:');
  const testSched = createSchedule({
    title: 'Culto Fuso Horário Teste',
    event_time: '19:00',
    recurrence: 'WEEKLY',
    day_of_week: 3,
    items: [
      { item_time: '19:00', name: 'Louvor 1', content: 'Música 1', is_immutable: false }
    ]
  });

  // Força uma data que já passou no fuso de SP
  db.prepare("UPDATE schedules SET next_run_date = '2020-05-10', reminder_sent = 1, sonoplasta_alert_sent = 1 WHERE id = ?").run(testSched.id);
  renewCompletedSchedules('America/Sao_Paulo');

  const afterRenew = getScheduleById(testSched.id);
  assert(afterRenew.next_run_date > '2020-05-10', `Próxima data renovada no fuso: ${afterRenew.next_run_date}`);
  assert(afterRenew.reminder_sent === 0, 'reminder_sent resetado para 0');
  assert(afterRenew.sonoplasta_alert_sent === 0, 'sonoplasta_alert_sent resetado para 0');

  // Limpeza
  deleteSchedule(testSched.id);

  console.log(`\n======================================================`);
  console.log(`RESULTADO: ${failedTests === 0 ? 'TODOS OS TESTES DE FUSO PASSARAM! 🎉' : `${failedTests} TESTES FALHARAM!`}`);
  console.log('======================================================\n');

  process.exit(failedTests === 0 ? 0 : 1);
}

runTimezoneTests().catch(err => {
  console.error('Erro fatal nos testes de timezone:', err);
  process.exit(1);
});
