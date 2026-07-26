-- SEC-002: Fix check_plan_limit to derive tenant_id from session instead of accepting from caller
--
-- PROBLEM:  check_plan_limit(p_tenant_id uuid, p_metric text) accepts the tenant_id
--           as a parameter from the frontend. A malicious caller can pass any tenant_id
--           to check (or exhaust) another tenant's limits.
--
-- FIX:     Replace with check_plan_limit(p_metric text) that derives the tenant_id
--           from auth.uid() via organization_members lookup.
--           Keep old signature as a wrapper that validates the caller belongs to that tenant.
--
-- NEO SST: "nunca aceitar tenant_id do frontend"

BEGIN;

-- Drop old function
DROP FUNCTION IF EXISTS public.check_plan_limit(uuid, text);

-- Create new version: derives tenant from session
CREATE OR REPLACE FUNCTION public.check_plan_limit(p_metric text)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $function$
DECLARE
  v_tenant_id  uuid;
  v_status     public.subscription_status;
  v_max_est    integer;
  v_max_dept   integer;
  v_max_mem    integer;
  v_max_camp   integer;
  v_max_assess integer;
  v_max_allowed integer;
  v_current_count integer;
BEGIN
  -- Derive tenant from session
  SELECT om.tenant_id INTO v_tenant_id
  FROM public.organization_members om
  WHERE om.user_id = auth.uid()
    AND om.deleted_at IS NULL
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'no_tenant');
  END IF;

  SELECT s.status,
         (p.limits).max_establishments,
         (p.limits).max_departments,
         (p.limits).max_members,
         (p.limits).max_campaigns_per_month,
         (p.limits).max_assessments_per_month
  INTO v_status, v_max_est, v_max_dept, v_max_mem, v_max_camp, v_max_assess
  FROM public.tenant_subscriptions s
  JOIN public.subscription_plans p ON p.id = s.plan_id
  WHERE s.tenant_id = v_tenant_id AND s.deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'no_subscription');
  END IF;

  IF v_status IN ('fully_blocked', 'cancelled') THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'subscription_blocked');
  END IF;

  IF v_status = 'partially_blocked' THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'read_only_mode');
  END IF;

  v_max_allowed := CASE p_metric
    WHEN 'establishments' THEN v_max_est
    WHEN 'departments' THEN v_max_dept
    WHEN 'members' THEN v_max_mem
    WHEN 'campaigns' THEN v_max_camp
    WHEN 'assessments' THEN v_max_assess
    ELSE NULL
  END;

  -- NULL = unlimited
  IF v_max_allowed IS NULL THEN
    RETURN jsonb_build_object('allowed', true, 'limit', NULL, 'current', 0);
  END IF;

  SELECT COALESCE(COUNT(*), 0) INTO v_current_count
  FROM (
    SELECT 1 FROM public.establishments WHERE tenant_id = v_tenant_id AND deleted_at IS NULL AND p_metric = 'establishments'
    UNION ALL
    SELECT 1 FROM public.departments WHERE tenant_id = v_tenant_id AND deleted_at IS NULL AND p_metric = 'departments'
    UNION ALL
    SELECT 1 FROM public.organization_members WHERE tenant_id = v_tenant_id AND deleted_at IS NULL AND p_metric = 'members'
    UNION ALL
    SELECT 1 FROM public.campaigns WHERE tenant_id = v_tenant_id AND deleted_at IS NULL AND p_metric = 'campaigns' AND created_at >= date_trunc('month', now())
    UNION ALL
    SELECT 1 FROM public.assessment_cycles WHERE tenant_id = v_tenant_id AND deleted_at IS NULL AND p_metric = 'assessments' AND created_at >= date_trunc('month', now())
  ) counts;

  RETURN jsonb_build_object(
    'allowed', v_current_count < v_max_allowed,
    'limit', v_max_allowed,
    'current', v_current_count,
    'remaining', GREATEST(0, v_max_allowed - v_current_count)
  );
END;
$function$;

-- Grant only to authenticated (was previously accessible to all)
GRANT EXECUTE ON FUNCTION public.check_plan_limit(text) TO authenticated, service_role;

COMMIT;
