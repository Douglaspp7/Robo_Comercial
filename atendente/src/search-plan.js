const SOURCES = new Set(['google', 'instagram']);

function cleanText(value, max) {
  const printable = Array.from(String(value || ''), (char) => char.charCodeAt(0) < 32 ? ' ' : char).join('');
  return printable.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function sanitizeSearchPlan(raw, city) {
  const rows = Array.isArray(raw) ? raw : raw?.suggestions;
  if (!Array.isArray(rows)) return [];
  const seen = new Set();
  const safe = [];
  for (const row of rows.slice(0, 24)) {
    const source = cleanText(row?.source, 20).toLowerCase();
    const query = cleanText(row?.query, 100).replace(/^#/, '');
    if (!SOURCES.has(source) || !query) continue;
    const key = `${source}:${query.toLocaleLowerCase('pt-BR')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    safe.push({
      source,
      mode: source === 'instagram' ? 'hashtag' : null,
      query,
      location: source === 'google' ? cleanText(row?.location || city, 100) : null,
      score: Math.max(1, Math.min(100, Math.round(Number(row?.score) || 50))),
      reason: cleanText(row?.reason, 240) || 'Boa aderência ao atendimento comercial pelo WhatsApp.',
    });
  }
  return safe.sort((a, b) => b.score - a.score).slice(0, 12);
}

export function buildSearchPlanPrompt({ city, objective }) {
  return `Você é estrategista de prospecção B2B do Zapien, um atendente de vendas com IA para WhatsApp.
Crie 12 hipóteses de busca para encontrar pequenos negócios em ${city} com maior chance de conversão.
Priorize negócios que dependem do WhatsApp, recebem perguntas repetidas, enviam catálogo/orçamento, agendam horários ou perdem contatos fora do expediente.
Objetivo adicional: ${objective || 'vender o Zapien para empresas locais'}.
Misture 8 buscas do Google Maps e 4 hashtags do Instagram. Use termos reais que uma busca local entende, sem # nas hashtags.
Não inclua pessoas físicas, listas compradas, dados sensíveis, atividades ilegais ou segmentos com abordagem invasiva.
Para cada hipótese dê uma nota estimada de 1 a 100 e explique em uma frase por que tende a converter. A nota é uma hipótese, não dado histórico.
Responda SOMENTE JSON válido neste formato:
{"suggestions":[{"source":"google","query":"clínica de estética","location":"${city}","score":90,"reason":"..."},{"source":"instagram","query":"esteticista${city.split(',')[0].replace(/\s+/g, '').toLowerCase()}","score":80,"reason":"..."}]}`;
}

export async function generateSearchPlan(input, createMessage, model) {
  const city = cleanText(input?.city, 100);
  const objective = cleanText(input?.objective, 240);
  if (!city) throw new Error('Cidade obrigatória.');
  const response = await createMessage({
    model,
    max_tokens: 1800,
    temperature: 0.3,
    messages: [{ role: 'user', content: buildSearchPlanPrompt({ city, objective }) }],
  });
  const text = response?.content?.find((part) => part.type === 'text')?.text || '';
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error('A IA não retornou um plano válido.');
  const suggestions = sanitizeSearchPlan(JSON.parse(json), city);
  if (!suggestions.length) throw new Error('A IA não retornou sugestões aproveitáveis.');
  return suggestions;
}
