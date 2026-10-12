import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  sonoplastaPhone: process.env.SONOPLASTA_PHONE || '',
  botName: process.env.BOT_NAME || 'WhatsBot Sonoplasta',
  timezone: process.env.TIMEZONE || 'America/Sao_Paulo',
  reminderTime: process.env.REMINDER_TIME || '09:00',
  ngrokAuthToken: process.env.NGROK_AUTHTOKEN || '',
  ngrokDomain: process.env.NGROK_DOMAIN || '',
  ngrokEnabled: process.env.NGROK_ENABLED !== 'false',
  adminUser: process.env.ADMIN_USER || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  dataDir: path.resolve(__dirname, '../../data'),
  authDir: path.resolve(__dirname, '../../baileys_auth_info')
};
