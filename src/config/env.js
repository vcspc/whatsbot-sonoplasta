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
  dataDir: path.resolve(__dirname, '../../data'),
  authDir: path.resolve(__dirname, '../../baileys_auth_info')
};
