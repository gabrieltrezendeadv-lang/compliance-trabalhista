-- Migration: onboarding_tenant_guard
-- Hardens fn_create_organization_with_owner with input validation and structured responses.
-- Creates fn_check_active_tenant() for lightweight guard checks.
-- Both use auth.uid() exclusively — never accept user_id from the client.

-- ============================================================
-- 1. Harden fn_create_organization_with_owner
--    DROP required: return type changes from uuid to jsonb
-- ============================================================
DROP FUNCTION IF EXISTS public.fn_create_organization_with_owner(text, text, text);

CREATE OR REPLACE FUNCTION public.fn_create_organization_with_owner(
  org_name text,
  org_slug text,
  org_cnpj text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id  uuid;
  v_org_id   uuid;
  v_slug     text;
  v_name     text;
  v_cnpj     text;
BEGIN
  -- Auth guard
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  -- Prevent duplicate: user already has active membership
  IF EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = v_user_id AND deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_HAS_ORGANIZATION');
  END IF;

  -- Validate name: 2-200 chars after trim
  v_name := btrim(COALESCE(org_name, ''));
  IF length(v_name) < 2 OR length(v_name) > 200 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_NAME');
  END IF;

  -- Validate slug: 3-63 chars, lowercase alphanumeric + hyphens, no leading/trailing hyphen
  v_slug := lower(btrim(COALESCE(org_slug, '')));
  IF v_slug !~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_SLUG');
  END IF;

  -- Check slug uniqueness
  IF EXISTS (
    SELECT 1 FROM public.organizations WHERE slug = v_slug
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'SLUG_TAKEN');
  END IF;

  -- Sanitize CNPJ: digits only, 14 chars, or NULL
  v_cnpj := regexp_replace(COALESCE(org_cnpj, ''), '[^0-9]', '', 'g');
  IF v_cnpj = '' THEN
    v_cnpj := NULL;
  ELSIF length(v_cnpj) <> 14 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_CNPJ');
  END IF;

  -- Create organization
  INSERT INTO public.organizations (name, slug, cnpj)
  VALUES (v_name, v_slug, v_cnpj)
  RETURNING id INTO v_org_id;

  -- Create owner membership
  INSERT INTO public.organization_members (tenant_id, user_id, role)
  VALUES (v_org_id, v_user_id, 'owner');

  RETURN jsonb_build_object(
    'success', true,
    'organization_id', v_org_id,
    'slug', v_slug
  );
END;
$function$;

-- ============================================================
-- 2. Create fn_check_active_tenant (lightweight guard)
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_check_active_tenant()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN
      jsonb_build_object('has_tenant', false, 'reason', 'NOT_AUTHENTICATED')
    WHEN EXISTS (
      SELECT 1 FROM public.organization_members
      WHERE user_id = auth.uid() AND deleted_at IS NULL
    ) THEN
      jsonb_build_object('has_tenant', true)
    ELSE
      jsonb_build_object('has_tenant', false, 'reason', 'NO_MEMBERSHIP')
  END;
$function$;

-- ============================================================
-- 3. Grants: deny-by-default, then explicit allow
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.fn_create_organization_with_owner(text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_create_organization_with_owner(text, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.fn_check_active_tenant() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_check_active_tenant() TO authenticated;

-- ============================================================
-- Verification queries (read-only)
-- ============================================================
-- SELECT has_function_privilege('authenticated', 'public.fn_create_organization_with_owner(text,text,text)', 'EXECUTE');
-- SELECT has_function_privilege('authenticated', 'public.fn_check_active_tenant()', 'EXECUTE');
-- SELECT has_function_privilege('anon', 'public.fn_create_organization_with_owner(text,text,text)', 'EXECUTE');
-- SELECT has_function_privilege('anon', 'public.fn_check_active_tenant()', 'EXECUTE');
-- SELECT has_function_privilege('PUBLIC', 'public.fn_create_organization_with_owner(text,text,text)', 'EXECUTE');
-- SELECT has_function_privilege('PUBLIC', 'public.fn_check_active_tenant()', 'EXECUTE');
