-- PRIV-001 — Hash de tokens e separação entre convite e respostas futuras.
-- Estado anterior:
--   assessment_invitations.token contém o token em texto;
--   assessment_responses.invitation_id é obrigatório.
-- Estado posterior:
--   novos convites armazenam apenas token_hash;
--   novas respostas usam submission_batch_id e metadados de grupo, sem
--   invitation_id; o vínculo de entrega fica fora das respostas.
-- Compatibilidade:
--   tokens e vínculos antigos são mantidos até DATA-001; as funções aceitam
--   token_hash e fallback legado durante a transição.
-- Dependências: pgcrypto em extensions, FIX-004, FIX-003.
-- PROPOSTA: não executada automaticamente.

ALTER TABLE public.assessment_invitations
  ADD COLUMN IF NOT EXISTS token_hash text;

UPDATE public.assessment_invitations
SET token_hash = encode(
  extensions.digest(convert_to(token, 'UTF8'), 'sha256'),
  'hex'
)
WHERE token_hash IS NULL AND token IS NOT NULL;

ALTER TABLE public.assessment_invitations
  ALTER COLUMN token DROP NOT NULL,
  ALTER COLUMN token_hash SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS
  idx_assessment_invitations_token_hash
  ON public.assessment_invitations(token_hash);

ALTER TABLE public.assessment_responses
  ADD COLUMN IF NOT EXISTS submission_batch_id uuid,
  ADD COLUMN IF NOT EXISTS establishment_id uuid
    REFERENCES public.establishments(id),
  ADD COLUMN IF NOT EXISTS department_id uuid
    REFERENCES public.departments(id);

WITH batches AS (
  SELECT invitation_id, gen_random_uuid() AS batch_id
  FROM public.assessment_responses
  WHERE submission_batch_id IS NULL
  GROUP BY invitation_id
)
UPDATE public.assessment_responses ar
SET
  submission_batch_id = b.batch_id,
  establishment_id = ai.establishment_id,
  department_id = ai.department_id
FROM batches b
JOIN public.assessment_invitations ai ON ai.id = b.invitation_id
WHERE ar.invitation_id = b.invitation_id;

ALTER TABLE public.assessment_responses
  ALTER COLUMN submission_batch_id SET NOT NULL,
  ALTER COLUMN invitation_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS
  idx_assessment_responses_batch_item
  ON public.assessment_responses(submission_batch_id, item_id);

CREATE INDEX IF NOT EXISTS
  idx_assessment_responses_cycle_group
  ON public.assessment_responses(cycle_id, establishment_id, department_id);

CREATE TABLE IF NOT EXISTS public.assessment_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id),
  cycle_id uuid NOT NULL REFERENCES public.assessment_cycles(id),
  employee_id uuid NOT NULL REFERENCES public.employee_profiles(id),
  establishment_id uuid REFERENCES public.establishments(id),
  department_id uuid REFERENCES public.departments(id),
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  status text NOT NULL CHECK (status IN ('sent', 'failed')),
  provider_id text,
  error_code text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, employee_id)
);

ALTER TABLE public.assessment_dispatches ENABLE ROW LEVEL SECURITY;

CREATE POLICY assessment_dispatches_select_admin
  ON public.assessment_dispatches
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.fn_resolve_tenant_id()
    AND public.fn_user_has_role(ARRAY[
      'owner'::public.organization_role,
      'admin'::public.organization_role,
      'manager'::public.organization_role
    ])
  );

CREATE POLICY assessment_dispatches_insert_admin
  ON public.assessment_dispatches
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = public.fn_resolve_tenant_id()
    AND public.fn_user_has_role(ARRAY[
      'owner'::public.organization_role,
      'admin'::public.organization_role,
      'manager'::public.organization_role
    ])
  );

