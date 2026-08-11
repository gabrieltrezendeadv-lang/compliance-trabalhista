/**
 * METADADOS CONTRATUAIS — Etapa 12C.1, no nível dos CASOS DE USO.
 *
 * ── O QUE SÓ SE PROVA AQUI ──────────────────────────────────────────────────
 *
 * O contrato compartilhado (`tests/contract/shared-expectations.ts`) prova a
 * paridade entre o dublê e o PostgREST no nível do REPOSITÓRIO — lá a versão
 * dos termos já chega resolvida. A comparação com a versão VIGENTE acontece
 * antes, no caso de uso, e é isso que este arquivo cobre: versão antiga,
 * versão futura e versão inventada precisam parar aqui, e o repositório nem
 * pode ser chamado.
 *
 * Também aqui se prova o que a interface promete e o banco não sabe: que o
 * e-mail rejeitado NÃO aparece na mensagem de erro que vai para tela e log.
 */

import { describe, expect, it } from "vitest";

import {
  acceptTerms,
  startTrial,
  updateBillingEmail,
} from "@/lib/billing/usecases/subscription";
import { TERMS_VERSION } from "@/lib/billing/terms";

import { COLAB_A, montarBancada, ORG_A, ORG_B, ORG_FANTASMA } from "./harness";

async function comTrial(opcoes: Parameters<typeof montarBancada>[0] = {}) {
  const b = montarBancada(opcoes);
  const r = await startTrial(b.env, {
    plan: "essencial",
    period: "monthly",
    workerCount: 10,
    cnpj: "00000000000191",
    termsVersion: TERMS_VERSION,
  });
  expect(r.ok).toBe(true);
  return b;
}

