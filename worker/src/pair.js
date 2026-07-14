/**
 * Utilitário de pareamento/validação dos números.
 * Sobe só as conexões (sem API nem loop de disparo), mostra o QR/código de
 * cada número e, quando um conecta, envia uma mensagem de teste para si mesmo.
 *
 * Uso:
 *   node --env-file-if-exists=.env src/pair.js
 */
import { getNumbers } from "./config.js";
import { startAll, getAllStates, sendText } from "./wa.js";

const numbers = getNumbers();
await startAll(numbers);
console.log(`  Aguardando conexão de ${numbers.length} número(s)... (pareie acima)\n`);

const done = new Set();
const iv = setInterval(async () => {
  for (const st of getAllStates()) {
    if (st.connected && !done.has(st.id)) {
      done.add(st.id);
      const me = st.me?.split(":")[0]?.split("@")[0];
      console.log(`\n  [${st.id}] conectado como ${me}. Enviando teste...`);
      try {
        await sendText(st.id, `${me}@s.whatsapp.net`, "✅ Robo Comercial conectado — teste de envio.");
        console.log(`  [${st.id}] mensagem de teste enviada. OK.`);
      } catch (e) {
        console.error(`  [${st.id}] falha no teste:`, e.message);
      }
    }
  }
  if (done.size >= numbers.length) {
    clearInterval(iv);
    setTimeout(() => process.exit(0), 2000);
  }
}, 1500);