CREATE POLICY assessment_dispatches_update_admin
  ON public.assessment_dispatches
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id = public.fn_resolve_tenant_id()
    AND public.fn_user_has_role(ARRAY[
      'owner'::public.organization_role,
      'admin'::public.organization_role,
      'manager'::public.organization_role
    ])
  )
  WITH CHECK (
    tenant_id = public.fn_resolve_tenant_id()
    AND public.fn_user_has_role(ARRAY[
      'owner'::public.organization_role,
      'admin'::public.organization_role,
      'manager'::public.organization_role
    ])
  );

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
  v_token_hash text;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN
    RETURN jsonb_build_object('valid', false, 'error', 'invalid_or_expired');
  END IF;

  v_token_hash := encode(
    extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'),
    'hex'
  );

  SELECT ai.id, ai.cycle_id, ai.used_at, ai.expires_at
  INTO v_invitation
  FROM public.assessment_invitations ai
  WHERE ai.token_hash = v_token_hash
     OR (ai.token_hash IS NULL AND ai.token = p_token)
  LIMIT 1;

  IF v_invitation IS NULL
    OR v_invitation.used_at IS NOT NULL
    OR (v_invitation.expires_at IS NOT NULL AND v_invitation.expires_at <= now()) THEN
    RETURN jsonb_build_object('valid', false, 'error', 'invalid_or_expired');
  END IF;

  SELECT ac.id, ac.status, ac.questionnaire_template_id, ac.ends_at
  INTO v_cycle
  FROM public.assessment_cycles ac
  WHERE ac.id = v_invitation.cycle_id AND ac.deleted_at IS NULL;

  IF v_cycle IS NULL OR v_cycle.status <> 'active' OR v_cycle.ends_at <= now() THEN
    RETURN jsonb_build_object('valid', false, 'error', 'invalid_or_expired');
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

