import { isValidSession } from '../config/database.js';

export function requireAuth(req, res, next) {
  // Ignora preflight CORS
  if (req.method === 'OPTIONS') {
    return next();
  }

  const authHeader = req.headers.authorization;
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.headers['x-auth-token']) {
    token = String(req.headers['x-auth-token']).trim();
  } else if (req.query && req.query.token) {
    token = String(req.query.token).trim();
  }

  if (!token || !isValidSession(token)) {
    return res.status(401).json({
      success: false,
      error: 'Acesso não autorizado. Faça login para continuar.',
      code: 'UNAUTHORIZED'
    });
  }

  req.authToken = token;
  next();
}
