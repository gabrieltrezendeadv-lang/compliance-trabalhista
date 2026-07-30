-- ============================================================================
-- Migration: Campanhas de Compliance — tabelas principais
-- ============================================================================

CREATE TYPE public.campaign_status AS ENUM (
  'draft', 'scheduled', 'sending', 'sent', 'cancelled'
);

CREATE TYPE public.delivery_channel AS ENUM (
  'email', 'whatsapp', 'both'
);

CREATE TYPE public.delivery_status AS ENUM (
  'pending', 'queued', 'sent', 'delivered', 'read', 'failed', 'bounced', 'rejected'
);

CREATE TYPE public.campaign_type AS ENUM (
  'informational', 'risk_assessment', 'policy_update', 'training', 'legal_notice', 'custom'
);

CREATE TABLE public.campaign_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID REFERENCES public.organizations(id),
  name        TEXT NOT NULL,
  description TEXT,
  type        public.campaign_type NOT NULL DEFAULT 'informational',
  channel     public.delivery_channel NOT NULL DEFAULT 'email',
  subject     TEXT NOT NULL,
  body_html   TEXT,
  body_text   TEXT NOT NULL,
  legal_basis TEXT,
  requires_acknowledgment BOOLEAN NOT NULL DEFAULT FALSE,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  version     INT NOT NULL DEFAULT 1,
  created_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX idx_campaign_templates_tenant
  ON public.campaign_templates(tenant_id)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.fn_campaign_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_campaign_templates_updated_at
  BEFORE UPDATE ON public.campaign_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_campaign_updated_at();

CREATE OR REPLACE FUNCTION public.fn_campaign_templates_immutable_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'tenant_id is immutable on campaign_templates';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_campaign_templates_immutable_tenant
  BEFORE UPDATE ON public.campaign_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_campaign_templates_immutable_tenant();

CREATE TABLE public.campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.organizations(id),
  template_id     UUID REFERENCES public.campaign_templates(id),
  name            TEXT NOT NULL,
  description     TEXT,
  type            public.campaign_type NOT NULL DEFAULT 'informational',
  channel         public.delivery_channel NOT NULL DEFAULT 'email',
  status          public.campaign_status NOT NULL DEFAULT 'draft',
  subject         TEXT NOT NULL,
  body_html       TEXT,
  body_text       TEXT NOT NULL,
  legal_basis     TEXT,
  requires_acknowledgment BOOLEAN NOT NULL DEFAULT FALSE,
  scheduled_at    TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  target_scope    JSONB,
  assessment_cycle_id UUID,
  total_recipients INT NOT NULL DEFAULT 0,
  idempotency_key  TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  CONSTRAINT chk_campaign_sent CHECK (
    sent_at IS NULL OR status IN ('sending', 'sent')
  )
);

CREATE INDEX idx_campaigns_tenant_status
  ON public.campaigns(tenant_id, status)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX idx_campaigns_idempotency
  ON public.campaigns(idempotency_key);

CREATE TRIGGER trg_campaigns_updated_at
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_campaign_updated_at();

CREATE OR REPLACE FUNCTION public.fn_campaigns_immutable_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'tenant_id is immutable on campaigns';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_campaigns_immutable_tenant
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_campaigns_immutable_tenant();

CREATE TABLE public.campaign_recipients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL REFERENCES public.organizations(id),
  user_id       UUID REFERENCES auth.users(id),
  full_name     TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  establishment_id UUID,
  department_id    UUID,
  channel       public.delivery_channel NOT NULL DEFAULT 'email',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaign_recipients_campaign
  ON public.campaign_recipients(campaign_id);

CREATE INDEX idx_campaign_recipients_tenant
  ON public.campaign_recipients(tenant_id);

CREATE TABLE public.campaign_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  recipient_id    UUID NOT NULL REFERENCES public.campaign_recipients(id) ON DELETE CASCADE,
  channel         public.delivery_channel NOT NULL,
  status          public.delivery_status NOT NULL DEFAULT 'pending',
  provider_id     TEXT,
  idempotency_key TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  queued_at       TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  read_at         TIMESTAMPTZ,
  failed_at       TIMESTAMPTZ,
  error_code      TEXT,
  error_message   TEXT,
  attempt_count   INT NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaign_deliveries_campaign
  ON public.campaign_deliveries(campaign_id, status);

