-- =============================================================================
-- SEC-001 DRIFT RESOLUTION v1.2.2 — Executar via Dashboard SQL Editor
--
-- Contexto:
-- As linhas ALTER DEFAULT PRIVILEGES da migration SEC-001 NAO foram aplicadas
-- durante o deploy remoto porque o CLI nao tinha permissao para executar como
-- postgres/supabase_admin. Este script resolve essa divergencia.
--
-- Deve ser executado UMA VEZ via Supabase Dashboard > SQL Editor
-- (que roda como postgres) para configurar os default privileges corretamente.
--
-- Escopo:
--   1. Verificar autoridade (postgres pode alterar defaults de supabase_admin?)
--   2. Revogar EXECUTE default para novas funcoes — postgres e supabase_admin
--   3. Re-grant por allowlist completa (SEC-001 + consolidacao v1.2.2)
--   4. Verificacao pos-aplicacao (5 queries de auditoria)
--
-- Decisao PD-001: service_role NAO recebe EXECUTE default.
-- Grants explicitos sao feitos por allowlist.
--
-- v1.2.2 CHANGES:
--   - Corrigido: assinaturas das funcoes antigas na allowlist de coexistencia
--     fn_access_complaint(text,text) — 2 args, nao 3
--     fn_send_reporter_message(text,text,text) — 3 args, nao 4
--     fn_check_pin_rate_limit(text,integer,integer) — text+int+int, nao 5 args
--   - Funcoes criticas ausentes geram RAISE EXCEPTION (nao apenas NOTICE)
--   - Allowlist cobre: pre-CONTRACT (antigas), pos-EXPAND (_v2), pos-CONTRACT
--
-- IMPORTANTE: Este script e ADITIVO — configura defaults para FUTURAS funcoes.
-- Os REVOKEs individuais das funcoes existentes ja estao em vigor.
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════════════════════
-- 0. VERIFICACAO DE AUTORIDADE
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_is_super boolean;
  v_is_member boolean;
BEGIN
  SELECT rolsuper INTO v_is_super
  FROM pg_roles WHERE rolname = current_user;

  v_is_member := pg_has_role(current_user, 'supabase_admin', 'MEMBER');

  IF NOT (COALESCE(v_is_super, false) OR v_is_member) THEN
    RAISE EXCEPTION
      'AUTORIDADE INSUFICIENTE: % nao e superuser nem membro de supabase_admin. '
      'Nao e possivel alterar default privileges de supabase_admin. '
      'Execute este script via Dashboard SQL Editor (que roda como postgres).',
      current_user;
  END IF;

  RAISE NOTICE 'Autoridade verificada: % (superuser=%, membro_supabase_admin=%)',
    current_user, v_is_super, v_is_member;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. REVOGAR EXECUTE DEFAULT — funcoes criadas por postgres
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM authenticated;
-- PD-001: service_role nao recebe EXECUTE default
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. REVOGAR EXECUTE DEFAULT — funcoes criadas por supabase_admin
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM authenticated;
-- PD-001: service_role nao recebe EXECUTE default
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. RE-GRANT POR ALLOWLIST COMPLETA
--    Cobre SEC-001 original + funcoes da consolidacao v1.2.2.
--
--    Funcoes criticas (Bloco 1) que DEVEM existir geram RAISE EXCEPTION
--    se ausentes. Funcoes que podem nao existir (pre ou pos-CONTRACT) usam
--    tratamento condicional.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 3a. Grants para funcoes que DEVEM existir (erro fatal se ausente) ────────
DO $grants_critical$
DECLARE
  _sql text;
