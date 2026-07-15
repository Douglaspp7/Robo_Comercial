// Debounce por chave (ex: por contato). Quando o cliente manda varias
// mensagens seguidas, esperamos um curto periodo de silencio antes de
// acionar a IA — assim respondemos uma vez, juntando o contexto, em vez
// de uma chamada por mensagem.
const timers = new Map();

export function debounce(key, fn, delayMs) {
  clearTimeout(timers.get(key));
  const t = setTimeout(() => {
    timers.delete(key);
    fn();
  }, delayMs);
  timers.set(key, t);
}

export function cancelDebounce(key) {
  clearTimeout(timers.get(key));
  timers.delete(key);
}
