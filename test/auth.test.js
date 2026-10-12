import { db } from '../src/config/database.js';
import {
  hashPassword,
  verifyPassword,
  validateCredentials,
  changeCredentials,
  createSession,
  isValidSession,
  deleteSession,
  cleanupExpiredSessions,
  getSetting,
  setSetting
} from '../src/config/database.js';
import { requireAuth } from '../src/middlewares/auth.js';
import { getNgrokStatus, startNgrokTunnel, stopNgrokTunnel } from '../src/services/ngrok.js';

let failedTests = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`✅ [PASS] ${testName}`);
  } else {
    console.error(`❌ [FAIL] ${testName}`);
    failedTests++;
  }
}

async function runAuthTests() {
  console.log('\n======================================================');
  console.log('🔐 TESTES DE AUTENTICAÇÃO E SESSÃO COLETIVA');
  console.log('======================================================\n');

  // 1. Testes de Hashing e Verificação de Senha
  console.log('1. Criptografia e Verificação de Senha:');
  const { hash, salt } = hashPassword('minhaSenhaSegura');
  assert(hash && hash.length === 128, 'Hash scrypt gerado com tamanho correto (64 bytes / 128 hex)');
  assert(salt && salt.length === 32, 'Salt aleatório gerado com 16 bytes (32 hex)');
  assert(verifyPassword('minhaSenhaSegura', hash, salt), 'Senha correta validada com sucesso');
  assert(!verifyPassword('senhaErrada', hash, salt), 'Senha incorreta rejeitada');
  assert(!verifyPassword('', hash, salt), 'Senha vazia rejeitada');
  assert(!verifyPassword(null, hash, salt), 'Null rejeitado');

  // 2. Validação de Credenciais Coletivas Padrão
  console.log('\n2. Credenciais Coletivas do Sistema:');
  assert(validateCredentials('admin', 'admin123'), 'Login padrão (admin / admin123) aceito');
  assert(validateCredentials('ADMIN', 'admin123'), 'Login com usuário em maiúsculas aceito (case-insensitive)');
  assert(!validateCredentials('admin', 'senhaErrada123'), 'Senha incorreta rejeitada');
  assert(!validateCredentials('usuario_desconhecido', 'admin123'), 'Usuário inexistente rejeitado');

  // 3. Gerenciamento de Sessões
  console.log('\n3. Ciclo de Vida da Sessão:');
  const session = createSession();
  assert(session.token && session.token.length === 64, 'Token de sessão gerado com 32 bytes (64 hex)');
  assert(session.expiresAt > Date.now(), 'Data de expiração calculada no futuro');
  assert(isValidSession(session.token), 'Sessão recém-criada é válida');

  deleteSession(session.token);
  assert(!isValidSession(session.token), 'Sessão invalidada após logout (deleteSession)');
  assert(!isValidSession('token_fantasma_inexistente'), 'Token inexistente retorna falso');

  // 4. Teste de Expiração de Sessão
  console.log('\n4. Expiração e Limpeza Automática:');
  const expiredSession = createSession();
  const pastTime = Date.now() - 1000;
  db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(pastTime, expiredSession.token);
  assert(!isValidSession(expiredSession.token), 'Sessão com data expirada é rejeitada e removida');

  // 5. Alteração de Credenciais
  console.log('\n5. Alteração de Usuário e Senha Coletivos:');
  changeCredentials('pastor', 'pastorNovaSenha2026');
  assert(validateCredentials('pastor', 'pastorNovaSenha2026'), 'Novas credenciais aceitas após alteração');
  assert(!validateCredentials('admin', 'admin123'), 'Credenciais antigas desativadas');

  // Restaura padrão para não afetar outros testes
  changeCredentials('admin', 'admin123');
  assert(validateCredentials('admin', 'admin123'), 'Credenciais restauradas para admin / admin123');

  // 6. Teste de Middleware requireAuth
  console.log('\n6. Middleware Express requireAuth:');
  let nextCalled = false;
  let statusSent = null;
  let jsonSent = null;

  const mockRes = {
    status(code) {
      statusSent = code;
      return {
        json(data) {
          jsonSent = data;
        }
      };
    }
  };

  // 6.1 Sem token
  nextCalled = false;
  requireAuth({ headers: {} }, mockRes, () => { nextCalled = true; });
  assert(!nextCalled && statusSent === 401, 'Requisição sem token bloqueada com 401');

  // 6.2 Token inválido
  nextCalled = false;
  requireAuth({ headers: { authorization: 'Bearer token_invalido_123' } }, mockRes, () => { nextCalled = true; });
  assert(!nextCalled && statusSent === 401, 'Requisição com token inválido bloqueada com 401');

  // 6.3 Token válido
  const validSession = createSession();
  nextCalled = false;
  requireAuth({ headers: { authorization: `Bearer ${validSession.token}` } }, mockRes, () => { nextCalled = true; });
  assert(nextCalled, 'Requisição com Bearer token válido autorizada (next chamado)');
  deleteSession(validSession.token);

  // 7. Testes do Serviço Ngrok (Resiliência e Status)
  console.log('\n7. Serviço Ngrok (Resiliência e Tolerância a Falhas):');
  const initialStatus = getNgrokStatus();
  assert(typeof initialStatus.enabled === 'boolean', 'Status do Ngrok informa propriedade enabled');
  assert(typeof initialStatus.hasToken === 'boolean', 'Status do Ngrok informa propriedade hasToken');
  assert(typeof initialStatus.port === 'number', 'Status do Ngrok informa porta do servidor');

  // 7.1 Túnel com Ngrok Desativado
  setSetting('ngrok_enabled', '0');
  const disabledResult = await startNgrokTunnel();
  assert(disabledResult === null, 'startNgrokTunnel retorna null quando desativado');
  assert(getNgrokStatus().status === 'DISABLED', 'Status marcado como DISABLED');

  // 7.2 Túnel sem Token
  setSetting('ngrok_enabled', '1');
  const originalToken = getSetting('ngrok_authtoken', '');
  setSetting('ngrok_authtoken', '');
  const missingTokenResult = await startNgrokTunnel();
  assert(missingTokenResult === null, 'startNgrokTunnel não trava e retorna null sem token');
  assert(getNgrokStatus().status === 'MISSING_TOKEN', 'Status marcado como MISSING_TOKEN');

  // 7.3 Parada do Túnel
  await stopNgrokTunnel();
  assert(getNgrokStatus().status === 'DISCONNECTED', 'stopNgrokTunnel redefine status para DISCONNECTED');

  // Restaura configurações originais
  if (originalToken) {
    setSetting('ngrok_authtoken', originalToken);
  }

  console.log(`\n======================================================`);
  console.log(`RESULTADO: ${failedTests === 0 ? 'TODOS OS TESTES DE AUTH PASSARAM! 🎉' : `${failedTests} TESTES FALHARAM!`}`);
  console.log('======================================================\n');

  process.exit(failedTests === 0 ? 0 : 1);
}

runAuthTests().catch(err => {
  console.error('Erro fatal nos testes de auth:', err);
  process.exit(1);
});
