-- ============================================================================
-- Funções SECURITY DEFINER de Avaliação
-- Todas com SET search_path = '' (defense-in-depth)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_get_questionnaire_for_token(
  p_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_invitation RECORD;
  v_cycle      RECORD;
  v_template   RECORD;
  v_sections   JSONB;
BEGIN
  SELECT ai.id, ai.cycle_id, ai.used_at, ai.expires_at
  INTO v_invitation
  FROM public.assessment_invitations ai
  WHERE ai.token = p_token;

  IF v_invitation IS NULL THEN
    RETURN jsonb_build_object('valid', FALSE, 'error', 'token_not_found');
  END IF;

  IF v_invitation.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('valid', FALSE, 'error', 'already_submitted');
  END IF;

  IF v_invitation.expires_at IS NOT NULL AND v_invitation.expires_at < now() THEN
    RETURN jsonb_build_object('valid', FALSE, 'error', 'token_expired');
  END IF;

  SELECT ac.id, ac.status, ac.questionnaire_template_id, ac.ends_at
  INTO v_cycle
  FROM public.assessment_cycles ac
  WHERE ac.id = v_invitation.cycle_id AND ac.deleted_at IS NULL;

  IF v_cycle IS NULL OR v_cycle.status <> 'active' THEN
    RETURN jsonb_build_object('valid', FALSE, 'error', 'cycle_not_active');
  END IF;

  IF v_cycle.ends_at < now() THEN
    RETURN jsonb_build_object('valid', FALSE, 'error', 'cycle_ended');
  END IF;

  SELECT qt.name, qt.description, qt.response_scale
  INTO v_template
  FROM public.questionnaire_templates qt
  WHERE qt.id = v_cycle.questionnaire_template_id AND qt.deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'description', s.description,
      'dimension_code', s.dimension_code,
      'items', (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'id', i.id,
            'text', i.text,
            'help_text', i.help_text,
            'required', i.required
          ) ORDER BY i.display_order
        ), '[]'::jsonb)
        FROM public.questionnaire_items i
        WHERE i.section_id = s.id
      )
    ) ORDER BY s.display_order
  ), '[]'::jsonb)
  INTO v_sections
  FROM public.questionnaire_sections s
  WHERE s.template_id = v_cycle.questionnaire_template_id;

  RETURN jsonb_build_object(
    'valid', TRUE,
    'template', jsonb_build_object(
      'name', v_template.name,
      'description', v_template.description,
      'response_scale', v_template.response_scale
    ),
    'sections', v_sections
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_questionnaire_for_token(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_submit_assessment(
  p_token TEXT,
  p_responses TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invitation RECORD;
  v_cycle      RECORD;
  v_response   JSONB;
  v_item       JSONB;
  v_count      INT := 0;
BEGIN
  SELECT ai.id, ai.cycle_id, ai.tenant_id, ai.used_at, ai.establishment_id, ai.department_id
  INTO v_invitation
  FROM public.assessment_invitations ai
  WHERE ai.token = p_token;

  IF v_invitation IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'token_not_found');
  END IF;

  IF v_invitation.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'already_submitted');
  END IF;

  SELECT ac.id, ac.status, ac.ends_at
  INTO v_cycle
  FROM public.assessment_cycles ac
  WHERE ac.id = v_invitation.cycle_id AND ac.deleted_at IS NULL;

  IF v_cycle IS NULL OR v_cycle.status <> 'active' THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'cycle_not_active');
  END IF;

  v_response := p_responses::jsonb;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_response)
  LOOP
    INSERT INTO public.assessment_responses (
      invitation_id, cycle_id, tenant_id, item_id, value
    ) VALUES (
      v_invitation.id,
      v_invitation.cycle_id,
      v_invitation.tenant_id,
      (v_item->>'item_id')::uuid,
      (v_item->>'value')::int
    );
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.assessment_invitations
  SET used_at = now()
  WHERE id = v_invitation.id;

  RETURN jsonb_build_object('success', TRUE, 'items_recorded', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_submit_assessment(TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_assessment_cycle_summary(
  p_cycle_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_cycle RECORD;
  v_results JSONB;
BEGIN
  SELECT ac.id, ac.tenant_id, ac.min_respondents_threshold
  INTO v_cycle
  FROM public.assessment_cycles ac
  WHERE ac.id = p_cycle_id AND ac.deleted_at IS NULL;

  IF v_cycle IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.tenant_id = v_cycle.tenant_id
      AND om.user_id = auth.uid()
      AND om.role IN ('owner', 'admin', 'manager', 'auditor')
      AND om.deleted_at IS NULL
  ) THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb), '[]'::jsonb)
  INTO v_results
  FROM (
    SELECT
      qs.id AS section_id,
      qs.name AS section_name,
      qs.dimension_code,
      count(DISTINCT ar.invitation_id) AS respondent_count,
      CASE
        WHEN count(DISTINCT ar.invitation_id) >= v_cycle.min_respondents_threshold
        THEN round(avg(ar.value)::numeric, 2)
        ELSE NULL
      END AS avg_score,
      CASE
        WHEN count(DISTINCT ar.invitation_id) >= v_cycle.min_respondents_threshold
        THEN min(ar.value)
        ELSE NULL
      END AS min_score,
      CASE
        WHEN count(DISTINCT ar.invitation_id) >= v_cycle.min_respondents_threshold
        THEN max(ar.value)
        ELSE NULL
      END AS max_score,
      CASE
        WHEN count(DISTINCT ar.invitation_id) >= v_cycle.min_respondents_threshold
        THEN round(stddev(ar.value)::numeric, 2)
        ELSE NULL
      END AS stddev_score,
      count(DISTINCT ar.invitation_id) < v_cycle.min_respondents_threshold AS below_threshold
    FROM public.questionnaire_sections qs
    JOIN public.questionnaire_items qi ON qi.section_id = qs.id
    LEFT JOIN public.assessment_responses ar ON ar.item_id = qi.id AND ar.cycle_id = p_cycle_id
    WHERE qs.template_id = (
      SELECT questionnaire_template_id FROM public.assessment_cycles WHERE id = p_cycle_id
    )
    GROUP BY qs.id, qs.name, qs.dimension_code
    ORDER BY qs.display_order
  ) sub;

  RETURN v_results;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_assessment_cycle_summary(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_assessment_group_results(
  p_cycle_id UUID,
  p_establishment_id UUID,
  p_department_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_cycle RECORD;
  v_results JSONB;
BEGIN
  SELECT ac.id, ac.tenant_id, ac.min_respondents_threshold
  INTO v_cycle
  FROM public.assessment_cycles ac
  WHERE ac.id = p_cycle_id AND ac.deleted_at IS NULL;

  IF v_cycle IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.tenant_id = v_cycle.tenant_id
      AND om.user_id = auth.uid()
      AND om.role IN ('owner', 'admin', 'manager', 'auditor')
      AND om.deleted_at IS NULL
  ) THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb), '[]'::jsonb)
  INTO v_results
  FROM (
    SELECT
      qs.id AS section_id,
      qs.name AS section_name,
      qs.dimension_code,
      count(DISTINCT ar.invitation_id) AS respondent_count,
      CASE
        WHEN count(DISTINCT ar.invitation_id) >= v_cycle.min_respondents_threshold
        THEN round(avg(ar.value)::numeric, 2)
        ELSE NULL
      END AS avg_score,
      CASE
        WHEN count(DISTINCT ar.invitation_id) >= v_cycle.min_respondents_threshold
        THEN min(ar.value)
        ELSE NULL
      END AS min_score,
      CASE
        WHEN count(DISTINCT ar.invitation_id) >= v_cycle.min_respondents_threshold
        THEN max(ar.value)
        ELSE NULL
      END AS max_score,
      CASE
        WHEN count(DISTINCT ar.invitation_id) >= v_cycle.min_respondents_threshold
        THEN round(stddev(ar.value)::numeric, 2)
        ELSE NULL
      END AS stddev_score,
      count(DISTINCT ar.invitation_id) < v_cycle.min_respondents_threshold AS below_threshold
    FROM public.questionnaire_sections qs
    JOIN public.questionnaire_items qi ON qi.section_id = qs.id
    LEFT JOIN public.assessment_responses ar ON ar.item_id = qi.id AND ar.cycle_id = p_cycle_id
    LEFT JOIN public.assessment_invitations ai ON ai.id = ar.invitation_id
    WHERE qs.template_id = (
      SELECT questionnaire_template_id FROM public.assessment_cycles WHERE id = p_cycle_id
    )
      AND (p_establishment_id IS NULL OR ai.establishment_id = p_establishment_id)
      AND (p_department_id IS NULL OR ai.department_id = p_department_id)
    GROUP BY qs.id, qs.name, qs.dimension_code
    ORDER BY qs.display_order
  ) sub;

  RETURN v_results;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_assessment_group_results(UUID, UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_assessment_participation_stats(
  p_cycle_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_cycle RECORD;
  v_results JSONB;
BEGIN
  SELECT ac.id, ac.tenant_id
  INTO v_cycle
  FROM public.assessment_cycles ac
  WHERE ac.id = p_cycle_id AND ac.deleted_at IS NULL;

  IF v_cycle IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.tenant_id = v_cycle.tenant_id
      AND om.user_id = auth.uid()
      AND om.role IN ('owner', 'admin', 'manager', 'auditor')
      AND om.deleted_at IS NULL
  ) THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb), '[]'::jsonb)
  INTO v_results
  FROM (
    SELECT
      e.id AS establishment_id,
      e.name AS establishment_name,
      d.id AS department_id,
      d.name AS department_name,
      count(ai.id) AS invited_count,
      count(ai.used_at) AS responded_count,
      CASE
        WHEN count(ai.id) > 0
        THEN round((count(ai.used_at)::numeric / count(ai.id)) * 100, 1)
        ELSE 0
      END AS participation_rate
    FROM public.assessment_invitations ai
    LEFT JOIN public.establishments e ON e.id = ai.establishment_id
    LEFT JOIN public.departments d ON d.id = ai.department_id
    WHERE ai.cycle_id = p_cycle_id
    GROUP BY e.id, e.name, d.id, d.name
    ORDER BY e.name, d.name
  ) sub;

  RETURN v_results;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_assessment_participation_stats(UUID) TO authenticated;
