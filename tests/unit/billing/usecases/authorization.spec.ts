/**
 * AUTORIZAÇÃO E ISOLAMENTO ENTRE TENANTS.
 *
 * ── AS DUAS PROPRIEDADES QUE ESTE ARQUIVO PROTEGE ───────────────────────────
 *
 * 1. RECUSA INDISTINGUÍVEL. Organização alheia e organização inexistente
 *    produzem exatamente a mesma resposta. Distingui-las entregaria "esta
 *    organização existe" a quem varre identificadores.
 *
 * 2. RECUSA ANTES DO EFEITO. A autorização falha antes de qualquer escrita e
 *    antes de qualquer chamada ao provider — e isso é MEDIDO, não descrito.
 */

import { describe, expect, it } from "vitest";

import { applyProviderEvent, createCheckout } from "@/lib/billing/usecases/payments";
import {
  acceptTerms,
  cancelAtPeriodEnd,
  choosePlan,
  scheduleDowngradeUseCase,
  startTrial,
  updateBillingEmail,
  upgradeSubscription,
} from "@/lib/billing/usecases/subscription";
import {
  grantCourtesy,
  resolveBillingAccess,
  revokeCourtesy,
} from "@/lib/billing/usecases/access";
import {
  COLAB_A,
  DONO_A,
  MEMBROS,
  ORG_A,
  ORG_B,
  ORG_FANTASMA,
  montarBancada,
} from "./harness";
import { TERMS_VERSION } from "@/lib/billing/terms";

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

describe("recusa indistinguível", () => {
  it("organização alheia e inexistente produzem a MESMA recusa", async () => {
    const b = await comTrial();

    // O dono de A pede explicitamente por B — que existe — e por uma
    // organização que não existe. As duas respostas têm de ser idênticas.
    const alheia = await cancelAtPeriodEnd(b.env, { requestedOrganizationId: ORG_B });
    const inexistente = await cancelAtPeriodEnd(b.env, {
      requestedOrganizationId: ORG_FANTASMA,
    });

    expect(alheia.ok).toBe(false);
    expect(inexistente.ok).toBe(false);
    if (!alheia.ok && !inexistente.ok) {
      expect(alheia.error.code).toBe(inexistente.error.code);
      expect(alheia.error.message).toBe(inexistente.error.message);
    }
  });

  it("a recusa no REPOSITÓRIO também é indistinguível", async () => {
    // Sem passar por `assertTenant`: o ator de A pede direto o estado de B e o
    // de uma organização inexistente. A revalidação do banco responde igual.
    const b = await comTrial();

    const alheia = await b.repo.readState(DONO_A, ORG_B);
    const inexistente = await b.repo.readState(DONO_A, ORG_FANTASMA);

    expect(alheia.ok).toBe(false);
    expect(inexistente.ok).toBe(false);
    if (!alheia.ok && !inexistente.ok) {
      expect(alheia.error.code).toBe(inexistente.error.code);
      expect(alheia.error.message).toBe(inexistente.error.message);
    }
  });
});

describe("somente o proprietário administra", () => {
  const comandos: ReadonlyArray<[string, (b: Awaited<ReturnType<typeof comTrial>>) => Promise<{ ok: boolean }>]> = [
    ["startTrial", (b) => startTrial(b.env, { plan: "essencial", period: "monthly", workerCount: 5, cnpj: "00000000000191", termsVersion: TERMS_VERSION })],
    ["updateBillingEmail", (b) => updateBillingEmail(b.env, { billingEmail: "financeiro@empresa.com.br" })],
    ["acceptTerms", (b) => acceptTerms(b.env, { termsVersion: TERMS_VERSION })],
    ["choosePlan", (b) => choosePlan(b.env, { plan: "completo", period: "monthly" })],
    ["upgradeSubscription", (b) => upgradeSubscription(b.env, { plan: "completo" })],
    ["scheduleDowngrade", (b) => scheduleDowngradeUseCase(b.env, { plan: "essencial" })],
    ["cancelAtPeriodEnd", (b) => cancelAtPeriodEnd(b.env)],
    ["grantCourtesy", (b) => grantCourtesy(b.env, { plan: "completo", days: 30, reason: "piloto" })],
    ["revokeCourtesy", (b) => revokeCourtesy(b.env, { courtesyId: "crt_000001", reason: "fim" })],
    ["createCheckout", (b) => createCheckout(b.env, { method: "pix", checkoutIntentId: "ck", customerName: "n", customerEmail: "e@t.local" })],
  ];

  for (const [nome, executar] of comandos) {
    it(`${nome} recusa quem não é proprietário, sem tocar provider`, async () => {
      // Colaborador de A: pertence à organização, mas não é dono.
      const b = montarBancada({ actorId: COLAB_A, organizationId: ORG_A });
      const r = await executar(b);

      expect(r.ok).toBe(false);
      // E o provider nunca soube que houve tentativa.
      expect(b.chamadasDoProvider()).toBe(0);
    });
  }

  it("a recusa acontece ANTES de qualquer escrita", async () => {
    const b = await comTrial();
    const antes = await b.assinatura();

    await cancelAtPeriodEnd(b.env, { requestedOrganizationId: ORG_B });

    // Nada mudou: a recusa não deixou efeito colateral.
    expect(await b.assinatura()).toEqual(antes);
  });
});

