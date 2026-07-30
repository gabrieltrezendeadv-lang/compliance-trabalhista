
-- ============================================================================
-- Fix: Infinite recursion in RLS policies for complaint_investigators
--
-- Problem: complaints_select_investigator → complaint_investigators (RLS) →
--          investigators_select → complaints (RLS) → complaints_select_investigator → ∞
--
-- Solution: SECURITY DEFINER helper function that checks complaint_investigators
--           without triggering RLS, breaking the cycle.
-- ============================================================================

-- Helper 1: Check if current user is an assigned investigator for a complaint
-- Used by: complaints, complaint_contents, complaint_messages policies
CREATE OR REPLACE FUNCTION public.fn_is_assigned_investigator(p_complaint_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.complaint_investigators
    WHERE complaint_id = p_complaint_id
      AND user_id = auth.uid()
      AND removed_at IS NULL
  );
$$;

-- Helper 2: Check if current user is admin/owner in the complaint's tenant
-- Used by: complaint_investigators policies
CREATE OR REPLACE FUNCTION public.fn_is_complaint_tenant_admin(p_complaint_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.complaints c
    JOIN public.organization_members om ON om.tenant_id = c.tenant_id
    WHERE c.id = p_complaint_id
      AND om.user_id = auth.uid()
      AND om.role IN ('owner', 'admin')
      AND om.deleted_at IS NULL
      AND c.deleted_at IS NULL
  );
$$;

-- ============================================================================
-- Recreate policies using the helper functions
-- ============================================================================

-- 1. complaints: investigator select (was querying complaint_investigators directly)
DROP POLICY IF EXISTS complaints_select_investigator ON public.complaints;
CREATE POLICY complaints_select_investigator ON public.complaints
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND public.fn_is_assigned_investigator(id));

-- 2. complaint_contents: investigator select
DROP POLICY IF EXISTS contents_select_investigator ON public.complaint_contents;
CREATE POLICY contents_select_investigator ON public.complaint_contents
  FOR SELECT TO authenticated
  USING (public.fn_is_assigned_investigator(complaint_id));

-- 3. complaint_messages: investigator select
DROP POLICY IF EXISTS messages_select_investigator ON public.complaint_messages;
CREATE POLICY messages_select_investigator ON public.complaint_messages
  FOR SELECT TO authenticated
  USING (public.fn_is_assigned_investigator(complaint_id));

-- 4. complaint_messages: investigator insert
DROP POLICY IF EXISTS messages_insert_investigator ON public.complaint_messages;
CREATE POLICY messages_insert_investigator ON public.complaint_messages
  FOR INSERT TO authenticated
  WITH CHECK (public.fn_is_assigned_investigator(complaint_id) AND sender_type = 'investigator');

-- 5. complaint_investigators: select (was querying complaints directly)
DROP POLICY IF EXISTS investigators_select ON public.complaint_investigators;
CREATE POLICY investigators_select ON public.complaint_investigators
  FOR SELECT TO authenticated
  USING (public.fn_is_complaint_tenant_admin(complaint_id) OR user_id = auth.uid());

-- 6. complaint_investigators: insert admin
DROP POLICY IF EXISTS investigators_insert_admin ON public.complaint_investigators;
CREATE POLICY investigators_insert_admin ON public.complaint_investigators
  FOR INSERT TO authenticated
  WITH CHECK (public.fn_is_complaint_tenant_admin(complaint_id));

-- 7. complaint_investigators: update admin
DROP POLICY IF EXISTS investigators_update_admin ON public.complaint_investigators;
CREATE POLICY investigators_update_admin ON public.complaint_investigators
  FOR UPDATE TO authenticated
  USING (public.fn_is_complaint_tenant_admin(complaint_id));
