/**
 * AUTORIZAÇÃO EM USUÁRIO MULTI-ORGANIZAÇÃO
 *
 * ── O DEFEITO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR ──────────────────────────
 *
 * As variantes `…For` faziam:
 *
 *     const r = await requireBillingOwner();   // resolve a PRIMEIRA membership
 *     if (pedido !== r.principal.organizationId) return negar(...);
 *
 * Isso não pergunta "o usuário pertence ao tenant pedido?". Pergunta "o tenant
 * pedido é justamente o primeiro que eu resolvi?" — e as duas perguntas só
 * coincidem para quem tem uma organização só.
 *
 * O efeito não era abrir acesso indevido: era RECUSAR acesso legítimo. Quem é
 * owner de A e membro de B, com B ativo, era barrado de B.
 *
 * ── POR QUE ESTE FAKE FILTRA, SE O COMPARTILHADO NÃO FILTRA ─────────────────
 *
 * `tests/fixtures/supabase-fake.ts` deliberadamente NÃO aplica filtros: lá, o
 * defeito temido é o código ESQUECER o filtro de tenant e o fake "consertar" a
 * falha, deixando passar um teste cross-tenant com produção vulnerável.
 *
 * Aqui a situação é a inversa. O defeito é o código não enviar o filtro, e a
 * consequência é a recusa de um usuário legítimo. Um fake que não filtrasse
 * devolveria a membership certa de qualquer jeito, e o teste passaria com o
 * código velho. Para que o teste MEÇA a correção, a tabela precisa se comportar
 * como tabela: responder ao `user_id`, ao `tenant_id`, ao `deleted_at` e ao
 * `role` que a consulta enviar.
 *
 * As duas escolhas são a mesma disciplina aplicada a defeitos opostos: o
 * fixture nunca pode ser o que faz o teste passar.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import {
  requireBillingMemberFor,
  requireBillingOwnerFor,
} from "@/lib/billing/authorization";

import { TENANT_A, TENANT_B } from "../../fixtures/tenants";

const USUARIO = { id: "00000000-0000-4000-8000-0000000000aa", email: "multi@exemplo.test" };
const TENANT_C = "cccccccc-0000-4000-8000-000000000003";

interface Linha {
  readonly tenant_id: string;
  readonly role: string;
  readonly user_id: string;
  readonly deleted_at: string | null;
  readonly created_at: string;
}

interface Opcoes {
  readonly linhas: readonly Linha[];
  /** Erro de consulta, para provar que ele nunca vira permissão. */
  readonly erro?: { message: string };
  readonly semSessao?: boolean;
}

/** Filtros que a consulta enviou — é o que separa "perguntou" de "adivinhou". */
let filtrosEnviados: Array<{ metodo: string; args: unknown[] }> = [];

/**
 * Tabela `organization_members` que responde aos filtros recebidos.
 *
 * Suporta exatamente o que o código de produção usa: `eq`, `is`, `order`,
 * `limit`, `maybeSingle`. Qualquer método fora dessa lista é encadeável e
 * inerte — se a produção passar a usar outro, o teste não mente: ele
 * simplesmente não filtra por ele, e a asserção de filtros enviados denuncia.
 */
function instalarTabela(opcoes: Opcoes) {
  filtrosEnviados = [];

  const builder: Record<string, unknown> = {};
  const igualdades: Array<[string, unknown]> = [];
  const nulos: string[] = [];

  for (const metodo of ["eq", "is", "order", "limit", "neq", "in", "not"]) {
    builder[metodo] = (...args: unknown[]) => {
      filtrosEnviados.push({ metodo, args });
      if (metodo === "eq") igualdades.push([String(args[0]), args[1]]);
      if (metodo === "is" && args[1] === null) nulos.push(String(args[0]));
      return builder;
    };
  }
  builder.select = () => builder;

  builder.maybeSingle = async () => {
    if (opcoes.erro) return { data: null, error: opcoes.erro };

    const encontradas = opcoes.linhas
      .filter((l) => igualdades.every(([coluna, valor]) => (l as unknown as Record<string, unknown>)[coluna] === valor))
      .filter((l) => nulos.every((coluna) => (l as unknown as Record<string, unknown>)[coluna] === null))
      .sort((x, y) => x.created_at.localeCompare(y.created_at));

    return { data: encontradas[0] ?? null, error: null };
  };

  const client = {
    auth: {
      getUser: async () => ({
        data: { user: opcoes.semSessao ? null : USUARIO },
        error: null,
      }),
    },
    from: () => builder,
  };

  vi.mocked(createClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createClient>>
  );
}

