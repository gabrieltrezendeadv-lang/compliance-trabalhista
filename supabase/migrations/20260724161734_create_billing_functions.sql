
-- ============================================================================
-- check_plan_limit — usa jsonb para extrair limites em vez de composite type
-- ============================================================================
CREATE OR REPLACE FUNCTION public.check_plan_limit(p_tenant_id uuid, p_metric text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status public.subscription_status;
  v_max_est integer;
  v_max_dept integer;
  v_max_mem integer;
  v_max_camp integer;
  v_max_assess integer;
  v_max_allowed integer;
  v_current_count integer;
BEGIN
  SELECT s.status,
         (p.limits).max_establishments,
         (p.limits).max_departments,
         (p.limits).max_members,
         (p.limits).max_campaigns_per_month,
         (p.limits).max_assessments_per_month
  INTO v_status, v_max_est, v_max_dept, v_max_mem, v_max_camp, v_max_assess
  FROM public.tenant_subscriptions s
  JOIN public.subscription_plans p ON p.id = s.plan_id
  WHERE s.tenant_id = p_tenant_id AND s.deleted_at IS NULL;

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

  -- NULL = ilimitado
  IF v_max_allowed IS NULL THEN
    RETURN jsonb_build_object('allowed', true, 'limit', NULL, 'current', 0);
  END IF;

  SELECT COALESCE(COUNT(*), 0) INTO v_current_count
  FROM (
    SELECT 1 FROM public.establishments WHERE tenant_id = p_tenant_id AND deleted_at IS NULL AND p_metric = 'establishments'
    UNION ALL
    SELECT 1 FROM public.departments WHERE tenant_id = p_tenant_id AND deleted_at IS NULL AND p_metric = 'departments'
    UNION ALL
    SELECT 1 FROM public.organization_members WHERE tenant_id = p_tenant_id AND deleted_at IS NULL AND p_metric = 'members'
    UNION ALL
    SELECT 1 FROM public.campaigns WHERE tenant_id = p_tenant_id AND deleted_at IS NULL AND p_metric = 'campaigns' AND created_at >= date_trunc('month', now())
    UNION ALL
    SELECT 1 FROM public.assessment_cycles WHERE tenant_id = p_tenant_id AND deleted_at IS NULL AND p_metric = 'assessments' AND created_at >= date_trunc('month', now())
  ) counts;

  RETURN jsonb_build_object(
    'allowed', v_current_count < v_max_allowed,
    'limit', v_max_allowed,
    'current', v_current_count,
    'remaining', GREATEST(0, v_max_allowed - v_current_count)
  );
END;
$$;

-- ============================================================================
-- transition_subscription_status — máquina de estados ADR-005
-- ============================================================================
CREATE OR REPLACE FUNCTION public.transition_subscription_status(
  p_subscription_id uuid,
  p_new_status public.subscription_status,
  p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current_status public.subscription_status;
  v_tenant_id uuid;
  v_valid boolean := false;
BEGIN
  SELECT status, tenant_id
  INTO v_current_status, v_tenant_id
  FROM public.tenant_subscriptions
  WHERE id = p_subscription_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_valid := CASE v_current_status
    WHEN 'trialing' THEN p_new_status IN ('active', 'cancelled')
    WHEN 'active' THEN p_new_status IN ('past_due', 'cancelled')
    WHEN 'past_due' THEN p_new_status IN ('active', 'grace_period', 'cancelled')
    WHEN 'grace_period' THEN p_new_status IN ('active', 'partially_blocked', 'cancelled')
    WHEN 'partially_blocked' THEN p_new_status IN ('active', 'fully_blocked', 'cancelled')
    WHEN 'fully_blocked' THEN p_new_status IN ('active', 'cancelled')
    WHEN 'cancelled' THEN p_new_status IN ('active')
    ELSE false
  END;

  IF NOT v_valid THEN
    RETURN false;
  END IF;

  UPDATE public.tenant_subscriptions
  SET status = p_new_status,
      cancelled_at = CASE WHEN p_new_status = 'cancelled' THEN now() ELSE cancelled_at END,
      grace_period_ends_at = CASE
        WHEN p_new_status = 'grace_period' THEN now() + interval '7 days'
        WHEN p_new_status = 'active' THEN NULL
        ELSE grace_period_ends_at
      END,
      block_escalation_at = CASE
        WHEN p_new_status = 'partially_blocked' THEN now() + interval '15 days'
        WHEN p_new_status = 'active' THEN NULL
        ELSE block_escalation_at
      END
  WHERE id = p_subscription_id;

  INSERT INTO public.billing_events (tenant_id, subscription_id, event_type, description, metadata)
  VALUES (
    v_tenant_id, p_subscription_id, 'status_changed',
    COALESCE(p_reason, v_current_status::text || ' -> ' || p_new_status::text),
    jsonb_build_object('from', v_current_status, 'to', p_new_status)
  );

  RETURN true;
END;
$$;
