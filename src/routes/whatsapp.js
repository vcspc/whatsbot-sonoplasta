import { Router } from 'express';
import { getWhatsAppStatus, initWhatsApp, logoutWhatsApp } from '../services/baileys.js';

const router = Router();

router.get('/status', (req, res) => {
  try {
    const status = getWhatsAppStatus();
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/restart', async (req, res) => {
  try {
    await initWhatsApp();
    res.json({ success: true, message: 'Reiniciando conexão com WhatsApp...' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/logout', async (req, res) => {
  try {
    await logoutWhatsApp();
    res.json({ success: true, message: 'WhatsApp desconectado com sucesso.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
