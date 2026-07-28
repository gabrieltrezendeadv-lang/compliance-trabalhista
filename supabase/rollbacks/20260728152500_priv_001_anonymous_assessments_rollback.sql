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

-- Os corpos anteriores das funções são restaurados pelos rollbacks de
-- FIX-003 e FIX-004, nesta ordem:
-- 20260728151000_fix_003_reverse_scoring_rollback.sql
-- 20260728152000_fix_004_assessment_submission_rollback.sql
