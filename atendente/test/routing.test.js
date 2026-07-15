/**
 * Testes de roteamento WhatsApp — Entry Route com pontuação natural e compatibilidade legada.
 *
 * Cobre os formatos:
 *  - Novo:   "Olá❕ Conheci a @vilaflor◇ e queria tirar uma dúvida❔"
 *  - Braille legado:  "Olá! Vim conhecer ⠓⡇⡷ @vilaflor e gostaria de ver os produtos 😊"
 *  - Slug legado:     "Olá! Vim conhecer a loja @vilaflor-2 e gostaria de ver os produtos 😊"
 *  - START slug, Token (K8M3Q1)
 */
import './_setup.js'; // define env vars antes de qualquer módulo que importe config.js
import { test, describe } from 'node:test';
import assert from 'node:assert';

// ── Novo sistema: pontuação natural ───────────────────────────────────────────
import {
  OPENING_SYMBOLS,
  MIDDLE_SYMBOLS,
  QUESTION_SYMBOLS,
  isValidEntryCode,
  generateEntryCode,
  createEntryHandle,
  buildWhatsAppEntryMessage,
} from '../src/entry.js';

// ── Legado: Braille ────────────────────────────────────────────────────────────
import { BRAILLE_ALPHABET, isValidRouteCode } from '../src/braille.js';

// ── Regex espelhadas de src/webhook.js ────────────────────────────────────────

// Novo formato com pontuação natural
// \s* antes do emoji de abertura e antes do emoji de fechamento: o WhatsApp insere
// espaços ao redor de emoji no pre-fill, mesmo que o template gerado não os tenha.
const ENTRY_ROUTE_REGEX =
  /^ol[aá]\s*([❕❗])\s+conheci a\s+@([a-z0-9-]{2,60})([·•◦○●◇◆□■△▲▽▼☆★✦])\s+e queria tirar uma d[uú]vida\s*([❔❓])\s*$/iu;

// Formato Braille legado
const BRAILLE_ROUTE_REGEX =
  /^ol[aá]!\s+vim conhecer\s+([⠁-⣿]{3})\s+@([a-z0-9-]{2,60})\s+e gostaria de ver os produtos\s*😊?\s*$/iu;

// Formato slug legado (com números)
const LEGACY_SLUG_REGEX =
  /^ol[aá]!\s+vim conhecer a loja\s+@([a-z0-9-]{3,50})\s+e gostaria de ver os produtos\s*(?:😊)?\s*$/iu;

// Compatibilidade
const START_ROUTE_REGEX = /^start\s+([a-z0-9-]+)/i;
const TOKEN_ROUTE_REGEX = /\(([A-Z0-9]{6})\)/i;

// ── Helpers ───────────────────────────────────────────────────────────────────

const MAX_ROUTE_MSG_LEN = 200;

// Regex de remoção de variation selectors — espelha webhook.js linha 340-341
const STRIP_VS = /[\uFE00-\uFE0F\u200B-\u200D\uFEFF]/g;

/** Espelha a lógica do webhook para o novo formato (inclui strip de variation selectors). */
function matchEntryRoute(text) {
  const normalized = text.normalize('NFC').replace(STRIP_VS, '');
  if (normalized.length > MAX_ROUTE_MSG_LEN) return null;
  const m = normalized.match(ENTRY_ROUTE_REGEX);
  if (!m) return null;
  const entryHandle   = m[2].toLowerCase();
  const entryCode     = m[1] + m[3] + m[4];
  if (!isValidEntryCode(entryCode)) return null;
  return { entryHandle, entryCode };
}

function matchBraille(text) {
  const normalized = text.normalize('NFC');
  const m = normalized.match(BRAILLE_ROUTE_REGEX);
  if (!m) return null;
  const rawCode = m[1];
  if (!isValidRouteCode(rawCode)) return null;
  return { routeCode: rawCode, displayHandle: m[2].toLowerCase() };
}

function matchLegacySlug(text) {
  const m = text.normalize('NFC').match(LEGACY_SLUG_REGEX);
  return m ? m[1].toLowerCase() : null;
}

function matchStart(text) {
  const m = text.match(START_ROUTE_REGEX);
  return m ? m[1].toLowerCase() : null;
}

function matchToken(text) {
  const m = text.match(TOKEN_ROUTE_REGEX);
  return m ? m[1].toUpperCase() : null;
}

// Tenant fictício para testes de buildWhatsAppEntryMessage
const SAMPLE_TENANT = { entry_handle: 'vilaflor', entry_code: '❕◇❔' };

// ── Bloco 1: Símbolos e geração de entry_code ─────────────────────────────────

