
CREATE OR REPLACE FUNCTION public.fn_import_risks_from_cycle(p_cycle_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tenant_id UUID; v_user_id UUID; v_cycle RECORD; v_dim RECORD;
  v_risk_level public.risk_level; v_risk_id UUID; v_count INT := 0; v_skipped INT := 0;
BEGIN
  v_user_id := auth.uid();
  SELECT tenant_id INTO v_tenant_id FROM public.organization_members
    WHERE user_id = v_user_id AND role IN ('owner','admin','manager') AND deleted_at IS NULL LIMIT 1;
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
      COUNT(DISTINCT ar.invitation_id) AS respondent_count, AVG(ar.value) AS avg_score
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

    IF v_risk_level NOT IN ('high','critical') THEN v_skipped := v_skipped + 1; CONTINUE; END IF;

    IF EXISTS (SELECT 1 FROM public.risk_items WHERE cycle_id = p_cycle_id
      AND section_id = v_dim.section_id AND tenant_id = v_tenant_id AND deleted_at IS NULL) THEN
      v_skipped := v_skipped + 1; CONTINUE;
    END IF;

    INSERT INTO public.risk_items (tenant_id, cycle_id, section_id, source, category,
      title, description, initial_risk_level, initial_score, status, priority, identified_by)
    VALUES (v_tenant_id, p_cycle_id, v_dim.section_id, 'assessment', 'psychosocial',
      'Risco psicossocial: ' || v_dim.section_name,
      'Risco identificado automaticamente a partir do ciclo "' || v_cycle.name ||
        '". Dimensão "' || v_dim.section_name || '"' ||
        COALESCE(' (' || v_dim.dimension_code || ')', '') ||
        '. Pontuação média: ' || ROUND(v_dim.avg_score, 2) || '/5 (' || v_dim.respondent_count || ' respondentes).',
      v_risk_level, ROUND(v_dim.avg_score, 2), 'identified',
      CASE WHEN v_risk_level = 'critical' THEN 'urgent' ELSE 'high' END, v_user_id
    ) RETURNING id INTO v_risk_id;

    INSERT INTO public.risk_audit_log (risk_item_id, actor_id, action, details)
    VALUES (v_risk_id, v_user_id, 'imported_from_assessment', jsonb_build_object(
      'cycle_id', p_cycle_id, 'section_name', v_dim.section_name,
      'avg_score', ROUND(v_dim.avg_score, 2), 'risk_level', v_risk_level::text));
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'imported', v_count, 'skipped', v_skipped, 'cycle_name', v_cycle.name);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_get_risk_inventory_summary()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tenant_id UUID; v_total INT; v_by_level JSONB; v_by_status JSONB;
  v_by_category JSONB; v_actions_overdue INT; v_actions_pending INT;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM public.organization_members
    WHERE user_id = auth.uid() AND role IN ('owner','admin','manager','investigator','auditor')
      AND deleted_at IS NULL LIMIT 1;
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'permission_denied');
  END IF;

  SELECT count(*) INTO v_total FROM public.risk_items WHERE tenant_id = v_tenant_id AND deleted_at IS NULL;

  SELECT COALESCE(jsonb_object_agg(level, cnt), '{}'::jsonb) INTO v_by_level FROM (
    SELECT initial_risk_level::text AS level, count(*) AS cnt FROM public.risk_items
    WHERE tenant_id = v_tenant_id AND deleted_at IS NULL GROUP BY initial_risk_level) sub;

  SELECT COALESCE(jsonb_object_agg(st, cnt), '{}'::jsonb) INTO v_by_status FROM (
    SELECT status::text AS st, count(*) AS cnt FROM public.risk_items
    WHERE tenant_id = v_tenant_id AND deleted_at IS NULL GROUP BY status) sub;

  SELECT COALESCE(jsonb_object_agg(cat, cnt), '{}'::jsonb) INTO v_by_category FROM (
    SELECT category::text AS cat, count(*) AS cnt FROM public.risk_items
    WHERE tenant_id = v_tenant_id AND deleted_at IS NULL GROUP BY category) sub;

  SELECT count(*) INTO v_actions_overdue FROM public.risk_action_plans
    WHERE tenant_id = v_tenant_id AND deleted_at IS NULL AND status IN ('planned','in_progress') AND due_date < CURRENT_DATE;

  SELECT count(*) INTO v_actions_pending FROM public.risk_action_plans
    WHERE tenant_id = v_tenant_id AND deleted_at IS NULL AND status IN ('planned','in_progress');

  RETURN jsonb_build_object('success', true, 'total', v_total, 'by_level', v_by_level,
    'by_status', v_by_status, 'by_category', v_by_category,
    'actions_overdue', v_actions_overdue, 'actions_pending', v_actions_pending);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_get_risk_detail(p_risk_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tenant_id UUID; v_risk RECORD; v_actions JSONB; v_reviews JSONB; v_audit JSONB;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM public.organization_members
    WHERE user_id = auth.uid() AND role IN ('owner','admin','manager','investigator','auditor')
      AND deleted_at IS NULL LIMIT 1;
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'permission_denied');
  END IF;

  SELECT ri.*, ac.name AS cycle_name, qs.name AS section_name, qs.dimension_code,
    e.name AS establishment_name, d.name AS department_name
  INTO v_risk FROM public.risk_items ri
  LEFT JOIN public.assessment_cycles ac ON ac.id = ri.cycle_id
  LEFT JOIN public.questionnaire_sections qs ON qs.id = ri.section_id
  LEFT JOIN public.establishments e ON e.id = ri.establishment_id
  LEFT JOIN public.departments d ON d.id = ri.department_id
  WHERE ri.id = p_risk_id AND ri.tenant_id = v_tenant_id AND ri.deleted_at IS NULL;

  IF v_risk IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', ap.id, 'title', ap.title, 'description', ap.description,
    'control_level', ap.control_level, 'responsible_name', COALESCE(p.full_name, 'Não atribuído'),
    'responsible_user_id', ap.responsible_user_id, 'due_date', ap.due_date,
    'status', ap.status, 'completed_at', ap.completed_at, 'notes', ap.notes, 'created_at', ap.created_at
  ) ORDER BY ap.created_at), '[]'::jsonb) INTO v_actions
  FROM public.risk_action_plans ap LEFT JOIN public.profiles p ON p.id = ap.responsible_user_id
  WHERE ap.risk_item_id = p_risk_id AND ap.deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', rr.id, 'reviewer_name', COALESCE(p.full_name, 'Desconhecido'),
    'review_date', rr.review_date, 'new_risk_level', rr.new_risk_level,
    'new_score', rr.new_score, 'assessment_method', rr.assessment_method,
    'findings', rr.findings, 'recommendation', rr.recommendation, 'created_at', rr.created_at
  ) ORDER BY rr.review_date DESC), '[]'::jsonb) INTO v_reviews
  FROM public.risk_reviews rr LEFT JOIN public.profiles p ON p.id = rr.reviewer_id
  WHERE rr.risk_item_id = p_risk_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'action', al.action, 'actor_name', COALESCE(p.full_name, 'Sistema'),
    'details', al.details, 'created_at', al.created_at
  ) ORDER BY al.created_at DESC), '[]'::jsonb) INTO v_audit
  FROM (SELECT * FROM public.risk_audit_log WHERE risk_item_id = p_risk_id ORDER BY created_at DESC LIMIT 20) al
  LEFT JOIN public.profiles p ON p.id = al.actor_id;

  RETURN jsonb_build_object('success', true,
    'risk', jsonb_build_object(
      'id', v_risk.id, 'title', v_risk.title, 'description', v_risk.description,
      'source', v_risk.source, 'category', v_risk.category,
      'initial_risk_level', v_risk.initial_risk_level, 'residual_risk_level', v_risk.residual_risk_level,
      'initial_score', v_risk.initial_score, 'status', v_risk.status, 'priority', v_risk.priority,
      'cycle_name', v_risk.cycle_name, 'section_name', v_risk.section_name,
      'dimension_code', v_risk.dimension_code, 'establishment_name', v_risk.establishment_name,
      'department_name', v_risk.department_name, 'affected_group', v_risk.affected_group,
      'identified_at', v_risk.identified_at, 'created_at', v_risk.created_at),
    'actions', v_actions, 'reviews', v_reviews, 'audit_log', v_audit);
END;
$$;
