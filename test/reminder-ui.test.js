import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const script = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');

function makeApp(inputs, response = { success: true, message: 'Enviado' }) {
  const requests = [];
  const alerts = [];
  const card = { querySelectorAll: selector => selector === '.reminder-item:checked' ? inputs : [] };
  const button = { disabled: false, closest: selector => selector === '.glass-card' ? card : null };
  const app = runInNewContext(`${script}\napp`, {
    window: {},
    document: { addEventListener() {} }
  });
  app.showAlert = (message, type) => alerts.push({ message, type });
  app.apiFetch = async (url, options) => {
    requests.push({ url, options });
    return { json: async () => response };
  };
  return { app, button, requests, alerts };
}

test('cronograma exibe seleção somente para momentos mutáveis com telefone', () => {
  const cards = [];
  const list = { innerHTML: '', appendChild: card => cards.push(card) };
  const app = runInNewContext(`${script}\napp`, {
    window: {},
    document: {
      addEventListener() {},
      getElementById: id => id === 'schedules-list' ? list : null,
      createElement: () => ({ className: '', innerHTML: '' })
    }
  });
  app.schedules = [{
    id: 1, title: 'Culto', recurrence: 'ONCE', next_run_date: '2026-10-18', event_time: '19:30',
    items: [
      { id: 11, item_order: 1, item_time: '19:30', name: 'Abertura', responsible_phone: '5511999991111', is_immutable: 0 },
      { id: 12, item_order: 2, item_time: '20:00', name: 'Oração', responsible_phone: '5511999992222', is_immutable: 1 },
      { id: 13, item_order: 3, item_time: '20:30', name: 'Avisos', responsible_phone: '', is_immutable: 0 }
    ]
  }];
  app.renderSchedules();
  assert.equal(cards.length, 1);
  assert.equal((cards[0].innerHTML.match(/class="reminder-item/g) || []).length, 1);
  assert.match(cards[0].innerHTML, /value="11" aria-label="Selecionar momento 1 para lembrete"/);
});

test('botão não faz requisição sem momentos marcados', async () => {
  const { app, button, requests, alerts } = makeApp([]);
  await app.remindNow(1, button);
  assert.equal(requests.length, 0);
  assert.equal(button.disabled, false);
  assert.match(alerts[0].message, /Selecione ao menos um momento/);
});

test('botão envia IDs apenas dos momentos marcados no card acionado', async () => {
  const inputs = [{ value: '12', checked: true }, { value: '13', checked: true }];
  const { app, button, requests } = makeApp(inputs);
  await app.remindNow(1, button);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/schedules/1/remind-now');
  assert.deepEqual(JSON.parse(requests[0].options.body), { item_ids: [12, 13] });
  assert.equal(inputs[0].checked, false);
  assert.equal(inputs[1].checked, false);
  assert.equal(button.disabled, false);
});

test('falha parcial mantém marcados somente os momentos que não receberam lembrete', async () => {
  const inputs = [{ value: '12', checked: true }, { value: '13', checked: true }];
  const { app, button, alerts } = makeApp(inputs, { success: false, error: 'Envio parcial', sent_item_ids: [12] });
  await app.remindNow(1, button);
  assert.equal(inputs[0].checked, false);
  assert.equal(inputs[1].checked, true);
  assert.equal(alerts.at(-1).type, 'error');
});