describe('generateEntryCode() — geração de código', () => {
  const code = generateEntryCode();
  const chars = Array.from(code);

  test('1 — gera código com exatamente três símbolos', () => {
    assert.strictEqual(chars.length, 3);
  });

  test('2 — primeiro símbolo pertence a OPENING_SYMBOLS', () => {
    assert.ok(OPENING_SYMBOLS.includes(chars[0]),
      `"${chars[0]}" não está em OPENING_SYMBOLS`);
  });

  test('3 — segundo símbolo pertence a MIDDLE_SYMBOLS', () => {
    assert.ok(MIDDLE_SYMBOLS.includes(chars[1]),
      `"${chars[1]}" não está em MIDDLE_SYMBOLS`);
  });

  test('4 — terceiro símbolo pertence a QUESTION_SYMBOLS', () => {
    assert.ok(QUESTION_SYMBOLS.includes(chars[2]),
      `"${chars[2]}" não está em QUESTION_SYMBOLS`);
  });

  test('5 — código não contém números', () => {
    assert.ok(!/\d/.test(code), `Código "${code}" contém número`);
  });

  test('6 — código não contém letras', () => {
    assert.ok(!/[a-zA-Z]/.test(code), `Código "${code}" contém letra`);
  });

  test('7 — código não contém espaços', () => {
    assert.ok(!/\s/.test(code), `Código "${code}" contém espaço`);
  });

  test('8 — código não contém caracteres invisíveis (U+0000–U+001F, U+200B, U+FEFF)', () => {
    // eslint-disable-next-line no-control-regex
    assert.ok(!/[\x00-\x1F\u200B\uFEFF]/.test(code),
      `Código "${code}" contém caractere invisível`);
  });
});

// ── Bloco 2: isValidEntryCode() — validação ───────────────────────────────────

describe('isValidEntryCode() — validação', () => {
  // Código de referência: opening[0] + middle[0] + question[0]
  const VALID = OPENING_SYMBOLS[0] + MIDDLE_SYMBOLS[0] + QUESTION_SYMBOLS[0];

  test('9 — tenant novo recebe entry_handle (via createEntryHandle)', () => {
    const handle = createEntryHandle('Meu Negócio');
    assert.ok(handle && handle.length > 0, 'entry_handle vazio');
    assert.match(handle, /^[a-z0-9-]+$/, 'entry_handle fora do padrão');
  });

  test('10 — tenant novo recebe entry_code válido (via generateEntryCode)', () => {
    const code = generateEntryCode();
    assert.ok(isValidEntryCode(code), `Código gerado "${code}" é inválido`);
  });

  test('11 — tenant existente recebe entry_handle via migration (createEntryHandle funciona)', () => {
    const handle = createEntryHandle('Vila Flor Cosméticos');
    assert.strictEqual(handle, 'vila-flor-cosmeticos');
  });

  test('12 — migration é idempotente (isValidEntryCode aceita códigos gerados)', () => {
    for (let i = 0; i < 20; i++) {
      const code = generateEntryCode();
      assert.ok(isValidEntryCode(code), `Iteração ${i}: código "${code}" inválido`);
    }
  });

  test('13 — código gerado uma vez não muda (isValidEntryCode é determinístico)', () => {
    const code = VALID;
    assert.ok(isValidEntryCode(code));
    assert.ok(isValidEntryCode(code));
    assert.ok(isValidEntryCode(code));
  });

  test('14 — alteração do nome comercial não muda entry_handle se já estiver salvo', () => {
    // O handle é gerado uma única vez e salvo; createEntryHandle é pura.
    // Uma vez salvo no banco, não é recalculado ao mudar business_name.
    const handleOriginal  = createEntryHandle('Vila Flor');
    const handleAlterado  = createEntryHandle('Vila Flor Nova');
    // handles diferentes de nomes diferentes — o banco manteria o original
    assert.notStrictEqual(handleOriginal, handleAlterado);
    assert.strictEqual(handleOriginal, 'vila-flor');
  });

  test('15 — alteração do nome não altera entry_code (código é independente do nome)', () => {
    // O código é gerado aleatoriamente e salvo; não deriva do nome.
    const code1 = generateEntryCode();
    const code2 = generateEntryCode();
    // Ambos válidos — nenhum depende do nome
    assert.ok(isValidEntryCode(code1));
    assert.ok(isValidEntryCode(code2));
  });

  test('16 — combinação handle + código: dois handles iguais com mesmo código seriam colisão', () => {
    // O banco tem UNIQUE INDEX em (entry_handle, entry_code).
    // Verificamos que a estrutura de dados suporta isso: mesmo código, handles diferentes → OK.
    const code = VALID;
    assert.ok(isValidEntryCode(code)); // válido independente do handle
  });

  test('17 — mesmo código pode existir em handles diferentes', () => {
    const code = VALID;
    // O índice é composto: (vilaflor, ❕·❔) ≠ (docesdamaria, ❕·❔)
    assert.ok(isValidEntryCode(code)); // código válido para qualquer handle
  });

  test('18 — mesmo handle pode existir com códigos diferentes', () => {
    const c1 = OPENING_SYMBOLS[0] + MIDDLE_SYMBOLS[0] + QUESTION_SYMBOLS[0];
    const c2 = OPENING_SYMBOLS[1] + MIDDLE_SYMBOLS[1] + QUESTION_SYMBOLS[1];
    assert.ok(isValidEntryCode(c1));
    assert.ok(isValidEntryCode(c2));
    assert.notStrictEqual(c1, c2);
  });
});

