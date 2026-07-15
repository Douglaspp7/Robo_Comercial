export function normalizeAlertPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length < 10 || digits.length > 15) {
    throw new Error('Informe um WhatsApp com DDD e código do país. Ex.: 5511999999999.');
  }
  return digits;
}
