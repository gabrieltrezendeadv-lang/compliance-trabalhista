/**
 * Autorização de aplicação em createEmployee — CONTRA O CÓDIGO REAL.
 *
 * ── O QUE ESTES TESTES PROVAM ─────────────────────────────────────────────
 *
 * Que `src/lib/employees/actions.ts`:
 *   1. exige sessão;
 *   2. exige papel owner ou admin;
 *   3. ENVIA o filtro de tenant ao validar estabelecimento e departamento;
 *   4. NÃO executa a escrita quando a autorização falha;
 *   5. grava o `tenant_id` da membership, nunca um vindo do cliente.
 *
 * ── O QUE ESTES TESTES **NÃO** PROVAM ─────────────────────────────────────
 *
 * RLS · USING · WITH CHECK · ACL · PUBLIC · SECURITY DEFINER · isolamento
 * efetivo no PostgreSQL.
 *
 * O cliente falso NÃO filtra por tenant_id (ver tests/fixtures/supabase-fake.ts).
 * É deliberado: se ele filtrasse, o teste passaria mesmo com o código de
 * produção esquecendo o `.eq("tenant_id", ...)`. Por isso a asserção é
 * "o filtro foi enviado", e não "o dado do outro tenant não veio".
 *
 * A verificação de isolamento real no banco está bloqueada pelo R1.
 * Ver tests/db/README-R1.md.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { createEmployee } from "@/lib/employees/actions";

import {
  adminA,
  anonymous,
  collaboratorA,
  managerA,
  ownerA,
  ownerB,
  userWithoutOrg,
  type Identity,
} from "../../fixtures/identities";
import { TENANT_A, TENANT_B } from "../../fixtures/tenants";
import {
  createFakeSupabase,
  sentFilter,
  writeOperations,
  type FakeSupabaseOptions,
} from "../../fixtures/supabase-fake";

/** Instala o cliente falso para a identidade indicada. */
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

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

