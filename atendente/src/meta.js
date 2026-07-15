import { config, embeddedSignupEnabled } from './config.js';

export { embeddedSignupEnabled };

/**
 * Troca o "code" do Embedded Signup por um token de acesso de negocio.
 * @param {string} code - codigo retornado pelo FB.login no front
 * @returns {Promise<string>} access_token
 */
export async function exchangeCodeForToken(code) {
  if (!embeddedSignupEnabled) throw new Error('Embedded Signup nao configurado.');

  const url = new URL(`https://graph.facebook.com/${config.whatsapp.apiVersion}/oauth/access_token`);
  url.searchParams.set('client_id', config.meta.appId);
  url.searchParams.set('client_secret', config.meta.appSecret);
  url.searchParams.set('code', code);

  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Falha na troca de token: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

/**
 * Garante que o numero esteja registrado na Cloud API (necessario apos o
 * Embedded Signup para poder enviar/receber). Ignora erro de "ja registrado".
 */
export async function registerPhoneNumber(phoneNumberId, token) {
  try {
    await fetch(
      `https://graph.facebook.com/${config.whatsapp.apiVersion}/${phoneNumberId}/register`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', pin: '000000' }),
      }
    );
  } catch (err) {
    console.warn('registerPhoneNumber:', err.message);
  }
}