describe("aceite dos termos no início do trial", () => {
  it("registra versão e instante do relógio injetado", async () => {
    const b = montarBancada();
    const r = await startTrial(b.env, {
      plan: "essencial",
      period: "monthly",
      workerCount: 10,
      cnpj: "00000000000191",
      termsVersion: TERMS_VERSION,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.termsVersion).toBe(TERMS_VERSION);
    // Do relógio, não de `new Date()`. É o que torna a borda testável.
    expect(r.value.termsAcceptedAt).toBe(b.relogio.now());
  });

  it("o contato financeiro é opcional e ausente significa nulo", async () => {
    const b = montarBancada();
    const r = await startTrial(b.env, {
      plan: "essencial",
      period: "monthly",
      workerCount: 10,
      cnpj: "00000000000191",
      termsVersion: TERMS_VERSION,
    });
    expect(r.ok && r.value.billingEmail).toBeNull();
  });

  for (const [rotulo, versao] of [
    ["ausente", ""],
    ["só espaços", "   "],
    ["antiga", "2025-01-01"],
    ["futura/inventada", "2099-12-31"],
    ["fora do formato", "termos-v1"],
  ] as const) {
    it(`trial com versão ${rotulo} é recusado ANTES do repositório`, async () => {
      const b = montarBancada();
      const r = await startTrial(b.env, {
        plan: "essencial",
        period: "monthly",
        workerCount: 10,
        cnpj: "00000000000191",
        termsVersion: versao,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("invalid_input");
      // NADA foi escrito: o caso de uso nem chegou ao repositório.
      expect(await b.assinatura()).toBeNull();
    });
  }

  it("a recusa não revela a versão vigente", async () => {
    const b = montarBancada();
    const r = await startTrial(b.env, {
      plan: "essencial",
      period: "monthly",
      workerCount: 10,
      cnpj: "00000000000191",
      termsVersion: "2025-01-01",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).not.toContain(TERMS_VERSION);
  });
});

describe("contato financeiro depois do trial", () => {
  it("o dono grava, e depois limpa", async () => {
    const b = await comTrial();

    const gravado = await updateBillingEmail(b.env, {
      billingEmail: "  financeiro@empresa.com.br  ",
    });
    expect(gravado.ok).toBe(true);
    if (gravado.ok) expect(gravado.value.billingEmail).toBe("financeiro@empresa.com.br");

    const limpo = await updateBillingEmail(b.env, { billingEmail: "" });
    expect(limpo.ok).toBe(true);
    if (limpo.ok) expect(limpo.value.billingEmail).toBeNull();

    const nulo = await updateBillingEmail(b.env, { billingEmail: null });
    expect(nulo.ok).toBe(true);
    if (nulo.ok) expect(nulo.value.billingEmail).toBeNull();
  });

  it("endereço rejeitado NÃO aparece na mensagem de erro", async () => {
    const b = await comTrial();
    const r = await updateBillingEmail(b.env, { billingEmail: "nao-e-um-email" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("invalid_input");
      // Mensagem de erro vai para log, tela e relatório. Um e-mail rejeitado
      // continua sendo o e-mail de alguém.
      expect(r.error.message).not.toContain("nao-e-um-email");
    }
  });

  it("endereço acima do limite é recusado sem ser reproduzido", async () => {
    const b = await comTrial();
    const gigante = `${"a".repeat(250)}@empresa.com.br`;
    const r = await updateBillingEmail(b.env, { billingEmail: gigante });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).not.toContain(gigante);
  });

  it("organização alheia e inexistente recebem a MESMA recusa", async () => {
    const b = await comTrial();
    const alheia = await updateBillingEmail(b.env, {
      requestedOrganizationId: ORG_B,
      billingEmail: "invasor@empresa.com.br",
    });
    const inexistente = await updateBillingEmail(b.env, {
      requestedOrganizationId: ORG_FANTASMA,
      billingEmail: "invasor@empresa.com.br",
    });
    expect(alheia.ok).toBe(false);
    expect(inexistente.ok).toBe(false);
    if (!alheia.ok && !inexistente.ok) {
      expect(alheia.error.code).toBe(inexistente.error.code);
      expect(alheia.error.message).toBe(inexistente.error.message);
    }
  });

  it("indisponibilidade do repositório NEGA, e não vira sucesso", async () => {
    const b = await comTrial({ failAt: ["updateBillingEmail"] });
    const r = await updateBillingEmail(b.env, {
      billingEmail: "financeiro@empresa.com.br",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("repository_unavailable");
  });
});

describe("novo aceite depois do trial", () => {
  it("recusa qualquer versão que não seja a vigente", async () => {
    const b = await comTrial();
    for (const versao of ["2025-01-01", "2099-12-31", "", "termos-v2"]) {
      const r = await acceptTerms(b.env, { termsVersion: versao });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("invalid_input");
    }
  });

  it("reenviar a versão vigente é idempotente e preserva o instante", async () => {
    const b = await comTrial();
    const antes = b.relogio.now();

    b.relogio.avancarDias(30);
    const r = await acceptTerms(b.env, { termsVersion: TERMS_VERSION });
    expect(r.ok).toBe(true);
    // O instante do aceite ORIGINAL é a prova. Um reenvio não a reescreve.
    if (r.ok) expect(r.value.termsAcceptedAt).toBe(antes);
  });

  it("indisponibilidade do repositório NEGA", async () => {
    const b = await comTrial({ failAt: ["acceptTerms"] });
    const r = await acceptTerms(b.env, { termsVersion: TERMS_VERSION });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("repository_unavailable");
  });

  it("membro comum é recusado, e a recusa é a de autorização", async () => {
    // Colaborador de A: pertence à organização, mas não é dono. Não há trial
    // aqui de propósito — a recusa de autorização acontece ANTES de o
    // repositório sequer procurar assinatura, e é isso que se exige: o código
    // tem de ser `not_owner`, não `not_found`.
    const b = montarBancada({ actorId: COLAB_A, organizationId: ORG_A });

    const termos = await acceptTerms(b.env, { termsVersion: TERMS_VERSION });
    expect(termos.ok).toBe(false);
    if (!termos.ok) expect(termos.error.code).toBe("not_owner");

    const email = await updateBillingEmail(b.env, {
      billingEmail: "colaborador@empresa.com.br",
    });
    expect(email.ok).toBe(false);
    if (!email.ok) expect(email.error.code).toBe("not_owner");

    expect(await b.assinatura()).toBeNull();
  });
});
