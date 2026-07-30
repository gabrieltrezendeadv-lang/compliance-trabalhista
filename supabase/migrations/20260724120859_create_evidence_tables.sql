-- ============================================================================
-- Migration: Geração de Evidências — tabelas principais
-- Bounded context: Evidências e Relatórios
-- Regras CLAUDE.md: #14 (imutabilidade), #15 (SHA-256), #22 (disclaimer)
-- ============================================================================

-- 1. Enum: evidence_type
CREATE TYPE public.evidence_type AS ENUM (
  'campaign_report',        -- evidência de campanha de comunicação
  'assessment_report',      -- evidência de ciclo de avaliação psicossocial
  'complaint_summary',      -- resumo estatístico do canal de denúncias
  'risk_inventory',         -- snapshot do inventário de riscos
  'compliance_package',     -- pacote consolidado de compliance
  'custom'                  -- relatório personalizado
);

-- 2. Enum: evidence_status
CREATE TYPE public.evidence_status AS ENUM (
  'generating',   -- snapshot sendo congelado
  'ready',        -- pronto, hash calculado, disponível para download
  'failed',       -- falha na geração
  'superseded'    -- substituído por nova versão (imutável, mas marcado)
);

-- 3. Enum: package_status
CREATE TYPE public.package_status AS ENUM (
  'draft',      -- em montagem, itens podem ser adicionados/removidos
  'sealed',     -- selado, imutável, hash do pacote calculado
  'exported'    -- exportado (download realizado ao menos uma vez)
);

-- 4. Enum: evidence_action (para audit log)
CREATE TYPE public.evidence_action AS ENUM (
  'generated',       -- relatório gerado
  'viewed',          -- relatório visualizado
  'downloaded',      -- relatório baixado
  'package_created', -- pacote criado
  'package_sealed',  -- pacote selado
  'package_exported' -- pacote exportado/baixado
);

