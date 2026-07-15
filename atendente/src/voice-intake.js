import { config, audioTranscriptionEnabled } from './config.js';
import { fetchWithTimeout } from './http.js';
import { checkOpenAiQuota } from './alerts.js';
import { readUploadBuffer } from './upload.js';

export const VOICE_INTAKE_MAX_BYTES = 10 * 1024 * 1024;
export const ALLOWED_VOICE_AUDIO_MIME = new Set([
  'audio/webm',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/m4a',
  'audio/aac',
  'video/webm',
]);

const DEFAULT_ATTENDANT = 'Ana';
const DEFAULT_TONE = 'Amigável, direto e profissional, como uma conversa de WhatsApp.';

function audioExtension(mime = '') {
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
  if (mime.includes('aac')) return 'aac';
  return 'mp3';
}

function asString(value, max = 2000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizeItems(items, fields, limit) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, limit).map((item) => {
    const out = {};
    fields.forEach((field) => {
      out[field] = asString(item?.[field], field === 'descricao' ? 500 : 240);
    });
    return out;
  }).filter((item) => Object.values(item).some(Boolean));
}

function normalizeSuggestion(raw = {}) {
  return {
    descricao: asString(raw.descricao, 2000),
    atendente_name: asString(raw.atendente_name, 80) || DEFAULT_ATTENDANT,
    tomDeVoz: asString(raw.tomDeVoz, 500) || DEFAULT_TONE,
    frete: asString(raw.frete, 1000),
    faqs: normalizeItems(raw.faqs, ['pergunta', 'resposta'], 6),
    objecoes: normalizeItems(raw.objecoes, ['objecao', 'resposta'], 6),
    produtos: normalizeItems(raw.produtos, ['nome', 'preco', 'descricao'], 8),
  };
}

async function transcribeVoiceAudio(buffer, mime) {
  if (!audioTranscriptionEnabled) {
    const err = new Error('Transcrição de áudio não está configurada.');
    err.statusCode = 503;
    throw err;
  }

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), `voice-intake.${audioExtension(mime)}`);
  form.append('model', 'gpt-4o-mini-transcribe');
  form.append('language', 'pt');
  form.append('response_format', 'json');

  let res;
  try {
    res = await fetchWithTimeout('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openaiApiKey}` },
      body: form,
    }, 45_000);
  } catch (err) {
    const e = new Error('Não foi possível enviar o áudio para transcrição.');
    e.statusCode = 502;
    throw e;
  }

  if (!res.ok) {
    const body = await res.text();
    checkOpenAiQuota(res.status, body);
    const err = new Error('Não consegui transcrever o áudio. Tente novamente ou preencha manualmente.');
    err.statusCode = res.status >= 500 ? 502 : 400;
    throw err;
  }

  const data = await res.json();
  const transcript = asString(data.text, 12000);
  if (!transcript) {
    const err = new Error('Não consegui identificar fala no áudio. Tente gravar novamente.');
    err.statusCode = 400;
    throw err;
  }
  return transcript;
}

async function organizeTranscript(transcript) {
  const schema = {
    name: 'settings_voice_intake',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        descricao: { type: 'string' },
        atendente_name: { type: 'string' },
        tomDeVoz: { type: 'string' },
        frete: { type: 'string' },
        faqs: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              pergunta: { type: 'string' },
              resposta: { type: 'string' },
            },
            required: ['pergunta', 'resposta'],
          },
        },
        objecoes: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              objecao: { type: 'string' },
              resposta: { type: 'string' },
            },
            required: ['objecao', 'resposta'],
          },
        },
        produtos: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              nome: { type: 'string' },
              preco: { type: 'string' },
              descricao: { type: 'string' },
            },
            required: ['nome', 'preco', 'descricao'],
          },
        },
      },
      required: ['descricao', 'atendente_name', 'tomDeVoz', 'frete', 'faqs', 'objecoes', 'produtos'],
    },
  };

  const body = {
    model: 'gpt-4o-mini',
    temperature: 0.2,
    response_format: { type: 'json_schema', json_schema: schema },
    messages: [
      {
        role: 'system',
        content:
          'Você receberá uma fala transcrita de um pequeno lojista brasileiro explicando seu negócio. ' +
          'Extraia apenas informações úteis para configurar uma IA de atendimento no WhatsApp. ' +
          'Não invente preços, produtos, cidades, endereço, política de troca ou prazo de entrega. ' +
          'Se algo não estiver claro, deixe em branco. Use português do Brasil, linguagem simples e clara.',
      },
      {
        role: 'user',
        content:
          'Organize esta fala em JSON para configuração da loja. ' +
          `Transcrição:\n${transcript}`,
      },
    ],
  };

  let res;
  try {
    res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }, 45_000);
  } catch (err) {
    const e = new Error('Não consegui organizar as informações da loja.');
    e.statusCode = 502;
    throw e;
  }

  if (!res.ok) {
    const text = await res.text();
    checkOpenAiQuota(res.status, text);
    const err = new Error('Não consegui organizar as informações da loja.');
    err.statusCode = res.status >= 500 ? 502 : 400;
    throw err;
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '{}';
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = {};
  }
  return normalizeSuggestion(parsed);
}

export async function processSettingsVoiceIntake(file) {
  if (!file || !file.size) {
    const err = new Error('Envie um arquivo de áudio para transcrever.');
    err.statusCode = 400;
    throw err;
  }
  if (file.size > VOICE_INTAKE_MAX_BYTES) {
    const err = new Error('Áudio muito grande. Grave até 60 segundos ou envie um arquivo menor que 10 MB.');
    err.statusCode = 413;
    throw err;
  }
  if (!ALLOWED_VOICE_AUDIO_MIME.has(file.mimetype)) {
    const err = new Error('Formato de áudio inválido. Use webm, mp3, wav ou m4a.');
    err.statusCode = 415;
    throw err;
  }

  // Buffer lido do disco só depois das validações acima (upload temporário).
  const audioBuffer = readUploadBuffer(file);
  if (!audioBuffer?.length) {
    const err = new Error('Envie um arquivo de áudio para transcrever.');
    err.statusCode = 400;
    throw err;
  }
  const transcript = await transcribeVoiceAudio(audioBuffer, file.mimetype);
  const suggested = await organizeTranscript(transcript);
  return { transcript, suggested };
}
