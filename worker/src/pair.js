/**
 * Utilitário de pareamento/validação do número.
 * Sobe só a conexão do WhatsApp (sem API nem loop de disparo), mostra o
 * QR ou o código de pareamento e, quando conectar, envia uma mensagem de
 * teste para si mesmo — assim você valida o chip/celular antes de operar.
 *
 * Uso:
 *   node --env-file-if-exists=.env src/pair.js
 */
import { startWhatsApp, getWaState, sendText } from "./wa.js";

await startWhatsApp();
console.log("  Aguardando conexão... (pareie pelo QR ou código acima)\n");

let done = false;
const iv = setInterval(async () => {
  const st = getWaState();
  if (st.connected && !done) {
    done = true;
    const me = st.me?.split(":")[0]?.split("@")[0];
    console.log(`\n  Conectado como ${me}. Enviando mensagem de teste...`);
    try {
      await sendText(
        `${me}@s.whatsapp.net`,
        "✅ Robo Comercial conectado — teste de envio pelo worker."
      );
      console.log("  Mensagem de teste enviada. Chip/celular validados.");
    } catch (e) {
      console.error("  Falha no envio de teste:", e.message);
    }
    clearInterval(iv);
    setTimeout(() => process.exit(0), 2000);
  }
}, 1500);