BEGIN
  FOR _sql IN VALUES
    -- ── Complaint functions (public-facing: anon + authenticated) ────────
    -- fn_submit_complaint: publico (permite denuncia anonima)
    ('GRANT EXECUTE ON FUNCTION public.fn_submit_complaint(text, text, text, text, boolean, text, text, text, text, text, text) TO anon, authenticated, service_role'),

    -- ── _v2 functions (service_role ONLY — gateway confiavel) ────────────
    ('GRANT EXECUTE ON FUNCTION public.fn_access_complaint_v2(text, text, text) TO service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_send_reporter_message_v2(text, text, text, text) TO service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_check_pin_rate_limit_v2(text, text, integer, integer, integer) TO service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_record_pin_failure(text, text) TO service_role'),

    -- ── PIN verification (internal — service_role) ──────────────────────
    ('GRANT EXECUTE ON FUNCTION public.fn_verify_complaint_pin(text, text) TO service_role'),

    -- ── Complaint management (authenticated) ────────────────────────────
    ('GRANT EXECUTE ON FUNCTION public.fn_get_complaint_list(uuid, text, integer, integer) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_get_complaint_list(text, integer, integer) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_get_complaint_detail(uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_update_complaint_status(uuid, text, text) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_is_assigned_investigator(uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_is_complaint_tenant_admin(uuid) TO authenticated, service_role'),

    -- ── Campaign functions ──────────────────────────────────────────────
    ('GRANT EXECUTE ON FUNCTION public.fn_get_campaign_stats(uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_prepare_campaign_send(uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_record_delivery_event(uuid, text, text, text, text, text) TO service_role'),

    -- ── Organization / Auth functions ───────────────────────────────────
    ('GRANT EXECUTE ON FUNCTION public.fn_create_organization_with_owner(text, text, text) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_resolve_tenant_id() TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_user_has_role(organization_role[]) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_handle_new_user() TO service_role'),
    ('GRANT EXECUTE ON FUNCTION public.check_plan_limit(text) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.check_plan_limit(uuid, text) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_remove_member(uuid) TO authenticated, service_role'),

    -- ── Assessment functions ────────────────────────────────────────────
    ('GRANT EXECUTE ON FUNCTION public.fn_assessment_cycle_summary(uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_assessment_group_results(uuid, uuid, uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_assessment_participation_stats(uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_get_questionnaire_for_token(text) TO anon, authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_submit_assessment(text, text) TO anon, authenticated, service_role'),

    -- ── Evidence functions ──────────────────────────────────────────────
    ('GRANT EXECUTE ON FUNCTION public.fn_generate_evidence_report(uuid, text, text, text, uuid, timestamptz, timestamptz, text) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_get_evidence_package_detail(uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_get_evidence_report_detail(uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_seal_evidence_package(uuid) TO authenticated, service_role'),

    -- ── Risk functions ──────────────────────────────────────────────────
    ('GRANT EXECUTE ON FUNCTION public.fn_get_risk_detail(uuid) TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_get_risk_inventory_summary() TO authenticated, service_role'),
    ('GRANT EXECUTE ON FUNCTION public.fn_import_risks_from_cycle(uuid) TO authenticated, service_role'),

    -- ── Billing functions ───────────────────────────────────────────────
    ('GRANT EXECUTE ON FUNCTION public.transition_subscription_status(uuid, subscription_status, text) TO service_role'),

    -- ── Webhook (SEC-006) ───────────────────────────────────────────────
    ('GRANT EXECUTE ON FUNCTION public.fn_process_webhook_event(text, text, text, text, text, text, text, text, jsonb) TO service_role'),

    -- ── Trigger functions (no direct client access) ─────────────────────
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
    ('GRANT EXECUTE ON FUNCTION public.fn_risk_items_immutable_tenant() TO service_role')
  LOOP
    BEGIN
      EXECUTE _sql;
    EXCEPTION WHEN undefined_function OR undefined_object THEN
      RAISE EXCEPTION 'FUNCAO CRITICA AUSENTE: %. '
        'Esta funcao deve existir no banco. Verifique se todas as migrations '
        'foram aplicadas corretamente.', _sql;
    END;
  END LOOP;
END
$grants_critical$;

-- ── 3b. Grants condicionais: funcoes antigas (pre-CONTRACT) ──────────────────
--    Estas funcoes existem enquanto o CONTRACT nao foi aplicado.
--    Se ausentes, o CONTRACT ja foi aplicado — NOTICE, nao erro.
DO $grants_old$
DECLARE
  _sql text;
BEGIN
  FOR _sql IN VALUES
    -- Assinaturas antigas CORRETAS:
    -- fn_access_complaint(text, text) — 2 parametros
    ('GRANT EXECUTE ON FUNCTION public.fn_access_complaint(text, text) TO anon, authenticated, service_role'),
    -- fn_send_reporter_message(text, text, text) — 3 parametros
    ('GRANT EXECUTE ON FUNCTION public.fn_send_reporter_message(text, text, text) TO anon, authenticated, service_role'),
    -- fn_check_pin_rate_limit(text, integer, integer) — 1 text + 2 integer
    ('GRANT EXECUTE ON FUNCTION public.fn_check_pin_rate_limit(text, integer, integer) TO service_role')
  LOOP
    BEGIN
      EXECUTE _sql;
    EXCEPTION WHEN undefined_function OR undefined_object THEN
      RAISE NOTICE 'Funcao antiga ausente (CONTRACT aplicado?): %', _sql;
    END;
  END LOOP;
