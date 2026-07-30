BEGIN;

CREATE TABLE IF NOT EXISTS public.organization_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.organizations(id),
  actor_id    uuid,
  action      text NOT NULL,
  target_type text,
  target_id   uuid,
  details     jsonb DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_audit_log_tenant
  ON public.organization_audit_log (tenant_id, created_at DESC);

ALTER TABLE public.organization_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_audit_log_select_admin ON public.organization_audit_log;
CREATE POLICY org_audit_log_select_admin ON public.organization_audit_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.tenant_id = organization_audit_log.tenant_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
        AND om.deleted_at IS NULL
    )
  );

CREATE OR REPLACE FUNCTION public.fn_remove_member(
  p_member_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $function$
DECLARE
  v_caller_id      uuid;
  v_caller_role    text;
  v_caller_tenant  uuid;
  v_target         record;
  v_owner_count    integer;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'unauthenticated');
  END IF;

  SELECT om.tenant_id, om.role::text
  INTO v_caller_tenant, v_caller_role
  FROM public.organization_members om
  WHERE om.user_id = v_caller_id
    AND om.deleted_at IS NULL
  LIMIT 1;

  IF v_caller_tenant IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'no_tenant');
  END IF;

  SELECT om.id, om.user_id, om.tenant_id, om.role::text AS role, om.deleted_at
  INTO v_target
  FROM public.organization_members om
  WHERE om.id = p_member_id
  FOR UPDATE;

  IF v_target IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'member_not_found');
  END IF;

  IF v_target.tenant_id != v_caller_tenant THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'member_not_found');
  END IF;

  IF v_target.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'already_removed');
  END IF;

  IF v_target.user_id = v_caller_id THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'cannot_remove_self');
  END IF;

  IF v_caller_role = 'owner' THEN
    NULL;
  ELSIF v_caller_role = 'admin' THEN
    IF v_target.role IN ('owner', 'admin') THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'insufficient_privileges');
    END IF;
  ELSE
    RETURN jsonb_build_object('success', FALSE, 'error', 'forbidden');
  END IF;

  IF v_target.role = 'owner' THEN
    SELECT count(*) INTO v_owner_count
    FROM public.organization_members om
    WHERE om.tenant_id = v_caller_tenant
      AND om.role = 'owner'
      AND om.deleted_at IS NULL;

    IF v_owner_count <= 1 THEN
      RETURN jsonb_build_object('success', FALSE, 'error', 'last_owner_cannot_be_removed');
    END IF;
  END IF;

  UPDATE public.organization_members
  SET deleted_at = now(),
      updated_at = now()
  WHERE id = p_member_id;

  INSERT INTO public.organization_audit_log (
    tenant_id, actor_id, action, target_type, target_id, details
  ) VALUES (
    v_caller_tenant,
    v_caller_id,
    'member_removed',
    'member',
    p_member_id,
    jsonb_build_object(
      'removed_user_id', v_target.user_id,
      'removed_role', v_target.role
    )
  );

  RETURN jsonb_build_object('success', TRUE);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_remove_member(uuid)
  TO authenticated, service_role;

COMMIT;
