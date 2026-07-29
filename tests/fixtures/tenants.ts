/**
 * Fixtures multi-tenant — tenant A e tenant B.
 *
 * IDs fixos e legíveis para que uma falha de isolamento apareça na mensagem
 * de erro do teste sem exigir investigação.
 */

export const TENANT_A = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  slug: "tenant-a",
  name: "Organização A",
  establishmentId: "aaaaaaaa-0000-4000-8000-0000000000e1",
  departmentId: "aaaaaaaa-0000-4000-8000-0000000000d1",
  employeeId: "aaaaaaaa-0000-4000-8000-0000000000c1",
  complaintId: "aaaaaaaa-0000-4000-8000-0000000000f1",
} as const;

export const TENANT_B = {
  id: "bbbbbbbb-0000-4000-8000-000000000002",
  slug: "tenant-b",
  name: "Organização B",
  establishmentId: "bbbbbbbb-0000-4000-8000-0000000000e2",
  departmentId: "bbbbbbbb-0000-4000-8000-0000000000d2",
  employeeId: "bbbbbbbb-0000-4000-8000-0000000000c2",
  complaintId: "bbbbbbbb-0000-4000-8000-0000000000f2",
} as const;

export type TenantFixture = typeof TENANT_A;
