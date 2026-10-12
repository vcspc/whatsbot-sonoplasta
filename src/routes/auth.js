import { Router } from 'express';
import {
  validateCredentials,
  createSession,
  deleteSession,
  isValidSession,
  changeCredentials,
  getSetting,
  logMessage
} from '../config/database.js';
import { requireAuth } from '../middlewares/auth.js';

const router = Router();

// Login
router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Informe usuário e senha para acessar.'
      });
    }

    const isValid = validateCredentials(username, password);
    if (!isValid) {
      logMessage('WARN', `[Auth] Tentativa de login inválida para o usuário: "${username}"`);
      return res.status(401).json({
        success: false,
        error: 'Usuário ou senha incorretos.'
      });
    }

    const session = createSession();
    logMessage('INFO', `[Auth] Login realizado com sucesso no sistema (Usuário: "${username}").`);

    res.json({
      success: true,
      token: session.token,
      expires_at: session.expiresAt,
      username: getSetting('auth_username', 'admin')
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Logout
router.post('/logout', (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (req.headers['x-auth-token']) {
      token = String(req.headers['x-auth-token']).trim();
    }

    if (token) {
      deleteSession(token);
    }

    res.json({ success: true, message: 'Sessão encerrada com sucesso.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Verifica se o token atual é válido
router.get('/check', (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (req.headers['x-auth-token']) {
      token = String(req.headers['x-auth-token']).trim();
    }

    if (token && isValidSession(token)) {
      return res.json({
        success: true,
        authenticated: true,
        username: getSetting('auth_username', 'admin')
      });
    }

    res.status(401).json({
      success: false,
      authenticated: false,
      error: 'Sessão não autorizada ou expirada.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Alteração de credenciais coletivas
router.post('/change-credentials', requireAuth, (req, res) => {
  try {
    const { currentPassword, newUsername, newPassword } = req.body || {};

    if (!currentPassword) {
      return res.status(400).json({
        success: false,
        error: 'Informe a senha atual para confirmar a alteração.'
      });
    }

    const currentUsername = getSetting('auth_username', 'admin');
    const isCurrentValid = validateCredentials(currentUsername, currentPassword);
    if (!isCurrentValid) {
      return res.status(400).json({
        success: false,
        error: 'A senha atual informada está incorreta.'
      });
    }

    if (!newUsername && !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Informe um novo usuário ou nova senha para atualizar.'
      });
    }

    changeCredentials(newUsername, newPassword);
    logMessage('INFO', `[Auth] Credenciais coletivas do sistema foram alteradas com sucesso.`);

    res.json({
      success: true,
      message: 'Credenciais atualizadas com sucesso!',
      username: getSetting('auth_username', 'admin')
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