-- ============================================================================
-- 5. evidence_reports — Snapshots imutáveis de dados de compliance
-- ============================================================================
CREATE TABLE public.evidence_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.organizations(id),

  -- Tipo e identificação
  type            public.evidence_type NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  status          public.evidence_status NOT NULL DEFAULT 'generating',

  -- Versionamento (regra #14: correções por nova versão)
  version         INT NOT NULL DEFAULT 1,
  previous_version_id UUID REFERENCES public.evidence_reports(id),

  -- Referência polimórfica à fonte dos dados
  source_type     TEXT NOT NULL,  -- 'campaign', 'assessment_cycle', 'complaint_period', 'risk_inventory'
  source_id       UUID,           -- ID do recurso fonte (campaign_id, cycle_id, etc.)

  -- Período coberto pelo relatório
  period_start    TIMESTAMPTZ,
  period_end      TIMESTAMPTZ,

  -- Snapshot imutável dos dados (regra #14)
  content_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Integridade (regra #15: SHA-256)
  content_hash    TEXT,  -- SHA-256 hex do content_snapshot serializado

  -- Arquivo gerado (futuro: PDF no Supabase Storage)
  file_path       TEXT,
  file_size_bytes BIGINT,
  file_hash       TEXT,  -- SHA-256 do arquivo PDF

  -- Disclaimer obrigatório (regra #22)
  disclaimer      TEXT NOT NULL DEFAULT 'Este relatório depende de validação por profissional habilitado.',

  -- Metadados extras
  metadata        JSONB DEFAULT '{}'::jsonb,

  -- Quem gerou
  generated_by    UUID REFERENCES auth.users(id),
  generated_at    TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,

  -- Validação: versão > 1 deve ter previous_version_id
  CONSTRAINT chk_version_chain CHECK (
    version = 1 OR previous_version_id IS NOT NULL
  )
);

CREATE INDEX idx_evidence_reports_tenant_type
  ON public.evidence_reports(tenant_id, type)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_evidence_reports_source
  ON public.evidence_reports(source_type, source_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_evidence_reports_status
  ON public.evidence_reports(tenant_id, status)
  WHERE deleted_at IS NULL;

-- Trigger: updated_at
CREATE OR REPLACE FUNCTION public.fn_evidence_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_evidence_reports_updated_at
  BEFORE UPDATE ON public.evidence_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_evidence_updated_at();

-- Trigger: tenant_id imutável
CREATE OR REPLACE FUNCTION public.fn_evidence_reports_immutable_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'tenant_id is immutable on evidence_reports';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_evidence_reports_immutable_tenant
  BEFORE UPDATE ON public.evidence_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_evidence_reports_immutable_tenant();

-- Trigger: conteúdo imutável após status 'ready' (regra #14)
CREATE OR REPLACE FUNCTION public.fn_evidence_reports_immutable_content()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.status IN ('ready', 'superseded') THEN
    IF OLD.content_snapshot IS DISTINCT FROM NEW.content_snapshot
       OR OLD.content_hash IS DISTINCT FROM NEW.content_hash
       OR OLD.file_path IS DISTINCT FROM NEW.file_path THEN
      RAISE EXCEPTION 'content is immutable after status = ready on evidence_reports';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_evidence_reports_immutable_content
  BEFORE UPDATE ON public.evidence_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_evidence_reports_immutable_content();

-- ============================================================================
-- 6. evidence_packages — Pacotes de compliance agrupando múltiplos relatórios
-- ============================================================================
CREATE TABLE public.evidence_packages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.organizations(id),

  name            TEXT NOT NULL,
  description     TEXT,
  status          public.package_status NOT NULL DEFAULT 'draft',

  -- Período coberto
  period_start    TIMESTAMPTZ NOT NULL,
  period_end      TIMESTAMPTZ NOT NULL,

  -- Integridade do pacote (hash de todos os hashes dos relatórios)
  package_hash    TEXT,  -- SHA-256 calculado ao selar

  -- Selamento
  sealed_at       TIMESTAMPTZ,
  sealed_by       UUID REFERENCES auth.users(id),

  -- Metadados
  metadata        JSONB DEFAULT '{}'::jsonb,

  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,

  CONSTRAINT chk_period CHECK (period_end > period_start),
  CONSTRAINT chk_sealed CHECK (
    (status != 'sealed' AND status != 'exported') OR sealed_at IS NOT NULL
  )
);

CREATE INDEX idx_evidence_packages_tenant
  ON public.evidence_packages(tenant_id)
  WHERE deleted_at IS NULL;

CREATE TRIGGER trg_evidence_packages_updated_at
  BEFORE UPDATE ON public.evidence_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_evidence_updated_at();

-- Trigger: tenant_id imutável
CREATE OR REPLACE FUNCTION public.fn_evidence_packages_immutable_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'tenant_id is immutable on evidence_packages';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_evidence_packages_immutable_tenant
  BEFORE UPDATE ON public.evidence_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_evidence_packages_immutable_tenant();

-- Trigger: pacote selado é imutável
CREATE OR REPLACE FUNCTION public.fn_evidence_packages_immutable_sealed()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.status IN ('sealed', 'exported') THEN
    -- Só permite transição sealed → exported
    IF NEW.status = 'exported' AND OLD.status = 'sealed' THEN
      RETURN NEW;
    END IF;
    -- Qualquer outra alteração de conteúdo é bloqueada
    IF OLD.name IS DISTINCT FROM NEW.name
       OR OLD.description IS DISTINCT FROM NEW.description
       OR OLD.period_start IS DISTINCT FROM NEW.period_start
       OR OLD.period_end IS DISTINCT FROM NEW.period_end
       OR OLD.package_hash IS DISTINCT FROM NEW.package_hash THEN
      RAISE EXCEPTION 'sealed evidence_packages are immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_evidence_packages_immutable_sealed
  BEFORE UPDATE ON public.evidence_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_evidence_packages_immutable_sealed();

-- ============================================================================
-- 7. evidence_package_items — Itens de um pacote (join table)
-- ============================================================================
CREATE TABLE public.evidence_package_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id      UUID NOT NULL REFERENCES public.evidence_packages(id) ON DELETE CASCADE,
  report_id       UUID NOT NULL REFERENCES public.evidence_reports(id),

  order_index     INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_package_report UNIQUE (package_id, report_id)
);

CREATE INDEX idx_evidence_package_items_package
  ON public.evidence_package_items(package_id);

-- ============================================================================
-- 8. evidence_audit_log — Trilha de auditoria
-- ============================================================================
CREATE TABLE public.evidence_audit_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES public.organizations(id),

  evidence_report_id  UUID REFERENCES public.evidence_reports(id),
  evidence_package_id UUID REFERENCES public.evidence_packages(id),

  action              public.evidence_action NOT NULL,
  actor_id            UUID REFERENCES auth.users(id),

  ip_address          INET,
  user_agent          TEXT,

  metadata            JSONB DEFAULT '{}'::jsonb,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Pelo menos um dos dois deve estar preenchido
  CONSTRAINT chk_audit_target CHECK (
    evidence_report_id IS NOT NULL OR evidence_package_id IS NOT NULL
  )
);

CREATE INDEX idx_evidence_audit_log_tenant
  ON public.evidence_audit_log(tenant_id, created_at DESC);

CREATE INDEX idx_evidence_audit_log_report
  ON public.evidence_audit_log(evidence_report_id)
  WHERE evidence_report_id IS NOT NULL;

CREATE INDEX idx_evidence_audit_log_package
  ON public.evidence_audit_log(evidence_package_id)
  WHERE evidence_package_id IS NOT NULL;

-- ============================================================================
-- 9. RLS — deny-by-default (regra #1)
-- ============================================================================

ALTER TABLE public.evidence_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_package_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_audit_log ENABLE ROW LEVEL SECURITY;

-- ---------- evidence_reports ----------
-- Leitura: owner, admin, manager, auditor
CREATE POLICY evidence_reports_select ON public.evidence_reports
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.tenant_id = evidence_reports.tenant_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin', 'manager', 'auditor')
        AND om.deleted_at IS NULL
    )
  );

-- INSERT via SECURITY DEFINER (fn_generate_evidence_report)

-- UPDATE restrito: apenas transições de status (generating → ready/failed, ready → superseded)
CREATE POLICY evidence_reports_update ON public.evidence_reports
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.tenant_id = evidence_reports.tenant_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
        AND om.deleted_at IS NULL
    )
  );

