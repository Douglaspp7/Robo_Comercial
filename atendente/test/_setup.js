// Setup de ambiente para testes que importam módulos dependentes de config.js.
// Importe este arquivo ANTES de qualquer import de ../src que puxe config.js.
//
// IMPORTANTE: este módulo é 100% SÍNCRONO de propósito (sem `await import`,
// sem top-level await). Uma versão anterior usava `await import(...)` aqui e,
// mesmo com a ordem de import correta no arquivo de teste, o import de
// '../src/db.js' era avaliado ANTES do DATABASE_PATH ser setado — os testes
// acabavam escrevendo no banco de dev compartilhado (./data/zapien.db),
// causando contagens não-determinísticas entre execuções. Import estático
// elimina qualquer fronteira assíncrona e garante a ordem.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';
process.env.WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'test-token';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret';
// Habilita mpBillingEnabled — sem isso, subscriptionState() trata todo mundo
// como 'ativo' incondicionalmente (modo "sem cobrança configurada") e os
// testes de trial/limite por plano não conseguem exercitar o status real.
process.env.MP_PLATFORM_TOKEN = process.env.MP_PLATFORM_TOKEN || 'test-mp-platform-token';

// Isolamento de banco: cada execução de `node --test` usa um SQLite temporário
// próprio (nunca o ./data/zapien.db do dev). Sem isso, dados de uma
// execução (tenants, ai_usage etc.) vazam para a próxima e os testes de
// contagem/limite ficam não-determinísticos.
if (!process.env.DATABASE_PATH) {
  const dir = mkdtempSync(join(tmpdir(), 'zapien-test-db-'));
  process.env.DATABASE_PATH = join(dir, 'test.db');
}
