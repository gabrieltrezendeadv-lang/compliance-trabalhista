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

    // Artefatos gerados por ferramentas de teste (Etapa 1) — não são código
    // do projeto e não devem ser lintados.
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
  ]),

  {
    rules: {
      /**
       * Prefixo "_" marca parâmetro deliberadamente não usado.
       *
       * Os adaptadores e mocks de provider implementam uma interface comum
       * (MessageProvider, BillingProvider). Vários métodos não usam todos os
       * parâmetros do contrato — `parseWebhook(_payload, _headers)` no mock,
       * por exemplo. Renomear não é opção: a assinatura é imposta pela
       * interface, e alterar `src/` está fora do escopo desta etapa.
       *
       * A regra CONTINUA ativa: variável ou parâmetro não usado SEM o
       * prefixo "_" segue sendo reportado. O prefixo é uma declaração
       * explícita de intenção, não um silenciador geral.
       */
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
]);

export default eslintConfig;
