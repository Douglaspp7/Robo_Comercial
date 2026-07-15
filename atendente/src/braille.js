/**
 * Identificadores Braille para roteamento de lojas no WhatsApp.
 *
 * Cada loja recebe um route_code permanente de 3 caracteres escolhidos
 * deste alfabeto. Com 32 símbolos: 32³ = 32.768 combinações únicas possíveis.
 *
 * Regras:
 *  - O caractere Braille vazio U+2800 (⠀) NÃO está incluído.
 *  - Apenas símbolos visíveis e distintos visualmente foram selecionados.
 *  - O alfabeto é a fonte de verdade para geração E validação.
 */
import { randomInt } from 'node:crypto';

export const BRAILLE_ALPHABET = [
  '⠁', '⠃', '⠉', '⠙', '⠑', '⠋', '⠛', '⠓',
  '⠊', '⠚', '⠅', '⠇', '⠍', '⠝', '⠕', '⠏',
  '⠟', '⠗', '⠎', '⠞', '⠥', '⠧', '⠺', '⠭',
  '⠽', '⠵', '⡇', '⡏', '⡗', '⡟', '⡧', '⡷',
];

/**
 * Valida se `code` é exatamente 3 caracteres presentes no BRAILLE_ALPHABET.
 * Usa Array.from() para tratar corretamente surrogate pairs e codepoints > U+FFFF.
 */
export function isValidRouteCode(code) {
  if (!code) return false;
  const chars = Array.from(code);
  return chars.length === 3 && chars.every(c => BRAILLE_ALPHABET.includes(c));
}

/**
 * Gera um candidato de 3 caracteres aleatórios do BRAILLE_ALPHABET.
 * Usa crypto.randomInt para aleatoriedade segura (sem Math.random).
 * Não garante unicidade — use generateUniqueRouteCode() em src/db.js para isso.
 */
export function generateBrailleCode() {
  let result = '';
  for (let i = 0; i < 3; i++) {
    result += BRAILLE_ALPHABET[randomInt(BRAILLE_ALPHABET.length)];
  }
  return result;
}
