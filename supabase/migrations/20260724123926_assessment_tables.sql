-- ============================================================================
-- Migration 3/4: Tabelas de Avaliação Psicossocial
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assessment_status') THEN
    CREATE TYPE public.assessment_status AS ENUM (
      'planning',
      'active',
      'closed',
      'archived'
    );
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.questionnaire_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  version         INT NOT NULL DEFAULT 1,
  instrument_code TEXT,
  response_scale  JSONB NOT NULL DEFAULT '{"type": "likert", "points": 5, "min_value": 1, "max_value": 5, "labels": {"1": "Nunca", "2": "Raramente", "3": "Às vezes", "4": "Frequentemente", "5": "Sempre"}}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_questionnaire_templates_tenant
  ON public.questionnaire_templates (tenant_id) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_questionnaire_templates_updated_at
  BEFORE UPDATE ON public.questionnaire_templates
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

ALTER TABLE public.questionnaire_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY questionnaire_templates_select ON public.questionnaire_templates
  FOR SELECT
  USING (
    (tenant_id IS NULL OR tenant_id = fn_resolve_tenant_id())
    AND deleted_at IS NULL
  );

CREATE POLICY questionnaire_templates_insert_admin ON public.questionnaire_templates
  FOR INSERT
  WITH CHECK (
    tenant_id = fn_resolve_tenant_id()
    AND fn_user_has_role(ARRAY['owner'::organization_role, 'admin'::organization_role])
  );

CREATE TABLE IF NOT EXISTS public.questionnaire_sections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  template_id     UUID NOT NULL REFERENCES public.questionnaire_templates(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  dimension_code  TEXT,
  display_order   INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_questionnaire_sections_template
  ON public.questionnaire_sections (template_id);

ALTER TABLE public.questionnaire_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY questionnaire_sections_select ON public.questionnaire_sections
  FOR SELECT
  USING (
    tenant_id IS NULL
    OR tenant_id = fn_resolve_tenant_id()
  );

CREATE TABLE IF NOT EXISTS public.questionnaire_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  section_id      UUID NOT NULL REFERENCES public.questionnaire_sections(id) ON DELETE CASCADE,
  text            TEXT NOT NULL,
  help_text       TEXT,
  display_order   INT NOT NULL DEFAULT 0,
  reverse_scored  BOOLEAN NOT NULL DEFAULT FALSE,
  required        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_questionnaire_items_section
  ON public.questionnaire_items (section_id);

ALTER TABLE public.questionnaire_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY questionnaire_items_select ON public.questionnaire_items
  FOR SELECT
  USING (
    tenant_id IS NULL
    OR tenant_id = fn_resolve_tenant_id()
  );

CREATE TABLE IF NOT EXISTS public.assessment_cycles (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  questionnaire_template_id   UUID NOT NULL REFERENCES public.questionnaire_templates(id),
  name                        TEXT NOT NULL,
  description                 TEXT,
  starts_at                   TIMESTAMPTZ NOT NULL,
  ends_at                     TIMESTAMPTZ NOT NULL,
  status                      assessment_status NOT NULL DEFAULT 'planning',
  min_respondents_threshold   INT NOT NULL DEFAULT 5 CHECK (min_respondents_threshold >= 3),
  created_by                  UUID,
  settings                    JSONB DEFAULT '{}'::jsonb,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at                  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_assessment_cycles_tenant
  ON public.assessment_cycles (tenant_id) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_assessment_cycles_updated_at
  BEFORE UPDATE ON public.assessment_cycles
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

ALTER TABLE public.assessment_cycles ENABLE ROW LEVEL SECURITY;

CREATE POLICY assessment_cycles_select_tenant ON public.assessment_cycles
  FOR SELECT
  USING (tenant_id = fn_resolve_tenant_id() AND deleted_at IS NULL);

CREATE POLICY assessment_cycles_insert_admin ON public.assessment_cycles
  FOR INSERT
  WITH CHECK (
    tenant_id = fn_resolve_tenant_id()
    AND fn_user_has_role(ARRAY['owner'::organization_role, 'admin'::organization_role, 'manager'::organization_role])
  );

CREATE POLICY assessment_cycles_update_admin ON public.assessment_cycles
  FOR UPDATE
  USING (
    tenant_id = fn_resolve_tenant_id()
    AND fn_user_has_role(ARRAY['owner'::organization_role, 'admin'::organization_role, 'manager'::organization_role])
    AND deleted_at IS NULL
  );

CREATE TABLE IF NOT EXISTS public.assessment_invitations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id        UUID NOT NULL REFERENCES public.assessment_cycles(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  token           TEXT NOT NULL UNIQUE,
  establishment_id UUID REFERENCES public.establishments(id),
  department_id   UUID REFERENCES public.departments(id),
  used_at         TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assessment_invitations_token
  ON public.assessment_invitations (token);
CREATE INDEX IF NOT EXISTS idx_assessment_invitations_cycle
  ON public.assessment_invitations (cycle_id);

ALTER TABLE public.assessment_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY assessment_invitations_select_admin ON public.assessment_invitations
  FOR SELECT
  USING (
    tenant_id = fn_resolve_tenant_id()
    AND fn_user_has_role(ARRAY['owner'::organization_role, 'admin'::organization_role, 'manager'::organization_role])
  );

CREATE POLICY assessment_invitations_insert_admin ON public.assessment_invitations
  FOR INSERT
  WITH CHECK (
    tenant_id = fn_resolve_tenant_id()
    AND fn_user_has_role(ARRAY['owner'::organization_role, 'admin'::organization_role, 'manager'::organization_role])
  );

CREATE TABLE IF NOT EXISTS public.assessment_responses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id   UUID NOT NULL REFERENCES public.assessment_invitations(id) ON DELETE CASCADE,
  cycle_id        UUID NOT NULL REFERENCES public.assessment_cycles(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  item_id         UUID NOT NULL REFERENCES public.questionnaire_items(id),
  value           INT NOT NULL CHECK (value >= 1 AND value <= 10),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assessment_responses_cycle
  ON public.assessment_responses (cycle_id);
CREATE INDEX IF NOT EXISTS idx_assessment_responses_invitation
  ON public.assessment_responses (invitation_id);

ALTER TABLE public.assessment_responses ENABLE ROW LEVEL SECURITY;

-- REGRA CRÍTICA: Respostas individuais NUNCA acessíveis via RLS
-- Somente funções SECURITY DEFINER que agregam (min threshold) podem ler
-- Não há SELECT policy — deny-by-default
