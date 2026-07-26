-- SEC-001: Revoke PUBLIC EXECUTE on all functions, fix default privileges, re-grant by allowlist
--
-- PROBLEM:  Every function in public schema has EXECUTE granted to PUBLIC (all roles
--           including unauthenticated), anon, and authenticated via default privileges
--           set by both postgres and supabase_admin roles.
--           This means any caller—even unauthenticated—can invoke any SECURITY DEFINER
--           function, bypassing RLS and executing with postgres privileges.
--
-- FIX:     1. Revoke EXECUTE from PUBLIC on all existing functions
--          2. Fix default privileges so new functions don't auto-grant
--          3. Re-grant EXECUTE per function to the minimum role set needed
--
-- NOTE:    GRANTs use DO blocks with EXCEPTION handlers so the migration is tolerant
--          of functions that don't exist yet (e.g., created by later migrations).
--          Each GRANT either succeeds or is silently skipped.
--
-- ROLLBACK: Restore previous default privileges and grants (see bottom comment block)

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. REVOKE all existing EXECUTE grants from PUBLIC, anon, authenticated
--    on ALL functions in public schema.
--    service_role keeps access (it's the server-side admin key).
-- ═══════════════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. FIX default privileges so future CREATE FUNCTION doesn't re-grant.
--    Both postgres and supabase_admin auto-grant to anon/authenticated.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. RE-GRANT by allowlist using a helper that skips missing functions.
--
-- Legend:
--   anon          = unauthenticated users (complaint submission/access)
--   authenticated = logged-in users
--   service_role  = server-side operations (webhooks, cron)
--
-- Functions not listed here remain accessible only to postgres/service_role.
-- ═══════════════════════════════════════════════════════════════════════════

DO $grants$
DECLARE
  _sql text;
BEGIN
  -- Helper: execute each GRANT; skip if function doesn't exist
  FOR _sql IN VALUES
    -- ── Complaint functions (public-facing, anon + authenticated) ────────
    ('GRANT EXECUTE ON FUNCTION public.fn_submit_complaint(text, text, text, text, boolean, text, text, text, text, text, text) TO anon, authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_access_complaint(text, text) TO anon, authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_send_reporter_message(text, text, text) TO anon, authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_verify_complaint_pin(text, text) TO service_role'),

    -- ── Complaint management (authenticated users with proper roles) ─────
    ('GRANT EXECUTE ON FUNCTION public.fn_get_complaint_list(uuid, text, integer, integer) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_get_complaint_detail(uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_update_complaint_status(uuid, text, text) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_is_assigned_investigator(uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_is_complaint_tenant_admin(uuid) TO authenticated, service_role'),

    -- ── Campaign functions (authenticated + service_role) ────────────────
    ('GRANT EXECUTE ON FUNCTION public.fn_get_campaign_stats(uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_prepare_campaign_send(uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_record_delivery_event(uuid, text, text, text, text, text) TO service_role'),

    -- ── Organization / Auth functions ────────────────────────────────────
    ('GRANT EXECUTE ON FUNCTION public.fn_create_organization_with_owner(text, text, text) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_resolve_tenant_id() TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_user_has_role(organization_role[]) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_handle_new_user() TO service_role'),
    ('GRANT EXECUTE ON FUNCTION public.check_plan_limit(uuid, text) TO authenticated, service_role'),

    -- ── Assessment functions ─────────────────────────────────────────────
    ('GRANT EXECUTE ON FUNCTION public.fn_assessment_cycle_summary(uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_assessment_group_results(uuid, uuid, uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_assessment_participation_stats(uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_get_questionnaire_for_token(text) TO anon, authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_submit_assessment(text, text) TO anon, authenticated, service_role'),

    -- ── Evidence functions ───────────────────────────────────────────────
    ('GRANT EXECUTE ON FUNCTION public.fn_generate_evidence_report(uuid, text, text, text, uuid, timestamptz, timestamptz, text) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_get_evidence_package_detail(uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_get_evidence_report_detail(uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_seal_evidence_package(uuid) TO authenticated, service_role'),

    -- ── Risk functions ───────────────────────────────────────────────────
    ('GRANT EXECUTE ON FUNCTION public.fn_get_risk_detail(uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_get_risk_inventory_summary() TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_import_risks_from_cycle(uuid) TO authenticated, service_role'),

    -- ── Billing functions ────────────────────────────────────────────────
    ('GRANT EXECUTE ON FUNCTION public.transition_subscription_status(uuid, subscription_status, text) TO service_role'),

    -- ── Trigger functions (no direct client access needed) ───────────────
    ('GRANT EXECUTE ON FUNCTION public.fn_set_updated_at() TO service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_audit_log_immutable() TO service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_complaints_updated_at() TO service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_complaints_immutable_tenant() TO service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_campaigns_immutable_tenant() TO service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_campaign_templates_immutable_tenant() TO service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_campaign_updated_at() TO service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_evidence_updated_at() TO service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_evidence_packages_immutable_tenant() TO service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_evidence_packages_immutable_sealed() TO service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_evidence_reports_immutable_tenant() TO service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_evidence_reports_immutable_content() TO service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_risk_items_immutable_tenant() TO service_role'),

    -- ── New functions created by later SEC migrations ────────────────────
    -- SEC-002: check_plan_limit new signature
    ('GRANT EXECUTE ON FUNCTION public.check_plan_limit(text) TO authenticated, service_role'),
    -- SEC-003: complaint PIN rate limiting helper
    ('GRANT EXECUTE ON FUNCTION public.fn_check_pin_rate_limit(text, integer, integer) TO service_role'),
    -- SEC-004: remove member RPC
    ('GRANT EXECUTE ON FUNCTION public.fn_remove_member(uuid) TO authenticated, service_role'),
    -- SEC-005: prepare campaign send (already listed above, same signature)
    -- SEC-006: process webhook event
    ('GRANT EXECUTE ON FUNCTION public.fn_process_webhook_event(text, text, text, text, text, text, text, text, jsonb) TO service_role')
  LOOP
    BEGIN
      EXECUTE _sql;
    EXCEPTION WHEN undefined_function OR undefined_object THEN
      RAISE NOTICE 'SEC-001: Skipping (function not found): %', _sql;
    END;
  END LOOP;
END
$grants$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK (do NOT run unless reverting):
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO PUBLIC, anon, authenticated, service_role;
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--   GRANT EXECUTE ON FUNCTIONS TO PUBLIC, anon, authenticated, service_role;
-- ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
--   GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
-- ═══════════════════════════════════════════════════════════════════════════
