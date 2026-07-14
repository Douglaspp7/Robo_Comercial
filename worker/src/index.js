/**
 * Ponto de entrada do worker: sobe a API HTTP, conecta os números do WhatsApp
 * e inicia os loops de disparo. Feito para rodar 24/7 (systemd num Pi).
 */
import { config, getNumbers } from "./config.js";
import { startServer } from "./server.js";
import { startAll } from "./wa.js";
import { startSender } from "./sender.js";

const numbers = getNumbers();

console.log("Robo Comercial — worker de disparo");
console.log(
  `  números=${numbers.length} [${numbers.map((n) => n.id).join(", ")}]  ` +
    `cota/dia=${config.dailyLimit}/número  intervalo=${config.minDelaySec}-${config.maxDelaySec}s` +
    (config.warmupRamp.length ? `  warmup=[${config.warmupRamp.join(",")}]` : "")
);

startServer();
startSender(numbers);
startAll(numbers).catch((e) => {
  console.error("Falha ao iniciar as sessões:", e.message);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log("\nEncerrando worker...");
    process.exit(0);
  });
}
