-- ============================================================================
-- Migration: Canal de Denúncias — tabelas principais
-- ADR-006: Anonimato + separação metadata/conteúdo + acesso por caso
-- ============================================================================

-- 1. Enum: complaint_status
CREATE TYPE public.complaint_status AS ENUM (
  'pending',       -- recém-registrada, aguarda triagem
  'under_review',  -- triagem em andamento
  'investigating', -- investigação designada
  'resolved',      -- concluída
  'dismissed',     -- arquivada sem procedência
  'reopened'       -- reaberta
);

-- 2. Enum: complaint_severity
CREATE TYPE public.complaint_severity AS ENUM (
  'low',
  'medium',
  'high',
  'critical'
);

-- 3. Enum: complaint_category
CREATE TYPE public.complaint_category AS ENUM (
  'harassment',           -- assédio moral
  'sexual_harassment',    -- assédio sexual
  'discrimination',       -- discriminação
  'retaliation',          -- retaliação
  'safety_violation',     -- violação de segurança
  'fraud',                -- fraude
  'corruption',           -- corrupção
  'conflict_of_interest', -- conflito de interesses
  'policy_violation',     -- violação de políticas
  'other'                 -- outros
);

-- ============================================================================
-- 4. complaints — METADATA ONLY (visível para admin do tenant)
-- ============================================================================
CREATE TABLE public.complaints (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES public.organizations(id),
  protocol     TEXT NOT NULL UNIQUE,
  pin_hash     TEXT NOT NULL,
  category     public.complaint_category NOT NULL DEFAULT 'other',
  severity     public.complaint_severity NOT NULL DEFAULT 'medium',
  status       public.complaint_status   NOT NULL DEFAULT 'pending',
  is_anonymous BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ,
  deleted_at   TIMESTAMPTZ,
  CONSTRAINT chk_complaint_resolved CHECK (
    resolved_at IS NULL OR status IN ('resolved', 'dismissed')
  )
);

CREATE INDEX idx_complaints_tenant_status ON public.complaints(tenant_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_complaints_protocol ON public.complaints(protocol);

CREATE OR REPLACE FUNCTION public.fn_complaints_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_complaints_updated_at
  BEFORE UPDATE ON public.complaints
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_complaints_updated_at();

CREATE OR REPLACE FUNCTION public.fn_complaints_immutable_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'tenant_id is immutable on complaints';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_complaints_immutable_tenant
  BEFORE UPDATE ON public.complaints
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_complaints_immutable_tenant();

-- ============================================================================
-- 5. complaint_contents — CONTEÚDO PROTEGIDO
-- ============================================================================
CREATE TABLE public.complaint_contents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id   UUID NOT NULL UNIQUE REFERENCES public.complaints(id) ON DELETE CASCADE,
  subject        TEXT NOT NULL,
  description    TEXT NOT NULL,
  reporter_name  TEXT,
  reporter_email TEXT,
  reporter_phone TEXT,
  establishment_name TEXT,
  department_name    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_complaint_contents_updated_at
  BEFORE UPDATE ON public.complaint_contents
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_complaints_updated_at();

-- ============================================================================
-- 6. complaint_investigators — acesso per-case
-- ============================================================================
CREATE TABLE public.complaint_investigators (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id  UUID NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id),
  assigned_by   UUID NOT NULL REFERENCES auth.users(id),
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at    TIMESTAMPTZ,
  CONSTRAINT uq_active_investigator UNIQUE (complaint_id, user_id)
);

CREATE INDEX idx_complaint_investigators_user
  ON public.complaint_investigators(user_id)
  WHERE removed_at IS NULL;

CREATE INDEX idx_complaint_investigators_complaint
  ON public.complaint_investigators(complaint_id)
  WHERE removed_at IS NULL;

-- ============================================================================
-- 7. complaint_messages — Caixa segura bidirecional
-- ============================================================================
CREATE TABLE public.complaint_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id  UUID NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  sender_type   TEXT NOT NULL CHECK (sender_type IN ('reporter', 'investigator')),
  sender_id     UUID REFERENCES auth.users(id),
  body          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_sender_consistency CHECK (
    (sender_type = 'reporter' AND sender_id IS NULL) OR
    (sender_type = 'investigator' AND sender_id IS NOT NULL)
  )
);

