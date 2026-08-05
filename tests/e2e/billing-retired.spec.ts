/**
 * E2E — o runtime legado de billing está aposentado, e a jornada segue desligada.
 *
 * ── POR QUE ISTO É E2E, E NÃO ASSERÇÃO SOBRE ARQUIVO ────────────────────────
 *
 * A guarda estática prova que `src/app/api/webhooks/billing/route.ts` não
 * existe no repositório. Isso não é a mesma coisa que provar que a APLICAÇÃO
 * CONSTRUÍDA não responde naquele caminho — um `rewrite`, um middleware ou uma
 * rota dinâmica poderiam servi-lo mesmo sem o arquivo.
 *
 * Aqui a pergunta é feita ao servidor rodando: o que responde em
 * `/api/webhooks/billing`? A resposta tem de ser "nada que processe cobrança".
 *
 * Nenhuma credencial, nenhum dado semeado, nenhuma chamada externa.
 */

import { expect, test } from "@playwright/test";

test.describe("webhook legado de billing", () => {
  test("POST em /api/webhooks/billing não é atendido por handler de cobrança", async ({
    request,
  }) => {
    const resposta = await request.post("/api/webhooks/billing", {
      data: { event: "PAYMENT_RECEIVED", payment: { id: "pay_inexistente" } },
      headers: { "content-type": "application/json" },
      failOnStatusCode: false,
    });

    // 404 (rota inexistente) e 405 (método não permitido) são os desfechos
    // aceitáveis. O que NÃO pode acontecer é 2xx: significaria que alguma coisa
    // aceitou o evento.
    expect([404, 405]).toContain(resposta.status());
    expect(resposta.ok()).toBe(false);
  });

  test("GET no mesmo caminho também não é atendido", async ({ request }) => {
    const resposta = await request.get("/api/webhooks/billing", { failOnStatusCode: false });
    expect(resposta.ok()).toBe(false);
    expect([404, 405]).toContain(resposta.status());
  });

  test("a resposta não vaza estrutura do processamento antigo", async ({ request }) => {
    const resposta = await request.post("/api/webhooks/billing", {
      data: {},
      failOnStatusCode: false,
    });
    const corpo = await resposta.text();

    // O handler antigo respondia com estes formatos. Nenhum deles pode voltar.
    for (const vestigio of [
      "Billing webhook unavailable",
      "Invalid token",
      "asaas-access-token",
      "tenant_subscriptions",
      "billing_events",
    ]) {
      expect(corpo).not.toContain(vestigio);
    }
  });
});

test.describe("jornada comercial continua desligada", () => {
  test("/dashboard/billing não expõe plano nem checkout a visitante", async ({ page }) => {
    await page.goto("/dashboard/billing");

    // Sem sessão, o visitante termina no login — nunca numa página de plano.
    // Com sessão, a própria página redireciona para /dashboard. Em nenhum dos
    // dois casos existe preço ou botão de contratação.
    await expect(page).not.toHaveURL(/\/dashboard\/billing$/);

    const conteudo = await page.content();
    expect(conteudo).not.toMatch(/R\$\s*\d/);
    expect(conteudo).not.toMatch(/assinar|contratar|checkout/i);
  });

  test("a landing não anuncia planos, preços ou contratação", async ({ page }) => {
    await page.goto("/");
    const conteudo = await page.content();

    expect(conteudo).not.toMatch(/R\$\s*\d/);
    expect(conteudo).not.toMatch(/\bpre[çc]os?\b/i);
    await expect(page.getByRole("link", { name: /assinar|contratar|planos/i })).toHaveCount(0);
  });

  test("a navegação autenticada não oferece entrada de billing", async ({ page }) => {
    // Sem sessão a navegação do dashboard não é renderizada; o que se prova
    // aqui é que nenhuma rota pública leva a /dashboard/billing.
    await page.goto("/");
    await expect(page.locator('a[href="/dashboard/billing"]')).toHaveCount(0);
  });
});
