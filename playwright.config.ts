import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright — E2E sem banco e sem credenciais.
 *
 * ESCOPO DELIBERADO DA ETAPA 1: apenas jornadas que funcionam sem Supabase
 * provisionado — rotas públicas, ausência de sessão, erro controlado,
 * renderização e acessibilidade básica.
 *
 * O E2E autenticado (os 10 cenários de tests/e2e-scenarios.md) está bloqueado
 * pelo R1 e registrado em tests/db/README-R1.md §4. Ele NÃO foi criado como
 * `test.skip`: representar funcionalidade ausente com testes ignorados
 * mascararia a lacuna.
 *
 * As variáveis abaixo são placeholders sintáticos, necessários apenas para o
 * servidor iniciar. Nenhuma credencial real é usada — e o app falha fechado
 * sem provedores configurados, que é justamente parte do que se verifica.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["html"], ["list"]] : [["list"]],

  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    // Testa contra o build de produção, como recomenda a documentação do
    // Next.js — comportamento mais próximo do real que o modo dev.
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://placeholder.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "placeholder-anon-key",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    },
  },
});