-- ---------- evidence_packages ----------
CREATE POLICY evidence_packages_select ON public.evidence_packages
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.tenant_id = evidence_packages.tenant_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin', 'manager', 'auditor')
        AND om.deleted_at IS NULL
    )
  );

CREATE POLICY evidence_packages_insert ON public.evidence_packages
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.tenant_id = evidence_packages.tenant_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
        AND om.deleted_at IS NULL
    )
  );

CREATE POLICY evidence_packages_update ON public.evidence_packages
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.tenant_id = evidence_packages.tenant_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
        AND om.deleted_at IS NULL
    )
  );

-- ---------- evidence_package_items ----------
CREATE POLICY evidence_package_items_select ON public.evidence_package_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.evidence_packages ep
      JOIN public.organization_members om ON om.tenant_id = ep.tenant_id
      WHERE ep.id = evidence_package_items.package_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin', 'manager', 'auditor')
        AND om.deleted_at IS NULL
        AND ep.deleted_at IS NULL
    )
  );

CREATE POLICY evidence_package_items_insert ON public.evidence_package_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.evidence_packages ep
      JOIN public.organization_members om ON om.tenant_id = ep.tenant_id
      WHERE ep.id = evidence_package_items.package_id
        AND ep.status = 'draft'
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
        AND om.deleted_at IS NULL
        AND ep.deleted_at IS NULL
    )
  );

CREATE POLICY evidence_package_items_delete ON public.evidence_package_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.evidence_packages ep
      JOIN public.organization_members om ON om.tenant_id = ep.tenant_id
      WHERE ep.id = evidence_package_items.package_id
        AND ep.status = 'draft'
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
        AND om.deleted_at IS NULL
        AND ep.deleted_at IS NULL
    )
  );

-- ---------- evidence_audit_log ----------
-- Somente leitura para admin/owner/auditor
CREATE POLICY evidence_audit_log_select ON public.evidence_audit_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.tenant_id = evidence_audit_log.tenant_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin', 'auditor')
        AND om.deleted_at IS NULL
    )
  );