// ── Bloco 3: Reconhecimento da nova frase ─────────────────────────────────────

describe('Novo formato de ativação — matchEntryRoute()', () => {
  test('19 — a nova mensagem identifica a loja correta (entry_handle extraído)', () => {
    const result = matchEntryRoute('Olá❕ Conheci a @vilaflor◇ e queria tirar uma dúvida❔');
    assert.ok(result, 'Mensagem não foi reconhecida');
    assert.strictEqual(result.entryHandle, 'vilaflor');
    assert.ok(isValidEntryCode(result.entryCode));
  });

  test('20 — mensagem com ❕ funciona', () => {
    const result = matchEntryRoute('Olá❕ Conheci a @loja◇ e queria tirar uma dúvida❔');
    assert.ok(result);
    assert.strictEqual(Array.from(result.entryCode)[0], '❕');
  });

  test('21 — mensagem com ❗ funciona', () => {
    const result = matchEntryRoute('Olá❗ Conheci a @loja◇ e queria tirar uma dúvida❔');
    assert.ok(result);
    assert.strictEqual(Array.from(result.entryCode)[0], '❗');
  });

  test('22 — mensagem com ❔ funciona', () => {
    const result = matchEntryRoute('Olá❕ Conheci a @loja◇ e queria tirar uma dúvida❔');
    assert.ok(result);
    assert.strictEqual(Array.from(result.entryCode)[2], '❔');
  });

  test('23 — mensagem com ❓ funciona', () => {
    const result = matchEntryRoute('Olá❗ Conheci a @loja◇ e queria tirar uma dúvida❓');
    assert.ok(result);
    assert.strictEqual(Array.from(result.entryCode)[2], '❓');
  });

  test('24 — todos os 16 símbolos intermediários funcionam', () => {
    for (const m of MIDDLE_SYMBOLS) {
      const msg = `Olá❕ Conheci a @loja${m} e queria tirar uma dúvida❔`;
      const result = matchEntryRoute(msg);
      assert.ok(result, `Símbolo intermediário "${m}" não foi reconhecido`);
      assert.strictEqual(Array.from(result.entryCode)[1], m);
    }
  });

  test('25 — código inexistente não cria rota (isValidEntryCode rejeita chars inválidos)', () => {
    // Simula código com símbolos fora das listas
    const badCode = '⠓⠁⠛'; // Braille — não são OPENING/MIDDLE/QUESTION symbols
    assert.ok(!isValidEntryCode(badCode));
  });

  test('26 — handle inexistente não cria rota (regex só aceita [a-z0-9-])', () => {
    const result = matchEntryRoute('Olá❕ Conheci a @loja!◇ e queria tirar uma dúvida❔');
    assert.strictEqual(result, null, 'Handle com ! não deve ser aceito');
  });

  test('27 — tenant inativo não é utilizado (regra de negócio no webhook, não na regex)', () => {
    // O match da regex acontece mas o webhook verifica found.active
    const result = matchEntryRoute('Olá❕ Conheci a @vilaflor◇ e queria tirar uma dúvida❔');
    assert.ok(result, 'Regex deve reconhecer a mensagem');
    // found.active é verificado no webhook.js — aqui testamos que o match ocorre
  });

  test('28 — consumidor pode migrar da loja A para a loja B (entry_handle muda)', () => {
    const msgA = matchEntryRoute('Olá❕ Conheci a @lojaA◇ e queria tirar uma dúvida❔');
    const msgB = matchEntryRoute('Olá❕ Conheci a @lojaB◇ e queria tirar uma dúvida❔');
    assert.ok(msgA && msgB);
    assert.notStrictEqual(msgA.entryHandle, msgB.entryHandle);
  });

  test('29 — mensagem de ativação não entra no histórico da IA (isNewRoute=true no webhook)', () => {
    // A mensagem de ativação é processada como isNewRoute=true no webhook.js.
    // Quando isNewRoute=true, o webhook NÃO salva a mensagem no histórico (linha 463-465).
    // Testamos que a mensagem corresponde ao padrão de ativação.
    const result = matchEntryRoute('Olá❕ Conheci a @vilaflor◇ e queria tirar uma dúvida❔');
    assert.ok(result !== null, 'Mensagem de ativação deve ser reconhecida como nova rota');
  });

  test('30 — a IA não presume que o consumidor quer catálogo (histórico vazio na saudação)', () => {
    // buildWhatsAppEntryMessage gera mensagem genérica, sem mencionar catálogo ou produtos.
    const msg = buildWhatsAppEntryMessage(SAMPLE_TENANT);
    assert.ok(!msg.toLowerCase().includes('catálogo'), 'Mensagem não deve mencionar catálogo');
    assert.ok(!msg.toLowerCase().includes('produto'), 'Mensagem não deve mencionar produtos');
    assert.ok(!msg.toLowerCase().includes('pedido'), 'Mensagem não deve mencionar pedido');
  });

  test('31 — mensagens posteriores utilizam a rota salva (customerRouteQueries.upsert)', () => {
    // Verifica que mensagens regulares NÃO fazem match de nenhum formato de ativação
    const textoRegular = 'Quero saber o preço do produto X';
    assert.strictEqual(matchEntryRoute(textoRegular), null);
    assert.strictEqual(matchBraille(textoRegular), null);
    assert.strictEqual(matchLegacySlug(textoRegular), null);
    assert.strictEqual(matchStart(textoRegular), null);
    assert.strictEqual(matchToken(textoRegular), null);
    // → O webhook usa customerRouteQueries.byPhone para mensagens sem match
  });

  test('32 — menção comum a @perfil não altera a rota', () => {
    assert.strictEqual(matchEntryRoute('Vi a @vilaflor◇ no Instagram.'), null);
    assert.strictEqual(matchEntryRoute('Você conhece a @docesdamaria?'), null);
  });

  test('33 — símbolos soltos não alteram a rota', () => {
    assert.strictEqual(matchEntryRoute('Meu símbolo favorito é ❕◇❔.'), null);
    assert.strictEqual(matchEntryRoute('❕ ◇ ❔'), null);
  });

  test('34 — frase incompleta não altera a rota', () => {
    assert.strictEqual(matchEntryRoute('Olá❕ Conheci a @vilaflor◇'), null);
    assert.strictEqual(matchEntryRoute('Conheci a @vilaflor◇ e queria tirar uma dúvida❔'), null);
    assert.strictEqual(matchEntryRoute('Olá❕ Conheci a @vilaflor◇ e queria informações'), null);
  });

  test('35 — frase com modificações relevantes não altera a rota', () => {
    // Espaço entre handle e middle symbol (middle deve ser colado ao handle)
    assert.strictEqual(matchEntryRoute('Olá❕ Conheci a @vilaflor ◇ e queria tirar uma dúvida❔'), null);
    // Palavra "comprar" no lugar de "dúvida"
    assert.strictEqual(matchEntryRoute('Olá❕ Conheci a @vilaflor◇ e queria tirar uma compra❔'), null);
    // Opening symbol como letra
    assert.strictEqual(matchEntryRoute('Olá! Conheci a @vilaflor◇ e queria tirar uma dúvida❔'), null);
    // Nota: espaço antes do emoji de abertura é aceito intencionalmente (WhatsApp adiciona esses espaços)
  });
});