function linha(
  tenant: string,
  role: string,
  created_at: string,
  deleted_at: string | null = null
): Linha {
  return { tenant_id: tenant, role, user_id: USUARIO.id, deleted_at, created_at };
}

/** O filtro de tenant chegou ao banco? É a prova estrutural da correção. */
function filtrouPorTenant(esperado: string): boolean {
  return filtrosEnviados.some(
    (f) => f.metodo === "eq" && f.args[0] === "tenant_id" && f.args[1] === esperado
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("owner de A e membro de B", () => {
  const MEMBERSHIPS = [
    linha(TENANT_A.id, "owner", "2026-01-01T00:00:00Z"),
    linha(TENANT_B.id, "collaborator", "2026-02-01T00:00:00Z"),
  ];

  it("acessa B legitimamente, mesmo com A sendo a PRIMEIRA membership", async () => {
    instalarTabela({ linhas: MEMBERSHIPS });
    const r = await requireBillingMemberFor(TENANT_B.id);

    expect(r.ok, "membro legítimo de B foi recusado").toBe(true);
    if (!r.ok) return;
    expect(r.principal.organizationId).toBe(TENANT_B.id);
    expect(r.principal.role).toBe("member");
    // A prova estrutural: a consulta perguntou POR B, em vez de resolver o
    // padrão e comparar depois.
    expect(filtrouPorTenant(TENANT_B.id)).toBe(true);
  });

  it("acessa B legitimamente com a ordem de criação INVERTIDA", async () => {
    // B passa a ser a primeira. Se a resolução dependesse da ordem, um dos dois
    // casos passaria e o outro não — e é por isso que os dois existem.
    instalarTabela({
      linhas: [
        linha(TENANT_B.id, "collaborator", "2026-01-01T00:00:00Z"),
        linha(TENANT_A.id, "owner", "2026-02-01T00:00:00Z"),
      ],
    });
    const r = await requireBillingMemberFor(TENANT_B.id);

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.principal.organizationId).toBe(TENANT_B.id);
  });

  it("continua sendo owner de A quando pede A", async () => {
    instalarTabela({ linhas: MEMBERSHIPS });
    const r = await requireBillingOwnerFor(TENANT_A.id);

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.principal.role).toBe("owner");
  });

  it("NÃO administra B, onde é apenas colaborador", async () => {
    instalarTabela({ linhas: MEMBERSHIPS });
    const r = await requireBillingOwnerFor(TENANT_B.id);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_owner");
    // E o filtro de papel foi ENVIADO ao banco, além de conferido no objeto.
    expect(
      filtrosEnviados.some((f) => f.metodo === "eq" && f.args[0] === "role" && f.args[1] === "owner")
    ).toBe(true);
  });
});

describe("owner de duas organizações", () => {
  const DUAS = [
    linha(TENANT_A.id, "owner", "2026-01-01T00:00:00Z"),
    linha(TENANT_B.id, "owner", "2026-02-01T00:00:00Z"),
  ];

  it("administra B, que NÃO é a primeira", async () => {
    instalarTabela({ linhas: DUAS });
    const r = await requireBillingOwnerFor(TENANT_B.id);

    expect(r.ok, "owner legítimo de B foi recusado").toBe(true);
    if (!r.ok) return;
    expect(r.principal.organizationId).toBe(TENANT_B.id);
    expect(r.principal.role).toBe("owner");
    expect(filtrouPorTenant(TENANT_B.id)).toBe(true);
  });

  it("administra A, que é a primeira", async () => {
    instalarTabela({ linhas: DUAS });
    const r = await requireBillingOwnerFor(TENANT_A.id);

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.principal.organizationId).toBe(TENANT_A.id);
  });
});

