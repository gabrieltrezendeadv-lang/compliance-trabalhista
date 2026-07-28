-- Rollback exato do FIX-001 para o estado catalogado em 2026-07-28.
-- Restaura somente o corpo e os privilégios anteriormente confirmados.
-- Atenção: este rollback também restaura os defeitos documentados.

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
  v_user_id UUID;
  v_report_id UUID;
  v_snapshot JSONB;
  v_hash TEXT;
  v_member_role TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
  END IF;
  SELECT om.role INTO v_member_role
  FROM public.organization_members om
  WHERE om.tenant_id = p_tenant_id AND om.user_id = v_user_id
    AND om.deleted_at IS NULL LIMIT 1;
  IF v_member_role IS NULL OR v_member_role NOT IN ('owner', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN');
  END IF;
  CASE p_source_type
    WHEN 'campaign' THEN
      SELECT jsonb_build_object(
        'campaign', jsonb_build_object(
          'id', c.id, 'name', c.name, 'type', c.type, 'channel', c.channel,
          'status', c.status, 'subject', c.subject, 'body_text', c.body_text,
          'legal_basis', c.legal_basis, 'requires_acknowledgment', c.requires_acknowledgment,
          'total_recipients', c.total_recipients, 'sent_at', c.sent_at,
          'completed_at', c.completed_at, 'target_scope', c.target_scope
        ),
        'stats', (
          SELECT jsonb_build_object(
            'total_deliveries', count(*),
            'delivered', count(*) FILTER (WHERE cd.status IN ('delivered', 'read')),
            'failed', count(*) FILTER (WHERE cd.status IN ('failed', 'bounced', 'rejected')),
            'pending', count(*) FILTER (WHERE cd.status IN ('pending', 'queued', 'sent'))
          ) FROM public.campaign_deliveries cd WHERE cd.campaign_id = c.id
        ),
        'acknowledgments', (
          SELECT jsonb_build_object('total', count(*))
          FROM public.campaign_acknowledgments ca WHERE ca.campaign_id = c.id
        ),
        'recipients', (
          SELECT jsonb_agg(jsonb_build_object(
            'name', cr.full_name, 'channel', cr.channel,
            'delivery_status', (
              SELECT cd2.status FROM public.campaign_deliveries cd2
              WHERE cd2.recipient_id = cr.id ORDER BY cd2.created_at DESC LIMIT 1
            ),
            'acknowledged', EXISTS (
              SELECT 1 FROM public.campaign_acknowledgments ca2
              WHERE ca2.recipient_id = cr.id AND ca2.campaign_id = c.id
            )
          )) FROM public.campaign_recipients cr WHERE cr.campaign_id = c.id
        ),
        'generated_at', now(),
        'disclaimer', 'Este relatório depende de validação por profissional habilitado.'
      ) INTO v_snapshot
      FROM public.campaigns c
      WHERE c.id = p_source_id AND c.tenant_id = p_tenant_id AND c.deleted_at IS NULL;
    WHEN 'assessment_cycle' THEN
      SELECT jsonb_build_object(
        'cycle', jsonb_build_object(
          'id', ac.id, 'name', ac.name, 'status', ac.status,
          'started_at', ac.started_at, 'ended_at', ac.ended_at,
          'total_invited', ac.total_invited, 'total_responses', ac.total_responses
        ),
        'note', 'Respostas individuais omitidas por política de privacidade (NR-1/LGPD)',
        'generated_at', now(),
        'disclaimer', 'Este relatório depende de validação por profissional habilitado.'
      ) INTO v_snapshot
      FROM public.assessment_cycles ac
      WHERE ac.id = p_source_id AND ac.tenant_id = p_tenant_id AND ac.deleted_at IS NULL;
    WHEN 'complaint_period' THEN
      SELECT jsonb_build_object(
        'period', jsonb_build_object('start', p_period_start, 'end', p_period_end),
        'statistics', jsonb_build_object(
          'total', count(*),
          'by_status', jsonb_object_agg(comp.status, comp.cnt),
          'by_category', jsonb_object_agg(COALESCE(comp_cat.category, 'sem_categoria'), comp_cat.cnt)
        ),
        'note', 'Conteúdo das denúncias acessível somente por investigadores designados.',
        'generated_at', now(),
        'disclaimer', 'Este relatório depende de validação por profissional habilitado.'
      ) INTO v_snapshot
      FROM (
        SELECT status, count(*) AS cnt FROM public.complaints
        WHERE tenant_id = p_tenant_id
          AND created_at >= COALESCE(p_period_start, '1970-01-01'::timestamptz)
          AND created_at <= COALESCE(p_period_end, now()) AND deleted_at IS NULL
        GROUP BY status
      ) comp
      CROSS JOIN (
        SELECT COALESCE(category, 'sem_categoria') AS category, count(*) AS cnt
        FROM public.complaints
        WHERE tenant_id = p_tenant_id
          AND created_at >= COALESCE(p_period_start, '1970-01-01'::timestamptz)
          AND created_at <= COALESCE(p_period_end, now()) AND deleted_at IS NULL
        GROUP BY category
      ) comp_cat;
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_SOURCE_TYPE');
  END CASE;
  IF v_snapshot IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'SOURCE_NOT_FOUND');
  END IF;
  v_hash := encode(extensions.digest(v_snapshot::text::bytea, 'sha256'), 'hex');
  INSERT INTO public.evidence_reports (
    tenant_id, type, title, description, status, source_type, source_id,
    period_start, period_end, content_snapshot, content_hash, generated_by, generated_at
  ) VALUES (
    p_tenant_id, p_type::public.evidence_type, p_title, p_description, 'ready',
    p_source_type, p_source_id, p_period_start, p_period_end,
    v_snapshot, v_hash, v_user_id, now()
  ) RETURNING id INTO v_report_id;
  INSERT INTO public.evidence_audit_log (
    tenant_id, evidence_report_id, action, actor_id, metadata
  ) VALUES (
    p_tenant_id, v_report_id, 'generated', v_user_id,
    jsonb_build_object('source_type', p_source_type, 'source_id', p_source_id)
  );
  RETURN jsonb_build_object('success', true, 'report_id', v_report_id, 'content_hash', v_hash);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_generate_evidence_report(
  uuid, text, text, text, uuid, timestamptz, timestamptz, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_generate_evidence_report(
  uuid, text, text, text, uuid, timestamptz, timestamptz, text
) TO authenticated, service_role;
