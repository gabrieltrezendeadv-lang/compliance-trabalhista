BEGIN;

-- Revoke PUBLIC/anon/authenticated EXECUTE on all existing functions
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;

-- NOTE: ALTER DEFAULT PRIVILEGES skipped — requires superuser.
-- Each SEC migration includes its own explicit GRANT statements.

-- Re-grant per allowlist (skips functions that don't exist yet)
DO $grants$
DECLARE
  _sql text;
BEGIN
  FOR _sql IN VALUES
    ('GRANT EXECUTE ON FUNCTION public.fn_submit_complaint(text, text, text, text, boolean, text, text, text, text, text, text) TO anon, authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_access_complaint(text, text) TO anon, authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_send_reporter_message(text, text, text) TO anon, authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_verify_complaint_pin(text, text) TO service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_get_complaint_list(uuid, text, integer, integer) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_get_complaint_detail(uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_update_complaint_status(uuid, text, text) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_is_assigned_investigator(uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_is_complaint_tenant_admin(uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_get_campaign_stats(uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_prepare_campaign_send(uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_record_delivery_event(uuid, text, text, text, text, text) TO service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_create_organization_with_owner(text, text, text) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_resolve_tenant_id() TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_user_has_role(organization_role[]) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_handle_new_user() TO service_role'),
    ('GRANT EXECUTE ON FUNCTION public.check_plan_limit(uuid, text) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_assessment_cycle_summary(uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_assessment_group_results(uuid, uuid, uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_assessment_participation_stats(uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_get_questionnaire_for_token(text) TO anon, authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_submit_assessment(text, text) TO anon, authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_generate_evidence_report(uuid, text, text, text, uuid, timestamptz, timestamptz, text) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_get_evidence_package_detail(uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_get_evidence_report_detail(uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_seal_evidence_package(uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_get_risk_detail(uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_get_risk_inventory_summary() TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_import_risks_from_cycle(uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.transition_subscription_status(uuid, subscription_status, text) TO service_role'),
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
    ('GRANT EXECUTE ON FUNCTION public.check_plan_limit(text) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_check_pin_rate_limit(text, integer, integer) TO service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_remove_member(uuid) TO authenticated, service_role'),
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
