/**
 * Fixtures de identidade — as oito exigidas pelo roadmap (Etapa 1).
 *
 * São dados puros. Não carregam comportamento e não simulam RLS: descrevem
 * apenas *quem* está chamando. O que o código de produção faz com essa
 * identidade é justamente o que os testes verificam.
 */

import { TENANT_A, TENANT_B } from "./tenants";

export type Role =
  | "owner"
  | "admin"
  | "manager"
  | "collaborator"
  | "investigator"
  | "auditor";

export interface Identity {
  /** Rótulo legível, usado nas mensagens de teste. */
  label: string;
  /** `null` representa ausência de sessão. */
  user: { id: string; email: string } | null;
  /** Membership ativa; `null` para anônimo ou usuário sem organização. */
  membership: { tenant_id: string; role: Role } | null;
}

function identity(
  label: string,
  userId: string | null,
  email: string,
  tenantId: string | null,
  role: Role | null
): Identity {
  return {
    label,
    user: userId ? { id: userId, email } : null,
    membership:
      tenantId && role ? { tenant_id: tenantId, role } : null,
  };
}

// ─── Sem sessão / sem organização ──────────────────────────────────────────

export const anonymous = identity(
  "anônimo",
  null,
  "",
  null,
  null
);

export const userWithoutOrg = identity(
  "usuário sem organização",
  "00000000-0000-4000-8000-000000000009",
  "sem-org@exemplo.test",
  null,
  null
);

// ─── Tenant A — os seis papéis ─────────────────────────────────────────────

export const collaboratorA = identity(
  "collaborator (tenant A)",
  "aaaaaaaa-1111-4000-8000-000000000001",
  "collaborator-a@exemplo.test",
  TENANT_A.id,
  "collaborator"
);

export const managerA = identity(
  "manager (tenant A)",
  "aaaaaaaa-1111-4000-8000-000000000002",
  "manager-a@exemplo.test",
  TENANT_A.id,
  "manager"
);

export const adminA = identity(
  "admin (tenant A)",
  "aaaaaaaa-1111-4000-8000-000000000003",
  "admin-a@exemplo.test",
  TENANT_A.id,
  "admin"
);

export const ownerA = identity(
  "owner (tenant A)",
  "aaaaaaaa-1111-4000-8000-000000000004",
  "owner-a@exemplo.test",
  TENANT_A.id,
  "owner"
);

export const investigatorA = identity(
  "investigator (tenant A)",
  "aaaaaaaa-1111-4000-8000-000000000005",
  "investigator-a@exemplo.test",
  TENANT_A.id,
  "investigator"
);

export const auditorA = identity(
  "auditor (tenant A)",
  "aaaaaaaa-1111-4000-8000-000000000006",
  "auditor-a@exemplo.test",
  TENANT_A.id,
  "auditor"
);

// ─── Tenant B — equivalentes, para a matriz cruzada A × B ──────────────────

export const collaboratorB = identity(
  "collaborator (tenant B)",
  "bbbbbbbb-1111-4000-8000-000000000001",
  "collaborator-b@exemplo.test",
  TENANT_B.id,
  "collaborator"
);

export const adminB = identity(
  "admin (tenant B)",
  "bbbbbbbb-1111-4000-8000-000000000003",
  "admin-b@exemplo.test",
  TENANT_B.id,
  "admin"
);

export const ownerB = identity(
  "owner (tenant B)",
  "bbbbbbbb-1111-4000-8000-000000000004",
  "owner-b@exemplo.test",
  TENANT_B.id,
  "owner"
);

export const investigatorB = identity(
  "investigator (tenant B)",
  "bbbbbbbb-1111-4000-8000-000000000005",
  "investigator-b@exemplo.test",
  TENANT_B.id,
  "investigator"
);

/** Os seis papéis do tenant A, para varrer a matriz de papéis. */
export const rolesOfTenantA: Identity[] = [
  collaboratorA,
  managerA,
  adminA,
  ownerA,
  investigatorA,
  auditorA,
];

/** As oito identidades exigidas pelo roadmap. */
export const allIdentities: Identity[] = [
  anonymous,
  userWithoutOrg,
  ...rolesOfTenantA,
];