const VALID_EMPLOYEE = {
  full_name: "Maria Silva",
  email: "maria@exemplo.test",
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════
// Sessão e papel
// ══════════════════════════════════════════════════════════════════════════

describe("exigência de sessão", () => {
  it("rejeita chamada anônima sem escrever nada", async () => {
    const fake = install(anonymous);

    const result = await createEmployee(form(VALID_EMPLOYEE));

    expect(result.error).toBe("Usuário não autenticado");
    expect(writeOperations(fake.calls)).toHaveLength(0);
  });
});

describe("exigência de papel", () => {
  it("rejeita usuário autenticado sem organização, sem escrever nada", async () => {
    const fake = install(userWithoutOrg);

    const result = await createEmployee(form(VALID_EMPLOYEE));

    expect(result.error).toBe("Somente owner ou admin pode cadastrar colaboradores");
    expect(writeOperations(fake.calls)).toHaveLength(0);
  });

  it.each([
    ["collaborator", collaboratorA],
    ["manager", managerA],
  ])("rejeita %s — papel insuficiente — sem escrever nada", async (_label, identity) => {
    // A consulta de membership do código filtra por papel; para papéis não
    // autorizados ela não retorna linha.
    const fake = install(identity, {
      from: { organization_members: { data: null, error: null } },
    });

    const result = await createEmployee(form(VALID_EMPLOYEE));

    expect(result.error).toBe("Somente owner ou admin pode cadastrar colaboradores");
    expect(writeOperations(fake.calls)).toHaveLength(0);
  });

  it("consulta memberships restringindo a owner/admin e ignorando removidos", async () => {
    const fake = install(ownerA);

    await createEmployee(form(VALID_EMPLOYEE));

    const membershipQuery = fake.calls.from.find(
      (c) => c.table === "organization_members"
    );
    expect(membershipQuery).toBeDefined();

    const roleFilter = membershipQuery!.filters.find((f) => f.method === "in");
    expect(roleFilter?.args[1]).toEqual(["owner", "admin"]);

    // Membership com soft delete não pode valer.
    expect(
      membershipQuery!.filters.some(
        (f) => f.method === "is" && f.args[0] === "deleted_at" && f.args[1] === null
      )
    ).toBe(true);
  });

  it.each([
    ["owner", ownerA],
    ["admin", adminA],
  ])("aceita %s e grava o colaborador", async (_label, identity) => {
    const fake = install(identity);

    const result = await createEmployee(form(VALID_EMPLOYEE));

    expect(result.success).toBe(true);
    expect(writeOperations(fake.calls)).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Matriz cross-tenant A × B
// ══════════════════════════════════════════════════════════════════════════

describe("isolamento cross-tenant (camada de aplicação)", () => {
  it("valida estabelecimento SEMPRE filtrando pelo tenant da membership", async () => {
    const fake = install(ownerA, {
      from: {
        organization_members: { data: ownerA.membership, error: null },
        establishments: { data: { id: TENANT_B.establishmentId }, error: null },
      },
    });

    await createEmployee(
      form({ ...VALID_EMPLOYEE, establishment_id: TENANT_B.establishmentId })
    );

    // O código de produção precisa ter enviado o filtro de tenant. Sem ele,
    // o banco decidiria sozinho — e é exatamente isso que não pode acontecer.
    expect(sentFilter(fake.calls, "establishments", "tenant_id", TENANT_A.id)).toBe(true);
    expect(sentFilter(fake.calls, "establishments", "tenant_id", TENANT_B.id)).toBe(false);
  });

  it("recusa estabelecimento de outro tenant e NÃO grava", async () => {
    // O banco, com o filtro de tenant aplicado, devolveria vazio.
    const fake = install(ownerA, {
      from: {
        organization_members: { data: ownerA.membership, error: null },
        establishments: { data: null, error: null },
      },
    });

    const result = await createEmployee(
      form({ ...VALID_EMPLOYEE, establishment_id: TENANT_B.establishmentId })
    );

    expect(result.error).toBe("Estabelecimento inválido para esta organização");
    expect(writeOperations(fake.calls)).toHaveLength(0);
  });

  it("valida departamento SEMPRE filtrando pelo tenant da membership", async () => {
    const fake = install(ownerA, {
      from: {
        organization_members: { data: ownerA.membership, error: null },
        departments: { data: null, error: null },
      },
    });

    await createEmployee(
      form({ ...VALID_EMPLOYEE, department_id: TENANT_B.departmentId })
    );

    expect(sentFilter(fake.calls, "departments", "tenant_id", TENANT_A.id)).toBe(true);
  });

  it("recusa departamento de outro tenant e NÃO grava", async () => {
    const fake = install(ownerA, {
      from: {
        organization_members: { data: ownerA.membership, error: null },
        departments: { data: null, error: null },
      },
    });

    const result = await createEmployee(
      form({ ...VALID_EMPLOYEE, department_id: TENANT_B.departmentId })
    );

    expect(result.error).toBe("Departamento inválido para esta organização");
    expect(writeOperations(fake.calls)).toHaveLength(0);
  });

  it("recusa departamento que não pertence ao estabelecimento informado", async () => {
    const fake = install(ownerA, {
      from: {
        organization_members: { data: ownerA.membership, error: null },
        establishments: { data: { id: TENANT_A.establishmentId }, error: null },
        departments: {
          data: {
            id: TENANT_A.departmentId,
            establishment_id: "aaaaaaaa-0000-4000-8000-0000000000e9",
          },
          error: null,
        },
      },
    });

    const result = await createEmployee(
      form({
        ...VALID_EMPLOYEE,
        establishment_id: TENANT_A.establishmentId,
        department_id: TENANT_A.departmentId,
      })
    );

    expect(result.error).toBe(
      "O departamento não pertence ao estabelecimento selecionado"
    );
    expect(writeOperations(fake.calls)).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Origem do tenant_id gravado
// ══════════════════════════════════════════════════════════════════════════

describe("origem do tenant_id", () => {
  /**
   * Formulário VÁLIDO, sem campo extra — a escrita precisa acontecer para que
   * o payload possa ser inspecionado.
   *
   * A versão anterior deste teste enviava `tenant_id` extra e envolvia as
   * asserções em `if (payload)`. Como o schema é `.strict()`, a entrada era
   * rejeitada, nenhum insert ocorria, `payload` ficava `undefined` e o bloco
   * inteiro era pulado: o teste passava sem verificar absolutamente nada.
   * Asserção de segurança nunca pode ser condicional a um payload opcional.
   *
   * A rejeição de campo extra é verificada separadamente, em "allowlist de
   * campos".
   */
  it("grava o tenant da membership no payload do insert", async () => {
    const fake = install(ownerA);

    const result = await createEmployee(form(VALID_EMPLOYEE));
    expect(result.success).toBe(true);

    const writes = writeOperations(fake.calls);
    expect(writes).toHaveLength(1);

    const insert = writes[0];
    expect(insert.table).toBe("employee_profiles");
    expect(insert.operation).toBe("insert");
    expect(insert.payload).toBeDefined();

    const payload = insert.payload as Record<string, unknown>;
    expect(payload.tenant_id).toBe(TENANT_A.id);
    expect(payload.tenant_id).not.toBe(TENANT_B.id);
  });

  it("usa o tenant de quem está autenticado, não um tenant fixo", async () => {
    // Mesma ação, identidade do tenant B: o tenant gravado precisa acompanhar
    // a membership, provando que não há valor constante embutido.
    const fake = install(ownerB, {
      from: { organization_members: { data: ownerB.membership, error: null } },
    });

    const result = await createEmployee(form(VALID_EMPLOYEE));
    expect(result.success).toBe(true);

    const writes = writeOperations(fake.calls);
    expect(writes).toHaveLength(1);
    expect(writes[0].payload).toBeDefined();

    const payload = writes[0].payload as Record<string, unknown>;
    expect(payload.tenant_id).toBe(TENANT_B.id);
    expect(payload.tenant_id).not.toBe(TENANT_A.id);
  });

  it("força status 'active' na criação", async () => {
    const fake = install(ownerA);

    const result = await createEmployee(form(VALID_EMPLOYEE));
    expect(result.success).toBe(true);

    const writes = writeOperations(fake.calls);
    expect(writes).toHaveLength(1);
    expect(writes[0].payload).toBeDefined();

    const payload = writes[0].payload as Record<string, unknown>;
    expect(payload.status).toBe("active");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Allowlist de campos
// ══════════════════════════════════════════════════════════════════════════

describe("allowlist de campos", () => {
  it("rejeita payload com campo fora do schema, sem escrever nada", async () => {
    const fake = install(ownerA);

    const result = await createEmployee(
      form({ ...VALID_EMPLOYEE, tenant_id: TENANT_B.id })
    );

    // O schema é .strict(): campo extra invalida a entrada inteira.
    expect(result.error).toBeTruthy();
    expect(result.success).toBeUndefined();
    expect(writeOperations(fake.calls)).toHaveLength(0);
  });

  it("exige e-mail ou telefone para viabilizar o envio de campanhas", async () => {
    const fake = install(ownerA);

    const result = await createEmployee(form({ full_name: "Sem Contato" }));

    expect(result.error).toContain("ao menos e-mail ou telefone");
    expect(writeOperations(fake.calls)).toHaveLength(0);
  });
});
