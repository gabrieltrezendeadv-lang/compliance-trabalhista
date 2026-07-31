/**
 * BILLING GUARD — o fim do fail-open, contra o código real.
 *
 * Cobre os itens 14 e 15 dos testes obrigatórios: erro de verificação
 * recusado, e feature flag desligada preservando o comportamento atual por
 * caminho explícito.
 *
 * ── O DEFEITO QUE ESTES TESTES IMPEDEM DE VOLTAR ──────────────────────────
 *
 * A versão anterior de `enforcePlanLimit` terminava com
 * `if (error) return { allowed: true }`. Como `check_plan_limit` está com
 * EXECUTE revogado de todos os papéis (SEC-002), esse ramo era o ÚNICO
 * alcançável: o guard aprovava sempre.
 *
 * O teste decisivo é "erro de verificação com billing LIGADO nega". Ele falha
 * imediatamente se alguém reintroduzir qualquer `catch → allow`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import {
  enforceFeature,
  enforceWriteAccess,
  getSubscriptionWarning,
} from "@/lib/billing/guard";
import { BILLING_FLAG_ENV } from "@/lib/billing/flag";

import { anonymous, ownerA, userWithoutOrg, type Identity } from "../../fixtures/identities";
import {
  createFakeSupabase,
  type FakeSupabaseOptions,
} from "../../fixtures/supabase-fake";

const original = process.env[BILLING_FLAG_ENV];

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

const ligarBilling = () => {
  process.env[BILLING_FLAG_ENV] = "true";
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env[BILLING_FLAG_ENV];
});

afterEach(() => {
  if (original === undefined) delete process.env[BILLING_FLAG_ENV];
  else process.env[BILLING_FLAG_ENV] = original;
});

describe("feature flag desligada — comportamento atual preservado", () => {
  it("permite, mas por DESVIO EXPLÍCITO, e o desvio é identificável", async () => {
    install(ownerA);
    const r = await enforceFeature("risks");

    expect(r.allowed).toBe(true);
    // As duas marcas juntas são o que distingue este caminho de um fail-open:
    // um `catch → allow` devolveria `reason: "ok"` e nenhum `bypass`.
    expect(r.reason).toBe("billing_disabled");
    expect(r.bypass).toBe(true);
  });

  it("não consulta o banco quando desligada", async () => {
    // Inércia verificável: com a flag desligada o guard não toca em nada.
    const fake = install(ownerA);
    await enforceFeature("complaints");
    await enforceWriteAccess();

    expect(fake.calls.from).toHaveLength(0);
    expect(fake.calls.rpc).toHaveLength(0);
    expect(fake.calls.authGetUser).toBe(0);
  });

  it("permite escrita e não exibe aviso nenhum", async () => {
    install(ownerA);
    const escrita = await enforceWriteAccess();
    expect(escrita.allowed).toBe(true);
    expect(escrita.bypass).toBe(true);
    expect(await getSubscriptionWarning()).toBeNull();
  });

  it("permite mesmo sem sessão — o desvio é anterior a qualquer verificação", async () => {
    install(anonymous);
    const r = await enforceFeature("risks");
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("billing_disabled");
  });
});

describe("feature flag ligada — fail-closed", () => {
  it("erro de verificação NEGA", async () => {
    ligarBilling();
    install(ownerA, {
      from: {
        organization_members: {
          data: null,
          error: { message: "permission denied" },
        },
      },
    });

    const r = await enforceFeature("risks");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("verification_failed");
    expect(r.bypass).toBeUndefined();
  });

  it("sem sessão, nega", async () => {
    ligarBilling();
    install(anonymous);
    const r = await enforceFeature("risks");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("not_authenticated");
  });

  it("sem organização, nega", async () => {
    ligarBilling();
    install(userWithoutOrg);
    const r = await enforceFeature("risks");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("no_organization");
  });

  it("sem fonte de assinatura verificável, NEGA — inclusive para o owner", async () => {
    // Limite declarado da Etapa 12A: a fachada de leitura do schema `billing`
    // é da 12B. Até lá, ligar a flag BLOQUEIA tudo — nunca libera. É o
    // comportamento correto de um guard fail-closed, e é a razão de a flag
    // nascer desligada.
    ligarBilling();
    install(ownerA);

    for (const decisao of [await enforceFeature("documents"), await enforceWriteAccess()]) {
      expect(decisao.allowed).toBe(false);
      expect(decisao.reason).toBe("verification_failed");
    }
  });

  it("nenhuma decisão positiva sai sem verificação quando a flag está ligada", async () => {
    ligarBilling();
    install(ownerA);

    const decisoes = [
      await enforceFeature("risks"),
      await enforceFeature("complaints"),
      await enforceFeature("documents"),
      await enforceWriteAccess(),
    ];

    expect(decisoes.every((d) => d.allowed === false)).toBe(true);
    expect(decisoes.some((d) => d.bypass === true)).toBe(false);
  });

  it("aviso de assinatura não é exibido sem verificação", async () => {
    ligarBilling();
    install(ownerA);
    expect(await getSubscriptionWarning()).toBeNull();
  });
});

describe("nenhuma falha vira autorização por acidente", () => {
  // A lista do item 3 da revisão, uma a uma. O que se prova aqui é que TODAS
  // convergem para negação — e nenhuma delas escapa como exceção não tratada.

  it("exceção ao criar o cliente NEGA", async () => {
    ligarBilling();
    vi.mocked(createClient).mockRejectedValue(new Error("boom"));
    const r = await enforceFeature("risks");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("verification_failed");
  });

  it("timeout NEGA", async () => {
    ligarBilling();
    vi.mocked(createClient).mockRejectedValue(
      Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" })
    );
    const r = await enforceWriteAccess();
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("verification_failed");
  });

  it("erro de leitura da membership NEGA", async () => {
    ligarBilling();
    install(ownerA, {
      from: {
        organization_members: {
          data: null,
          error: { message: "could not read", code: "57014" },
        },
      },
    });
    const r = await enforceFeature("documents");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("verification_failed");
  });

  it("resposta malformada NEGA — e não é confundida com ausência de organização", async () => {
    ligarBilling();
    install(ownerA, {
      from: {
        organization_members: { data: { tenant_id: null }, error: null },
      },
    });
    const r = await enforceFeature("documents");
    expect(r.allowed).toBe(false);
    // "veio algo que não dá para usar" é diferente de "não há organização".
    expect(r.reason).toBe("verification_failed");
  });

  it("entitlement desconhecido NEGA", async () => {
    ligarBilling();
    install(ownerA);
    const r = await enforceFeature("recurso_que_nao_existe" as never);
    expect(r.allowed).toBe(false);
    expect(r.bypass).toBeUndefined();
  });

  it("com a flag DESLIGADA, nem a exceção muda o resultado — o desvio é anterior", async () => {
    // O desvio da flag acontece antes de qualquer I/O, então não há como uma
    // falha de infraestrutura alterar o comportamento atual da aplicação.
    vi.mocked(createClient).mockRejectedValue(new Error("boom"));
    const r = await enforceFeature("risks");
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("billing_disabled");
    expect(r.bypass).toBe(true);
  });
});

describe("SEC-002 continua valendo", () => {
  it("o guard NÃO chama check_plan_limit", async () => {
    // A função está com EXECUTE revogado de todos os papéis. Chamá-la só
    // poderia produzir erro — e era desse erro que nascia o fail-open.
    ligarBilling();
    const fake = install(ownerA);
    await enforceFeature("risks");
    await enforceWriteAccess();

    expect(fake.calls.rpc.map((c) => c.fn)).not.toContain("check_plan_limit");
    expect(fake.calls.rpc).toHaveLength(0);
  });
});