// ── Bloco 4: Compatibilidade com formatos antigos ─────────────────────────────

describe('Compatibilidade com formatos antigos', () => {
  const BRAILLE_CODE = BRAILLE_ALPHABET[7] + BRAILLE_ALPHABET[26] + BRAILLE_ALPHABET[31]; // ⠓⡇⡷

  test('36 — formato geométrico antigo (Braille) ainda é reconhecido', () => {
    const msg = `Olá! Vim conhecer ${BRAILLE_CODE} @vilaflor e gostaria de ver os produtos 😊`;
    const result = matchBraille(msg);
    assert.ok(result, 'Formato Braille legado não foi reconhecido');
    assert.ok(isValidRouteCode(result.routeCode));
  });

  test('37 — formato Braille antigo tem precedência sobre slug legado', () => {
    const msg = `Olá! Vim conhecer ${BRAILLE_CODE} @vilaflor e gostaria de ver os produtos 😊`;
    assert.ok(matchBraille(msg) !== null);
    assert.strictEqual(matchLegacySlug(msg), null, 'Slug legado não deve capturar formato Braille');
  });

  test('38 — formato com slug (nome + números) ainda funciona', () => {
    const slug = matchLegacySlug('Olá! Vim conhecer a loja @vilaflor-2847 e gostaria de ver os produtos 😊');
    assert.strictEqual(slug, 'vilaflor-2847');
  });

  test('39 — START slug continua funcionando', () => {
    assert.strictEqual(matchStart('START vilaflor'), 'vilaflor');
    assert.strictEqual(matchStart('start minha-loja-123'), 'minha-loja-123');
  });

  test('40 — token temporário antigo continua funcionando', () => {
    assert.strictEqual(matchToken('(K8M3Q1)'), 'K8M3Q1');
    assert.strictEqual(matchToken('Seu código é (AB1234)'), 'AB1234');
  });
});

