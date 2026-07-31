/**
 * AUTORIZAÇÃO E ISOLAMENTO ENTRE TENANTS.
 *
 * Duas organizações reais, A e B, com proprietários distintos. O que se prova
 * aqui é que o identificador vindo do cliente NUNCA autoriza, que papéis
 * diferentes de owner são recusados, e que a recusa não revela a existência de
 * organização alheia.
 */

import { describe, expect, it } from "vitest";

import { startTrial, cancelAtPeriodEnd, recordWorkerCount } from "@/lib/billing/usecases/subscription";
import { createMockCheckout } from "@/lib/billing/usecases/payments";
import { grantCourtesy, resolveBillingAccess, revokeCourtesy } from "@/lib/billing/usecases/access";
import type { BillingAuthContext } from "@/lib/billing/core/ports";
import { bancada, erro, valor, ORG_A, ORG_B, OWNER_A, OWNER_B } from "./harness";

const CNPJ = "00.000.000/0001-91";

const abrirTrial = (env: Parameters<typeof startTrial>[0]) =>
  startTrial(env, { plan: "essencial", period: "monthly", workerCount: 10, cnpj: CNPJ });

describe("somente owner administra", () => {
  it("owner é aceito", async () => {
    const b = bancada();
    expect((await abrirTrial(b.env)).ok).toBe(true);
  });

  for (const papel of ["admin", "manager", "member", "collaborator", "auditor"]) {
    it(`${papel} é recusado em alteração financeira`, async () => {
      const b = bancada();
      // O contexto é montado no servidor; aqui simula-se um papel diferente
      // chegando até o caso de uso — que precisa recusar por conta própria.
      const env = {
        ...b.env,
        auth: { ...b.env.auth, role: papel } as unknown as BillingAuthContext,
      };
      expect(erro(await abrirTrial(env))).toBe("not_owner");
      expect(erro(await recordWorkerCount(env, { workerCount: 5 }))).toBe("not_owner");
      expect(
        erro(
          await grantCourtesy(env, { plan: "completo", days: 10, reason: "x" })
        )
      ).toBe("not_owner");
    });
  }

  it("papel diferente de owner NÃO chega a tocar no repositório", async () => {
    const b = bancada();
    const env = {
      ...b.env,
      auth: { ...b.env.auth, role: "admin" } as unknown as BillingAuthContext,
    };
    await abrirTrial(env);
    // Nada foi criado: a recusa é anterior a qualquer escrita.
    expect(valor(await b.repo.findSubscription(ORG_A))).toBeNull();
  });
});

describe("IDOR — organização do cliente nunca autoriza", () => {
  it("owner de A é aceito ao pedir A", async () => {
    const b = bancada({ organizationId: ORG_A, userId: OWNER_A });
    const r = await startTrial(b.env, {
      plan: "essencial",
      period: "monthly",
      workerCount: 10,
      cnpj: CNPJ,
      requestedOrganizationId: ORG_A,
    });
    expect(r.ok).toBe(true);
  });

  it("owner de A é RECUSADO ao pedir B", async () => {
    const b = bancada({ organizationId: ORG_A, userId: OWNER_A });
    const r = await startTrial(b.env, {
      plan: "essencial",
      period: "monthly",
      workerCount: 10,
      cnpj: CNPJ,
      requestedOrganizationId: ORG_B,
    });
    expect(erro(r)).toBe("not_owner");
  });

  it("owner de B é RECUSADO ao pedir A — vale nos dois sentidos", async () => {
    const b = bancada({ organizationId: ORG_B, userId: OWNER_B });
    const r = await startTrial(b.env, {
      plan: "essencial",
      period: "monthly",
      workerCount: 10,
      cnpj: CNPJ,
      requestedOrganizationId: ORG_A,
    });
    expect(erro(r)).toBe("not_owner");
  });

  it("organização inexistente e organização alheia são INDISTINGUÍVEIS", async () => {
    const b = bancada({ organizationId: ORG_A, userId: OWNER_A });
    const alheia = await cancelAtPeriodEnd(b.env, { requestedOrganizationId: ORG_B });
    const inexistente = await cancelAtPeriodEnd(b.env, {
      requestedOrganizationId: "00000000-0000-4000-8000-0000000dead0",
    });
    expect(erro(alheia)).toBe(erro(inexistente));
    expect(erro(alheia)).toBe("not_owner");
  });

  it("entrada vazia não é substituída pela organização do servidor", async () => {
    const b = bancada();
    for (const entrada of ["", "   "]) {
      expect(erro(await cancelAtPeriodEnd(b.env, { requestedOrganizationId: entrada }))).toBe(
        "invalid_input"
      );
    }
  });

  it("a recusa por IDOR não escreve nada", async () => {
    const b = bancada({ organizationId: ORG_A });
    await startTrial(b.env, {
      plan: "essencial",
      period: "monthly",
      workerCount: 10,
      cnpj: CNPJ,
      requestedOrganizationId: ORG_B,
    });
    expect(valor(await b.repo.listAuditEvents(ORG_A))).toHaveLength(0);
    expect(valor(await b.repo.listAuditEvents(ORG_B))).toHaveLength(0);
  });
});