END
$grants_old$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. VERIFICACAO POS-APLICACAO
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 4.1 Verificar default privileges de postgres ───────────────────────────
SELECT
  defaclrole::regrole AS role_owner,
  defaclnamespace::regnamespace AS schema,
  defaclobjtype AS obj_type,
  defaclacl AS acl_entries
FROM pg_default_acl
WHERE defaclrole = 'postgres'::regrole
  AND defaclnamespace = 'public'::regnamespace
  AND defaclobjtype = 'f';

-- ─── 4.2 Verificar default privileges de supabase_admin ─────────────────────
SELECT
  defaclrole::regrole AS role_owner,
  defaclnamespace::regnamespace AS schema,
  defaclobjtype AS obj_type,
  defaclacl AS acl_entries
FROM pg_default_acl
WHERE defaclrole = 'supabase_admin'::regrole
  AND defaclnamespace = 'public'::regnamespace
  AND defaclobjtype = 'f';

-- ─── 4.3 Funcoes com EXECUTE herdado de PUBLIC ─────────────────────────────
SELECT
  p.proname AS function_name,
  pg_catalog.array_to_string(p.proargtypes::regtype[], ', ') AS arg_types,
  a.grantee,
  a.privilege_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL aclexplode(p.proacl) AS a(grantor, grantee, privilege_type, is_grantable)
WHERE n.nspname = 'public'
  AND a.privilege_type = 'EXECUTE'
  AND a.grantee = 0
ORDER BY p.proname;

-- ─── 4.4 Matriz has_function_privilege por role ─────────────────────────────
SELECT
  p.proname AS function_name,
  pg_catalog.array_to_string(p.proargtypes::regtype[], ', ') AS arg_types,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_exec,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_can_exec,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_can_exec
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (
    has_function_privilege('anon', p.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
    OR has_function_privilege('service_role', p.oid, 'EXECUTE')
  )
ORDER BY p.proname;

-- ─── 4.5 Confirmar que funcoes _v2 e internas NAO sao acessiveis ────────────
--         por anon ou authenticated (service_role only)
SELECT
  'fn_record_pin_failure' AS function_name,
  has_function_privilege('anon', 'public.fn_record_pin_failure(text,text)', 'EXECUTE') AS anon,
  has_function_privilege('authenticated', 'public.fn_record_pin_failure(text,text)', 'EXECUTE') AS authenticated,
  has_function_privilege('service_role', 'public.fn_record_pin_failure(text,text)', 'EXECUTE') AS service_role
UNION ALL
SELECT
  'fn_check_pin_rate_limit_v2',
  has_function_privilege('anon', 'public.fn_check_pin_rate_limit_v2(text,text,integer,integer,integer)', 'EXECUTE'),
  has_function_privilege('authenticated', 'public.fn_check_pin_rate_limit_v2(text,text,integer,integer,integer)', 'EXECUTE'),
  has_function_privilege('service_role', 'public.fn_check_pin_rate_limit_v2(text,text,integer,integer,integer)', 'EXECUTE')
UNION ALL
SELECT
  'fn_access_complaint_v2',
  has_function_privilege('anon', 'public.fn_access_complaint_v2(text,text,text)', 'EXECUTE'),
  has_function_privilege('authenticated', 'public.fn_access_complaint_v2(text,text,text)', 'EXECUTE'),
  has_function_privilege('service_role', 'public.fn_access_complaint_v2(text,text,text)', 'EXECUTE')
UNION ALL
SELECT
  'fn_send_reporter_message_v2',
  has_function_privilege('anon', 'public.fn_send_reporter_message_v2(text,text,text,text)', 'EXECUTE'),
  has_function_privilege('authenticated', 'public.fn_send_reporter_message_v2(text,text,text,text)', 'EXECUTE'),
  has_function_privilege('service_role', 'public.fn_send_reporter_message_v2(text,text,text,text)', 'EXECUTE');