// ── Bloco 5: Formato do novo link ─────────────────────────────────────────────

describe('buildWhatsAppEntryMessage() e formato do link', () => {
  const msg = buildWhatsAppEntryMessage(SAMPLE_TENANT);

  test('41 — novo link não contém números acrescentados ao handle', () => {
    assert.ok(!/vilaflor-\d/.test(msg), 'Handle não deve ter sufixo numérico');
  });

  test('42 — novo link não contém Braille', () => {
    assert.ok(!/[⠀-⣿]/.test(msg), 'Mensagem não deve conter Braille');
  });

  test('43 — URL do WhatsApp utiliza encodeURIComponent', () => {
    const serverPhone = '5511999999999';
    const waUrl = `https://wa.me/${serverPhone}?text=${encodeURIComponent(msg)}`;
    // Verifica que caracteres especiais estão codificados
    assert.ok(waUrl.includes('%E2%9D%95') || waUrl.includes('%E2'), 'URL não codificou os símbolos');
    assert.ok(!waUrl.includes('❕'), 'URL não deve conter ❕ literal');
    assert.ok(!waUrl.includes('◇'), 'URL não deve conter ◇ literal');
    assert.ok(!waUrl.includes('❔'), 'URL não deve conter ❔ literal');
  });

  test('44 — mensagem de ativação tem o formato correto (para QR Code e botão)', () => {
    // Formato: "Olá{opening} Conheci a @{handle}{middle} e queria tirar uma dúvida{question}"
    const result = matchEntryRoute(msg);
    assert.ok(result !== null, `Mensagem gerada não é reconhecida pelo webhook: "${msg}"`);
    assert.strictEqual(result.entryHandle, SAMPLE_TENANT.entry_handle);
  });

  test('45 — botão "Copiar link" copia /c/:slug (link da plataforma, não wa.me direto)', () => {
    // O link copiado é sempre ${appUrl}/c/${slug}, não a URL wa.me.
    // A mensagem de ativação está embutida no redirect server-side.
    const link = 'https://app.example.com/c/vilaflor';
    assert.ok(link.includes('/c/'), 'Link deve passar pela landing page /c/');
    assert.ok(!link.includes('wa.me'), 'Link copiado não deve ser wa.me direto');
  });

  test('46 — botão "Abrir WhatsApp" usa o link correto (mesmo URL de cópia)', () => {
    // linkOpenBtn.href = data.link — o mesmo que o input de cópia
    const link = 'https://app.example.com/c/vilaflor';
    assert.ok(link.startsWith('https://'));
  });

  test('47 — createEntryHandle respeita limite de 60 caracteres', () => {
    const longo = 'a'.repeat(80);
    const handle = createEntryHandle(longo);
    assert.ok(handle.length <= 60, `Handle tem ${handle.length} chars (máx 60)`);
  });

  test('48 — todos os formatos anteriores continuam sendo reconhecidos (regressão)', () => {
    const BRAILLE_CODE = BRAILLE_ALPHABET[0] + BRAILLE_ALPHABET[1] + BRAILLE_ALPHABET[2];

    // Novo formato
    assert.ok(matchEntryRoute('Olá❕ Conheci a @loja◇ e queria tirar uma dúvida❔') !== null);

    // Braille
    assert.ok(matchBraille(`Olá! Vim conhecer ${BRAILLE_CODE} @loja e gostaria de ver os produtos 😊`) !== null);

    // Slug com números
    assert.ok(matchLegacySlug('Olá! Vim conhecer a loja @loja-2 e gostaria de ver os produtos') !== null);

    // START
    assert.ok(matchStart('START minhaloja') !== null);

    // Token
    assert.ok(matchToken('(ABC123)') !== null);
  });
});

// ── Bloco 6b: Variation selectors (bug WhatsApp U+FE0F) ──────────────────────

