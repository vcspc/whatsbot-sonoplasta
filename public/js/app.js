const app = {
  schedules: [],
  currentScheduleId: null,
  whatsappStatus: null,
  pollInterval: null,

  init() {
    this.loadWhatsAppStatus();
    this.loadSettings();
    this.loadSchedules();
    this.loadLogs();

    // Polling contínuo para status do WhatsApp
    this.pollInterval = setInterval(() => {
      this.loadWhatsAppStatus(false);
    }, 3000);
  },

  showAlert(message, type = 'success') {
    const container = document.getElementById('alerts-container');
    const alert = document.createElement('div');
    const colors = {
      success: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
      error: 'bg-rose-500/10 border-rose-500/30 text-rose-400',
      info: 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400'
    };

    alert.className = `p-4 rounded-xl border flex items-center justify-between text-sm shadow-lg transition-all transform duration-300 ${colors[type] || colors.info}`;
    alert.innerHTML = `
      <div class="flex items-center gap-2">
        <span>${message}</span>
      </div>
      <button onclick="this.parentElement.remove()" class="text-current opacity-70 hover:opacity-100">&times;</button>
    `;

    container.appendChild(alert);
    setTimeout(() => {
      alert.style.opacity = '0';
      alert.style.transform = 'translateY(-10px)';
      setTimeout(() => alert.remove(), 300);
    }, 4000);
  },

  showModal(modalId) {
    const modal = document.getElementById(modalId);
    const content = document.getElementById(`${modalId}-content`);
    modal.classList.remove('hidden');
    setTimeout(() => {
      content.classList.remove('scale-95', 'opacity-0');
      content.classList.add('scale-100', 'opacity-100');
    }, 10);
  },

  hideModal(modalId) {
    const modal = document.getElementById(modalId);
    const content = document.getElementById(`${modalId}-content`);
    content.classList.remove('scale-100', 'opacity-100');
    content.classList.add('scale-95', 'opacity-0');
    setTimeout(() => {
      modal.classList.add('hidden');
    }, 300);
  },

  // --- WHATSAPP STATUS ---

  async loadWhatsAppStatus(showFeedback = true) {
    try {
      const res = await fetch('/api/whatsapp/status');
      const data = await res.json();
      this.whatsappStatus = data;
      this.renderWhatsAppStatus();
    } catch (err) {
      if (showFeedback) console.error('Erro ao verificar status do WhatsApp:', err);
    }
  },

  renderWhatsAppStatus() {
    const badgeDot = document.getElementById('wa-status-dot');
    const badgeText = document.getElementById('wa-status-text');
    const modalStatus = document.getElementById('wa-modal-status-text');
    const loader = document.getElementById('wa-loader');
    const qrView = document.getElementById('wa-qr-view');
    const connectedView = document.getElementById('wa-connected-view');
    const qrImg = document.getElementById('wa-qr-img');
    const connectedPhone = document.getElementById('wa-connected-phone');

    loader.classList.add('hidden');
    qrView.classList.add('hidden');
    connectedView.classList.add('hidden');

    if (this.whatsappStatus.status === 'CONNECTED') {
      badgeDot.className = 'w-2 h-2 rounded-full bg-emerald-500 badge-pulse';
      badgeText.innerText = 'WhatsApp Conectado';
      modalStatus.innerText = 'Pronto para enviar e receber mensagens.';
      connectedView.classList.remove('hidden');
      connectedPhone.innerText = this.whatsappStatus.phoneNumber || 'Ativo';
    } else if (this.whatsappStatus.status === 'SCAN_QR') {
      badgeDot.className = 'w-2 h-2 rounded-full bg-amber-500 badge-pulse';
      badgeText.innerText = 'Escanear QR Code';
      modalStatus.innerText = 'Conecte seu WhatsApp lendo o QR Code abaixo:';
      qrView.classList.remove('hidden');
      if (this.whatsappStatus.qrCode) {
        qrImg.src = this.whatsappStatus.qrCode;
      }
    } else if (this.whatsappStatus.status === 'CONNECTING') {
      badgeDot.className = 'w-2 h-2 rounded-full bg-indigo-500 badge-pulse';
      badgeText.innerText = 'Conectando...';
      modalStatus.innerText = 'Estabelecendo conexão segura...';
      loader.classList.remove('hidden');
    } else {
      badgeDot.className = 'w-2 h-2 rounded-full bg-rose-500';
      badgeText.innerText = 'Desconectado';
      modalStatus.innerText = 'Clique para reiniciar a conexão e gerar QR Code.';
      loader.classList.remove('hidden');
    }
  },

  async actionWhatsApp(action) {
    try {
      const res = await fetch(`/api/whatsapp/${action}`, { method: 'POST' });
      const data = await res.json();
      this.showAlert(data.message, data.success ? 'success' : 'error');
      this.loadWhatsAppStatus();
    } catch (err) {
      this.showAlert(`Erro: ${err.message}`, 'error');
    }
  },

  // --- CONFIGURAÇÕES ---

  async loadSettings() {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      if (data.success && data.settings) {
        document.getElementById('setting_sonoplasta_phone').value = data.settings.sonoplasta_phone || '';
        document.getElementById('setting_bot_name').value = data.settings.bot_name || '';
        if (data.settings.has_gemini_key) {
          document.getElementById('setting_gemini_key').placeholder = 'Chave ativa (••••••••). Digite para alterar.';
        }
      }
    } catch (err) {
      console.error('Erro ao carregar configurações:', err);
    }
  },

  async saveSettings(event) {
    event.preventDefault();
    const sonoplasta_phone = document.getElementById('setting_sonoplasta_phone').value.trim();
    const gemini_api_key = document.getElementById('setting_gemini_key').value.trim();
    const bot_name = document.getElementById('setting_bot_name').value.trim();

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sonoplasta_phone, gemini_api_key, bot_name })
      });
      const data = await res.json();
      if (data.success) {
        this.showAlert('Configurações salvas com sucesso!');
        this.loadSettings();
      } else {
        this.showAlert(data.error, 'error');
      }
    } catch (err) {
      this.showAlert(`Erro ao salvar configurações: ${err.message}`, 'error');
    }
  },

  // --- CRONOGRAMAS ---

  async loadSchedules() {
    const loading = document.getElementById('schedules-loading');
    const empty = document.getElementById('schedules-empty');
    const list = document.getElementById('schedules-list');

    try {
      const res = await fetch('/api/schedules');
      const data = await res.json();
      loading.classList.add('hidden');

      if (!data.success || !data.schedules || data.schedules.length === 0) {
        empty.classList.remove('hidden');
        list.innerHTML = '';
        return;
      }

      empty.classList.add('hidden');
      this.schedules = data.schedules;
      this.renderSchedules();
    } catch (err) {
      loading.classList.add('hidden');
      this.showAlert(`Erro ao carregar cronogramas: ${err.message}`, 'error');
    }
  },

  renderSchedules() {
    const list = document.getElementById('schedules-list');
    list.innerHTML = '';

    const dayNames = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

    this.schedules.forEach(schedule => {
      const card = document.createElement('div');
      card.className = 'glass-card glass-card-hover rounded-2xl p-6 transition';

      const recurrenceLabel = schedule.recurrence === 'DAILY' ? 'Diário' :
        schedule.recurrence === 'WEEKLY' ? `Semanal (${dayNames[schedule.day_of_week] || 'Dia'})` : 'Único';

      const formattedDate = schedule.next_run_date.split('-').reverse().join('/');

      // Renderização dos momentos/itens
      let itemsHtml = '';
      if (schedule.items && schedule.items.length > 0) {
        itemsHtml = `
          <div class="mt-4 border-t border-slate-700/50 pt-4">
            <h4 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Momentos do Culto (${schedule.items.length})</h4>
            <div class="space-y-2">
        `;

        schedule.items.forEach(item => {
          let statusBadge = '';
          if (item.is_immutable) {
            statusBadge = '<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30">🔒 Fixo / Imutável</span>';
          } else if (item.is_filled) {
            statusBadge = '<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">✓ Preenchido</span>';
          } else {
            statusBadge = '<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">⏳ Pendente</span>';
          }

          const contentDisplay = item.content ?
            `<span class="text-slate-200 font-medium">${item.content}</span>` :
            `<span class="text-slate-500 italic">Aguardando envio do responsável...</span>`;

          const responsibleDisplay = item.responsible_name ?
            `<span class="text-xs text-slate-400">👤 ${item.responsible_name} ${item.responsible_phone ? `(${item.responsible_phone})` : ''}</span>` :
            '';

          itemsHtml += `
            <div class="bg-slate-800/60 rounded-xl p-3 flex flex-col md:flex-row md:items-center justify-between gap-2 border border-slate-700/40">
              <div class="flex items-start md:items-center gap-3">
                <span class="text-xs font-mono font-bold bg-slate-900 px-2 py-1 rounded text-indigo-400 border border-slate-700">${item.item_time}</span>
                <div>
                  <div class="flex items-center gap-2">
                    <span class="font-semibold text-sm text-white">${item.name}</span>
                    ${statusBadge}
                  </div>
                  <div class="text-xs mt-0.5">${contentDisplay}</div>
                </div>
              </div>
              <div class="text-right">
                ${responsibleDisplay}
              </div>
            </div>
          `;
        });

        itemsHtml += `</div></div>`;
      } else {
        itemsHtml = `
          <div class="mt-4 border-t border-slate-700/50 pt-4 text-center py-4 text-slate-500 text-xs">
            Nenhum momento cadastrado neste cronograma.
          </div>
        `;
      }

      card.innerHTML = `
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div class="flex items-center gap-3">
              <h3 class="text-xl font-bold text-white">${schedule.title}</h3>
              <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">${recurrenceLabel}</span>
            </div>
            <div class="flex items-center gap-4 mt-2 text-xs text-slate-400">
              <span>📅 Próximo: <strong class="text-slate-200">${formattedDate}</strong></span>
              <span>⏰ Início: <strong class="text-slate-200">${schedule.event_time}</strong></span>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button onclick="app.sendToSonoplastaNow(${schedule.id})" title="Enviar cronograma ao Sonoplasta agora" class="bg-slate-800 hover:bg-slate-700 text-indigo-400 hover:text-indigo-300 px-3 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 border border-slate-700 active:scale-95">
              <i data-lucide="send" class="w-3.5 h-3.5"></i> Enviar p/ Sonoplasta
            </button>
            <button onclick="app.remindNow(${schedule.id})" title="Disparar lembretes para os responsáveis agora" class="bg-slate-800 hover:bg-slate-700 text-amber-400 hover:text-amber-300 px-3 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 border border-slate-700 active:scale-95">
              <i data-lucide="bell" class="w-3.5 h-3.5"></i> Lembrar Agora
            </button>
            <button onclick="app.editSchedule(${schedule.id})" title="Editar cronograma" class="bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white p-2 rounded-xl text-xs transition border border-slate-700 active:scale-95">
              <i data-lucide="edit-3" class="w-4 h-4"></i>
            </button>
            <button onclick="app.deleteSchedule(${schedule.id})" title="Excluir cronograma" class="bg-slate-800 hover:bg-rose-500/20 text-rose-400 p-2 rounded-xl text-xs transition border border-slate-700 active:scale-95">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        </div>

        ${itemsHtml}
      `;

      list.appendChild(card);
    });

    lucide.createIcons();
  },

  async sendToSonoplastaNow(scheduleId) {
    try {
      this.showAlert('Enviando cronograma para o Sonoplasta via WhatsApp...', 'info');
      const res = await fetch(`/api/schedules/${scheduleId}/send-now`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        this.showAlert(data.message, 'success');
      } else {
        this.showAlert(data.error, 'error');
      }
    } catch (err) {
      this.showAlert(`Erro: ${err.message}`, 'error');
    }
  },

  async remindNow(scheduleId) {
    try {
      this.showAlert('Disparando lembretes via WhatsApp...', 'info');
      const res = await fetch(`/api/schedules/${scheduleId}/remind-now`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        this.showAlert(data.message, 'success');
      } else {
        this.showAlert(data.error, 'error');
      }
    } catch (err) {
      this.showAlert(`Erro: ${err.message}`, 'error');
    }
  },

  async deleteSchedule(scheduleId) {
    if (!confirm('Deseja realmente excluir este cronograma e todos os seus itens?')) return;

    try {
      const res = await fetch(`/api/schedules/${scheduleId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        this.showAlert('Cronograma excluído com sucesso!');
        this.loadSchedules();
      } else {
        this.showAlert(data.error, 'error');
      }
    } catch (err) {
      this.showAlert(`Erro ao excluir: ${err.message}`, 'error');
    }
  },

  // --- MODAL DE CRIAÇÃO / EDIÇÃO DE CRONOGRAMA ---

  openScheduleModal(schedule = null) {
    document.getElementById('schedule-form').reset();
    document.getElementById('schedule-items-container').innerHTML = '';

    if (schedule) {
      document.getElementById('schedule-modal-title-text').innerText = 'Editar Cronograma';
      document.getElementById('sched_id').value = schedule.id;
      document.getElementById('sched_title').value = schedule.title;
      document.getElementById('sched_time').value = schedule.event_time;
      document.getElementById('sched_recurrence').value = schedule.recurrence;
      document.getElementById('sched_day_of_week').value = schedule.day_of_week ?? '0';
      document.getElementById('sched_date').value = schedule.next_run_date || '';

      if (schedule.items && schedule.items.length > 0) {
        schedule.items.forEach(item => this.addScheduleItem(item));
      } else {
        this.addScheduleItem();
      }
    } else {
      document.getElementById('schedule-modal-title-text').innerText = 'Novo Cronograma';
      document.getElementById('sched_id').value = '';
      document.getElementById('sched_recurrence').value = 'WEEKLY';
      document.getElementById('sched_day_of_week').value = '3'; // Quarta-feira padrão
      document.getElementById('sched_time').value = '19:30';

      // Adiciona itens padrão para agilizar
      this.addScheduleItem({ item_time: '19:30', name: 'Hino Inicial', is_immutable: false });
      this.addScheduleItem({ item_time: '19:45', name: 'Oração Inicial', is_immutable: true, content: 'Oração de Abertura' });
      this.addScheduleItem({ item_time: '20:00', name: 'Louvor Congregacional', is_immutable: false });
      this.addScheduleItem({ item_time: '20:45', name: 'Hino Final', is_immutable: false });
    }

    this.toggleDayOfWeek();
    this.showModal('schedule-modal');
    lucide.createIcons();
  },

  editSchedule(scheduleId) {
    const sched = this.schedules.find(s => s.id === scheduleId);
    if (sched) {
      this.openScheduleModal(sched);
    }
  },

  toggleDayOfWeek() {
    const rec = document.getElementById('sched_recurrence').value;
    const dowContainer = document.getElementById('sched_day_of_week_container');
    const dateContainer = document.getElementById('sched_date_container');

    if (rec === 'WEEKLY') {
      dowContainer.classList.remove('hidden');
      dateContainer.classList.add('hidden');
    } else if (rec === 'ONCE') {
      dowContainer.classList.add('hidden');
      dateContainer.classList.remove('hidden');
    } else {
      dowContainer.classList.add('hidden');
      dateContainer.classList.add('hidden');
    }
  },

  addScheduleItem(item = null) {
    const container = document.getElementById('schedule-items-container');
    const row = document.createElement('div');
    row.className = 'item-row p-4 lg:grid lg:grid-cols-12 gap-3 items-center bg-slate-900/30 hover:bg-slate-800/40 transition space-y-3 lg:space-y-0';

    const time = item?.item_time || document.getElementById('sched_time').value || '19:30';
    const name = item?.name || '';
    const respName = item?.responsible_name || '';
    const respPhone = item?.responsible_phone || '';
    const isImmutable = item?.is_immutable ? true : false;
    const content = item?.content || '';

    row.innerHTML = `
      <div class="col-span-1">
        <input type="time" value="${time}" class="item-time w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:ring-1 focus:ring-indigo-500 font-mono [&::-webkit-calendar-picker-indicator]:filter [&::-webkit-calendar-picker-indicator]:invert">
      </div>

      <div class="col-span-3">
        <input type="text" value="${name}" placeholder="Ex: Hino Inicial" required class="item-name w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:ring-1 focus:ring-indigo-500 font-medium">
      </div>

      <div class="col-span-2">
        <input type="text" value="${respName}" placeholder="Ex: Irmã Rosana" class="item-resp-name w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:ring-1 focus:ring-indigo-500">
      </div>

      <div class="col-span-2">
        <input type="text" value="${respPhone}" placeholder="Ex: 5511999998888" class="item-resp-phone w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:ring-1 focus:ring-indigo-500 font-mono">
      </div>

      <div class="col-span-3 space-y-1.5">
        <label class="flex items-center gap-1.5 text-[11px] text-slate-300 font-medium cursor-pointer">
          <input type="checkbox" ${isImmutable ? 'checked' : ''} onchange="app.toggleItemImmutable(this)" class="item-immutable rounded bg-slate-900 border-slate-700 text-purple-600 focus:ring-0">
          <span>Item Imutável (Conteúdo Fixo)</span>
        </label>
        <input type="text" value="${content}" placeholder="${isImmutable ? 'Conteúdo fixo (ex: Oração)' : 'Conteúdo / Louvor / Link'}" class="item-content w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:ring-1 focus:ring-purple-500">
      </div>

      <div class="col-span-1 text-center">
        <button type="button" onclick="this.closest('.item-row').remove()" class="text-rose-400 hover:text-rose-300 p-1.5 rounded-lg hover:bg-rose-500/10 transition" title="Remover momento">
          <i data-lucide="trash" class="w-4 h-4 mx-auto"></i>
        </button>
      </div>
    `;

    container.appendChild(row);
    lucide.createIcons();
  },

  toggleItemImmutable(checkbox) {
    const row = checkbox.closest('.item-row');
    const contentInput = row.querySelector('.item-content');
    if (checkbox.checked) {
      contentInput.placeholder = 'Digite o conteúdo fixo permanente deste item';
    } else {
      contentInput.placeholder = 'Conteúdo preenchido pelo bot ou manual';
    }
  },

  async saveSchedule(event) {
    event.preventDefault();
    const id = document.getElementById('sched_id').value;
    const title = document.getElementById('sched_title').value.trim();
    const event_time = document.getElementById('sched_time').value;
    const recurrence = document.getElementById('sched_recurrence').value;
    const day_of_week = recurrence === 'WEEKLY' ? parseInt(document.getElementById('sched_day_of_week').value, 10) : null;
    const next_run_date = recurrence === 'ONCE' ? document.getElementById('sched_date').value : null;

    // Coleta os itens da tabela
    const rows = document.querySelectorAll('#schedule-items-container .item-row');
    const items = [];

    rows.forEach(row => {
      const item_time = row.querySelector('.item-time').value;
      const name = row.querySelector('.item-name').value.trim();
      const responsible_name = row.querySelector('.item-resp-name').value.trim();
      const responsible_phone = row.querySelector('.item-resp-phone').value.trim();
      const is_immutable = row.querySelector('.item-immutable').checked;
      const content = row.querySelector('.item-content').value.trim();

      if (name) {
        items.push({
          item_time,
          name,
          responsible_name,
          responsible_phone,
          is_immutable,
          content
        });
      }
    });

    const payload = {
      title,
      event_time,
      recurrence,
      day_of_week,
      next_run_date,
      items
    };

    try {
      const url = id ? `/api/schedules/${id}` : '/api/schedules';
      const method = id ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (data.success) {
        this.showAlert('Cronograma salvo com sucesso!');
        this.hideModal('schedule-modal');
        this.loadSchedules();
      } else {
        this.showAlert(data.error, 'error');
      }
    } catch (err) {
      this.showAlert(`Erro ao salvar: ${err.message}`, 'error');
    }
  },

  // --- LOGS ---

  async loadLogs() {
    const container = document.getElementById('logs-container');
    try {
      const res = await fetch('/api/logs');
      const data = await res.json();
      if (data.success && data.logs) {
        if (data.logs.length === 0) {
          container.innerHTML = '<div class="text-slate-500">Nenhum evento registrado ainda.</div>';
          return;
        }

        container.innerHTML = data.logs.map(log => {
          const levelColors = {
            INFO: 'text-emerald-400',
            WARN: 'text-amber-400',
            ERROR: 'text-rose-400'
          };
          const color = levelColors[log.level] || 'text-slate-400';
          const time = log.timestamp ? log.timestamp.split(' ')[1] || log.timestamp : '';

          return `
            <div class="leading-relaxed border-b border-slate-800/40 pb-1">
              <span class="text-slate-500">[${time}]</span>
              <span class="${color} font-bold">[${log.level}]</span>
              <span class="text-slate-300">${log.message}</span>
            </div>
          `;
        }).join('');
      }
    } catch (err) {
      console.error('Erro ao buscar logs:', err);
    }
  }
};

window.app = app;
document.addEventListener('DOMContentLoaded', () => {
  app.init();
});
