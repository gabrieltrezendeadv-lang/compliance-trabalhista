-- Rollback exato do FIX-004 para o corpo catalogado em 2026-07-28.

CREATE OR REPLACE FUNCTION public.fn_submit_assessment(p_token text, p_responses text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_invitation record;
  v_cycle record;
  v_response jsonb;
  v_item jsonb;
  v_count int := 0;
BEGIN
  SELECT ai.id, ai.cycle_id, ai.tenant_id, ai.used_at,
         ai.establishment_id, ai.department_id
  INTO v_invitation
  FROM public.assessment_invitations ai
  WHERE ai.token = p_token;
  IF v_invitation IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'token_not_found');
  END IF;
  IF v_invitation.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_submitted');
  END IF;
  SELECT ac.id, ac.status, ac.ends_at INTO v_cycle
  FROM public.assessment_cycles ac
  WHERE ac.id = v_invitation.cycle_id AND ac.deleted_at IS NULL;
  IF v_cycle IS NULL OR v_cycle.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'cycle_not_active');
  END IF;
  v_response := p_responses::jsonb;
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_response)
  LOOP
    INSERT INTO public.assessment_responses (
      invitation_id, cycle_id, tenant_id, item_id, value
    ) VALUES (
      v_invitation.id, v_invitation.cycle_id, v_invitation.tenant_id,
      (v_item->>'item_id')::uuid, (v_item->>'value')::int
    );
    v_count := v_count + 1;
  END LOOP;
  UPDATE public.assessment_invitations SET used_at = now()
  WHERE id = v_invitation.id;
  RETURN jsonb_build_object('success', true, 'items_recorded', v_count);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_submit_assessment(text, text)
  FROM PUBLIC, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_submit_assessment(text, text)
  TO anon, authenticated, service_role;