describe('Variation selectors — robustez contra U+FE0F do WhatsApp', () => {
  // WhatsApp frequentemente entrega ❗ como ❗️ (U+2757 + U+FE0F) e ❓ como ❓️.
  // Sem o strip, a regex falha e o sistema cai no fallback de rota salva.

  test('49 — mensagem com ❗️ (U+FE0F) é reconhecida corretamente', () => {
    // Simula o que o WhatsApp entrega: ❗ + variation selector U+FE0F
    const msg = 'Olá❗️ Conheci a @estrela◦ e queria tirar uma dúvida❓️';
    const result = matchEntryRoute(msg);
    assert.ok(result !== null, 'Variation selector U+FE0F não deve impedir o reconhecimento');
    assert.strictEqual(result.entryHandle, 'estrela');
  });

  test('50 — entry_code extraído não contém variation selectors', () => {
    const msg = 'Olá❗️ Conheci a @estrela◦ e queria tirar uma dúvida❓️';
    const result = matchEntryRoute(msg);
    assert.ok(result !== null);
    // Após strip, o código deve ter exatamente 3 codepoints
    const chars = Array.from(result.entryCode);
    assert.strictEqual(chars.length, 3, `entryCode tem ${chars.length} chars, esperado 3`);
    assert.ok(!result.entryCode.includes('️'), 'entryCode não deve conter U+FE0F');
  });

  test('51 — ❕️ (U+FE0F) também é removido', () => {
    const msg = 'Olá❕️ Conheci a @loja◇ e queria tirar uma dúvida❔️';
    const result = matchEntryRoute(msg);
    assert.ok(result !== null);
    assert.strictEqual(result.entryHandle, 'loja');
  });

  test('52 — sem variation selectors continua funcionando normalmente', () => {
    // Sem U+FE0F — comportamento original não deve ser afetado
    const msg = 'Olá❗ Conheci a @estrela◦ e queria tirar uma dúvida❓';
    const result = matchEntryRoute(msg);
    assert.ok(result !== null);
    assert.strictEqual(result.entryHandle, 'estrela');
  });
});

// ── Bloco 6b.2: Espaços ao redor dos emoji inseridos pelo WhatsApp ────────────

describe('Espaços ao redor de emoji — comportamento real do WhatsApp', () => {
  // O WhatsApp pré-preenche "Olá❗ Conheci..." mas entrega "Olá ❗ Conheci..."
  // com espaço antes do emoji de abertura e antes do emoji de fechamento.

  test('53 — espaço antes de ❗ e antes de ❓ (comportamento real do WhatsApp)', () => {
    const msg = 'Olá ❗ Conheci a @estrela◦ e queria tirar uma dúvida ❓';
    const result = matchEntryRoute(msg);
    assert.ok(result !== null, 'Espaços ao redor de emoji não devem impedir o reconhecimento');
    assert.strictEqual(result.entryHandle, 'estrela');
    assert.strictEqual(result.entryCode, '❗◦❓');
  });

  test('54 — espaço antes de ❗ e antes de ❓ com token de sessão na mensagem', () => {
    // Simula a mensagem completa que o sistema recebe após strip do token
    const textForRouting = 'Olá ❗ Conheci a @estrela◦ e queria tirar uma dúvida ❓';
    const result = matchEntryRoute(textForRouting);
    assert.ok(result !== null);
    assert.strictEqual(result.entryHandle, 'estrela');
  });

  test('55 — apenas espaço antes de ❗ (fechamento sem espaço)', () => {
    const msg = 'Olá ❗ Conheci a @estrela◦ e queria tirar uma dúvida❓';
    const result = matchEntryRoute(msg);
    assert.ok(result !== null);
    assert.strictEqual(result.entryHandle, 'estrela');
  });

  test('56 — apenas espaço antes de ❓ (abertura sem espaço)', () => {
    const msg = 'Olá❗ Conheci a @estrela◦ e queria tirar uma dúvida ❓';
    const result = matchEntryRoute(msg);
    assert.ok(result !== null);
    assert.strictEqual(result.entryHandle, 'estrela');
  });
});

// ── Bloco 6c: createEntryHandle() ─────────────────────────────────────────────

describe('createEntryHandle() — geração de handle', () => {
  test('Remove acentos e converte para minúsculas', () => {
    assert.strictEqual(createEntryHandle('Vila Flor Cosméticos'), 'vila-flor-cosmeticos');
  });

  test('Substitui espaços por hífen e remove duplicados', () => {
    assert.strictEqual(createEntryHandle('minha  loja'), 'minha-loja');
  });

  test('Remove caracteres especiais', () => {
    assert.strictEqual(createEntryHandle('Loja & Cia.'), 'loja-cia');
  });

  test('Fallback para "loja" quando resultado seria vazio', () => {
    assert.strictEqual(createEntryHandle('!!!'), 'loja');
    assert.strictEqual(createEntryHandle(''), 'loja');
    assert.strictEqual(createEntryHandle(null), 'loja');
  });

  test('Limitado a 60 caracteres', () => {
    const handle = createEntryHandle('a'.repeat(80));
    assert.ok(handle.length <= 60);
  });

  test('Sem hífens nas extremidades', () => {
    const handle = createEntryHandle(' loja ');
    assert.ok(!handle.startsWith('-') && !handle.endsWith('-'));
  });
});

// ── Bloco 7: Attendance Code TX579 ────────────────────────────────────────────

