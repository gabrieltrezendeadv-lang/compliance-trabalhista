-- Rollback seguro de PRIV-001.
-- Só é exato antes de receber novos convites sem plaintext ou respostas anônimas.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.assessment_invitations WHERE token IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.assessment_responses WHERE invitation_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'Rollback bloqueado: existem dados novos sem vínculo reversível. Restaure o backup.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_assessment_participation_stats(
  p_cycle_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_cycle record;
  v_results jsonb;
BEGIN
  SELECT ac.id, ac.tenant_id
  INTO v_cycle
  FROM public.assessment_cycles ac
  WHERE ac.id = p_cycle_id AND ac.deleted_at IS NULL;

  IF v_cycle IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_members om
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
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_assessment_participation_stats(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_assessment_participation_stats(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_import_risks_from_cycle(uuid)
  TO authenticated, service_role;

DROP POLICY IF EXISTS assessment_dispatches_update_admin
  ON public.assessment_dispatches;
DROP POLICY IF EXISTS assessment_dispatches_insert_admin
  ON public.assessment_dispatches;
DROP POLICY IF EXISTS assessment_dispatches_select_admin
  ON public.assessment_dispatches;
DROP TABLE IF EXISTS public.assessment_dispatches;

DROP INDEX IF EXISTS public.idx_assessment_responses_cycle_group;
DROP INDEX IF EXISTS public.idx_assessment_responses_batch_item;
DROP INDEX IF EXISTS public.idx_assessment_invitations_token_hash;

ALTER TABLE public.assessment_responses
  ALTER COLUMN invitation_id SET NOT NULL,
  DROP COLUMN department_id,
  DROP COLUMN establishment_id,
  DROP COLUMN submission_batch_id;

ALTER TABLE public.assessment_invitations
  ALTER COLUMN token SET NOT NULL,
  DROP COLUMN token_hash;

CREATE OR REPLACE FUNCTION public.fn_get_questionnaire_for_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_invitation record;
  v_cycle record;
  v_template record;
  v_sections jsonb;
BEGIN
  SELECT ai.id, ai.cycle_id, ai.used_at, ai.expires_at
  INTO v_invitation
  FROM public.assessment_invitations ai
  WHERE ai.token = p_token;

  IF v_invitation IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'token_not_found');
  END IF;

  IF v_invitation.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'already_submitted');
  END IF;

  IF v_invitation.expires_at IS NOT NULL
     AND v_invitation.expires_at < now() THEN
    RETURN jsonb_build_object('valid', false, 'error', 'token_expired');
  END IF;

  SELECT ac.id, ac.status, ac.questionnaire_template_id, ac.ends_at
  INTO v_cycle
  FROM public.assessment_cycles ac
  WHERE ac.id = v_invitation.cycle_id
    AND ac.deleted_at IS NULL;

  IF v_cycle IS NULL OR v_cycle.status <> 'active' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'cycle_not_active');
  END IF;

  IF v_cycle.ends_at < now() THEN
    RETURN jsonb_build_object('valid', false, 'error', 'cycle_ended');
  END IF;

  SELECT qt.name, qt.description, qt.response_scale
  INTO v_template
  FROM public.questionnaire_templates qt
  WHERE qt.id = v_cycle.questionnaire_template_id
    AND qt.deleted_at IS NULL;

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
          )
          ORDER BY i.display_order
        ), '[]'::jsonb)
        FROM public.questionnaire_items i
        WHERE i.section_id = s.id
      )
    )
    ORDER BY s.display_order
  ), '[]'::jsonb)
  INTO v_sections
  FROM public.questionnaire_sections s
  WHERE s.template_id = v_cycle.questionnaire_template_id;

  RETURN jsonb_build_object(
    'valid', true,
    'template', jsonb_build_object(
      'name', v_template.name,
      'description', v_template.description,
      'response_scale', v_template.response_scale
    ),
    'sections', v_sections
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_get_questionnaire_for_token(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_questionnaire_for_token(text)
  TO anon, authenticated, service_role;

-- Os demais corpos anteriores são restaurados pelos rollbacks de FIX-003 e
-- FIX-004, executados depois deste arquivo na ordem cronológica inversa.
