import { db } from '../src/config/database.js';
import {
  createSchedule,
  getAllSchedules,
  getScheduleById,
  updateScheduleItemContent,
  getPendingItemsForPhone,
  renewCompletedSchedules,
  deleteSchedule
} from '../src/services/scheduleManager.js';
import {
  formatScheduleForWhatsApp,
  formatReminderMessage,
  arePhonesEqual,
  normalizePhone
} from '../src/utils/formatter.js';
import { extractYouTubeUrls, getYouTubeVideoTitle, closeBrowser } from '../src/services/playwright.js';
import {
  enqueueMessage,
  getConversationHistory,
  appendConversationHistory,
  resetConversationHistory
} from '../src/utils/debouncer.js';
import { processMessageWithGemini } from '../src/services/gemini.js';

let failedTests = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`✅ [PASS] ${testName}`);
  } else {
    console.error(`❌ [FAIL] ${testName}`);
    failedTests++;
  }
}

async function runTestSuite() {
  db.exec('DELETE FROM schedule_items; DELETE FROM schedules; DELETE FROM conversation_history;');
  console.log('\n--- INICIANDO TESTES DO WHATSBOT SONOPLASTA ---\n');

  // 1. Teste de Normalização e Comparação de Telefones
  console.log('1. Teste de Telefones:');
  assert(normalizePhone('+55 (11) 99999-8888') === '5511999998888', 'Normalização de telefone com pontuação');
  assert(arePhonesEqual('5511999998888', '551199998888'), 'Comparação de números com/sem 9º dígito no Brasil');
  assert(arePhonesEqual('5511999998888', '11999998888'), 'Comparação com e sem DDI 55');

  // 2. Teste de Criação de Cronograma e Itens
  console.log('\n2. Teste de Cronograma e Itens:');
  const testSchedule = createSchedule({
    title: 'Culto de Quarta-Feira Teste',
    event_time: '19:30',
    recurrence: 'WEEKLY',
    day_of_week: 3,
    items: [
      {
        item_time: '19:30',
        name: 'Hino Inicial',
        responsible_name: 'Irmã Rosana',
        responsible_phone: '5511999998888',
        is_immutable: false,
        content: ''
      },
      {
        item_time: '19:45',
        name: 'Oração Inicial',
        responsible_name: 'Pr. Carlos',
        responsible_phone: '5511988887777',
        is_immutable: true,
        content: 'Oração de Abertura'
      },
      {
        item_time: '20:30',
        name: 'Hino Final',
        responsible_name: 'Irmã Rosana',
        responsible_phone: '5511999998888',
        is_immutable: false,
        content: ''
      }
    ]
  });

  assert(testSchedule !== null && testSchedule.id > 0, 'Criação do cronograma no SQLite');
  assert(testSchedule.items.length === 3, 'Inclusão de 3 momentos no cronograma');

  // 3. Teste de Busca de Itens Pendentes por Telefone
  console.log('\n3. Teste de Filtro de Responsável por Telefone:');
  const rosanaItems = getPendingItemsForPhone('5511999998888');
  assert(rosanaItems.length === 2, 'Irmã Rosana possui 2 itens pendentes mutáveis (Hino Inicial e Final)');
  assert(rosanaItems.every(i => !i.is_immutable), 'Itens retornados para Rosana não incluem itens imutáveis');

  const carlosItems = getPendingItemsForPhone('5511988887777');
  assert(carlosItems.length === 0, 'Pr. Carlos não possui itens pendentes pois seu item é imutável');

  const strangerItems = getPendingItemsForPhone('5511911112222');
  assert(strangerItems.length === 0, 'Desconhecido não possui nenhum item sob sua responsabilidade');

  // 4. Teste de Atualização de Conteúdo do Item
  console.log('\n4. Teste de Atualização de Conteúdo:');
  const hinoInicial = rosanaItems.find(i => i.name === 'Hino Inicial');
  updateScheduleItemContent(hinoInicial.id, 'Harpa Cristã 15 - Foi na Cruz');

  const updatedSchedule = getScheduleById(testSchedule.id);
  const updatedItem = updatedSchedule.items.find(i => i.id === hinoInicial.id);
  assert(updatedItem.content === 'Harpa Cristã 15 - Foi na Cruz', 'Conteúdo do item atualizado no banco');
  assert(updatedItem.is_filled === 1, 'Status is_filled marcado como 1 após atualização');

  // 5. Teste de Extração de Links com Playwright
  console.log('\n5. Teste do Playwright para YouTube:');
  const urls = extractYouTubeUrls('Irmão, o hino vai ser este https://youtu.be/dQw4w9WgXcQ pode colocar no som');
  assert(urls.length === 1 && urls[0] === 'https://youtu.be/dQw4w9WgXcQ', 'Regex extrai URL do YouTube corretamente');

  const ytTitle = await getYouTubeVideoTitle('https://youtu.be/dQw4w9WgXcQ');
  assert(ytTitle && ytTitle.includes('Never Gonna Give You Up'), `Playwright extraiu título do vídeo: "${ytTitle}"`);

  // 6. Teste de Histórico e Timeout de 30 Minutos
  console.log('\n6. Teste de Histórico e Timeout (30 min):');
  resetConversationHistory('5511999998888');
  appendConversationHistory('5511999998888', 'user', 'A paz do Senhor');
  appendConversationHistory('5511999998888', 'model', 'A paz do Senhor, irmã!');

  const historyNow = getConversationHistory('5511999998888');
  assert(historyNow.length === 2, 'Histórico salvo e recuperado com 2 mensagens');

  // Simula inatividade de 31 minutos no banco
  const thirtyOneMinutesAgo = Date.now() - (31 * 60 * 1000);
  db.prepare('UPDATE conversation_history SET last_interaction = ? WHERE phone = ?').run(thirtyOneMinutesAgo, '5511999998888');

  const historyExpired = getConversationHistory('5511999998888');
  assert(historyExpired.length === 0, 'Histórico foi resetado automaticamente após 30min de inatividade');

  // 7. Teste de Debounce (Mensagens Picadas)
  console.log('\n7. Teste de Debounce (Mensagens Picadas):');
  let debouncedResult = null;
  const debouncePromise = new Promise(resolve => {
    enqueueMessage('5511999998888', 'Mensagem parte 1...', async (text) => {
      debouncedResult = text;
      resolve();
    }, 1000);
  });

  // Envia parte 2 logo em seguida (simulando mensagem picada)
  enqueueMessage('5511999998888', 'Mensagem parte 2!', null, 1000);

  console.log('   Aguardando finalização do buffer de debounce...');
  await debouncePromise;
  assert(debouncedResult === 'Mensagem parte 1...\nMensagem parte 2!', 'Debounce unificou as mensagens picadas recebidas');

  // 8. Teste de Processamento com IA Gemini (Fallback e Intenção)
  console.log('\n8. Teste de Processamento de Mensagem com IA:');
  const aiResult = await processMessageWithGemini({
    responsibleName: 'Irmã Rosana',
    userMessage: 'O hino final vai ser Harpa 115',
    pendingItems: [
      { id: 99, item_time: '20:30', name: 'Hino Final', content: '' }
    ],
    history: [],
    extractedYouTubeVideos: []
  });

  assert(aiResult.updated_items.length > 0, 'IA identifica e associa o conteúdo ao item pendente');
  assert(aiResult.reply_message.length > 0, 'IA gera resposta educada para o WhatsApp');

  // 9. Teste de Formatação de Mensagens para o WhatsApp
  console.log('\n9. Teste de Formatação para o WhatsApp:');
  const sonoplastaScheduleMsg = formatScheduleForWhatsApp(updatedSchedule, updatedSchedule.items);
  assert(sonoplastaScheduleMsg.includes('*CRONOGRAMA DO CULTO*'), 'Mensagem do Sonoplasta contém cabeçalho em Markdown');
  assert(sonoplastaScheduleMsg.includes('19:30 Hino Inicial: Harpa Cristã 15 - Foi na Cruz'), 'Mensagem contém louvor preenchido no padrão "HORÁRIO NOME: CONTEÚDO"');
  assert(!sonoplastaScheduleMsg.includes('*(Item Fixo)*'), 'Mensagem do Sonoplasta não contém tag técnica de item fixo');
  assert(!sonoplastaScheduleMsg.includes('Responsável'), 'Mensagem do Sonoplasta não contém detalhes técnicos de responsável');

  const reminderMsg = formatReminderMessage('Irmã Rosana', updatedSchedule, [hinoInicial]);
  assert(reminderMsg.includes('Olá, *Irmã Rosana*!'), 'Lembrete da véspera cumprimenta o responsável');
  assert(reminderMsg.includes(updatedSchedule.title), 'Lembrete da véspera cita o nome do culto');

  // 10. Teste de Renovação Pós-Culto
  console.log('\n10. Teste de Renovação Automática:');
  // Força data do cronograma para ontem
  db.prepare("UPDATE schedules SET next_run_date = '2020-01-01', reminder_sent = 1, sonoplasta_alert_sent = 1 WHERE id = ?").run(testSchedule.id);
  renewCompletedSchedules();

  const renewedSchedule = getScheduleById(testSchedule.id);
  assert(renewedSchedule.next_run_date > '2020-01-01', 'Data do cronograma avançada para a próxima ocorrência');
  assert(renewedSchedule.reminder_sent === 0, 'Flag reminder_sent resetada para 0');
  assert(renewedSchedule.sonoplasta_alert_sent === 0, 'Flag sonoplasta_alert_sent resetada para 0');

  const renewedMutableItem = renewedSchedule.items.find(i => !i.is_immutable && i.id === hinoInicial.id);
  assert(renewedMutableItem.content === '' && renewedMutableItem.is_filled === 0, 'Itens mutáveis foram limpos para novo preenchimento');

  const renewedImmutableItem = renewedSchedule.items.find(i => i.is_immutable);
  assert(renewedImmutableItem.content === 'Oração de Abertura', 'Itens imutáveis mantiveram seu conteúdo permanente');

  // Limpeza
  deleteSchedule(testSchedule.id);
  await closeBrowser();

  console.log(`\n--- FIM DOS TESTES: ${failedTests === 0 ? 'TODOS OS TESTES PASSARAM! 🎉' : `${failedTests} TESTE(S) FALHARAM.`} ---\n`);

  process.exit(failedTests === 0 ? 0 : 1);
}

runTestSuite().catch(err => {
  console.error('Erro fatal nos testes:', err);
  process.exit(1);
});