describe("isolamento de dados entre A e B", () => {
  it("cada organização enxerga apenas a própria assinatura", async () => {
    const a = bancada({ organizationId: ORG_A, userId: OWNER_A });
    valor(await abrirTrial(a.env));

    // Mesmo repositório, contexto de B: nada de A pode vazar.
    const envB = {
      ...a.env,
      auth: { userId: OWNER_B, organizationId: ORG_B, role: "owner" as const },
    };
    expect(valor(await a.repo.findSubscription(ORG_B))).toBeNull();
    expect(valor(await resolveBillingAccess(envB)).source).toBe("none");
  });

  it("cobrança de A não é alcançável pelo contexto de B", async () => {
    const a = bancada({ organizationId: ORG_A, userId: OWNER_A });
    valor(await abrirTrial(a.env));
    const checkout = valor(
      await createMockCheckout(a.env, {
        method: "pix",
        idempotencyKey: "k-a",
        customerName: "A",
        customerEmail: "a@x.test",
      })
    );

    const achada = valor(
      await a.repo.findChargeByExternalId(ORG_B, "mock", checkout.charge.externalChargeId)
    );
    expect(achada).toBeNull();
  });

  it("auditoria de A não aparece para B", async () => {
    const a = bancada({ organizationId: ORG_A });
    valor(await abrirTrial(a.env));
    expect(valor(await a.repo.listAuditEvents(ORG_A)).length).toBeGreaterThan(0);
    expect(valor(await a.repo.listAuditEvents(ORG_B))).toHaveLength(0);
  });

  it("cortesia de A não pode ser revogada pelo contexto de B", async () => {
    const a = bancada({ organizationId: ORG_A, userId: OWNER_A });
    const cortesia = valor(
      await grantCourtesy(a.env, { plan: "completo", days: 30, reason: "piloto" })
    );

    const envB = {
      ...a.env,
      auth: { userId: OWNER_B, organizationId: ORG_B, role: "owner" as const },
    };
    expect(erro(await revokeCourtesy(envB, { courtesyId: cortesia.id, reason: "x" }))).toBe(
      "not_found"
    );

    // E continua vigente para A.
    const acesso = valor(await resolveBillingAccess(a.env));
    expect(acesso.source).toBe("courtesy");
  });
});

describe("cortesia — prazo, motivo, autor e auditoria", () => {
  it("registra autor do contexto e prazo calculado", async () => {
    const b = bancada({ userId: OWNER_A });
    const c = valor(await grantCourtesy(b.env, { plan: "completo", days: 30, reason: "piloto" }));
    expect(c.grantedBy).toBe(OWNER_A);
    expect(c.startsAt).toBe("2026-08-01T00:00:00.000Z");
    expect(c.endsAt).toBe("2026-08-31T00:00:00.000Z");
    expect(c.revokedAt).toBeNull();

    const eventos = valor(await b.repo.listAuditEvents(b.env.auth.organizationId));
    const evento = eventos.find((e) => e.subject === "courtesy");
    expect(evento?.reason).toBe("piloto");
    expect(evento?.newValue).toMatchObject({ grantedBy: OWNER_A });
  });

  it("exige prazo positivo e motivo", async () => {
    const b = bancada();
    expect(erro(await grantCourtesy(b.env, { plan: "completo", days: 0, reason: "x" }))).toBe(
      "invalid_input"
    );
    expect(erro(await grantCourtesy(b.env, { plan: "completo", days: -1, reason: "x" }))).toBe(
      "invalid_input"
    );
    expect(erro(await grantCourtesy(b.env, { plan: "completo", days: 1.5, reason: "x" }))).toBe(
      "invalid_input"
    );
    expect(erro(await grantCourtesy(b.env, { plan: "completo", days: 10, reason: " " }))).toBe(
      "invalid_input"
    );
  });

  it("vigora até o fim e não além dele", async () => {
    const b = bancada();
    valor(await grantCourtesy(b.env, { plan: "completo", days: 30, reason: "piloto" }));

    b.tempo.set("2026-08-30T23:59:59.999Z");
    expect(valor(await resolveBillingAccess(b.env)).source).toBe("courtesy");

    b.tempo.set("2026-08-31T00:00:00.000Z");
    expect(valor(await resolveBillingAccess(b.env)).source).toBe("none");
  });

  it("revogação encerra o benefício e é auditada, sem apagar a concessão", async () => {
    const b = bancada();
    const c = valor(await grantCourtesy(b.env, { plan: "completo", days: 30, reason: "piloto" }));

    b.tempo.set("2026-08-10T00:00:00.000Z");
    valor(await revokeCourtesy(b.env, { courtesyId: c.id, reason: "encerrado a pedido" }));

    expect(valor(await resolveBillingAccess(b.env)).source).toBe("none");

    // A concessão original continua registrada, com autor e motivo.
    const cortesias = valor(await b.repo.listCourtesies(b.env.auth.organizationId));
    expect(cortesias).toHaveLength(1);
    expect(cortesias[0].reason).toBe("piloto");
    expect(cortesias[0].grantedBy).toBe(OWNER_A);
    expect(cortesias[0].revokedAt).toBe("2026-08-10T00:00:00.000Z");
  });

  it("revogar exige motivo e não repete", async () => {
    const b = bancada();
    const c = valor(await grantCourtesy(b.env, { plan: "completo", days: 30, reason: "piloto" }));
    expect(erro(await revokeCourtesy(b.env, { courtesyId: c.id, reason: "  " }))).toBe(
      "invalid_input"
    );
    valor(await revokeCourtesy(b.env, { courtesyId: c.id, reason: "fim" }));
    expect(erro(await revokeCourtesy(b.env, { courtesyId: c.id, reason: "de novo" }))).toBe(
      "conflict"
    );
  });
});
