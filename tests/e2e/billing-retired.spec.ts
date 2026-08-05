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

    // 404 EXATO, não "algo que não seja 2xx".
    //
    // A frouxidão importa aqui: 405 significaria que existe um handler no
    // caminho recusando o método — ou seja, que alguma coisa voltou a ocupar
    // `/api/webhooks/billing`. 401 significaria autenticação; 500, um handler
    // quebrado. Só o 404 diz "não há nada aqui para cobrança".
    expect(resposta.status()).toBe(404);
    expect(resposta.ok()).toBe(false);
  });

  test("GET no mesmo caminho também responde 404 exato", async ({ request }) => {
    const resposta = await request.get("/api/webhooks/billing", { failOnStatusCode: false });
    expect(resposta.status()).toBe(404);
    expect(resposta.ok()).toBe(false);
  });

  test("o 404 vem da allowlist FECHADA de `[provider]`, não de rota inexistente", async ({
    request,
  }) => {
    // ── POR QUE ESTA DISTINÇÃO IMPORTA ────────────────────────────────────
    //
    // `/api/webhooks/[provider]` é rota dinâmica: ela CASA com
    // `/api/webhooks/billing`. O 404 não vem de "não há rota" — vem de
    // `PROVIDER_CHANNEL_MAP` não conter `billing`. A proteção é de allowlist,
    // e uma allowlist só protege enquanto for fechada.
    //
    // Se alguém acrescentar `billing: "..."` ao mapa, este caso muda de corpo
    // e reprova, mesmo que o status siga 404 por outro motivo.
    const doBilling = await request.post("/api/webhooks/billing", {
      data: {},
      failOnStatusCode: false,
    });
    const deUmNomeQualquer = await request.post("/api/webhooks/provider-inexistente-xyz", {
      data: {},
      failOnStatusCode: false,
    });

    expect(doBilling.status()).toBe(404);
    expect(deUmNomeQualquer.status()).toBe(404);

    // Mesma recusa, pelo mesmo motivo: `billing` é tão desconhecido quanto um
    // nome inventado. É exatamente isso que se quer preservar.
    expect(await doBilling.json()).toEqual({ error: "Unknown provider: billing" });
    expect(await deUmNomeQualquer.json()).toEqual({
      error: "Unknown provider: provider-inexistente-xyz",
    });
  });

  test("nenhuma operação é executada pela requisição recusada", async ({ request }) => {
    // Um payload que, no handler antigo, teria marcado uma cobrança como paga.
    const resposta = await request.post("/api/webhooks/billing", {
      data: {
        event: "PAYMENT_RECEIVED",
        payment: { id: "pay_x", subscription: "sub_x", value: 9990, status: "RECEIVED" },
      },
      headers: { "content-type": "application/json", "asaas-access-token": "qualquer" },
      failOnStatusCode: false,
    });

    expect(resposta.status()).toBe(404);

    // A recusa acontece ANTES de ler o corpo: o handler dinâmico consulta o
    // mapa e sai. Nada de idempotência, assinatura ou persistência aparece na
    // resposta, porque nada disso chegou a ser considerado.
    const corpo = await resposta.text();
    expect(corpo).toBe(JSON.stringify({ error: "Unknown provider: billing" }));
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
