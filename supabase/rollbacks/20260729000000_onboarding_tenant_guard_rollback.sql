-- Rollback: onboarding_tenant_guard
-- Restores fn_create_organization_with_owner to its pre-migration state.
-- Drops fn_check_active_tenant.

-- ============================================================
-- 1. Restore original fn_create_organization_with_owner
--    DROP required: return type changes back from jsonb to uuid
-- ============================================================
DROP FUNCTION IF EXISTS public.fn_create_organization_with_owner(text, text, text);

CREATE OR REPLACE FUNCTION public.fn_create_organization_with_owner(
  org_name text,
  org_slug text,
  org_cnpj text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  new_org_id UUID;
  current_user_id UUID;
BEGIN
  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  IF EXISTS (
    SELECT 1 FROM organization_members
    WHERE user_id = current_user_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'User already belongs to an organization';
  END IF;

  IF EXISTS (
    SELECT 1 FROM organizations
    WHERE slug = org_slug AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Slug already in use';
  END IF;

  INSERT INTO organizations (name, slug, cnpj)
  VALUES (org_name, org_slug, org_cnpj)
  RETURNING id INTO new_org_id;

  INSERT INTO organization_members (tenant_id, user_id, role)
  VALUES (new_org_id, current_user_id, 'owner');

  RETURN new_org_id;
END;
$function$;

-- ============================================================
-- 2. Restore original grants
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.fn_create_organization_with_owner(text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_create_organization_with_owner(text, text, text) TO authenticated, service_role;

-- ============================================================
-- 3. Drop fn_check_active_tenant
-- ============================================================
DROP FUNCTION IF EXISTS public.fn_check_active_tenant();
