import { config, audioTranscriptionEnabled } from './config.js';
import { fetchWithTimeout } from './http.js';
import { checkOpenAiQuota } from './alerts.js';

/**
 * Transcreve um audio usando a API Whisper da OpenAI (opcional).
 * So funciona se OPENAI_API_KEY estiver configurada.
 * @returns {Promise<{text: string, seconds: number}|null>} texto + duração transcritos, ou null se indisponivel
 */
export async function transcribeAudio(buffer, mime) {
  if (!audioTranscriptionEnabled) return null;

  const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'mp4' : 'mp3';
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), `audio.${ext}`);
  form.append('model', 'whisper-1');
  form.append('language', 'pt');
  // verbose_json inclui `duration` (segundos) — usado para medir consumo de
  // minutos de transcrição por plano, sem precisar de lib de parsing de áudio.
  form.append('response_format', 'verbose_json');

  let res;
  try {
    res = await fetchWithTimeout('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openaiApiKey}` },
      body: form,
    }, 30000);
  } catch (err) {
    console.warn('Falha ao transcrever audio (rede/timeout):', err.message);
    return null;
  }

  if (!res.ok) {
    const body = await res.text();
    console.warn('Falha ao transcrever audio:', res.status, body);
    checkOpenAiQuota(res.status, body); // alerta se for falta de quota/crédito
    return null;
  }
  const data = await res.json();
  if (!data.text) return null;
  return { text: data.text, seconds: Math.max(0, Math.round(data.duration || 0)) };
}
