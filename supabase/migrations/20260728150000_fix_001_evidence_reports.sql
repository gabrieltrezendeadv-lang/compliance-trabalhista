-- FIX-001 — Corrige a geração de relatórios de evidências.
-- Estado anterior: branch assessment_cycle usa quatro colunas inexistentes;
-- complaint_period multiplica agregações por CROSS JOIN.
-- Estado posterior: usa starts_at/ends_at, calcula contagens e agrega denúncias
-- em subconsultas independentes.
-- Dependências: evidence_reports, evidence_audit_log, campaigns,
-- assessment_cycles, assessment_invitations, complaints, extensão pgcrypto.
-- Impacto esperado: restabelece a geração sem expor respostas individuais.
-- PROPOSTA: não executada automaticamente.

CREATE OR REPLACE FUNCTION public.fn_generate_evidence_report(
  p_tenant_id uuid,
  p_type text,
  p_title text,
  p_source_type text,
  p_source_id uuid DEFAULT NULL::uuid,
  p_period_start timestamptz DEFAULT NULL::timestamptz,
  p_period_end timestamptz DEFAULT NULL::timestamptz,
  p_description text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_report_id uuid;
  v_snapshot jsonb;
  v_hash text;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.tenant_id = p_tenant_id
      AND om.user_id = v_user_id
      AND om.role IN ('owner', 'admin')
      AND om.deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN');
  END IF;

  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_TITLE');
  END IF;

  CASE p_source_type
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
          SELECT jsonb_build_object('total', count(*))
          FROM public.campaign_acknowledgments ca
          WHERE ca.campaign_id = c.id
        ),
        'generated_at', now()
      )
      INTO v_snapshot
      FROM public.campaigns c
      WHERE c.id = p_source_id
        AND c.tenant_id = p_tenant_id
        AND c.deleted_at IS NULL;

    WHEN 'assessment_cycle' THEN
      SELECT jsonb_build_object(
        'cycle', jsonb_build_object(
          'id', ac.id,
          'name', ac.name,
          'status', ac.status,
          'starts_at', ac.starts_at,
          'ends_at', ac.ends_at,
          'total_invited', (
            SELECT count(*)
            FROM public.assessment_invitations ai
            WHERE ai.cycle_id = ac.id
          ),
          'total_responses', (
            SELECT count(*)
            FROM public.assessment_invitations ai
            WHERE ai.cycle_id = ac.id
              AND ai.used_at IS NOT NULL
          )
        ),
        'note', 'Respostas individuais não integram este relatório.',
        'generated_at', now()
      )
      INTO v_snapshot
      FROM public.assessment_cycles ac
      WHERE ac.id = p_source_id
        AND ac.tenant_id = p_tenant_id
        AND ac.deleted_at IS NULL;

    WHEN 'complaint_period' THEN
      IF p_period_start IS NULL
        OR p_period_end IS NULL
        OR p_period_end <= p_period_start THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_PERIOD');
      END IF;

      SELECT jsonb_build_object(
        'period', jsonb_build_object('start', p_period_start, 'end', p_period_end),
        'statistics', jsonb_build_object(
          'total', (
            SELECT count(*)
            FROM public.complaints c
            WHERE c.tenant_id = p_tenant_id
              AND c.created_at >= p_period_start
              AND c.created_at < p_period_end
              AND c.deleted_at IS NULL
          ),
          'by_status', COALESCE((
            SELECT jsonb_object_agg(s.status, s.cnt)
            FROM (
              SELECT c.status::text AS status, count(*) AS cnt
              FROM public.complaints c
              WHERE c.tenant_id = p_tenant_id
                AND c.created_at >= p_period_start
                AND c.created_at < p_period_end
                AND c.deleted_at IS NULL
              GROUP BY c.status
            ) s
          ), '{}'::jsonb),
          'by_category', COALESCE((
            SELECT jsonb_object_agg(s.category, s.cnt)
            FROM (
              SELECT COALESCE(c.category, 'sem_categoria') AS category,
                     count(*) AS cnt
              FROM public.complaints c
              WHERE c.tenant_id = p_tenant_id
                AND c.created_at >= p_period_start
                AND c.created_at < p_period_end
                AND c.deleted_at IS NULL
              GROUP BY COALESCE(c.category, 'sem_categoria')
            ) s
          ), '{}'::jsonb)
        ),
        'note', 'O conteúdo das denúncias não integra este relatório.',
        'generated_at', now()
      )
      INTO v_snapshot;

    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_SOURCE_TYPE');
  END CASE;

  IF v_snapshot IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'SOURCE_NOT_FOUND');
  END IF;

  v_hash := encode(extensions.digest(convert_to(v_snapshot::text, 'UTF8'), 'sha256'), 'hex');

  INSERT INTO public.evidence_reports (
    tenant_id, type, title, description, status,
    source_type, source_id, period_start, period_end,
    content_snapshot, content_hash, generated_by, generated_at
  )
  VALUES (
    p_tenant_id, p_type::public.evidence_type, p_title, p_description, 'ready',
    p_source_type, p_source_id, p_period_start, p_period_end,
    v_snapshot, v_hash, v_user_id, now()
  )
  RETURNING id INTO v_report_id;

  INSERT INTO public.evidence_audit_log (
    tenant_id, evidence_report_id, action, actor_id, metadata
  )
  VALUES (
    p_tenant_id, v_report_id, 'generated', v_user_id,
    jsonb_build_object('source_type', p_source_type, 'source_id', p_source_id)
  );

  RETURN jsonb_build_object(
    'success', true,
    'report_id', v_report_id,
    'content_hash', v_hash
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_generate_evidence_report(
  uuid, text, text, text, uuid, timestamptz, timestamptz, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_generate_evidence_report(
  uuid, text, text, text, uuid, timestamptz, timestamptz, text
) TO authenticated, service_role;

-- Verificação pós-migration:
SELECT
  p.oid::regprocedure::text AS signature,
  p.prosecdef,
  p.proconfig,
  p.proacl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'fn_generate_evidence_report';

-- Testes: owner/admin deve gerar cada tipo com fonte do próprio tenant;
-- manager, anônimo, fonte de outro tenant, período invertido e tipo desconhecido
-- devem falhar sem criar evidence_reports ou evidence_audit_log.

