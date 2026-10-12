import ngrok from '@ngrok/ngrok';
import { config } from '../config/env.js';
import { getSetting, logMessage } from '../config/database.js';

let currentListener = null;
let ngrokStatus = {
  status: 'DISCONNECTED', // 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'MISSING_TOKEN' | 'DISABLED' | 'ERROR'
  url: null,
  error: null,
  startedAt: null
};

export function getNgrokStatus() {
  const isEnabled = getSetting('ngrok_enabled', config.ngrokEnabled ? '1' : '0') !== '0';
  const hasToken = Boolean(getSetting('ngrok_authtoken', config.ngrokAuthToken));

  return {
    ...ngrokStatus,
    enabled: isEnabled,
    hasToken,
    port: config.port
  };
}

export async function stopNgrokTunnel() {
  if (currentListener) {
    try {
      await currentListener.close();
    } catch (err) {
      console.error('[Ngrok] Erro ao fechar listener:', err.message);
    }
    currentListener = null;
  }

  try {
    await ngrok.disconnect();
  } catch {}

  ngrokStatus = {
    status: 'DISCONNECTED',
    url: null,
    error: null,
    startedAt: null
  };
}

export async function startNgrokTunnel() {
  const isEnabled = getSetting('ngrok_enabled', config.ngrokEnabled ? '1' : '0') !== '0';

  if (!isEnabled) {
    ngrokStatus = {
      status: 'DISABLED',
      url: null,
      error: null,
      startedAt: null
    };
    logMessage('INFO', '[Ngrok] Túnel desabilitado nas configurações.');
    return null;
  }

  const authtoken = (getSetting('ngrok_authtoken', config.ngrokAuthToken) || '').trim();

  if (!authtoken) {
    ngrokStatus = {
      status: 'MISSING_TOKEN',
      url: null,
      error: 'Authtoken do Ngrok não configurado.',
      startedAt: null
    };
    const helpMsg = '[Ngrok] Authtoken não informado. Para acessar pela internet de qualquer lugar, obtenha seu token gratuito em https://dashboard.ngrok.com e preencha nas Configurações do painel ou no arquivo .env.';
    logMessage('WARN', helpMsg);
    console.log(`\n⚠️  ${helpMsg}\n`);
    return null;
  }

  await stopNgrokTunnel();

  ngrokStatus.status = 'CONNECTING';
  ngrokStatus.error = null;

  try {
    const domain = (getSetting('ngrok_domain', config.ngrokDomain) || '').trim();
    const forwardOpts = {
      addr: config.port,
      authtoken: authtoken,
      domain: domain || undefined
    };

    currentListener = await ngrok.forward(forwardOpts);
    const publicUrl = currentListener.url();

    ngrokStatus = {
      status: 'CONNECTED',
      url: publicUrl,
      error: null,
      startedAt: new Date().toISOString()
    };

    logMessage('INFO', `[Ngrok] Túnel público criado com sucesso: ${publicUrl}`);
    console.log(`\n========================================================`);
    console.log(`🌐 Link Ngrok de Acesso Remoto (Internet):`);
    console.log(`👉 ${publicUrl}`);
    console.log(`========================================================\n`);

    return publicUrl;
  } catch (err) {
    currentListener = null;
    ngrokStatus = {
      status: 'ERROR',
      url: null,
      error: err.message || 'Falha ao iniciar o túnel Ngrok.',
      startedAt: null
    };

    const errMsg = `[Ngrok] Falha ao conectar túnel: ${err.message}. A aplicação continua funcionando normalmente em http://localhost:${config.port}`;
    logMessage('ERROR', errMsg);
    console.error(`\n⚠️  ${errMsg}\n`);
    return null;
  }
}

export async function restartNgrokTunnel() {
  await stopNgrokTunnel();
  return await startNgrokTunnel();
}
