/**
 * Ponto de entrada do worker: sobe a API HTTP, conecta o WhatsApp e inicia
 * o loop de disparo. Feito para rodar 24/7 (ex.: systemd num Raspberry Pi).
 */
import { config } from "./config.js";
import { startServer } from "./server.js";
import { startWhatsApp } from "./wa.js";
import { startSender } from "./sender.js";

console.log("Robo Comercial — worker de disparo");
console.log(
  `  cota/dia=${config.dailyLimit}  intervalo=${config.minDelaySec}-${config.maxDelaySec}s` +
    (config.warmupRamp.length ? `  warmup=[${config.warmupRamp.join(",")}]` : "")
);

startServer();
startSender();
startWhatsApp().catch((e) => {
  console.error("Falha ao iniciar o WhatsApp:", e.message);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log("\nEncerrando worker...");
    process.exit(0);
  });
}