CREATE INDEX idx_complaint_messages_complaint
  ON public.complaint_messages(complaint_id, created_at);

-- ============================================================================
-- 8. complaint_audit_log — Log append-only
-- ============================================================================
CREATE TABLE public.complaint_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id  UUID NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  actor_id      UUID REFERENCES auth.users(id),
  action        TEXT NOT NULL,
  details       JSONB,
  ip_address    INET,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.fn_audit_log_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'complaint_audit_log is append-only: % not allowed', TG_OP;
END;
$$;

CREATE TRIGGER trg_audit_log_no_update
  BEFORE UPDATE ON public.complaint_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_audit_log_immutable();

CREATE TRIGGER trg_audit_log_no_delete
  BEFORE DELETE ON public.complaint_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_audit_log_immutable();

CREATE INDEX idx_complaint_audit_log_complaint
  ON public.complaint_audit_log(complaint_id, created_at);

-- ============================================================================
-- 9. RLS
-- ============================================================================

ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaint_contents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaint_investigators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaint_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaint_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY complaints_select_admin ON public.complaints
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.tenant_id = complaints.tenant_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin', 'manager', 'investigator')
        AND om.deleted_at IS NULL
    )
  );

CREATE POLICY complaints_select_investigator ON public.complaints
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.complaint_investigators ci
      WHERE ci.complaint_id = complaints.id
        AND ci.user_id = auth.uid()
        AND ci.removed_at IS NULL
    )
  );

CREATE POLICY complaints_update_admin ON public.complaints
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.tenant_id = complaints.tenant_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
        AND om.deleted_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.tenant_id = complaints.tenant_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
        AND om.deleted_at IS NULL
    )
  );

CREATE POLICY contents_select_investigator ON public.complaint_contents
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.complaint_investigators ci
      WHERE ci.complaint_id = complaint_contents.complaint_id
        AND ci.user_id = auth.uid()
        AND ci.removed_at IS NULL
    )
  );

CREATE POLICY investigators_select ON public.complaint_investigators
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.complaints c
      JOIN public.organization_members om ON om.tenant_id = c.tenant_id
      WHERE c.id = complaint_investigators.complaint_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
        AND om.deleted_at IS NULL
    )
    OR complaint_investigators.user_id = auth.uid()
  );

CREATE POLICY investigators_insert_admin ON public.complaint_investigators
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.complaints c
      JOIN public.organization_members om ON om.tenant_id = c.tenant_id
      WHERE c.id = complaint_investigators.complaint_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
        AND om.deleted_at IS NULL
    )
  );

CREATE POLICY investigators_update_admin ON public.complaint_investigators
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.complaints c
      JOIN public.organization_members om ON om.tenant_id = c.tenant_id
      WHERE c.id = complaint_investigators.complaint_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
        AND om.deleted_at IS NULL
    )
  );

CREATE POLICY messages_select_investigator ON public.complaint_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.complaint_investigators ci
      WHERE ci.complaint_id = complaint_messages.complaint_id
        AND ci.user_id = auth.uid()
        AND ci.removed_at IS NULL
    )
  );

CREATE POLICY messages_insert_investigator ON public.complaint_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_type = 'investigator'
    AND sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.complaint_investigators ci
      WHERE ci.complaint_id = complaint_messages.complaint_id
        AND ci.user_id = auth.uid()
        AND ci.removed_at IS NULL
    )
  );

CREATE POLICY audit_log_select ON public.complaint_audit_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.complaints c
      JOIN public.organization_members om ON om.tenant_id = c.tenant_id
      WHERE c.id = complaint_audit_log.complaint_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin', 'auditor')
        AND om.deleted_at IS NULL
    )
    OR EXISTS (
      SELECT 1 FROM public.complaint_investigators ci
      WHERE ci.complaint_id = complaint_audit_log.complaint_id
        AND ci.user_id = auth.uid()
        AND ci.removed_at IS NULL
    )
  );
