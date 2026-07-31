import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const serverOnlyStub = fileURLToPath(
  new URL("./tests/setup/server-only.stub.ts", import.meta.url)
);

export default defineConfig({
  resolve: {
    // Resolve o alias "@/*" do tsconfig.json. Suporte nativo do Vite 8 —
    // dispensa o plugin vite-tsconfig-paths, que passou a emitir aviso de
    // redundância a cada execução.
    tsconfigPaths: true,

    alias: [
      // Ver tests/setup/server-only.stub.ts para o motivo.
      { find: /^server-only$/, replacement: serverOnlyStub },
    ],
  },

  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          // Armadilha de rede: qualquer `fetch`/XHR/WebSocket num teste vira
          // falha, com o alvo na mensagem. A Etapa 12B roda só com o provider
          // mock, e essa afirmação precisava de imposição, não de revisão.
          setupFiles: ["./tests/setup/no-network.ts"],
          include: [
            "tests/unit/**/*.spec.ts",
            "tests/integration/**/*.spec.ts",
            "tests/static/**/*.spec.ts",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "component",
          environment: "jsdom",
          setupFiles: ["./tests/setup/jsdom.setup.ts"],
          include: ["tests/component/**/*.spec.tsx"],
        },
      },
    ],

    coverage: {
      provider: "v8",
      // Cobertura medida sobre o codigo real de producao — nunca sobre os
      // proprios arquivos de teste.
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/types/**", // apenas declaracoes de tipo, sem codigo executavel
        "src/**/*.d.ts",
      ],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "./coverage",

      // ── Limiares derivados de medição, não arbitrados ────────────────────
      //
      // Medição real da Etapa 1 (163 testes, commit inicial da branch):
      //   lines 8.66% (223/2574) · statements 8.93% (236/2641)
      //   functions 6.91% (34/492) · branches 6.89% (159/2307)
      //
      // Os valores abaixo ficam logo abaixo do medido, para travar regressão
      // sem quebrar por ruído. NENHUM módulo foi excluído para inflar o
      // percentual: o denominador é todo o src/, incluindo as ~20 páginas e
      // server actions async que o Vitest não consegue testar (limitação
      // documentada do Next.js) e que só serão cobertas por E2E — hoje
      // bloqueado pelo R1.
      //
      // O número global é baixo e honesto. Onde há teste, a cobertura é alta:
      //   registry.ts 94% · gateway.ts 86.7% · employees/actions.ts 85.2%
      //   schemas/complaint.ts 100% · password-input.tsx 100%
      //
      // Elevar estes limiares é trabalho dos PRs seguintes, à medida que cada
      // módulo for tocado.
      thresholds: {
        lines: 8,
        statements: 8,
        functions: 6,
        branches: 6,
      },
    },
  },
});