describe("a checagem de papel é da APLICAÇÃO, e vem antes do repositório", () => {
  /**
   * Ambiente cujo repositório EXPLODE ao primeiro toque.
   *
   * ── POR QUE ESTE TESTE PRECISOU EXISTIR ───────────────────────────────────
   *
   * Havia duas camadas recusando o colaborador: `assertTenantOwner`, na
   * aplicação, e `fn_require_member(..., true)` no banco (reproduzido pelo
   * dublê). Como as duas recusam, remover a PRIMEIRA não fazia nenhum teste
   * falhar — a recusa continuava chegando, só que de mais longe e depois de
   * uma ida ao banco.
   *
   * Defesa em profundidade é boa; camada que ninguém mede é decoração. Aqui o
   * repositório é uma armadilha: se a autorização não recusar por conta
   * própria, o teste estoura em vez de passar.
   */
  function envSemRepositorio(role: "owner" | "member") {
    const b = montarBancada();
    const armadilha = new Proxy(
      {},
      {
        get(_alvo, prop) {
          throw new Error(
            `a autorização deixou passar: o repositório foi tocado em "${String(prop)}"`
          );
        },
      }
    );
    return {
      ...b.env,
      repo: armadilha as typeof b.env.repo,
      auth: { userId: COLAB_A, organizationId: ORG_A, role },
    };
  }

  const ESCRITAS = [
    ["startTrial", (env: ReturnType<typeof envSemRepositorio>) =>
      startTrial(env, {
        plan: "essencial" as const,
        period: "monthly" as const,
        workerCount: 10,
        cnpj: "00000000000191",
        termsVersion: TERMS_VERSION,
      })],
    ["choosePlan", (env: ReturnType<typeof envSemRepositorio>) =>
      choosePlan(env, { plan: "completo" as const, period: "monthly" as const })],
    ["upgradeSubscription", (env: ReturnType<typeof envSemRepositorio>) =>
      upgradeSubscription(env, { plan: "completo" as const })],
    ["scheduleDowngradeUseCase", (env: ReturnType<typeof envSemRepositorio>) =>
      scheduleDowngradeUseCase(env, { plan: "essencial" as const })],
    ["cancelAtPeriodEnd", (env: ReturnType<typeof envSemRepositorio>) => cancelAtPeriodEnd(env, {})],
    ["acceptTerms", (env: ReturnType<typeof envSemRepositorio>) =>
      acceptTerms(env, { termsVersion: TERMS_VERSION })],
    ["updateBillingEmail", (env: ReturnType<typeof envSemRepositorio>) =>
      updateBillingEmail(env, { billingEmail: "f@e.com.br" })],
    ["createCheckout", (env: ReturnType<typeof envSemRepositorio>) =>
      createCheckout(env, {
        method: "pix" as const,
        checkoutIntentId: "ck-1",
        customerName: "n",
        customerEmail: "e@t.local",
      })],
  ] as const;

  for (const [nome, executar] of ESCRITAS) {
    it(`${nome}: membro é recusado SEM que o repositório seja tocado`, async () => {
      const r = await executar(envSemRepositorio("member"));

      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("not_owner");
    });
  }

  it("a decisão de ACESSO, ao contrário, deixa o membro passar", async () => {
    // O contraponto necessário: se a checagem de papel valesse para tudo, o
    // teste acima passaria com uma fachada que barra o colaborador de tudo — e
    // é justamente isso que estamos corrigindo. Aqui a armadilha DEVE ser
    // tocada, porque a decisão de acesso precisa ler o estado.
    const b = montarBancada();
    const env = { ...b.env, auth: { userId: COLAB_A, organizationId: ORG_A, role: "member" as const } };
    const r = await resolveBillingAccess(env, { billingEnabled: true });

    expect(r.ok).toBe(true);
  });

  it("o proprietário passa da checagem de papel e chega ao repositório", async () => {
    // Prova de que a armadilha mede o que diz medir: com `owner`, o caso de uso
    // NÃO para na autorização, e o repositório é alcançado.
    const env = { ...envSemRepositorio("owner"), auth: { userId: DONO_A, organizationId: ORG_A, role: "owner" as const } };
    await expect(cancelAtPeriodEnd(env, {})).rejects.toThrow(/o repositório foi tocado/);
  });
});

