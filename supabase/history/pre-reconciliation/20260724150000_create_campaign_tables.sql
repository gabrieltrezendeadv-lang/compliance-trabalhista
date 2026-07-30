-- ============================================================================
-- Migration: Campanhas de Compliance — tabelas principais
-- Lei 15.377/2025: informação obrigatória aos trabalhadores
-- ADR-004: Resend (e-mail) + WhatsApp Cloud API
-- ============================================================================

-- 1. Enum: campaign_status
CREATE TYPE public.campaign_status AS ENUM (
  'draft',       -- em rascunho
  'scheduled',   -- agendada para envio
  'sending',     -- envio em andamento
  'sent',        -- envio concluído
  'cancelled'    -- cancelada
);

-- 2. Enum: delivery_channel
CREATE TYPE public.delivery_channel AS ENUM (
  'email',
  'whatsapp',
  'both'        -- enviar por ambos os canais
);

-- 3. Enum: delivery_status (status unificado — ADR-004)
CREATE TYPE public.delivery_status AS ENUM (
  'pending',     -- aguardando envio
  'queued',      -- na fila do provedor
  'sent',        -- enviado pelo provedor
  'delivered',   -- confirmação de entrega
  'read',        -- confirmação de leitura (WhatsApp)
  'failed',      -- falha no envio
  'bounced',     -- e-mail devolvido
  'rejected'     -- rejeitado pelo provedor
);

-- 4. Enum: campaign_type
CREATE TYPE public.campaign_type AS ENUM (
  'informational',       -- informativo geral
  'risk_assessment',     -- divulgação de resultados de avaliação
  'policy_update',       -- atualização de política
  'training',            -- convocação para treinamento
  'legal_notice',        -- comunicação legal obrigatória (Lei 15.377)
  'custom'               -- personalizada
);

-- ============================================================================
-- 5. campaign_templates — Modelos reutilizáveis
-- ============================================================================
CREATE TABLE public.campaign_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID REFERENCES public.organizations(id),  -- NULL = template de sistema

  name        TEXT NOT NULL,
  description TEXT,
  type        public.campaign_type NOT NULL DEFAULT 'informational',
  channel     public.delivery_channel NOT NULL DEFAULT 'email',

  -- Conteúdo do template (suporta variáveis: {{nome}}, {{empresa}}, etc.)
  subject     TEXT NOT NULL,
  body_html   TEXT,         -- para e-mail
  body_text   TEXT NOT NULL, -- texto puro (e-mail fallback + WhatsApp)

  -- Metadados legais
  legal_basis TEXT,          -- e.g. "Lei 15.377/2025, art. 2º"
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

-- Trigger: updated_at
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

-- Trigger: tenant_id imutável
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

-- ============================================================================
-- 6. campaigns — Instâncias de campanhas enviadas
-- ============================================================================
CREATE TABLE public.campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.organizations(id),
  template_id     UUID REFERENCES public.campaign_templates(id),

  name            TEXT NOT NULL,
  description     TEXT,
  type            public.campaign_type NOT NULL DEFAULT 'informational',
  channel         public.delivery_channel NOT NULL DEFAULT 'email',
  status          public.campaign_status NOT NULL DEFAULT 'draft',

  -- Conteúdo congelado no momento do envio (snapshot imutável)
  subject         TEXT NOT NULL,
  body_html       TEXT,
  body_text       TEXT NOT NULL,

  -- Referência legal
  legal_basis     TEXT,
  requires_acknowledgment BOOLEAN NOT NULL DEFAULT FALSE,

  -- Agendamento
  scheduled_at    TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,

  -- Escopo: a quais departamentos/estabelecimentos se destina (JSONB)
  target_scope    JSONB,   -- e.g. {"establishment_ids": [...], "department_ids": [...]}

  -- Referência à avaliação (se tipo = risk_assessment)
  assessment_cycle_id UUID,

  -- Metadados de envio
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

-- Trigger: tenant_id imutável
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

-- ============================================================================
-- 7. campaign_recipients — Destinatários da campanha
-- ============================================================================
CREATE TABLE public.campaign_recipients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL REFERENCES public.organizations(id),

  -- Dados do destinatário (snapshot no momento do envio)
  user_id       UUID REFERENCES auth.users(id),
  full_name     TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,

  -- Localização
  establishment_id UUID,
  department_id    UUID,

  -- Status do destinatário nesta campanha
  channel       public.delivery_channel NOT NULL DEFAULT 'email',

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaign_recipients_campaign
  ON public.campaign_recipients(campaign_id);

CREATE INDEX idx_campaign_recipients_tenant
  ON public.campaign_recipients(tenant_id);

-- ============================================================================
-- 8. campaign_deliveries — Tracking de entrega por recipient + canal
-- Cada tentativa de entrega gera um registro. Status unificado (ADR-004).
-- ============================================================================
CREATE TABLE public.campaign_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  recipient_id    UUID NOT NULL REFERENCES public.campaign_recipients(id) ON DELETE CASCADE,

  channel         public.delivery_channel NOT NULL,
  status          public.delivery_status NOT NULL DEFAULT 'pending',

  -- IDs do provedor para rastreamento
  provider_id     TEXT,      -- e.g. Resend message_id ou WhatsApp message_id
  idempotency_key TEXT NOT NULL DEFAULT gen_random_uuid()::text,

  -- Timestamps de cada transição
  queued_at       TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  read_at         TIMESTAMPTZ,
  failed_at       TIMESTAMPTZ,

  -- Detalhes de erro (quando failed/bounced)
  error_code      TEXT,
  error_message   TEXT,

  -- Número de tentativas
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

-- ============================================================================
-- 9. campaign_acknowledgments — Confirmação de leitura/ciência pelo destinatário
-- Para campanhas com requires_acknowledgment = TRUE.
-- Evidência auditável de que o colaborador tomou ciência.
-- ============================================================================
CREATE TABLE public.campaign_acknowledgments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  recipient_id    UUID NOT NULL REFERENCES public.campaign_recipients(id) ON DELETE CASCADE,

  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- IP e user-agent registrados como evidência (NÃO é dado sensível — é o próprio colaborador autenticado)
  ip_address      INET,
  user_agent      TEXT,

  CONSTRAINT uq_acknowledgment UNIQUE (campaign_id, recipient_id)
);

-- ============================================================================
-- 10. RLS
-- ============================================================================

ALTER TABLE public.campaign_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_acknowledgments ENABLE ROW LEVEL SECURITY;

-- ---------- campaign_templates ----------
-- System templates (tenant_id IS NULL): todos autenticados podem ler
CREATE POLICY campaign_templates_select_system ON public.campaign_templates
  FOR SELECT TO authenticated
  USING (tenant_id IS NULL AND deleted_at IS NULL AND status = 'published');

-- Tenant templates: membros do tenant
CREATE POLICY campaign_templates_select_tenant ON public.campaign_templates
  FOR SELECT TO authenticated
  USING (
    tenant_id IS NOT NULL
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.tenant_id = campaign_templates.tenant_id
        AND om.user_id = auth.uid()
        AND om.deleted_at IS NULL
    )
  );

-- Criar/editar templates: admin/owner/manager
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

-- ---------- campaigns ----------
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

-- ---------- campaign_recipients ----------
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

-- ---------- campaign_deliveries ----------
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

-- INSERT/UPDATE de deliveries: via SECURITY DEFINER (webhook do provedor)

-- ---------- campaign_acknowledgments ----------
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

-- Colaborador confirma ciência da própria campanha
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