CREATE OR REPLACE FUNCTION public.fn_submit_assessment(
  p_token text,
  p_responses text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_invitation record;
  v_cycle record;
  v_response jsonb;
  v_batch_id uuid := gen_random_uuid();
  v_token_hash text;
  v_count int;
  v_required_count int;
  v_submitted_required_count int;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 OR p_responses IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_request');
  END IF;

  v_token_hash := encode(
    extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'),
    'hex'
  );

  SELECT ai.id, ai.cycle_id, ai.tenant_id, ai.used_at, ai.expires_at,
         ai.establishment_id, ai.department_id
  INTO v_invitation
  FROM public.assessment_invitations ai
  WHERE ai.token_hash = v_token_hash
     OR (ai.token_hash IS NULL AND ai.token = p_token)
  LIMIT 1
  FOR UPDATE;

  IF v_invitation IS NULL
    OR v_invitation.used_at IS NOT NULL
    OR (v_invitation.expires_at IS NOT NULL AND v_invitation.expires_at <= now()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_or_expired');
  END IF;

  SELECT ac.id, ac.status, ac.ends_at, ac.questionnaire_template_id
  INTO v_cycle
  FROM public.assessment_cycles ac
  WHERE ac.id = v_invitation.cycle_id AND ac.deleted_at IS NULL;

  IF v_cycle IS NULL OR v_cycle.status <> 'active' OR v_cycle.ends_at <= now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'cycle_not_active');
  END IF;

  BEGIN
    v_response := p_responses::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_payload');
  END;

  IF jsonb_typeof(v_response) <> 'array' OR jsonb_array_length(v_response) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_payload');
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_response) x
    WHERE jsonb_typeof(x) <> 'object'
      OR NOT (x ? 'item_id')
      OR NOT (x ? 'value')
      OR jsonb_typeof(x->'item_id') <> 'string'
      OR jsonb_typeof(x->'value') <> 'number'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_payload');
  END IF;

  BEGIN
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_response) x
      WHERE (x->>'value')::int < 1 OR (x->>'value')::int > 5
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'value_out_of_range');
    END IF;

    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_response) x
      LEFT JOIN public.questionnaire_items qi ON qi.id = (x->>'item_id')::uuid
      LEFT JOIN public.questionnaire_sections qs ON qs.id = qi.section_id
      WHERE qi.id IS NULL OR qs.template_id <> v_cycle.questionnaire_template_id
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'unknown_item');
    END IF;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_payload');
  END;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_response) x
    GROUP BY x->>'item_id' HAVING count(*) > 1
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'duplicate_item');
  END IF;

  SELECT count(*) INTO v_required_count
  FROM public.questionnaire_items qi
  JOIN public.questionnaire_sections qs ON qs.id = qi.section_id
  WHERE qs.template_id = v_cycle.questionnaire_template_id
    AND qi.required IS TRUE;

  SELECT count(*) INTO v_submitted_required_count
  FROM jsonb_array_elements(v_response) x
  JOIN public.questionnaire_items qi ON qi.id = (x->>'item_id')::uuid
  WHERE qi.required IS TRUE;

  IF v_submitted_required_count <> v_required_count THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_required_items');
  END IF;

  INSERT INTO public.assessment_responses (
    invitation_id, submission_batch_id, cycle_id, tenant_id,
    establishment_id, department_id, item_id, value
  )
  SELECT
    NULL, v_batch_id, v_invitation.cycle_id, v_invitation.tenant_id,
    v_invitation.establishment_id, v_invitation.department_id,
    (x->>'item_id')::uuid, (x->>'value')::int
  FROM jsonb_array_elements(v_response) x;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.assessment_invitations
  SET used_at = now()
  WHERE id = v_invitation.id AND used_at IS NULL;

  RETURN jsonb_build_object('success', true, 'items_recorded', v_count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_assessment_group_results(
  p_cycle_id uuid,
  p_establishment_id uuid,
  p_department_id uuid DEFAULT NULL::uuid
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
  SELECT ac.id, ac.tenant_id, ac.questionnaire_template_id,
         ac.min_respondents_threshold
  INTO v_cycle
  FROM public.assessment_cycles ac
  WHERE ac.id = p_cycle_id AND ac.deleted_at IS NULL;

  IF v_cycle IS NULL OR (
    auth.role() IS DISTINCT FROM 'service_role'
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.tenant_id = v_cycle.tenant_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin', 'manager', 'auditor')
        AND om.deleted_at IS NULL
    )
  ) THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.display_order), '[]'::jsonb)
  INTO v_results
  FROM (
    SELECT
      qs.id AS section_id,
      qs.name AS section_name,
      qs.dimension_code,
      qs.display_order,
      count(DISTINCT ar.submission_batch_id) AS respondent_count,
      CASE WHEN count(DISTINCT ar.submission_batch_id) >= v_cycle.min_respondents_threshold
        THEN round(avg(CASE WHEN qi.reverse_scored THEN 6 - ar.value ELSE ar.value END)::numeric, 2)
      END AS avg_score,
      CASE WHEN count(DISTINCT ar.submission_batch_id) >= v_cycle.min_respondents_threshold
        THEN min(CASE WHEN qi.reverse_scored THEN 6 - ar.value ELSE ar.value END)
      END AS min_score,
      CASE WHEN count(DISTINCT ar.submission_batch_id) >= v_cycle.min_respondents_threshold
        THEN max(CASE WHEN qi.reverse_scored THEN 6 - ar.value ELSE ar.value END)
      END AS max_score,
      CASE WHEN count(DISTINCT ar.submission_batch_id) >= v_cycle.min_respondents_threshold
        THEN round(stddev(CASE WHEN qi.reverse_scored THEN 6 - ar.value ELSE ar.value END)::numeric, 2)
      END AS stddev_score,
      count(DISTINCT ar.submission_batch_id) < v_cycle.min_respondents_threshold AS below_threshold
    FROM public.questionnaire_sections qs
    JOIN public.questionnaire_items qi ON qi.section_id = qs.id
    LEFT JOIN public.assessment_responses ar
      ON ar.item_id = qi.id
      AND ar.cycle_id = p_cycle_id
      AND ar.establishment_id = p_establishment_id
      AND (p_department_id IS NULL OR ar.department_id = p_department_id)
    WHERE qs.template_id = v_cycle.questionnaire_template_id
    GROUP BY qs.id, qs.name, qs.dimension_code, qs.display_order
  ) s;
  RETURN v_results;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_assessment_cycle_summary(p_cycle_id uuid)
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
  SELECT ac.id, ac.tenant_id, ac.questionnaire_template_id,
         ac.min_respondents_threshold
  INTO v_cycle
  FROM public.assessment_cycles ac
  WHERE ac.id = p_cycle_id AND ac.deleted_at IS NULL;

  IF v_cycle IS NULL OR (
    auth.role() IS DISTINCT FROM 'service_role'
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.tenant_id = v_cycle.tenant_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin', 'manager', 'auditor')
        AND om.deleted_at IS NULL
    )
  ) THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.display_order), '[]'::jsonb)
  INTO v_results
  FROM (
    SELECT
      qs.id AS section_id,
      qs.name AS section_name,
      qs.dimension_code,
      qs.display_order,
      count(DISTINCT ar.submission_batch_id) AS respondent_count,
      CASE WHEN count(DISTINCT ar.submission_batch_id) >= v_cycle.min_respondents_threshold
        THEN round(avg(CASE WHEN qi.reverse_scored THEN 6 - ar.value ELSE ar.value END)::numeric, 2)
      END AS avg_score,
      CASE WHEN count(DISTINCT ar.submission_batch_id) >= v_cycle.min_respondents_threshold
        THEN min(CASE WHEN qi.reverse_scored THEN 6 - ar.value ELSE ar.value END)
      END AS min_score,
      CASE WHEN count(DISTINCT ar.submission_batch_id) >= v_cycle.min_respondents_threshold
        THEN max(CASE WHEN qi.reverse_scored THEN 6 - ar.value ELSE ar.value END)
      END AS max_score,
      CASE WHEN count(DISTINCT ar.submission_batch_id) >= v_cycle.min_respondents_threshold
        THEN round(stddev(CASE WHEN qi.reverse_scored THEN 6 - ar.value ELSE ar.value END)::numeric, 2)
      END AS stddev_score,
      count(DISTINCT ar.submission_batch_id) < v_cycle.min_respondents_threshold AS below_threshold
    FROM public.questionnaire_sections qs
    JOIN public.questionnaire_items qi ON qi.section_id = qs.id
    LEFT JOIN public.assessment_responses ar
      ON ar.item_id = qi.id AND ar.cycle_id = p_cycle_id
    WHERE qs.template_id = v_cycle.questionnaire_template_id
    GROUP BY qs.id, qs.name, qs.dimension_code, qs.display_order
  ) s;
  RETURN v_results;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_import_risks_from_cycle(p_cycle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_cycle record;
  v_dim record;
  v_risk_level public.risk_level;
  v_risk_id uuid;
  v_count int := 0;
  v_skipped int := 0;
BEGIN
  SELECT ac.id, ac.tenant_id, ac.name, ac.status, ac.min_respondents_threshold
  INTO v_cycle
  FROM public.assessment_cycles ac
  WHERE ac.id = p_cycle_id AND ac.deleted_at IS NULL;

  IF v_user_id IS NULL OR v_cycle IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.tenant_id = v_cycle.tenant_id
      AND om.user_id = v_user_id
      AND om.role IN ('owner', 'admin', 'manager')
      AND om.deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'permission_denied');
  END IF;

  FOR v_dim IN
    SELECT
      qs.id AS section_id,
      qs.name AS section_name,
      count(DISTINCT ar.submission_batch_id) AS respondent_count,
      avg(CASE WHEN qi.reverse_scored THEN 6 - ar.value ELSE ar.value END) AS avg_score
    FROM public.assessment_responses ar
    JOIN public.questionnaire_items qi ON qi.id = ar.item_id
    JOIN public.questionnaire_sections qs ON qs.id = qi.section_id
    WHERE ar.cycle_id = p_cycle_id AND ar.tenant_id = v_cycle.tenant_id
    GROUP BY qs.id, qs.name
  LOOP
    IF v_dim.respondent_count < v_cycle.min_respondents_threshold
      OR v_dim.avg_score IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF v_dim.avg_score <= 2 THEN v_risk_level := 'low';
    ELSIF v_dim.avg_score <= 3 THEN v_risk_level := 'moderate';
    ELSIF v_dim.avg_score <= 4 THEN v_risk_level := 'high';
    ELSE v_risk_level := 'critical';
    END IF;

    IF v_risk_level NOT IN ('high', 'critical') OR EXISTS (
      SELECT 1 FROM public.risk_items ri
      WHERE ri.cycle_id = p_cycle_id
        AND ri.section_id = v_dim.section_id
        AND ri.tenant_id = v_cycle.tenant_id
        AND ri.deleted_at IS NULL
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.risk_items (
      tenant_id, cycle_id, section_id, source, category, title, description,
      initial_risk_level, initial_score, status, priority, identified_by
    ) VALUES (
      v_cycle.tenant_id, p_cycle_id, v_dim.section_id, 'assessment',
      'psychosocial', 'Risco psicossocial: ' || v_dim.section_name,
      'Risco identificado a partir do ciclo "' || v_cycle.name ||
        '". Pontuação agregada: ' || round(v_dim.avg_score, 2) || '/5.',
      v_risk_level, round(v_dim.avg_score, 2), 'identified',
      CASE WHEN v_risk_level = 'critical' THEN 'urgent' ELSE 'high' END,
      v_user_id
    )
    RETURNING id INTO v_risk_id;

    INSERT INTO public.risk_audit_log (
      risk_item_id, actor_id, action, details
    ) VALUES (
      v_risk_id, v_user_id, 'imported_from_assessment',
      jsonb_build_object(
        'cycle_id', p_cycle_id,
        'section_name', v_dim.section_name,
        'avg_score', round(v_dim.avg_score, 2),
        'risk_level', v_risk_level::text,
        'anonymous_batches', true
      )
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'imported', v_count,
    'skipped', v_skipped,
    'cycle_name', v_cycle.name
  );
END;
$function$;

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
  v_tenant_id uuid;
  v_threshold integer;
  v_result jsonb;
BEGIN
  SELECT ac.tenant_id, ac.min_respondents_threshold
  INTO v_tenant_id, v_threshold
  FROM public.assessment_cycles ac
  WHERE ac.id = p_cycle_id
    AND ac.deleted_at IS NULL
    AND (
      auth.role() = 'service_role'
      OR EXISTS (
        SELECT 1
        FROM public.organization_members om
        WHERE om.tenant_id = ac.tenant_id
          AND om.user_id = auth.uid()
          AND om.deleted_at IS NULL
      )
    );

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'cycle_not_found_or_forbidden';
  END IF;

  WITH invitation_groups AS (
    SELECT
      ad.establishment_id,
      e.name AS establishment_name,
      ad.department_id,
      d.name AS department_name,
      count(ad.id)::integer AS invited_count
    FROM public.assessment_dispatches ad
    LEFT JOIN public.establishments e
      ON e.id = ad.establishment_id
    LEFT JOIN public.departments d
      ON d.id = ad.department_id
    WHERE ad.cycle_id = p_cycle_id
      AND ad.tenant_id = v_tenant_id
      AND ad.status = 'sent'
    GROUP BY
      ad.establishment_id,
      e.name,
      ad.department_id,
      d.name
  ),
  response_groups AS (
    SELECT
      ar.establishment_id,
      ar.department_id,
      count(DISTINCT ar.submission_batch_id)::integer AS responded_count
    FROM public.assessment_responses ar
    WHERE ar.cycle_id = p_cycle_id
      AND ar.tenant_id = v_tenant_id
    GROUP BY ar.establishment_id, ar.department_id
  ),
  raw_groups AS (
    SELECT
      ig.establishment_id,
      ig.establishment_name,
      ig.department_id,
      ig.department_name,
      ig.invited_count,
      COALESCE(rg.responded_count, 0)::integer AS responded_count
    FROM invitation_groups ig
    LEFT JOIN response_groups rg
      ON rg.establishment_id IS NOT DISTINCT FROM ig.establishment_id
     AND rg.department_id IS NOT DISTINCT FROM ig.department_id
  ),
  protected_groups AS (
    SELECT jsonb_build_object(
      'scope', 'group',
      'establishment_id', rg.establishment_id,
      'establishment_name', rg.establishment_name,
      'department_id', rg.department_id,
      'department_name', rg.department_name,
      'invited_count',
        CASE WHEN rg.responded_count >= v_threshold
          THEN rg.invited_count ELSE NULL END,
      'responded_count',
        CASE WHEN rg.responded_count >= v_threshold
          THEN rg.responded_count ELSE NULL END,
      'participation_rate',
        CASE WHEN rg.responded_count >= v_threshold
          THEN round(
            100.0 * rg.responded_count / NULLIF(rg.invited_count, 0),
            1
          )
          ELSE NULL
        END,
      'below_threshold', rg.responded_count < v_threshold
    ) AS item
    FROM raw_groups rg
  ),
  overall_counts AS (
    SELECT
      COALESCE((
        SELECT count(ad.id)
        FROM public.assessment_dispatches ad
        WHERE ad.cycle_id = p_cycle_id
          AND ad.tenant_id = v_tenant_id
          AND ad.status = 'sent'
      ), 0)::integer AS invited_count,
      COALESCE((
        SELECT count(DISTINCT ar.submission_batch_id)
        FROM public.assessment_responses ar
        WHERE ar.cycle_id = p_cycle_id
          AND ar.tenant_id = v_tenant_id
      ), 0)::integer AS responded_count
  ),
  all_items AS (
    SELECT 0 AS sort_order, jsonb_build_object(
      'scope', 'overall',
      'establishment_id', NULL,
      'establishment_name', NULL,
      'department_id', NULL,
      'department_name', NULL,
      'invited_count',
        CASE WHEN oc.responded_count >= v_threshold
          THEN oc.invited_count ELSE NULL END,
      'responded_count',
        CASE WHEN oc.responded_count >= v_threshold
          THEN oc.responded_count ELSE NULL END,
      'participation_rate',
        CASE WHEN oc.responded_count >= v_threshold
          THEN round(
            100.0 * oc.responded_count / NULLIF(oc.invited_count, 0),
            1
          )
          ELSE NULL
        END,
      'below_threshold', oc.responded_count < v_threshold
    ) AS item
    FROM overall_counts oc
    UNION ALL
    SELECT 1 AS sort_order, pg.item
    FROM protected_groups pg
  )
  SELECT COALESCE(jsonb_agg(ai.item ORDER BY ai.sort_order), '[]'::jsonb)
  INTO v_result
  FROM all_items ai;

  RETURN v_result;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_get_questionnaire_for_token(text)
  FROM PUBLIC, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fn_submit_assessment(text, text)
  FROM PUBLIC, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fn_assessment_group_results(uuid, uuid, uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_assessment_cycle_summary(uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_import_risks_from_cycle(uuid)
  FROM PUBLIC, anon, service_role;
REVOKE EXECUTE ON FUNCTION public.fn_assessment_participation_stats(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_get_questionnaire_for_token(text) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_submit_assessment(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_assessment_group_results(uuid, uuid, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_assessment_cycle_summary(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_import_risks_from_cycle(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_assessment_participation_stats(uuid)
  TO authenticated, service_role;

REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.assessment_dispatches FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.assessment_dispatches
  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.assessment_dispatches TO service_role;

-- Verificação pós-migration:
SELECT
  count(*) FILTER (WHERE token_hash IS NULL) AS missing_hashes,
  count(*) FILTER (WHERE token IS NOT NULL) AS legacy_plaintext_tokens
FROM public.assessment_invitations;

SELECT
  count(*) FILTER (WHERE submission_batch_id IS NULL) AS missing_batches,
  count(*) FILTER (WHERE invitation_id IS NULL) AS anonymous_answer_rows
FROM public.assessment_responses;

-- Testes positivos: token legado e token somente-hash carregam o questionário;
-- nova resposta grava invitation_id NULL e um batch comum para todos os itens.
-- Testes negativos: token inválido, reuso, grupo cross-tenant e SELECT público.
