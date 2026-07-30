-- ============================================================================
-- Migration: Evidências — SECURITY DEFINER functions
-- Todas com SET search_path = '' (regra CLAUDE.md #5 segurança)
-- ============================================================================

-- ============================================================================
-- fn_generate_evidence_report
-- Gera um relatório de evidências a partir de dados existentes.
-- Congela o snapshot, calcula SHA-256, registra no audit log.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_generate_evidence_report(
  p_tenant_id     UUID,
  p_type          TEXT,
  p_title         TEXT,
  p_source_type   TEXT,
  p_source_id     UUID DEFAULT NULL,
  p_period_start  TIMESTAMPTZ DEFAULT NULL,
  p_period_end    TIMESTAMPTZ DEFAULT NULL,
  p_description   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id       UUID;
  v_report_id     UUID;
  v_snapshot       JSONB;
  v_hash           TEXT;
  v_member_role    TEXT;
BEGIN
  -- 1. Autenticação
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  -- 2. Autorização: owner ou admin do tenant
  SELECT om.role INTO v_member_role
  FROM public.organization_members om
  WHERE om.tenant_id = p_tenant_id
    AND om.user_id = v_user_id
    AND om.deleted_at IS NULL
  LIMIT 1;

  IF v_member_role IS NULL OR v_member_role NOT IN ('owner', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN');
  END IF;

  -- 3. Construir snapshot de acordo com o tipo de fonte
  CASE p_source_type
    -- ========== CAMPANHA ==========
    WHEN 'campaign' THEN
      SELECT jsonb_build_object(
        'campaign', jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'type', c.type,
          'channel', c.channel,
          'status', c.status,
          'subject', c.subject,
          'body_text', c.body_text,
          'legal_basis', c.legal_basis,
          'requires_acknowledgment', c.requires_acknowledgment,
          'total_recipients', c.total_recipients,
          'sent_at', c.sent_at,
          'completed_at', c.completed_at,
          'target_scope', c.target_scope
        ),
        'stats', (
          SELECT jsonb_build_object(
            'total_deliveries', count(*),
            'delivered', count(*) FILTER (WHERE cd.status IN ('delivered', 'read')),
            'failed', count(*) FILTER (WHERE cd.status IN ('failed', 'bounced', 'rejected')),
            'pending', count(*) FILTER (WHERE cd.status IN ('pending', 'queued', 'sent'))
          )
          FROM public.campaign_deliveries cd
          WHERE cd.campaign_id = c.id
        ),
        'acknowledgments', (
          SELECT jsonb_build_object(
            'total', count(*)
          )
          FROM public.campaign_acknowledgments ca
          WHERE ca.campaign_id = c.id
        ),
        'recipients', (
          SELECT jsonb_agg(jsonb_build_object(
            'name', cr.full_name,
            'channel', cr.channel,
            'delivery_status', (
              SELECT cd2.status
              FROM public.campaign_deliveries cd2
              WHERE cd2.recipient_id = cr.id
              ORDER BY cd2.created_at DESC
              LIMIT 1
            ),
            'acknowledged', EXISTS (
              SELECT 1 FROM public.campaign_acknowledgments ca2
              WHERE ca2.recipient_id = cr.id AND ca2.campaign_id = c.id
            )
          ))
          FROM public.campaign_recipients cr
          WHERE cr.campaign_id = c.id
        ),
        'generated_at', now(),
        'disclaimer', 'Este relatório depende de validação por profissional habilitado.'
      )
      INTO v_snapshot
      FROM public.campaigns c
      WHERE c.id = p_source_id
        AND c.tenant_id = p_tenant_id
        AND c.deleted_at IS NULL;

      IF v_snapshot IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'SOURCE_NOT_FOUND');
      END IF;

    -- ========== CICLO DE AVALIAÇÃO ==========
    WHEN 'assessment_cycle' THEN
      -- Snapshot simplificado — dados agregados, nunca individuais (regra #18)
      SELECT jsonb_build_object(
        'cycle', jsonb_build_object(
          'id', ac.id,
          'name', ac.name,
          'status', ac.status,
          'started_at', ac.started_at,
          'ended_at', ac.ended_at,
          'total_invited', ac.total_invited,
          'total_responses', ac.total_responses
        ),
        'note', 'Respostas individuais omitidas por política de privacidade (NR-1/LGPD)',
        'generated_at', now(),
        'disclaimer', 'Este relatório depende de validação por profissional habilitado.'
      )
      INTO v_snapshot
      FROM public.assessment_cycles ac
      WHERE ac.id = p_source_id
        AND ac.tenant_id = p_tenant_id
        AND ac.deleted_at IS NULL;

      IF v_snapshot IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'SOURCE_NOT_FOUND');
      END IF;

    -- ========== CANAL DE DENÚNCIAS (período) ==========
    WHEN 'complaint_period' THEN
      -- Resumo estatístico, SEM dados de conteúdo (regra #4 denúncias)
      SELECT jsonb_build_object(
        'period', jsonb_build_object(
          'start', p_period_start,
          'end', p_period_end
        ),
        'statistics', jsonb_build_object(
          'total', count(*),
          'by_status', jsonb_object_agg(
            comp.status, comp.cnt
          ),
          'by_category', jsonb_object_agg(
            COALESCE(comp_cat.category, 'sem_categoria'), comp_cat.cnt
          )
        ),
        'note', 'Conteúdo das denúncias acessível somente por investigadores designados.',
        'generated_at', now(),
        'disclaimer', 'Este relatório depende de validação por profissional habilitado.'
      )
      INTO v_snapshot
      FROM (
        SELECT status, count(*) as cnt
        FROM public.complaints
        WHERE tenant_id = p_tenant_id
          AND created_at >= COALESCE(p_period_start, '1970-01-01'::timestamptz)
          AND created_at <= COALESCE(p_period_end, now())
          AND deleted_at IS NULL
        GROUP BY status
      ) comp
      CROSS JOIN (
        SELECT COALESCE(category, 'sem_categoria') as category, count(*) as cnt
        FROM public.complaints
        WHERE tenant_id = p_tenant_id
          AND created_at >= COALESCE(p_period_start, '1970-01-01'::timestamptz)
          AND created_at <= COALESCE(p_period_end, now())
          AND deleted_at IS NULL
        GROUP BY category
      ) comp_cat;

      IF v_snapshot IS NULL THEN
        v_snapshot := jsonb_build_object(
          'period', jsonb_build_object('start', p_period_start, 'end', p_period_end),
          'statistics', jsonb_build_object('total', 0),
          'generated_at', now(),
          'disclaimer', 'Este relatório depende de validação por profissional habilitado.'
        );
      END IF;

    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_SOURCE_TYPE');
  END CASE;

  -- 4. Calcular SHA-256 do snapshot (regra #15)
  v_hash := encode(
    extensions.digest(v_snapshot::text::bytea, 'sha256'),
    'hex'
  );

  -- 5. Inserir o relatório
  INSERT INTO public.evidence_reports (
    tenant_id, type, title, description, status,
    source_type, source_id,
    period_start, period_end,
    content_snapshot, content_hash,
    generated_by, generated_at
  ) VALUES (
    p_tenant_id, p_type::public.evidence_type, p_title, p_description, 'ready',
    p_source_type, p_source_id,
    p_period_start, p_period_end,
    v_snapshot, v_hash,
    v_user_id, now()
  )
  RETURNING id INTO v_report_id;

  -- 6. Registrar no audit log
  INSERT INTO public.evidence_audit_log (
    tenant_id, evidence_report_id, action, actor_id,
    metadata
  ) VALUES (
    p_tenant_id, v_report_id, 'generated', v_user_id,
    jsonb_build_object('source_type', p_source_type, 'source_id', p_source_id)
  );

  RETURN jsonb_build_object(
    'success', true,
    'report_id', v_report_id,
    'content_hash', v_hash
  );
END;
$$;

-- ============================================================================
-- fn_seal_evidence_package
-- Sela um pacote de evidências, tornando-o imutável.
-- Calcula hash do pacote (SHA-256 de todos os hashes dos relatórios incluídos).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_seal_evidence_package(
  p_package_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id       UUID;
  v_tenant_id     UUID;
  v_package_status TEXT;
  v_hashes        TEXT;
  v_package_hash  TEXT;
  v_item_count    INT;
  v_member_role   TEXT;
BEGIN
  -- 1. Autenticação
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  -- 2. Buscar pacote
  SELECT ep.tenant_id, ep.status::text
  INTO v_tenant_id, v_package_status
  FROM public.evidence_packages ep
  WHERE ep.id = p_package_id
    AND ep.deleted_at IS NULL;

  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'PACKAGE_NOT_FOUND');
  END IF;

  IF v_package_status != 'draft' THEN
    RETURN jsonb_build_object('success', false, 'error', 'PACKAGE_ALREADY_SEALED');
  END IF;

  -- 3. Autorização
  SELECT om.role INTO v_member_role
  FROM public.organization_members om
  WHERE om.tenant_id = v_tenant_id
    AND om.user_id = v_user_id
    AND om.deleted_at IS NULL
  LIMIT 1;

  IF v_member_role IS NULL OR v_member_role NOT IN ('owner', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN');
  END IF;

  -- 4. Verificar que o pacote tem itens
  SELECT count(*) INTO v_item_count
  FROM public.evidence_package_items epi
  WHERE epi.package_id = p_package_id;

  IF v_item_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'PACKAGE_EMPTY');
  END IF;

  -- 5. Verificar que todos os relatórios estão 'ready'
  IF EXISTS (
    SELECT 1
    FROM public.evidence_package_items epi
    JOIN public.evidence_reports er ON er.id = epi.report_id
    WHERE epi.package_id = p_package_id
      AND er.status != 'ready'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'REPORTS_NOT_READY');
  END IF;

  -- 6. Calcular hash do pacote (concatenação ordenada dos hashes)
  SELECT string_agg(er.content_hash, '|' ORDER BY epi.order_index, er.created_at)
  INTO v_hashes
  FROM public.evidence_package_items epi
  JOIN public.evidence_reports er ON er.id = epi.report_id
  WHERE epi.package_id = p_package_id;

  v_package_hash := encode(
    extensions.digest(v_hashes::bytea, 'sha256'),
    'hex'
  );

  -- 7. Selar o pacote
  UPDATE public.evidence_packages
  SET status = 'sealed',
      package_hash = v_package_hash,
      sealed_at = now(),
      sealed_by = v_user_id
  WHERE id = p_package_id;

  -- 8. Audit log
  INSERT INTO public.evidence_audit_log (
    tenant_id, evidence_package_id, action, actor_id,
    metadata
  ) VALUES (
    v_tenant_id, p_package_id, 'package_sealed', v_user_id,
    jsonb_build_object('item_count', v_item_count, 'package_hash', v_package_hash)
  );

  RETURN jsonb_build_object(
    'success', true,
    'package_hash', v_package_hash,
    'item_count', v_item_count
  );
END;
$$;

-- ============================================================================
-- fn_get_evidence_report_detail
-- Retorna relatório com verificação de integridade.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_get_evidence_report_detail(
  p_report_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id     UUID;
  v_report      RECORD;
  v_computed_hash TEXT;
  v_integrity_ok BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  -- Buscar relatório com autorização via RLS natural (authenticated)
  SELECT
    er.id, er.tenant_id, er.type, er.title, er.description,
    er.status, er.version, er.previous_version_id,
    er.source_type, er.source_id,
    er.period_start, er.period_end,
    er.content_snapshot, er.content_hash,
    er.file_path, er.file_size_bytes, er.file_hash,
    er.disclaimer, er.metadata,
    er.generated_by, er.generated_at,
    er.created_at
  INTO v_report
  FROM public.evidence_reports er
  WHERE er.id = p_report_id
    AND er.deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.tenant_id = er.tenant_id
        AND om.user_id = v_user_id
        AND om.role IN ('owner', 'admin', 'manager', 'auditor')
        AND om.deleted_at IS NULL
    );

  IF v_report IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;

  -- Verificar integridade do hash
  IF v_report.content_hash IS NOT NULL THEN
    v_computed_hash := encode(
      extensions.digest(v_report.content_snapshot::text::bytea, 'sha256'),
      'hex'
    );
    v_integrity_ok := (v_computed_hash = v_report.content_hash);
  ELSE
    v_integrity_ok := NULL;
  END IF;

  -- Registrar visualização no audit log
  INSERT INTO public.evidence_audit_log (
    tenant_id, evidence_report_id, action, actor_id
  ) VALUES (
    v_report.tenant_id, p_report_id, 'viewed', v_user_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'report', jsonb_build_object(
      'id', v_report.id,
      'tenant_id', v_report.tenant_id,
      'type', v_report.type,
      'title', v_report.title,
      'description', v_report.description,
      'status', v_report.status,
      'version', v_report.version,
      'previous_version_id', v_report.previous_version_id,
      'source_type', v_report.source_type,
      'source_id', v_report.source_id,
      'period_start', v_report.period_start,
      'period_end', v_report.period_end,
      'content_snapshot', v_report.content_snapshot,
      'content_hash', v_report.content_hash,
      'file_path', v_report.file_path,
      'file_size_bytes', v_report.file_size_bytes,
      'file_hash', v_report.file_hash,
      'disclaimer', v_report.disclaimer,
      'metadata', v_report.metadata,
      'generated_by', v_report.generated_by,
      'generated_at', v_report.generated_at,
      'created_at', v_report.created_at,
      'integrity_verified', v_integrity_ok
    )
  );
END;
$$;

-- ============================================================================
-- fn_get_evidence_package_detail
-- Retorna pacote com lista de relatórios e verificação de integridade.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_get_evidence_package_detail(
  p_package_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id       UUID;
  v_package       RECORD;
  v_computed_hash TEXT;
  v_integrity_ok  BOOLEAN;
  v_items         JSONB;
  v_hashes        TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  SELECT
    ep.id, ep.tenant_id, ep.name, ep.description,
    ep.status, ep.period_start, ep.period_end,
    ep.package_hash, ep.sealed_at, ep.sealed_by,
    ep.metadata, ep.created_by, ep.created_at
  INTO v_package
  FROM public.evidence_packages ep
  WHERE ep.id = p_package_id
    AND ep.deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.tenant_id = ep.tenant_id
        AND om.user_id = v_user_id
        AND om.role IN ('owner', 'admin', 'manager', 'auditor')
        AND om.deleted_at IS NULL
    );

  IF v_package IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;

  -- Buscar itens
  SELECT jsonb_agg(
    jsonb_build_object(
      'report_id', er.id,
      'title', er.title,
      'type', er.type,
      'status', er.status,
      'content_hash', er.content_hash,
      'generated_at', er.generated_at,
      'order_index', epi.order_index
    ) ORDER BY epi.order_index, er.created_at
  )
  INTO v_items
  FROM public.evidence_package_items epi
  JOIN public.evidence_reports er ON er.id = epi.report_id
  WHERE epi.package_id = p_package_id;

  -- Verificar integridade do pacote se selado
  IF v_package.package_hash IS NOT NULL THEN
    SELECT string_agg(er.content_hash, '|' ORDER BY epi.order_index, er.created_at)
    INTO v_hashes
    FROM public.evidence_package_items epi
    JOIN public.evidence_reports er ON er.id = epi.report_id
    WHERE epi.package_id = p_package_id;

    v_computed_hash := encode(
      extensions.digest(v_hashes::bytea, 'sha256'),
      'hex'
    );
    v_integrity_ok := (v_computed_hash = v_package.package_hash);
  ELSE
    v_integrity_ok := NULL;
  END IF;

  -- Audit log
  INSERT INTO public.evidence_audit_log (
    tenant_id, evidence_package_id, action, actor_id
  ) VALUES (
    v_package.tenant_id, p_package_id, 'viewed', v_user_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'package', jsonb_build_object(
      'id', v_package.id,
      'tenant_id', v_package.tenant_id,
      'name', v_package.name,
      'description', v_package.description,
      'status', v_package.status,
      'period_start', v_package.period_start,
      'period_end', v_package.period_end,
      'package_hash', v_package.package_hash,
      'sealed_at', v_package.sealed_at,
      'sealed_by', v_package.sealed_by,
      'metadata', v_package.metadata,
      'created_by', v_package.created_by,
      'created_at', v_package.created_at,
      'integrity_verified', v_integrity_ok,
      'items', COALESCE(v_items, '[]'::jsonb)
    )
  );
END;
$$;
