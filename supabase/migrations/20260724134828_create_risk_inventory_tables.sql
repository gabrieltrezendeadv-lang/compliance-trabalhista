
-- Enums
CREATE TYPE risk_source AS ENUM ('assessment','manual','complaint','inspection');
CREATE TYPE risk_category AS ENUM ('psychosocial','ergonomic','physical','chemical','biological','accident');
CREATE TYPE risk_level AS ENUM ('low','moderate','high','critical');
CREATE TYPE risk_item_status AS ENUM ('identified','action_planned','in_progress','mitigated','accepted','closed');
CREATE TYPE control_hierarchy AS ENUM ('elimination','substitution','engineering','administrative','ppe');
CREATE TYPE action_status AS ENUM ('planned','in_progress','completed','cancelled','overdue');
CREATE TYPE review_recommendation AS ENUM ('maintain','intensify','close','new_action');

-- risk_items
CREATE TABLE public.risk_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.organizations(id),
  cycle_id UUID REFERENCES public.assessment_cycles(id),
  section_id UUID REFERENCES public.questionnaire_sections(id),
  source risk_source NOT NULL DEFAULT 'manual',
  category risk_category NOT NULL DEFAULT 'psychosocial',
  title TEXT NOT NULL,
  description TEXT,
  initial_risk_level risk_level NOT NULL,
  residual_risk_level risk_level,
  initial_score NUMERIC(4,2),
  status risk_item_status NOT NULL DEFAULT 'identified',
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  establishment_id UUID REFERENCES public.establishments(id),
  department_id UUID REFERENCES public.departments(id),
  affected_group TEXT,
  identified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  identified_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT risk_items_assessment_link CHECK (
    (source = 'assessment' AND cycle_id IS NOT NULL) OR (source != 'assessment')
  )
);

CREATE INDEX idx_risk_items_tenant ON public.risk_items(tenant_id);
CREATE INDEX idx_risk_items_status ON public.risk_items(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_risk_items_level ON public.risk_items(tenant_id, initial_risk_level) WHERE deleted_at IS NULL;
CREATE INDEX idx_risk_items_cycle ON public.risk_items(cycle_id) WHERE cycle_id IS NOT NULL;

CREATE TRIGGER trg_risk_items_updated_at
  BEFORE UPDATE ON public.risk_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE OR REPLACE FUNCTION public.fn_risk_items_immutable_tenant()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'tenant_id is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_risk_items_immutable_tenant
  BEFORE UPDATE ON public.risk_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_risk_items_immutable_tenant();

-- risk_action_plans
CREATE TABLE public.risk_action_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.organizations(id),
  risk_item_id UUID NOT NULL REFERENCES public.risk_items(id),
  title TEXT NOT NULL,
  description TEXT,
  control_level control_hierarchy,
  responsible_user_id UUID REFERENCES auth.users(id),
  due_date DATE,
  status action_status NOT NULL DEFAULT 'planned',
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_risk_action_plans_risk ON public.risk_action_plans(risk_item_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_risk_action_plans_status ON public.risk_action_plans(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_risk_action_plans_responsible ON public.risk_action_plans(responsible_user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_risk_action_plans_due ON public.risk_action_plans(due_date) WHERE status IN ('planned','in_progress') AND deleted_at IS NULL;

CREATE TRIGGER trg_risk_action_plans_updated_at
  BEFORE UPDATE ON public.risk_action_plans
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- risk_reviews
CREATE TABLE public.risk_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.organizations(id),
  risk_item_id UUID NOT NULL REFERENCES public.risk_items(id),
  reviewer_id UUID NOT NULL REFERENCES auth.users(id),
  review_date DATE NOT NULL DEFAULT CURRENT_DATE,
  new_risk_level risk_level NOT NULL,
  new_score NUMERIC(4,2),
  assessment_method TEXT,
  findings TEXT NOT NULL,
  recommendation review_recommendation NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_risk_reviews_risk ON public.risk_reviews(risk_item_id);
CREATE INDEX idx_risk_reviews_date ON public.risk_reviews(tenant_id, review_date);

-- risk_audit_log
CREATE TABLE public.risk_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  risk_item_id UUID NOT NULL REFERENCES public.risk_items(id),
  actor_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_risk_audit_log_risk ON public.risk_audit_log(risk_item_id);

CREATE TRIGGER trg_risk_audit_log_immutable
  BEFORE UPDATE OR DELETE ON public.risk_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log_immutable();

-- RLS
ALTER TABLE public.risk_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_action_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_audit_log ENABLE ROW LEVEL SECURITY;

-- Policies: risk_items
CREATE POLICY risk_items_select ON public.risk_items FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.tenant_id = risk_items.tenant_id AND om.user_id = auth.uid()
      AND om.role IN ('owner','admin','manager','investigator','auditor') AND om.deleted_at IS NULL
  ));
CREATE POLICY risk_items_insert ON public.risk_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.tenant_id = risk_items.tenant_id AND om.user_id = auth.uid()
      AND om.role IN ('owner','admin','manager') AND om.deleted_at IS NULL
  ));
CREATE POLICY risk_items_update ON public.risk_items FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.tenant_id = risk_items.tenant_id AND om.user_id = auth.uid()
      AND om.role IN ('owner','admin','manager') AND om.deleted_at IS NULL
  ));

-- Policies: risk_action_plans
CREATE POLICY risk_action_plans_select ON public.risk_action_plans FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.tenant_id = risk_action_plans.tenant_id AND om.user_id = auth.uid()
      AND om.role IN ('owner','admin','manager','investigator','auditor') AND om.deleted_at IS NULL
  ));
CREATE POLICY risk_action_plans_insert ON public.risk_action_plans FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.tenant_id = risk_action_plans.tenant_id AND om.user_id = auth.uid()
      AND om.role IN ('owner','admin','manager') AND om.deleted_at IS NULL
  ));
CREATE POLICY risk_action_plans_update ON public.risk_action_plans FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.tenant_id = risk_action_plans.tenant_id AND om.user_id = auth.uid()
      AND om.role IN ('owner','admin','manager') AND om.deleted_at IS NULL
  ) OR responsible_user_id = auth.uid());

-- Policies: risk_reviews
CREATE POLICY risk_reviews_select ON public.risk_reviews FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.tenant_id = risk_reviews.tenant_id AND om.user_id = auth.uid()
      AND om.role IN ('owner','admin','manager','investigator','auditor') AND om.deleted_at IS NULL
  ));
CREATE POLICY risk_reviews_insert ON public.risk_reviews FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.tenant_id = risk_reviews.tenant_id AND om.user_id = auth.uid()
      AND om.role IN ('owner','admin','manager') AND om.deleted_at IS NULL
  ));

-- Policies: risk_audit_log
CREATE POLICY risk_audit_log_select ON public.risk_audit_log FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.risk_items ri
    JOIN public.organization_members om ON om.tenant_id = ri.tenant_id
    WHERE ri.id = risk_audit_log.risk_item_id AND om.user_id = auth.uid()
      AND om.role IN ('owner','admin','auditor') AND om.deleted_at IS NULL
  ));
CREATE POLICY risk_audit_log_insert ON public.risk_audit_log FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.risk_items ri
    JOIN public.organization_members om ON om.tenant_id = ri.tenant_id
    WHERE ri.id = risk_audit_log.risk_item_id AND om.user_id = auth.uid() AND om.deleted_at IS NULL
  ));