describe("recusas, e todas fechadas", () => {
  it("membro de A não alcança B, onde não tem membership", async () => {
    instalarTabela({ linhas: [linha(TENANT_A.id, "collaborator", "2026-01-01T00:00:00Z")] });
    const r = await requireBillingMemberFor(TENANT_B.id);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_owner");
  });

  it("membership EXCLUÍDA não autoriza", async () => {
    instalarTabela({
      linhas: [linha(TENANT_B.id, "owner", "2026-01-01T00:00:00Z", "2026-06-01T00:00:00Z")],
    });
    const r = await requireBillingOwnerFor(TENANT_B.id);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_owner");
    // O `deleted_at IS NULL` foi enviado: não é o fake que está excluindo.
    expect(
      filtrosEnviados.some((f) => f.metodo === "is" && f.args[0] === "deleted_at" && f.args[1] === null)
    ).toBe(true);
  });

  it("erro da consulta NUNCA vira permissão", async () => {
    instalarTabela({
      linhas: [linha(TENANT_B.id, "owner", "2026-01-01T00:00:00Z")],
      erro: { message: "conexão perdida" },
    });
    const r = await requireBillingOwnerFor(TENANT_B.id);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("verification_failed");
  });

  it("sem sessão, nega antes de consultar a tabela", async () => {
    instalarTabela({ linhas: [linha(TENANT_B.id, "owner", "2026-01-01T00:00:00Z")], semSessao: true });
    const r = await requireBillingOwnerFor(TENANT_B.id);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_authenticated");
    expect(filtrosEnviados).toHaveLength(0);
  });

  it("tenant alheio e tenant INEXISTENTE respondem igual, por fora", async () => {
    const linhas = [linha(TENANT_A.id, "owner", "2026-01-01T00:00:00Z")];

    instalarTabela({ linhas });
    const alheio = await requireBillingOwnerFor(TENANT_B.id);
    instalarTabela({ linhas });
    const inexistente = await requireBillingOwnerFor(TENANT_C);

    expect(alheio.ok).toBe(false);
    expect(inexistente.ok).toBe(false);
    if (alheio.ok || inexistente.ok) return;
    expect(inexistente.reason).toBe(alheio.reason);
    expect(inexistente.message).toBe(alheio.message);
  });

  it("entrada vazia é recusada SEM consultar nada", async () => {
    for (const entrada of ["", "   ", null as unknown as string, undefined as unknown as string]) {
      instalarTabela({ linhas: [linha(TENANT_A.id, "owner", "2026-01-01T00:00:00Z")] });
      const r = await requireBillingOwnerFor(entrada);
      expect(r.ok).toBe(false);
      expect(filtrosEnviados, `${String(entrada)} consultou o banco`).toHaveLength(0);
    }
  });

  it("papel inesperado no banco vira `member`, nunca `owner`", async () => {
    instalarTabela({ linhas: [linha(TENANT_B.id, "auditor", "2026-01-01T00:00:00Z")] });

    const membro = await requireBillingMemberFor(TENANT_B.id);
    expect(membro.ok).toBe(true);
    if (membro.ok) expect(membro.principal.role).toBe("member");

    instalarTabela({ linhas: [linha(TENANT_B.id, "auditor", "2026-01-01T00:00:00Z")] });
    const dono = await requireBillingOwnerFor(TENANT_B.id);
    expect(dono.ok).toBe(false);
  });
});

describe("o tenant pedido restringe a consulta, e não autoriza", () => {
  it("linha de OUTRO tenant devolvida pelo banco é recusada mesmo assim", async () => {
    // Cenário defensivo: o filtro deixou de ser aplicado (RLS ausente,
    // refatoração, cliente falso) e o banco devolveu a linha errada. A
    // conferência posterior é o que separa "o banco filtrou" de "eu verifiquei".
    filtrosEnviados = [];
    const client = {
      auth: { getUser: async () => ({ data: { user: USUARIO }, error: null }) },
      from: () => {
        const b: Record<string, unknown> = {};
        for (const m of ["eq", "is", "order", "limit"]) b[m] = () => b;
        b.select = () => b;
        // Pediram B; o banco devolve A.
        b.maybeSingle = async () => ({
          data: { tenant_id: TENANT_A.id, role: "owner" },
          error: null,
        });
        return b;
      },
    };
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>
    );

    const r = await requireBillingOwnerFor(TENANT_B.id);
    expect(r.ok, "a linha de outro tenant autorizou").toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_owner");
  });
});
