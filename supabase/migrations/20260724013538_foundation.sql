-- Foundation: core tables, helper functions, RLS deny-by-default
-- This migration creates the foundational schema for the multi-tenant platform.
-- All business tables depend on organizations(id) as the tenant root.

-- =============================================================================
-- 1. HELPER FUNCTIONS
-- =============================================================================

-- Trigger function: auto-update updated_at on row modification
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 2. ENUMS
-- =============================================================================

CREATE TYPE organization_role AS ENUM (
  'owner',
  'admin',
  'manager',
  'collaborator',
  'investigator',
  'auditor'
);

CREATE TYPE subscription_status AS ENUM (
  'active',
  'past_due',
  'grace_period',
  'partially_blocked',
  'fully_blocked',
  'cancelled'
);

-- =============================================================================
-- 3. ORGANIZATIONS (tenant root)
-- =============================================================================

CREATE TABLE organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  cnpj        TEXT,
  settings    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE INDEX idx_organizations_slug ON organizations (slug) WHERE deleted_at IS NULL;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 4. ORGANIZATION MEMBERS (user ↔ tenant ↔ role)
-- =============================================================================

CREATE TABLE organization_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        organization_role NOT NULL DEFAULT 'collaborator',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ,

  UNIQUE (tenant_id, user_id)
);

CREATE TRIGGER trg_organization_members_updated_at
  BEFORE UPDATE ON organization_members
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE INDEX idx_organization_members_user_id ON organization_members (user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_organization_members_tenant_id ON organization_members (tenant_id) WHERE deleted_at IS NULL;

ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 5. TENANT RESOLUTION HELPERS
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_resolve_tenant_id()
RETURNS UUID AS $$
  SELECT tenant_id
  FROM organization_members
  WHERE user_id = auth.uid()
    AND deleted_at IS NULL
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION fn_user_has_role(required_roles organization_role[])
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organization_members
    WHERE user_id = auth.uid()
      AND tenant_id = fn_resolve_tenant_id()
      AND role = ANY(required_roles)
      AND deleted_at IS NULL
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp;

-- =============================================================================
-- 6. ESTABLISHMENTS (unidades/filiais within a tenant)
-- =============================================================================

CREATE TABLE establishments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  cnpj        TEXT,
  address     JSONB,
  is_main     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

CREATE TRIGGER trg_establishments_updated_at
  BEFORE UPDATE ON establishments
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE INDEX idx_establishments_tenant_id ON establishments (tenant_id) WHERE deleted_at IS NULL;

ALTER TABLE establishments ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 7. DEPARTMENTS (setores within an establishment)
-- =============================================================================

CREATE TABLE departments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  establishment_id  UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);

CREATE TRIGGER trg_departments_updated_at
  BEFORE UPDATE ON departments
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE INDEX idx_departments_tenant_id ON departments (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_departments_establishment_id ON departments (establishment_id) WHERE deleted_at IS NULL;

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 8. EMPLOYEE PROFILES (empregados vinculados ao tenant)
-- =============================================================================

CREATE TABLE employee_profiles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id           UUID REFERENCES auth.users(id),
  establishment_id  UUID REFERENCES establishments(id),
  department_id     UUID REFERENCES departments(id),
  full_name         TEXT NOT NULL,
  email             TEXT,
  phone             TEXT,
  job_title         TEXT,
  hire_date         DATE,
  status            TEXT NOT NULL DEFAULT 'active',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);

CREATE TRIGGER trg_employee_profiles_updated_at
  BEFORE UPDATE ON employee_profiles
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE INDEX idx_employee_profiles_tenant_id ON employee_profiles (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_employee_profiles_user_id ON employee_profiles (user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_employee_profiles_establishment_id ON employee_profiles (tenant_id, establishment_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_employee_profiles_department_id ON employee_profiles (tenant_id, department_id) WHERE deleted_at IS NULL;

ALTER TABLE employee_profiles ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 9. RLS POLICIES
-- =============================================================================

CREATE POLICY organizations_select_member ON organizations
  FOR SELECT USING (
    id = fn_resolve_tenant_id()
    AND deleted_at IS NULL
  );

CREATE POLICY organizations_update_admin ON organizations
  FOR UPDATE USING (
    id = fn_resolve_tenant_id()
    AND fn_user_has_role(ARRAY['owner', 'admin']::organization_role[])
    AND deleted_at IS NULL
  );

CREATE POLICY organization_members_select_tenant ON organization_members
  FOR SELECT USING (
    tenant_id = fn_resolve_tenant_id()
    AND deleted_at IS NULL
  );

CREATE POLICY organization_members_insert_admin ON organization_members
  FOR INSERT WITH CHECK (
    tenant_id = fn_resolve_tenant_id()
    AND fn_user_has_role(ARRAY['owner', 'admin']::organization_role[])
  );

CREATE POLICY organization_members_update_admin ON organization_members
  FOR UPDATE USING (
    tenant_id = fn_resolve_tenant_id()
    AND fn_user_has_role(ARRAY['owner', 'admin']::organization_role[])
    AND deleted_at IS NULL
  );

CREATE POLICY establishments_select_tenant ON establishments
  FOR SELECT USING (
    tenant_id = fn_resolve_tenant_id()
    AND deleted_at IS NULL
  );

CREATE POLICY establishments_insert_admin ON establishments
  FOR INSERT WITH CHECK (
    tenant_id = fn_resolve_tenant_id()
    AND fn_user_has_role(ARRAY['owner', 'admin']::organization_role[])
  );

CREATE POLICY establishments_update_admin ON establishments
  FOR UPDATE USING (
    tenant_id = fn_resolve_tenant_id()
    AND fn_user_has_role(ARRAY['owner', 'admin']::organization_role[])
    AND deleted_at IS NULL
  );

CREATE POLICY departments_select_tenant ON departments
  FOR SELECT USING (
    tenant_id = fn_resolve_tenant_id()
    AND deleted_at IS NULL
  );

CREATE POLICY departments_insert_admin ON departments
  FOR INSERT WITH CHECK (
    tenant_id = fn_resolve_tenant_id()
    AND fn_user_has_role(ARRAY['owner', 'admin']::organization_role[])
  );

CREATE POLICY departments_update_admin ON departments
  FOR UPDATE USING (
    tenant_id = fn_resolve_tenant_id()
    AND fn_user_has_role(ARRAY['owner', 'admin']::organization_role[])
    AND deleted_at IS NULL
  );

CREATE POLICY employee_profiles_select_tenant ON employee_profiles
  FOR SELECT USING (
    tenant_id = fn_resolve_tenant_id()
    AND deleted_at IS NULL
  );

CREATE POLICY employee_profiles_insert_admin ON employee_profiles
  FOR INSERT WITH CHECK (
    tenant_id = fn_resolve_tenant_id()
    AND fn_user_has_role(ARRAY['owner', 'admin']::organization_role[])
  );

CREATE POLICY employee_profiles_update_admin ON employee_profiles
  FOR UPDATE USING (
    tenant_id = fn_resolve_tenant_id()
    AND fn_user_has_role(ARRAY['owner', 'admin']::organization_role[])
    AND deleted_at IS NULL
  );