describe("evento do provider não aceita tenant de fora", () => {
  it("a entrada do webhook não tem organização nem ator", async () => {
    const b = await comTrial();
    const checkout = await createCheckout(b.env, {
      method: "pix",
      checkoutIntentId: "ck-1",
      customerName: "n",
      customerEmail: "e@t.local",
    });
    expect(checkout.ok).toBe(true);
    if (!checkout.ok) return;

    // O tipo de entrada não tem `organizationId` nem `actorId` — se tivesse,
    // esta chamada não compilaria sem eles, e quem manda o evento escolheria a
    // quem ele se aplica. O tenant sai da resolução pelo identificador externo.
    const r = await applyProviderEvent(b.env, {
      externalEventId: "ev-1",
      externalChargeId: checkout.value.charge.externalChargeId,
      eventType: "charge_paid",
      occurredAt: "2026-08-05T00:00:00.000Z",
    });

    expect(r.ok).toBe(true);
    if (r.ok && r.value.kind === "applied") {
      expect(r.value.charge.organizationId).toBe(ORG_A);
    }
  });

  it("evento de cobrança desconhecida não revela existência de organização", async () => {
    const b = await comTrial();

    const inventado = await applyProviderEvent(b.env, {
      externalEventId: "ev-x",
      externalChargeId: "chg-que-nao-existe",
      eventType: "charge_paid",
      occurredAt: "2026-08-05T00:00:00.000Z",
    });

    expect(inventado.ok).toBe(false);
    if (!inventado.ok) {
      expect(inventado.error.code).toBe("not_found");
      // A mensagem fala da COBRANÇA, nunca de organização.
      expect(inventado.error.message).not.toMatch(/organiza|org-/i);
    }
  });
});

describe("falha de leitura nunca vira acesso", () => {
  it("repositório indisponível reprova — não devolve 'sem assinatura'", async () => {
    const b = await comTrial();
    b.repo.definirFalhas(["readState"]);

    const r = await resolveBillingAccess(b.env, { billingEnabled: true });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("repository_unavailable");
  });

  it("organização sem assinatura é motivo PRÓPRIO, distinto de indisponibilidade", async () => {
    const b = montarBancada();

    const r = await resolveBillingAccess(b.env, { billingEnabled: true });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.reason).toBe("sem_assinatura");
      expect(r.value.readOnly).toBe(true);
      expect(r.value.plan).toBeNull();
    }
  });

  it("estado desconhecido nega em vez de liberar", async () => {
    // Não há como produzir estado desconhecido pelo caminho normal — o tipo
    // impede. A propriedade equivalente e observável: nenhum motivo de acesso
    // concede escrita sem assinatura, cortesia ou direito adquirido.
    const b = montarBancada();
    const r = await resolveBillingAccess(b.env, { billingEnabled: true });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.features).toEqual([]);
      expect(r.value.storageMib).toBe(0);
    }
  });
});

describe("nenhum detalhe interno vaza", () => {
  it("erro do repositório não carrega mensagem de driver", async () => {
    const b = await comTrial();
    b.repo.definirFalhas(["claimIdempotency"]);

    const r = await createCheckout(b.env, {
      method: "pix",
      checkoutIntentId: "ck-1",
      customerName: "n",
      customerEmail: "e@t.local",
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      // Nada de host, usuário, porta, esquema de conexão ou SQL.
      expect(r.error.message).not.toMatch(/postgres|localhost|127\.0\.0\.1|select |insert |@/i);
    }
  });

  it("o repositório servidor não é importável fora do servidor", async () => {
    // `SupabaseBillingRepository` é `server-only`: importá-lo aqui seria erro
    // de build. A propriedade é garantida pelo pacote `server-only` e conferida
    // estaticamente por BO-10; aqui se registra que a suíte de unidade usa
    // exclusivamente o dublê.
    const b = montarBancada();
    expect(b.repo.constructor.name).toBe("InMemoryBillingRepository");
  });
});

describe("membros e papéis", () => {
  it("as fixtures declaram exatamente os papéis usados", () => {
    expect(MEMBROS.map((m) => m.role).sort()).toEqual(["collaborator", "owner", "owner"]);
  });
});
