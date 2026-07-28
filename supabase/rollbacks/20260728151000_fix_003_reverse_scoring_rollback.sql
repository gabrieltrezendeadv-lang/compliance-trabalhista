-- Rollback do FIX-003.
-- Restaura os corpos catalogados, que calculavam AVG(ar.value) diretamente.

CREATE OR REPLACE FUNCTION public.fn_assessment_cycle_summary(p_cycle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE v_cycle record; v_results jsonb;
BEGIN
  SELECT ac.id, ac.tenant_id, ac.min_respondents_threshold INTO v_cycle
  FROM public.assessment_cycles ac
  WHERE ac.id = p_cycle_id AND ac.deleted_at IS NULL;
  IF v_cycle IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.tenant_id = v_cycle.tenant_id AND om.user_id = auth.uid()
      AND om.role IN ('owner','admin','manager','auditor') AND om.deleted_at IS NULL
  ) THEN RETURN '[]'::jsonb; END IF;
  SELECT COALESCE(jsonb_agg(row_to_json(s)::jsonb), '[]'::jsonb) INTO v_results
  FROM (
    SELECT qs.id AS section_id, qs.name AS section_name, qs.dimension_code,
      count(DISTINCT ar.invitation_id) AS respondent_count,
      CASE WHEN count(DISTINCT ar.invitation_id) >= v_cycle.min_respondents_threshold
        THEN round(avg(ar.value)::numeric, 2) END AS avg_score,
      CASE WHEN count(DISTINCT ar.invitation_id) >= v_cycle.min_respondents_threshold
        THEN min(ar.value) END AS min_score,
      CASE WHEN count(DISTINCT ar.invitation_id) >= v_cycle.min_respondents_threshold
        THEN max(ar.value) END AS max_score,
      CASE WHEN count(DISTINCT ar.invitation_id) >= v_cycle.min_respondents_threshold
        THEN round(stddev(ar.value)::numeric, 2) END AS stddev_score,
      count(DISTINCT ar.invitation_id) < v_cycle.min_respondents_threshold AS below_threshold
    FROM public.questionnaire_sections qs
    JOIN public.questionnaire_items qi ON qi.section_id = qs.id
    LEFT JOIN public.assessment_responses ar
      ON ar.item_id = qi.id AND ar.cycle_id = p_cycle_id
    WHERE qs.template_id = (
      SELECT questionnaire_template_id FROM public.assessment_cycles WHERE id = p_cycle_id
    )
    GROUP BY qs.id, qs.name, qs.dimension_code, qs.display_order
    ORDER BY qs.display_order
  ) s;
  RETURN v_results;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_assessment_group_results(
  p_cycle_id uuid, p_establishment_id uuid, p_department_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE v_cycle record; v_results jsonb;
BEGIN
  SELECT ac.id, ac.tenant_id, ac.min_respondents_threshold INTO v_cycle
  FROM public.assessment_cycles ac
  WHERE ac.id = p_cycle_id AND ac.deleted_at IS NULL;
  IF v_cycle IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.tenant_id = v_cycle.tenant_id AND om.user_id = auth.uid()
      AND om.role IN ('owner','admin','manager','auditor') AND om.deleted_at IS NULL
  ) THEN RETURN '[]'::jsonb; END IF;
  SELECT COALESCE(jsonb_agg(row_to_json(s)::jsonb), '[]'::jsonb) INTO v_results
  FROM (
    SELECT qs.id AS section_id, qs.name AS section_name, qs.dimension_code,
      count(DISTINCT ar.invitation_id) AS respondent_count,
      CASE WHEN count(DISTINCT ar.invitation_id) >= v_cycle.min_respondents_threshold
        THEN round(avg(ar.value)::numeric, 2) END AS avg_score,
      CASE WHEN count(DISTINCT ar.invitation_id) >= v_cycle.min_respondents_threshold
        THEN min(ar.value) END AS min_score,
      CASE WHEN count(DISTINCT ar.invitation_id) >= v_cycle.min_respondents_threshold
        THEN max(ar.value) END AS max_score,
      CASE WHEN count(DISTINCT ar.invitation_id) >= v_cycle.min_respondents_threshold
        THEN round(stddev(ar.value)::numeric, 2) END AS stddev_score,
      count(DISTINCT ar.invitation_id) < v_cycle.min_respondents_threshold AS below_threshold
    FROM public.questionnaire_sections qs
    JOIN public.questionnaire_items qi ON qi.section_id = qs.id
    LEFT JOIN public.assessment_responses ar
      ON ar.item_id = qi.id AND ar.cycle_id = p_cycle_id
    LEFT JOIN public.assessment_invitations ai ON ai.id = ar.invitation_id
    WHERE qs.template_id = (
      SELECT questionnaire_template_id FROM public.assessment_cycles WHERE id = p_cycle_id
    )
      AND (p_establishment_id IS NULL OR ai.establishment_id = p_establishment_id)
      AND (p_department_id IS NULL OR ai.department_id = p_department_id)
    GROUP BY qs.id, qs.name, qs.dimension_code, qs.display_order
    ORDER BY qs.display_order
  ) s;
  RETURN v_results;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_import_risks_from_cycle(p_cycle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_tenant_id uuid; v_user_id uuid; v_cycle record; v_dim record;
  v_risk_level public.risk_level; v_risk_id uuid; v_count int := 0; v_skipped int := 0;
BEGIN
  v_user_id := auth.uid();
  SELECT tenant_id INTO v_tenant_id FROM public.organization_members
  WHERE user_id = v_user_id AND role IN ('owner','admin','manager')
    AND deleted_at IS NULL LIMIT 1;
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'permission_denied');
  END IF;
  SELECT id, tenant_id, name, status INTO v_cycle FROM public.assessment_cycles
  WHERE id = p_cycle_id AND tenant_id = v_tenant_id AND deleted_at IS NULL;
  IF v_cycle IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'cycle_not_found');
  END IF;
  FOR v_dim IN
    SELECT qs.id AS section_id, qs.name AS section_name, qs.dimension_code,
      count(DISTINCT ar.invitation_id) AS respondent_count, avg(ar.value) AS avg_score
    FROM public.assessment_responses ar
    JOIN public.questionnaire_items qi ON qi.id = ar.item_id
    JOIN public.questionnaire_sections qs ON qs.id = qi.section_id
    WHERE ar.cycle_id = p_cycle_id AND ar.tenant_id = v_tenant_id
    GROUP BY qs.id, qs.name, qs.dimension_code
  LOOP
    IF v_dim.avg_score IS NULL THEN CONTINUE; END IF;
    IF v_dim.avg_score <= 2 THEN v_risk_level := 'low';
    ELSIF v_dim.avg_score <= 3 THEN v_risk_level := 'moderate';
    ELSIF v_dim.avg_score <= 4 THEN v_risk_level := 'high';
    ELSE v_risk_level := 'critical'; END IF;
    IF v_risk_level NOT IN ('high','critical') THEN
      v_skipped := v_skipped + 1; CONTINUE;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.risk_items WHERE cycle_id = p_cycle_id
        AND section_id = v_dim.section_id AND tenant_id = v_tenant_id
        AND deleted_at IS NULL
    ) THEN v_skipped := v_skipped + 1; CONTINUE; END IF;
    INSERT INTO public.risk_items (
      tenant_id, cycle_id, section_id, source, category, title, description,
      initial_risk_level, initial_score, status, priority, identified_by
    ) VALUES (
      v_tenant_id, p_cycle_id, v_dim.section_id, 'assessment', 'psychosocial',
      'Risco psicossocial: ' || v_dim.section_name,
      'Risco identificado automaticamente a partir do ciclo "' || v_cycle.name ||
        '". Pontuação média: ' || round(v_dim.avg_score, 2) || '/5.',
      v_risk_level, round(v_dim.avg_score, 2), 'identified',
      CASE WHEN v_risk_level = 'critical' THEN 'urgent' ELSE 'high' END, v_user_id
    ) RETURNING id INTO v_risk_id;
    INSERT INTO public.risk_audit_log (risk_item_id, actor_id, action, details)
    VALUES (
      v_risk_id, v_user_id, 'imported_from_assessment',
      jsonb_build_object('cycle_id', p_cycle_id, 'section_name', v_dim.section_name,
        'avg_score', round(v_dim.avg_score, 2), 'risk_level', v_risk_level::text)
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'imported', v_count,
    'skipped', v_skipped, 'cycle_name', v_cycle.name);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_assessment_cycle_summary(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_assessment_group_results(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_import_risks_from_cycle(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_assessment_cycle_summary(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_assessment_group_results(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_import_risks_from_cycle(uuid) TO authenticated, service_role;
