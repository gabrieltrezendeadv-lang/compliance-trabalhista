-- Function to create an organization and add the authenticated user as owner.
-- SECURITY DEFINER: bypasses RLS since the user has no membership yet.
-- Called during onboarding after signup.

CREATE OR REPLACE FUNCTION fn_create_organization_with_owner(
  org_name TEXT,
  org_slug TEXT,
  org_cnpj TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  new_org_id UUID;
  current_user_id UUID;
BEGIN
  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  -- Check if user already has an organization
  IF EXISTS (
    SELECT 1 FROM organization_members
    WHERE user_id = current_user_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'User already belongs to an organization';
  END IF;

  -- Check if slug is already taken
  IF EXISTS (
    SELECT 1 FROM organizations
    WHERE slug = org_slug AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Slug already in use';
  END IF;

  -- Create the organization
  INSERT INTO organizations (name, slug, cnpj)
  VALUES (org_name, org_slug, org_cnpj)
  RETURNING id INTO new_org_id;

  -- Add the user as owner
  INSERT INTO organization_members (tenant_id, user_id, role)
  VALUES (new_org_id, current_user_id, 'owner');

  RETURN new_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;
