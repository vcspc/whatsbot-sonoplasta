import { GoogleGenAI } from '@google/genai';
import { getSetting, logMessage } from '../config/database.js';
import { config } from '../config/env.js';

/**
 * Obtém a chave do Gemini do banco de dados ou das variáveis de ambiente.
 */
function getApiKey() {
  return getSetting('gemini_api_key') || config.geminiApiKey || '';
}

/**
 * Processa a mensagem do responsável com o Gemini AI, utilizando o histórico de conversas e os itens pendentes do cronograma.
 *
 * @param {Object} params
 * @param {string} params.responsibleName - Nome do responsável
 * @param {string} params.userMessage - Mensagem enviada pelo responsável (acumulada após 10s)
 * @param {Array<Object>} params.pendingItems - Lista de itens do cronograma atribuídos a essa pessoa
 * @param {Array<{ role: 'user' | 'model', text: string }>} params.history - Histórico dos últimos 30 minutos
 * @param {Array<{ url: string, title: string }>} params.extractedYouTubeVideos - Vídeos com título já extraído pelo Playwright
 * @returns {Promise<{ updated_items: Array<{ id: number, content: string }>, reply_message: string }>}
 */
export async function processMessageWithGemini({
  responsibleName,
  userMessage,
  pendingItems,
  history = [],
  extractedYouTubeVideos = []
}) {
  const apiKey = getApiKey();

  // Informações de vídeos extraídos pelo Playwright
  let youtubeContext = '';
  if (extractedYouTubeVideos.length > 0) {
    youtubeContext = '\nVídeos do YouTube identificados e seus títulos extraídos:\n' +
      extractedYouTubeVideos.map(v => `- Link: ${v.url}\n  Título do Vídeo: "${v.title}"`).join('\n');
  }

  // Se não houver chave de API configurada, utiliza lógica de fallback heurística
  if (!apiKey) {
    logMessage('WARN', '[Gemini] Chave de API não configurada. Usando fallback automático.');
    return fallbackResponse({
      responsibleName,
      userMessage,
      pendingItems,
      extractedYouTubeVideos
    });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    // Monta o prompt de sistema
    const itemsDescription = pendingItems.map(item =>
      `- [ID: ${item.id}] Horário: ${item.item_time} | Nome do Momento: "${item.name}" | Conteúdo atual: ${item.content ? `"${item.content}"` : '(vazio/pendente)'}`
    ).join('\n');

    const systemInstruction = `Você é o assistente inteligente da equipe de sonoplastia de uma igreja evangélica.
Seu objetivo é conversar com as pessoas responsáveis pelos momentos do culto para registrar e atualizar o cronograma (hinos, louvores, vídeos, pregação, orações).

A pessoa que está conversando com você se chama: "${responsibleName || 'Irmão(ã)'}".
Ela é responsável pelo(s) seguinte(s) item(ns) do cronograma:
${itemsDescription || 'Nenhum item pendente no momento.'}
${youtubeContext}

Diretrizes:
1. Analise o que o usuário disse (e o histórico de conversa) para identificar se ele está informando o conteúdo de um ou mais momentos do cronograma.
2. Se o usuário enviou um link do YouTube e temos o título extraído do vídeo, associe o título do vídeo (e o link) como conteúdo do item correspondente.
3. Se o usuário for responsável por mais de um item (ex: Hino Inicial e Hino Final) e disser por exemplo "o primeiro vai ser Hino 10 e o último Hino 20", mapeie cada conteúdo para o ID correspondente.
4. Se o usuário for responsável por apenas 1 item, qualquer louvor/música/vídeo informado deve ser atribuído àquele item.
5. Se a mensagem for apenas uma dúvida ou cumprimento, responda com cordialidade e lembre-o gentilmente do que ainda está pendente.
6. Sempre responda de forma cristã, calorosa, educada e prestativa ("A paz do Senhor", "Deus abençoe", "Muito obrigado").

ATENÇÃO: Você DEVE retornar ESTRITAMENTE um objeto JSON válido, sem markdown envolvente ou com json format, no seguinte formato:
{
  "updated_items": [
    {
      "id": 12,
      "content": "Harpa Cristã 15 - Foi na Cruz"
    }
  ],
  "reply_message": "Muito obrigado, Irmã Rosana! Já anotei o Hino Inicial para o culto. Que Deus abençoe! 🙏"
}`;

    // Monta os conteúdos para o Gemini com histórico multi-turn
    const contents = [];

    // Adiciona histórico recente (se houver)
    for (const h of history) {
      contents.push({
        role: h.role === 'model' ? 'model' : 'user',
        parts: [{ text: h.text }]
      });
    }

    // Mensagem atual do usuário
    contents.push({
      role: 'user',
      parts: [{ text: userMessage }]
    });

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      config: {
        systemInstruction,
        responseMimeType: 'application/json'
      }
    });

    const responseText = response.text?.trim() || '';
    logMessage('INFO', `[Gemini] Resposta recebida da IA: ${responseText.slice(0, 150)}...`);

    // Parse do JSON da resposta
    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      // Tenta remover possíveis marcadores de código se o modelo colocou ```json
      const cleaned = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleaned);
    }

    return {
      updated_items: Array.isArray(parsed.updated_items) ? parsed.updated_items : [],
      reply_message: parsed.reply_message || 'Muito obrigado! Mensagem recebida e atualizada no cronograma. 🙏'
    };
  } catch (error) {
    logMessage('ERROR', `[Gemini] Falha ao processar com Gemini (${error.message}). Ativando fallback.`);
    return fallbackResponse({
      responsibleName,
      userMessage,
      pendingItems,
      extractedYouTubeVideos
    });
  }
}

/**
 * Fallback caso a API do Gemini esteja sem chave ou indisponível temporariamente.
 */
function fallbackResponse({ responsibleName, userMessage, pendingItems, extractedYouTubeVideos }) {
  const updated_items = [];
  let content = userMessage.trim();

  // Se houver vídeo extraído do YouTube, usa o título do vídeo
  if (extractedYouTubeVideos.length > 0) {
    content = `${extractedYouTubeVideos[0].title} (${extractedYouTubeVideos[0].url})`;
  }

  // Se houver apenas 1 item pendente, atribui direto a ele
  if (pendingItems && pendingItems.length === 1) {
    updated_items.push({
      id: pendingItems[0].id,
      content
    });
    return {
      updated_items,
      reply_message: `A paz do Senhor, ${responsibleName || 'irmão(ã)'}! Recebi e atualizei o item "${pendingItems[0].name}" no cronograma. Muito obrigado! Deus abençoe! 🙏`
    };
  }

  // Se houver múltiplos itens pendentes, tenta associar por menção de nome
  if (pendingItems && pendingItems.length > 1) {
    for (const item of pendingItems) {
      const lower = item.name.toLowerCase();
      if (userMessage.toLowerCase().includes(lower)) {
        updated_items.push({
          id: item.id,
          content
        });
      }
    }

    if (updated_items.length > 0) {
      return {
        updated_items,
        reply_message: `A paz do Senhor, ${responsibleName || 'irmão(ã)'}! Atualizei o(s) momento(s) correspondente(s) no cronograma. Muito obrigado! 🙏`
      };
    }
  }

  return {
    updated_items: [],
    reply_message: `A paz do Senhor, ${responsibleName || 'irmão(ã)'}! Recebi sua mensagem. Por favor, confirme para qual momento do cronograma você gostaria de registrar essa informação. 🙏`
  };
}
