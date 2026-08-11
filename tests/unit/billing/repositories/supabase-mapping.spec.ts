/**
 * MAPEAMENTO DA RESPOSTA DO POSTGREST — fail-closed no que é ilegível
 *
 * ── A PROPRIEDADE QUE ESTE ARQUIVO PROTEGE ──────────────────────────────────
 *
 * "Ausente" e "presente e inválido" são coisas diferentes, e confundi-las
 * mascara defeito. Um `terms_accepted_at` corrompido que virasse `null` sairia
 * como "esta organização nunca aceitou os termos" — indistinguível da verdade,
 * e num campo cuja data é o fato contratual.
 *
 * ── COMO SE TESTA SEM REDE ──────────────────────────────────────────────────
 *
 * `SupabaseBillingRepository` aceita o cliente por construtor. Aqui entra um
 * dublê que devolve a carga que o teste quiser, sem abrir conexão — o projeto
 * `unit` proíbe rede, e nenhuma é aberta.
 */

import { describe, expect, it } from "vitest";

import { SupabaseBillingRepository } from "@/lib/billing/repositories/supabase";

/** Assinatura como `fn_billing_read_state` a devolve, com o que o teste mandar. */
function estado(assinatura: Record<string, unknown> | null) {
  return {
    subscription: assinatura,
    courtesies: [],
    grandfathering: null,
    grandfatheringCutoff: null,
  };
}

const BASE = Object.freeze({
  id: "sub_1",
  organization_id: "org_1",
  plan: "essencial",
  tier: "t1_20",
  period: "monthly",
  state: "trialing",
  worker_count: 10,
  cnpj: "00000000000191",
  current_period_start: "2026-08-01T00:00:00+00:00",
  current_period_end: "2026-09-01T00:00:00+00:00",
  trial_ends_at: null,
  payment_failed_at: null,
  scheduled_downgrade_plan: null,
  scheduled_downgrade_tier: null,
  price_snapshot: null,
});

/** Repositório com um cliente que devolve `data` e nunca fala com a rede. */
function comResposta(data: unknown) {
  const cliente = {
    rpc: async () => ({ data, error: null }),
  };
  return new SupabaseBillingRepository(
    cliente as unknown as ConstructorParameters<typeof SupabaseBillingRepository>[0]
  );
}

async function lerAssinatura(assinatura: Record<string, unknown>) {
  const repo = comResposta(estado(assinatura));
  return repo.readState("ator", "org_1");
}

describe("normalização de instante", () => {
  it("campo opcional legitimamente ausente continua nulo", async () => {
    const r = await lerAssinatura({
      ...BASE,
      terms_version: null,
      terms_accepted_at: null,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.subscription?.termsAcceptedAt).toBeNull();
    expect(r.value.subscription?.termsVersion).toBeNull();
    expect(r.value.subscription?.trialEndsAt).toBeNull();
  });

  it("chave AUSENTE do objeto também é nulo, e não erro", async () => {
    const { trial_ends_at: _ignorado, ...semChave } = BASE;
    const r = await lerAssinatura({
      ...semChave,
      terms_version: null,
      terms_accepted_at: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.subscription?.trialEndsAt).toBeNull();
  });

  for (const [rotulo, valor] of [
    ["com deslocamento", "2026-08-01T00:00:00+00:00"],
    ["em Z", "2026-08-01T00:00:00.000Z"],
    ["sem milissegundos", "2026-08-01T00:00:00Z"],
    ["em outro fuso", "2026-07-31T21:00:00-03:00"],
  ] as const) {
    it(`formato equivalente ${rotulo} vira o MESMO instante canônico`, async () => {
      const r = await lerAssinatura({
        ...BASE,
        terms_version: "2026-08-10",
        terms_accepted_at: valor,
      });
      expect(r.ok).toBe(true);
      // Todos os quatro são o mesmo instante. A saída é uma só string.
      if (r.ok) {
        expect(r.value.subscription?.termsAcceptedAt).toBe("2026-08-01T00:00:00.000Z");
      }
    });
  }

  for (const [rotulo, valor] of [
    ["texto que não é data", "ontem de manhã"],
    ["data impossível", "2026-13-45T00:00:00Z"],
    ["string vazia", ""],
    ["número", 1_754_006_400_000],
    ["objeto", { quando: "2026-08-01" }],
  ] as const) {
    it(`instante ${rotulo} NEGA em vez de virar nulo`, async () => {
      const r = await lerAssinatura({
        ...BASE,
        terms_version: "2026-08-10",
        terms_accepted_at: valor,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe("repository_unavailable");
        // E o VALOR não vaza na mensagem. String vazia fica de fora porque
        // `toContain("")` é verdadeiro para qualquer texto — a asserção seria
        // vácua, e uma asserção vácua é pior do que asserção nenhuma.
        const impresso = String(valor);
        if (impresso !== "") expect(r.error.message).not.toContain(impresso);
      }
    });
  }

  it("versão preenchida com instante INVÁLIDO nunca produz par quebrado", async () => {
    const r = await lerAssinatura({
      ...BASE,
      terms_version: "2026-08-10",
      terms_accepted_at: "não é data",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("repository_unavailable");
  });

  it("versão preenchida com instante NULO é par quebrado, e também NEGA", async () => {
    // O CHECK do banco torna isto impossível. Se chegar assim, a resposta está
    // errada — e devolver "aceitou, sem data" seria pior do que negar.
    const r = await lerAssinatura({
      ...BASE,
      terms_version: "2026-08-10",
      terms_accepted_at: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("repository_unavailable");
  });

  it("instante sem versão também é par quebrado", async () => {
    const r = await lerAssinatura({
      ...BASE,
      terms_version: null,
      terms_accepted_at: "2026-08-01T00:00:00+00:00",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("repository_unavailable");
  });

  it("par completo e válido passa", async () => {
    const r = await lerAssinatura({
      ...BASE,
      billing_email: "financeiro@empresa.com.br",
      terms_version: "2026-08-10",
      terms_accepted_at: "2026-08-01T00:00:00+00:00",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.subscription?.termsVersion).toBe("2026-08-10");
    expect(r.value.subscription?.termsAcceptedAt).toBe("2026-08-01T00:00:00.000Z");
    expect(r.value.subscription?.billingEmail).toBe("financeiro@empresa.com.br");
  });

  it("instante obrigatório inválido NEGA, e não devolve assinatura parcial", async () => {
    const r = await lerAssinatura({
      ...BASE,
      current_period_start: "quando der",
      terms_version: null,
      terms_accepted_at: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("repository_unavailable");
  });
});