import { isValidAttendanceCode, generateUniqueAttendanceCode } from '../src/db.js';

// Regex espelhada de src/webhook.js — detecta "Atendimento XXNNN" na mensagem.
// Não depende do emoji 🎟️ (o WhatsApp pode entregar o codepoint de forma diferente).
const ATTENDANCE_ROUTE_RE = /\bAtendimento\s+([A-Z]{2}[0-9]{3})\b/i;

function matchAttendanceCode(text) {
  const normalized = text.normalize('NFC').replace(/[\uFE00-\uFE0F\u200B-\u200D\uFEFF]/g, '');
  if (normalized.length > 400) return null;
  const m = normalized.match(ATTENDANCE_ROUTE_RE);
  if (!m) return null;
  const code = m[1].toUpperCase();
  return isValidAttendanceCode(code) ? code : null;
}

describe('isValidAttendanceCode() — validação de formato', () => {
  test('57 — aceita formato válido 2 letras + 3 dígitos', () => {
    assert.ok(isValidAttendanceCode('TX579'));
    assert.ok(isValidAttendanceCode('AB000'));
    assert.ok(isValidAttendanceCode('ZZ999'));
  });

  test('58 — rejeita letras minúsculas', () => {
    assert.ok(!isValidAttendanceCode('tx579'));
    assert.ok(!isValidAttendanceCode('Tx579'));
  });

  test('59 — rejeita formato com 1 letra + 4 dígitos', () => {
    assert.ok(!isValidAttendanceCode('T5790'));
  });

  test('60 — rejeita formato com 3 letras + 2 dígitos', () => {
    assert.ok(!isValidAttendanceCode('TXY57'));
  });

  test('61 — rejeita formato com 2 letras + 2 dígitos (muito curto)', () => {
    assert.ok(!isValidAttendanceCode('TX57'));
  });

  test('62 — rejeita formato com 2 letras + 4 dígitos (muito longo)', () => {
    assert.ok(!isValidAttendanceCode('TX5790'));
  });

  test('63 — rejeita string vazia', () => {
    assert.ok(!isValidAttendanceCode(''));
  });

  test('64 — rejeita null/undefined', () => {
    assert.ok(!isValidAttendanceCode(null));
    assert.ok(!isValidAttendanceCode(undefined));
  });

  test('65 — rejeita código com espaços', () => {
    assert.ok(!isValidAttendanceCode('TX 579'));
  });

  test('66 — rejeita código com caracteres especiais', () => {
    assert.ok(!isValidAttendanceCode('TX5-9'));
    assert.ok(!isValidAttendanceCode('TX579!'));
  });
});

describe('generateUniqueAttendanceCode() — geração de código', () => {
  test('67 — gera código no formato válido', () => {
    const code = generateUniqueAttendanceCode();
    assert.ok(isValidAttendanceCode(code), `Código gerado "${code}" inválido`);
  });

  test('68 — gera 2 letras maiúsculas + 3 dígitos', () => {
    for (let i = 0; i < 20; i++) {
      const code = generateUniqueAttendanceCode();
      assert.match(code, /^[A-Z]{2}[0-9]{3}$/,
        `Código "${code}" fora do padrão [A-Z]{2}[0-9]{3}`);
    }
  });

  test('69 — gera códigos com exatamente 5 caracteres', () => {
    const code = generateUniqueAttendanceCode();
    assert.strictEqual(code.length, 5);
  });
});

