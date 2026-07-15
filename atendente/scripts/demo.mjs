// Modo DEMONSTRACAO: sobe o app ja populado com dados ficticios,
// sem precisar de nenhuma chave real. Use: npm run demo
//
// Define valores padrao ANTES de importar qualquer modulo de src/,
// porque src/config.js le as variaveis de ambiente no momento do import.

import { rmSync } from 'node:fs';

process.env.ANTHROPIC_API_KEY ||= 'demo-sem-chave-real';
process.env.WHATSAPP_VERIFY_TOKEN ||= 'demo-verify';
process.env.SESSION_SECRET ||= 'demo-session-secret-aaaaaaaaaaaaaaaa';
process.env.DATABASE_PATH ||= './data/demo.db';
process.env.APP_URL ||= `http://localhost:${process.env.PORT || 3000}`;
process.env.ADMIN_EMAIL ||= 'admin@demo.com';
// Habilita a UI de assinatura (chaves ficticias; nenhuma cobranca real acontece).
process.env.STRIPE_SECRET_KEY ||= 'sk_test_demo';
process.env.STRIPE_PRICE_ID ||= 'price_demo';

// Comeca sempre com um banco demo limpo.
for (const suffix of ['', '-wal', '-shm']) {
  try {
    rmSync(process.env.DATABASE_PATH + suffix, { force: true });
  } catch {}
}

const { seedDemo } = await import('./seed-demo.mjs');
seedDemo();

console.log('\n┌─────────────────────────────────────────────┐');
console.log('│  Gest-o-Whatz — MODO DEMONSTRAÇÃO           │');
console.log('├─────────────────────────────────────────────┤');
console.log(`│  Abra:  ${process.env.APP_URL.padEnd(36)}│`);
console.log('│  Login: admin@demo.com                      │');
console.log('│  Senha: 123456                              │');
console.log('└─────────────────────────────────────────────┘\n');

await import('../src/server.js');
