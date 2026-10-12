import { chromium } from 'playwright';
import { logMessage } from '../config/database.js';

let browserInstance = null;

async function getBrowser() {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });
  }
  return browserInstance;
}

/**
 * Extrai todas as URLs do YouTube encontradas no texto.
 */
export function extractYouTubeUrls(text) {
  if (!text) return [];
  const regex = /(https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/)[a-zA-Z0-9_-]+|youtu\.be\/[a-zA-Z0-9_-]+)[^\s]*)/gi;
  const matches = text.match(regex);
  return matches ? Array.from(new Set(matches)) : [];
}

/**
 * Acessa um link do YouTube usando o Playwright e extrai o título do vídeo.
 */
export async function getYouTubeVideoTitle(url) {
  // 1. Tenta primeiro via API oficial oEmbed do YouTube (mais rápido e imune a interstitials)
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const data = await res.json();
      if (data && data.title && data.title.trim()) {
        logMessage('INFO', `[Playwright] Título extraído com sucesso: "${data.title.trim()}"`);
        return data.title.trim();
      }
    }
  } catch {
    // Segue para fallback com Playwright
  }

  let context = null;
  let page = null;
  try {
    logMessage('INFO', `[Playwright] Acessando link do YouTube: ${url}`);
    const browser = await getBrowser();
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    page = await context.newPage();

    // Bloqueia recursos desnecessários para acelerar o carregamento
    await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,eot,mp4,webm,mp3}', route => route.abort());

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // Tenta obter o título de várias formas:
    // 1. Meta tag og:title
    // 2. Meta tag title
    // 3. document.title
    const title = await page.evaluate(() => {
      const isValid = t => t && t.trim() && !t.startsWith('http://') && !t.startsWith('https://');

      // 1. og:title
      const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
      if (isValid(ogTitle)) return ogTitle.trim();

      // 2. meta name="title"
      const metaTitle = document.querySelector('meta[name="title"]')?.getAttribute('content');
      if (isValid(metaTitle)) return metaTitle.trim();

      // 3. document.title
      if (document.title && document.title.trim()) {
        const cleaned = document.title.replace(/\s*-\s*YouTube$/i, '').trim();
        if (isValid(cleaned)) return cleaned;
      }

      return null;
    });

    if (title) {
      logMessage('INFO', `[Playwright] Título extraído com sucesso: "${title}"`);
      return title;
    }

    // Se ainda não achou, aguarda até 3 segundos pelo seletor h1
    try {
      const el = await page.waitForSelector('h1', { timeout: 3000 });
      const text = (await el?.textContent())?.trim();
      if (text) {
        return text.replace(/\s*-\s*YouTube$/i, '').trim();
      }
    } catch {
      // Ignora timeout secundário
    }

    return null;
  } catch (error) {
    logMessage('ERROR', `[Playwright] Erro ao extrair título do YouTube (${url}): ${error.message}`);
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
  }
}

/**
 * Fecha a instância do navegador ao encerrar a aplicação.
 */
export async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
  }
}