CREATE INDEX idx_campaign_deliveries_recipient
  ON public.campaign_deliveries(recipient_id);

CREATE UNIQUE INDEX idx_campaign_deliveries_idempotency
  ON public.campaign_deliveries(idempotency_key);

CREATE TRIGGER trg_campaign_deliveries_updated_at
  BEFORE UPDATE ON public.campaign_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_campaign_updated_at();

CREATE TABLE public.campaign_acknowledgments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  recipient_id    UUID NOT NULL REFERENCES public.campaign_recipients(id) ON DELETE CASCADE,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address      INET,
  user_agent      TEXT,
  CONSTRAINT uq_acknowledgment UNIQUE (campaign_id, recipient_id)
);

-- ============================================================================
-- RLS
-- ============================================================================

ALTER TABLE public.campaign_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_acknowledgments ENABLE ROW LEVEL SECURITY;

CREATE POLICY campaign_templates_select_system ON public.campaign_templates
  FOR SELECT TO authenticated
  USING (tenant_id IS NULL AND deleted_at IS NULL AND status = 'published');

CREATE POLICY campaign_templates_select_tenant ON public.campaign_templates
  FOR SELECT TO authenticated
  USING (
    tenant_id IS NOT NULL AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.tenant_id = campaign_templates.tenant_id
        AND om.user_id = auth.uid() AND om.deleted_at IS NULL
    )
  );

CREATE POLICY campaign_templates_insert ON public.campaign_templates
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.tenant_id = campaign_templates.tenant_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin', 'manager')
        AND om.deleted_at IS NULL
    )
  );

CREATE POLICY campaign_templates_update ON public.campaign_templates
  FOR UPDATE TO authenticated
  USING (
    tenant_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.tenant_id = campaign_templates.tenant_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin', 'manager')
        AND om.deleted_at IS NULL
    )
  );

CREATE POLICY campaigns_select ON public.campaigns
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.tenant_id = campaigns.tenant_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin', 'manager', 'auditor')
        AND om.deleted_at IS NULL
    )
  );

CREATE POLICY campaigns_insert ON public.campaigns
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.tenant_id = campaigns.tenant_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin', 'manager')
        AND om.deleted_at IS NULL
    )
  );

CREATE POLICY campaigns_update ON public.campaigns
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.tenant_id = campaigns.tenant_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin', 'manager')
        AND om.deleted_at IS NULL
    )
  );

CREATE POLICY recipients_select ON public.campaign_recipients
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.tenant_id = campaign_recipients.tenant_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin', 'manager', 'auditor')
        AND om.deleted_at IS NULL
    )
  );

CREATE POLICY recipients_insert ON public.campaign_recipients
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.tenant_id = campaign_recipients.tenant_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin', 'manager')
        AND om.deleted_at IS NULL
    )
  );

CREATE POLICY deliveries_select ON public.campaign_deliveries
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.campaigns c
      JOIN public.organization_members om ON om.tenant_id = c.tenant_id
      WHERE c.id = campaign_deliveries.campaign_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin', 'manager', 'auditor')
        AND om.deleted_at IS NULL
    )
  );

CREATE POLICY acknowledgments_select ON public.campaign_acknowledgments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.campaigns c
      JOIN public.organization_members om ON om.tenant_id = c.tenant_id
      WHERE c.id = campaign_acknowledgments.campaign_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin', 'manager', 'auditor')
        AND om.deleted_at IS NULL
    )
  );

CREATE POLICY acknowledgments_insert_self ON public.campaign_acknowledgments
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.campaign_recipients cr
      WHERE cr.id = campaign_acknowledgments.recipient_id
        AND cr.campaign_id = campaign_acknowledgments.campaign_id
        AND cr.user_id = auth.uid()
    )
  );
