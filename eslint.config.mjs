import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Worker de disparo: projeto Node independente, com lint próprio.
    "worker/**",
    // Atendente (cópia do Zapien que vende Zapien): app Express independente,
    // com lint/testes próprios — não segue as regras do Next.
    "atendente/**",
  ]),
]);

export default eslintConfig;
