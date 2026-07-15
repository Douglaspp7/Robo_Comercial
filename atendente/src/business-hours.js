/**
 * Horário de atendimento — helper compartilhado entre o webhook (responder ou
 * não fora do horário) e as automações (condições within/outside_business_hours).
 * Regra: sem configuração ativa = considera sempre dentro do horário.
 */
export function isWithinBusinessHours(biz, now = new Date()) {
  const h = biz?.horario_atendimento;
  if (!h?.ativo || !h?.inicio || !h?.fim) return true; // sem config = atende sempre

  const day = now.getDay(); // 0=Dom, 1=Seg, ..., 6=Sab
  // Aceita dias como array de números OU string "1,2,3" (legado do painel).
  const dias = Array.isArray(h.dias)
    ? h.dias.map(Number)
    : String(h.dias || '1,2,3,4,5').split(',').map(Number).filter(Number.isFinite); // padrão: seg-sex
  if (!dias.includes(day)) return false;

  const [startH, startM] = h.inicio.split(':').map(Number);
  const [endH, endM] = h.fim.split(':').map(Number);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const startMin = startH * 60 + (startM || 0);
  const endMin = endH * 60 + (endM || 0);
  return nowMin >= startMin && nowMin < endMin;
}
