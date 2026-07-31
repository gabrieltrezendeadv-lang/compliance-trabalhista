/**
 * AUTORIZAÇÃO DE BILLING — contra o código real de
 * `src/lib/billing/authorization.ts`.
 *
 * Cobre os itens 12 e 13 dos testes obrigatórios: owner autorizado, admin e
 * demais papéis recusados.
 *
 * ── O QUE ESTES TESTES PROVAM ─────────────────────────────────────────────
 *
 *   1. sem sessão, nega;
 *   2. sem membership, nega;
 *   3. erro de consulta NUNCA vira permissão;
 *   4. o filtro de papel É ENVIADO ao banco;
 *   5. o papel é CONFERIDO no objeto devolvido — e é isto que separa
 *      "o banco filtrou" de "eu verifiquei".
 *
 * O ponto 5 só é observável porque o cliente falso NÃO aplica filtros: ele
 * devolve a membership programada mesmo tendo recebido `.eq("role","owner")`.
 * Um código que confiasse apenas no filtro aceitaria um admin aqui. Ver
 * tests/fixtures/supabase-fake.ts.
 *
 * ── O QUE ELES NÃO PROVAM ─────────────────────────────────────────────────
 *
 * RLS · USING · WITH CHECK · ACL · isolamento efetivo no PostgreSQL. Essa
 * camada é verificada por `scripts/ci/assert-billing-security.sql`, contra
 * banco de verdade.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import {
  requireBillingOwner,
  requireBillingOwnerFor,
} from "@/lib/billing/authorization";

import {
  adminA,
  anonymous,
  auditorA,
  collaboratorA,
  investigatorA,
  managerA,
  ownerA,
  ownerB,
  userWithoutOrg,
  type Identity,
} from "../../fixtures/identities";
import { TENANT_A, TENANT_B } from "../../fixtures/tenants";
import {
  createFakeSupabase,
  type FakeSupabaseOptions,
} from "../../fixtures/supabase-fake";

function install(identity: Identity, extra: FakeSupabaseOptions = {}) {
  const fake = createFakeSupabase({
    user: identity.user,
    from: {
      organization_members: { data: identity.membership, error: null },
      ...extra.from,
    },
    ...extra,
  });

  vi.mocked(createClient).mockResolvedValue(
    fake.client as unknown as Awaited<ReturnType<typeof createClient>>
  );

  return fake;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("owner autorizado", () => {
  it("aceita o proprietário e devolve a organização da membership", async () => {
    install(ownerA);
    const r = await requireBillingOwner();

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.principal.role).toBe("owner");
    expect(r.principal.userId).toBe(ownerA.user?.id);
    expect(r.principal.organizationId).toBe(ownerA.membership?.tenant_id);
  });

  it("envia o filtro de papel ao banco, além de conferir depois", async () => {
    const fake = install(ownerA);
    await requireBillingOwner();

    const consulta = fake.calls.from.find((c) => c.table === "organization_members");
    expect(consulta).toBeDefined();
    expect(
      consulta?.filters.some(
        (f) => f.method === "eq" && f.args[0] === "role" && f.args[1] === "owner"
      )
    ).toBe(true);
  });

  it("resolve a organização de forma determinística", async () => {
    // Mesma regra de `fn_resolve_tenant_id` após o TG-12: sem a ordenação
    // total, um usuário com mais de uma organização recairia num tenant
    // arbitrário — e billing é exatamente onde isso custaria dinheiro.
    const fake = install(ownerA);
    await requireBillingOwner();

    const consulta = fake.calls.from.find((c) => c.table === "organization_members");
    const ordens = consulta?.filters.filter((f) => f.method === "order") ?? [];
    expect(ordens.map((o) => o.args[0])).toEqual(["created_at", "id"]);
    expect(ordens.every((o) => (o.args[1] as { ascending: boolean }).ascending)).toBe(true);
  });
});

describe("todos os demais papéis são recusados", () => {
  const recusados: Identity[] = [
    adminA,
    managerA,
    collaboratorA,
    investigatorA,
    auditorA,
  ];

  for (const identidade of recusados) {
    it(`${identidade.label} é recusado`, async () => {
      install(identidade);
      const r = await requireBillingOwner();

      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe("not_owner");
      expect(r.message).toMatch(/proprietário/i);
    });
  }

  it("admin é recusado mesmo com o filtro de papel enviado", async () => {
    // O cliente falso devolve a membership de admin apesar do
    // `.eq("role","owner")`. Se a decisão dependesse só do filtro, isto
    // passaria — e passaria também em produção no dia em que uma refatoração
    // removesse o filtro.
    const fake = install(adminA);
    const r = await requireBillingOwner();

    const consulta = fake.calls.from.find((c) => c.table === "organization_members");
    expect(
      consulta?.filters.some((f) => f.method === "eq" && f.args[1] === "owner")
    ).toBe(true);
    expect(r.ok).toBe(false);
  });
});

describe("fail-closed", () => {
  it("sem sessão, nega", async () => {
    install(anonymous);
    const r = await requireBillingOwner();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("not_authenticated");
  });

  it("sem organização, nega", async () => {
    install(userWithoutOrg);
    const r = await requireBillingOwner();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("no_organization");
  });

  it("erro de autenticação nega, e não permite", async () => {
    install(ownerA, { authError: { message: "token inválido" } });
    const r = await requireBillingOwner();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("verification_failed");
  });

  it("exceção do cliente NEGA em vez de escapar", async () => {
    // Sem tratamento, a promessa rejeitaria e o chamador — que testa
    // `if (!r.ok)` — nunca rodaria. A operação abortaria com erro não
    // tratado: seguro por acidente, e não por decisão.
    vi.mocked(createClient).mockRejectedValue(new Error("connect ETIMEDOUT"));
    const r = await requireBillingOwner();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("verification_failed");
  });

  it("resposta malformada não autoriza", async () => {
    install(ownerA, {
      from: {
        organization_members: {
          // Veio linha e o papel é owner, mas sem tenant utilizável.
          data: { tenant_id: null, role: "owner" },
          error: null,
        },
      },
    });
    const r = await requireBillingOwner();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("verification_failed");
  });

  it("erro de consulta NUNCA vira permissão", async () => {
    // É o defeito exato que esta etapa corrige em enforcePlanLimit. Ele não
    // pode reaparecer por outra porta.
    install(ownerA, {
      from: {
        organization_members: {
          data: null,
          error: { message: "permission denied for table organization_members" },
        },
      },
    });

    const r = await requireBillingOwner();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("verification_failed");
  });
});

describe("IDOR — o identificador vindo do cliente nunca autoriza", () => {
  // O formato clássico: o servidor confirma "é owner de alguma coisa" e depois
  // OPERA sobre o `organization_id` que o cliente mandou. O proprietário do
  // tenant A administraria a assinatura do tenant B sem sair da sessão dele.

  it("owner do tenant A é aceito para a PRÓPRIA organização", async () => {
    install(ownerA);
    const r = await requireBillingOwnerFor(TENANT_A.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.principal.organizationId).toBe(TENANT_A.id);
  });

  it("owner do tenant A é RECUSADO ao pedir o tenant B", async () => {
    install(ownerA);
    const r = await requireBillingOwnerFor(TENANT_B.id);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("not_owner");
  });

  it("owner do tenant B é RECUSADO ao pedir o tenant A — a recusa vale nos dois sentidos", async () => {
    install(ownerB);
    const r = await requireBillingOwnerFor(TENANT_A.id);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("not_owner");
  });

  it("a recusa não confirma a existência da organização alheia", async () => {
    // `not_owner` para os dois casos: organização inexistente e organização
    // real de outro tenant. Uma mensagem distinta viraria oráculo de
    // enumeração.
    install(ownerA);
    const alheia = await requireBillingOwnerFor(TENANT_B.id);
    const inexistente = await requireBillingOwnerFor(
      "00000000-0000-4000-8000-00000000dead"
    );
    expect(alheia.ok).toBe(false);
    expect(inexistente.ok).toBe(false);
    if (alheia.ok || inexistente.ok) return;
    expect(inexistente.reason).toBe(alheia.reason);
  });

  it("entrada vazia é recusada, e não substituída pela do servidor", async () => {
    install(ownerA);
    for (const entrada of ["", "   ", null as unknown as string, undefined as unknown as string]) {
      const r = await requireBillingOwnerFor(entrada);
      expect(r.ok).toBe(false);
    }
  });

  it("admin do tenant A é recusado mesmo pedindo a própria organização", async () => {
    install(adminA);
    const r = await requireBillingOwnerFor(TENANT_A.id);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("not_owner");
  });
});