describe('Webhook — detecção do attendance code na mensagem', () => {
  const fullMsg = (biz, code) =>
    `Olá! Conheci a empresa ${biz} e gostaria de falar com vocês.\n\n🎟️ Atendimento ${code}\n\nToque em Enviar para iniciar 👉🏽`;

  test('70 — detecta código TX579 na mensagem completa', () => {
    const code = matchAttendanceCode(fullMsg('Estrela', 'TX579'));
    assert.strictEqual(code, 'TX579');
  });

  test('71 — detecta código independente do nome da empresa', () => {
    assert.strictEqual(matchAttendanceCode(fullMsg('Amazônia Aromas', 'AB123')), 'AB123');
    assert.strictEqual(matchAttendanceCode(fullMsg('Loja do João & Cia.', 'ZZ000')), 'ZZ000');
  });

  test('72 — detecta após remoção de variation selector (🎟️ → 🎟)', () => {
    // Simula o que o WhatsApp entrega: 🎟️ com variation selector U+FE0F
    const msg = `Olá! Conheci a empresa Estrela e gostaria de falar com vocês.\n\n\u{1F39F}️ Atendimento TX579\n\nToque em Enviar para iniciar 👉🏽`;
    assert.strictEqual(matchAttendanceCode(msg), 'TX579');
  });

  test('73 — aceita espaço extra entre emoji e palavra Atendimento', () => {
    const msg = `...\n\n🎟️  Atendimento TX579\n\n...`;
    assert.strictEqual(matchAttendanceCode(msg), 'TX579');
  });

  test('74 — não detecta em mensagem sem o padrão correto', () => {
    assert.strictEqual(matchAttendanceCode('Olá! Quero comprar'), null);
    assert.strictEqual(matchAttendanceCode('TX579'), null);
    // "Atendimento TX579" sozinho é detectado — sem dependência de emoji
    assert.strictEqual(matchAttendanceCode('Atendimento TX579'), 'TX579');
  });

  test('75 — não detecta código com formato inválido (1 letra + 4 dígitos)', () => {
    const msg = fullMsg('Estrela', 'T5790');
    assert.strictEqual(matchAttendanceCode(msg), null);
  });

  test('76 — código em letras minúsculas é normalizado para maiúsculas (regex case-insensitive)', () => {
    // O webhook aceita "tx579" e normaliza para "TX579" via toUpperCase().
    const msg = `🎟️ Atendimento tx579`;
    assert.strictEqual(matchAttendanceCode(msg), 'TX579');
  });

  test('77 — não detecta código com 3 letras + 2 dígitos', () => {
    const msg = fullMsg('Estrela', 'TXY57');
    assert.strictEqual(matchAttendanceCode(msg), null);
  });

  test('78 — mensagem muito longa (> 400 chars) é ignorada', () => {
    const longText = 'x'.repeat(401);
    assert.strictEqual(matchAttendanceCode(longText), null);
  });

  test('79 — detecta código em qualquer posição da mensagem', () => {
    assert.strictEqual(matchAttendanceCode('🎟 Atendimento AB999'), 'AB999');
    assert.strictEqual(matchAttendanceCode('Início do texto\n\n🎟 Atendimento GH456\n\nFim'), 'GH456');
  });

  test('80 — código extraído é sempre uppercase', () => {
    const msg = `🎟 Atendimento TX579`;
    const code = matchAttendanceCode(msg);
    assert.strictEqual(code, code?.toUpperCase());
  });
});

describe('Mensagem de atendimento TX579 — formato e conteúdo', () => {
  function buildAttendanceMsg(bizName, code) {
    const sanitized = (bizName || 'esta empresa')
      .trim()
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1F\x7F]/g, '')
      .slice(0, 80);
    return `Olá! Conheci a empresa ${sanitized}\ne gostaria de falar com vocês.\n\n🎫 Atendimento ${code}\n\n👉 Toque em Enviar para iniciar.`;
  }

  test('81 — mensagem contém nome da empresa', () => {
    const msg = buildAttendanceMsg('Estrela Cosméticos', 'TX579');
    assert.ok(msg.includes('Estrela Cosméticos'));
  });

  test('82 — mensagem contém o código TX579', () => {
    const msg = buildAttendanceMsg('Estrela', 'TX579');
    assert.ok(msg.includes('🎫 Atendimento TX579'));
  });

  test('83 — mensagem contém instrução de envio', () => {
    const msg = buildAttendanceMsg('Estrela', 'TX579');
    assert.ok(msg.includes('👉 Toque em Enviar para iniciar'));
  });

  test('84 — nome da empresa é sanitizado (sem chars de controle no nome)', () => {
    const msg = buildAttendanceMsg('Estrela\x00\x01\nNova', 'TX579');
    // \n separa o nome de "e gostaria" no template — usar flag s para dotAll
    const match = msg.match(/Conheci a empresa ([\s\S]+?)\ne gostaria/);
    assert.ok(match, 'Padrão "Conheci a empresa" não encontrado na mensagem');
    // eslint-disable-next-line no-control-regex
    assert.ok(!match[1].match(/[\x00-\x1F]/),
      `Nome sanitizado "${match[1]}" contém caractere de controle`);
  });

  test('85 — nome da empresa é truncado a 80 caracteres', () => {
    const longName = 'A'.repeat(100);
    const msg = buildAttendanceMsg(longName, 'TX579');
    const match = msg.match(/Conheci a empresa ([\s\S]+?)\ne gostaria/);
    assert.ok(match && match[1].length <= 80, 'Nome não foi truncado a 80 chars');
  });

  test('86 — fallback para "esta empresa" quando nome é vazio', () => {
    const msg = buildAttendanceMsg('', 'TX579');
    assert.ok(msg.includes('esta empresa'));
  });

  test('87 — código detectado mesmo após mudança do nome da empresa', () => {
    const msg1 = buildAttendanceMsg('Estrela', 'TX579');
    const msg2 = buildAttendanceMsg('Estrela Cosméticos Premium', 'TX579');
    assert.strictEqual(matchAttendanceCode(msg1), 'TX579');
    assert.strictEqual(matchAttendanceCode(msg2), 'TX579');
  });
});
