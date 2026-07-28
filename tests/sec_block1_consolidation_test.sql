-- =============================================================================
-- TESTES FUNCIONAIS — SEC-BLOCK1-CONSOLIDATION v1.2.2
--
-- 42 testes reais que chamam as funcoes e verificam retorno.
--
-- Pre-requisito:
--   1. Bootstrap executado (bootstrap_test_db.sql)
--   2. 20260727100000_sec_block1_expand.sql aplicada (v1.2.2 EXPAND)
--   3. pgcrypto habilitado (extensions.crypt, extensions.digest)
--   4. fn_verify_complaint_pin disponivel (migration original)
--
-- Execucao: psql -f tests/sec_block1_consolidation_test.sql
-- =============================================================================

-- ─── VERIFICACOES DE PRE-REQUISITO ─────────────────────────────────────────

DO $precheck$
BEGIN
  -- fn_verify_complaint_pin deve existir (das migrations originais)
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'fn_verify_complaint_pin'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION '[PREREQ] fn_verify_complaint_pin nao encontrada. Aplique todas as migrations originais.';
  END IF;

  -- test_set_auth deve existir (do bootstrap)
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'test_set_auth'
  ) THEN
    RAISE EXCEPTION '[PREREQ] test_set_auth() nao encontrada. Execute bootstrap_test_db.sql primeiro.';
  END IF;

  -- Verificar que v1.2.1 EXPAND esta aplicada (funcoes _v2 existem)
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_check_pin_rate_limit_v2'
  ) THEN
    RAISE EXCEPTION '[PREREQ] fn_check_pin_rate_limit_v2 nao encontrada. Aplique a migration EXPAND v1.2.1.';
  END IF;

  RAISE NOTICE '[PREREQ] Pre-requisitos verificados OK';
END $precheck$;

-- ─── SETUP: DADOS DE TESTE ──────────────────────────────────────────────────

DO $setup$
DECLARE
  -- Usuarios
  v_user_a uuid := 'a0000001-0001-4001-a001-000000000001';
  v_user_b uuid := 'a0000002-0002-4002-a002-000000000002';
  v_user_c uuid := 'a0000003-0003-4003-a003-000000000003';
  v_user_d uuid := 'a0000004-0004-4004-a004-000000000004';
  v_user_e uuid := 'a0000005-0005-4005-a005-000000000005';
  v_user_f uuid := 'a0000006-0006-4006-a006-000000000006';
  v_user_g uuid := 'a0000007-0007-4007-a007-000000000007';

  -- Organizacoes
  v_org_alpha uuid := 'b0000001-0001-4001-b001-000000000001';
  v_org_beta  uuid := 'b0000002-0002-4002-b002-000000000002';

  -- Membros (id do registro de membership)
  v_mem_a_alpha uuid := 'c0000001-0001-4001-c001-000000000001';
  v_mem_b_alpha uuid := 'c0000002-0002-4002-c002-000000000002';
  v_mem_c_alpha uuid := 'c0000003-0003-4003-c003-000000000003';
  v_mem_d_beta  uuid := 'c0000004-0004-4004-c004-000000000004';
  v_mem_e_alpha uuid := 'c0000005-0005-4005-c005-000000000005';
  v_mem_e_beta  uuid := 'c0000006-0006-4006-c006-000000000006';

  -- Plano e assinatura
  v_plan_id uuid := 'd0000001-0001-4001-d001-000000000001';
  v_sub_id  uuid := 'd0000002-0002-4002-d002-000000000002';

  -- Estabelecimento e departamento
  v_est_1  uuid := 'e0000001-0001-4001-e001-000000000001';
  v_dept_1 uuid := 'f0000001-0001-4001-f001-000000000001';

  -- Employee profiles
  v_emp_1 uuid := 'ee000001-0001-4001-e001-000000000001';
  v_emp_2 uuid := 'ee000002-0002-4002-e002-000000000002';
  v_emp_3 uuid := 'ee000003-0003-4003-e003-000000000003';
  v_emp_4 uuid := 'ee000004-0004-4004-e004-000000000004';
  v_emp_5 uuid := 'ee000005-0005-4005-e005-000000000005';

  -- Complaints para testes de acesso
  v_complaint_acc uuid := 'dd000001-0001-4001-d001-000000000001';
  v_complaint_res uuid := 'dd000002-0002-4002-d002-000000000002';

  -- Campaigns
  v_camp_valid   uuid := 'cc000001-0001-4001-c001-000000000001';
  v_camp_roles   uuid := 'cc000002-0002-4002-c002-000000000002';
  v_camp_empty   uuid := 'cc000003-0003-4003-c003-000000000003';
  v_camp_cross   uuid := 'cc000004-0004-4004-c004-000000000004';
  v_camp_uuid    uuid := 'cc000005-0005-4005-c005-000000000005';
  v_camp_both    uuid := 'cc000006-0006-4006-c006-000000000006';
  v_camp_typeof  uuid := 'cc000007-0007-4007-c007-000000000007';
  v_camp_dedup   uuid := 'cc000008-0008-4008-c008-000000000008';

  i integer;
BEGIN
  -- 1. auth.users
  INSERT INTO auth.users (id, email) VALUES
    (v_user_a, 'testa@test.local'),
    (v_user_b, 'testb@test.local'),
    (v_user_c, 'testc@test.local'),
    (v_user_d, 'testd@test.local'),
    (v_user_e, 'teste@test.local'),
    (v_user_f, 'testf@test.local'),
    (v_user_g, 'testg@test.local')
  ON CONFLICT (id) DO NOTHING;

  -- 2. Profiles
  INSERT INTO public.profiles (id, full_name, email) VALUES
    (v_user_a, 'User A (Owner Alpha)', 'testa@test.local'),
    (v_user_b, 'User B (Viewer Alpha)', 'testb@test.local'),
    (v_user_c, 'User C (Admin Alpha)',  'testc@test.local'),
    (v_user_d, 'User D (Owner Beta)',   'testd@test.local'),
    (v_user_e, 'User E (Multi-Org)',    'teste@test.local'),
    (v_user_f, 'User F (Dedup Email)',  'testf@test.local'),
    (v_user_g, 'User G (Dedup Phone)', 'testg@test.local')
  ON CONFLICT (id) DO NOTHING;

  -- 3. Organizacoes
  INSERT INTO public.organizations (id, name, slug) VALUES
    (v_org_alpha, 'Org Alpha Teste', 'test-alpha'),
    (v_org_beta,  'Org Beta Teste',  'test-beta')
  ON CONFLICT (id) DO NOTHING;

  -- 4. Membros
  INSERT INTO public.organization_members (id, tenant_id, user_id, role) VALUES
    (v_mem_a_alpha, v_org_alpha, v_user_a, 'owner'),
    (v_mem_b_alpha, v_org_alpha, v_user_b, 'viewer'),
    (v_mem_c_alpha, v_org_alpha, v_user_c, 'admin'),
    (v_mem_d_beta,  v_org_beta,  v_user_d, 'owner'),
    (v_mem_e_alpha, v_org_alpha, v_user_e, 'investigator'),
    (v_mem_e_beta,  v_org_beta,  v_user_e, 'investigator')
  ON CONFLICT (id) DO NOTHING;

  -- 5. Plano de assinatura e assinatura
  INSERT INTO public.subscription_plans (id, name) VALUES
    (v_plan_id, 'Plano Teste v1.2')
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.subscription_plans
  SET limits = ROW(5, 10, 20, 30, 12)::public.plan_limits
  WHERE id = v_plan_id;

  INSERT INTO public.tenant_subscriptions (id, tenant_id, plan_id, status) VALUES
    (v_sub_id, v_org_alpha, v_plan_id, 'active')
  ON CONFLICT (id) DO NOTHING;

  -- 6. Estabelecimento e departamento
  INSERT INTO public.establishments (id, tenant_id, name) VALUES
    (v_est_1, v_org_alpha, 'Filial Central Teste')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.departments (id, tenant_id, name, establishment_id) VALUES
    (v_dept_1, v_org_alpha, 'RH Teste', v_est_1)
  ON CONFLICT (id) DO NOTHING;

  -- 7. Employee profiles
  --    emp_1: email + phone (qualifica para todos os canais)
  --    emp_2: apenas email
  --    emp_3: apenas phone
  --    emp_4: email DUPLICADO de emp_1 (uppercase) + phone unico → testa dedup email
  --    emp_5: email unico + phone DUPLICADO de emp_1 (com espacos) → testa dedup phone
  INSERT INTO public.employee_profiles (id, tenant_id, user_id, full_name, email, phone, establishment_id, department_id, status) VALUES
    (v_emp_1, v_org_alpha, v_user_a, 'Emp Um',    'emp1@test.local',    '+5511999990001', v_est_1, v_dept_1, 'active'),
    (v_emp_2, v_org_alpha, v_user_b, 'Emp Dois',  'emp2@test.local',    NULL,             v_est_1, v_dept_1, 'active'),
    (v_emp_3, v_org_alpha, v_user_c, 'Emp Tres',  NULL,                 '+5511999990003', v_est_1, v_dept_1, 'active'),
    (v_emp_4, v_org_alpha, v_user_f, 'Emp Quatro','EMP1@TEST.LOCAL',    '+5511999990004', v_est_1, v_dept_1, 'active'),
    (v_emp_5, v_org_alpha, v_user_g, 'Emp Cinco', 'emp5@test.local',    '+55 11 99999-0001', v_est_1, v_dept_1, 'active')
  ON CONFLICT (id) DO NOTHING;

  -- 8. Complaints para testes de acesso (PIN = '654321', bcrypt hash)
  INSERT INTO public.complaints (id, tenant_id, protocol, pin_hash, category, severity, is_anonymous, status) VALUES
    (v_complaint_acc, v_org_alpha, 'TSTACC01',
     extensions.crypt('654321', extensions.gen_salt('bf', 10)),
     'other'::public.complaint_category, 'medium'::public.complaint_severity, true,
     'pending'::public.complaint_status),
    (v_complaint_res, v_org_alpha, 'TSTRES01',
     extensions.crypt('654321', extensions.gen_salt('bf', 10)),
     'other'::public.complaint_category, 'medium'::public.complaint_severity, true,
     'resolved'::public.complaint_status)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.complaint_contents (complaint_id, subject, description) VALUES
    (v_complaint_acc, 'Teste Acesso', 'Denuncia para teste de acesso'),
    (v_complaint_res, 'Teste Resolvida', 'Denuncia resolvida para teste')
  ON CONFLICT DO NOTHING;

  -- 9. Complaints para teste de paginacao (10 registros)
  FOR i IN 1..10 LOOP
    INSERT INTO public.complaints (
      tenant_id, protocol, category, severity, is_anonymous,
      pin_hash, status
    ) VALUES (
      v_org_alpha, 'TSTLST' || lpad(i::text, 2, '0'),
      'other'::public.complaint_category,
      'medium'::public.complaint_severity,
      true,
      extensions.crypt('999999', extensions.gen_salt('bf', 10)),
      'pending'::public.complaint_status
    ) ON CONFLICT DO NOTHING;
  END LOOP;

  -- 10. Campaigns para testes de fn_prepare_campaign_send
  INSERT INTO public.campaigns (id, tenant_id, name, channel, status, subject, body_text, target_scope, created_by) VALUES
    -- T26: campanha valida (email, sem scope) → emp_1 + emp_2 + emp_4 + emp_5 (4 com email)
    (v_camp_valid, v_org_alpha, 'Camp Valida', 'email'::public.delivery_channel,
     'draft'::public.campaign_status, 'Assunto', 'Corpo da campanha', NULL, v_user_a),
    -- T24: campanha com scope 'roles' (invalido)
    (v_camp_roles, v_org_alpha, 'Camp Roles', 'email'::public.delivery_channel,
     'draft'::public.campaign_status, 'Assunto', 'Corpo',
     '{"roles": ["admin"]}'::jsonb, v_user_a),
    -- T25: campanha em org_beta (sem employees -> 0 recipients)
    (v_camp_empty, v_org_beta, 'Camp Vazia', 'email'::public.delivery_channel,
     'draft'::public.campaign_status, 'Assunto', 'Corpo', NULL, v_user_d),
    -- T27: campanha cross-tenant
    (v_camp_cross, v_org_beta, 'Camp Cross', 'email'::public.delivery_channel,
     'draft'::public.campaign_status, 'Assunto', 'Corpo', NULL, v_user_d),
    -- T28: campanha com UUID invalido
    (v_camp_uuid, v_org_alpha, 'Camp UUID', 'email'::public.delivery_channel,
     'draft'::public.campaign_status, 'Assunto', 'Corpo',
     '{"establishment_ids": ["not-a-valid-uuid"]}'::jsonb, v_user_a),
    -- T29: campanha channel 'both' → emp_1 + emp_2 + emp_3 + emp_4 + emp_5 (todos tem email OU phone)
    (v_camp_both, v_org_alpha, 'Camp Both', 'both'::public.delivery_channel,
     'draft'::public.campaign_status, 'Assunto', 'Corpo', NULL, v_user_a),
    -- T34: campanha com jsonb_typeof invalido (establishment_ids como string, nao array)
    (v_camp_typeof, v_org_alpha, 'Camp Typeof', 'email'::public.delivery_channel,
     'draft'::public.campaign_status, 'Assunto', 'Corpo',
     '{"establishment_ids": "nao-e-um-array"}'::jsonb, v_user_a),
    -- T38-T39: campanha 'both' para teste de dedup (igual a camp_both mas separada)
    (v_camp_dedup, v_org_alpha, 'Camp Dedup', 'both'::public.delivery_channel,
     'draft'::public.campaign_status, 'Assunto', 'Corpo dedup', NULL, v_user_a)
  ON CONFLICT (id) DO NOTHING;

  -- 11. Limpar rate limit attempts de teste
  DELETE FROM public.complaint_pin_attempts WHERE protocol LIKE 'TST%';

  RAISE NOTICE '[SETUP] Dados de teste criados com sucesso';
END $setup$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T01: fn_submit_complaint — PIN com menos de 6 digitos rejeitado
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t01$
DECLARE v_result jsonb;
BEGIN
  SELECT public.fn_submit_complaint(
    'test-alpha', 'Teste T01', 'Descricao T01',
    'other', true, NULL, NULL, NULL, NULL, NULL,
    '1234'  -- 4 digitos -> rejeitado
  ) INTO v_result;

  IF (v_result->>'success')::boolean = false
     AND v_result->>'error' = 'invalid_pin_length' THEN
    RAISE NOTICE '[PASS] T01: PIN < 6 digitos rejeitado';
  ELSE
    RAISE EXCEPTION '[FAIL] T01: Esperado invalid_pin_length, obteve: %', v_result;
  END IF;
END $t01$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T02: fn_submit_complaint — PIN com 6 digitos aceito
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t02$
DECLARE v_result jsonb;
BEGIN
  SELECT public.fn_submit_complaint(
    'test-alpha', 'Teste T02', 'Descricao T02',
    'other', true, NULL, NULL, NULL, NULL, NULL,
    '123456'
  ) INTO v_result;

  IF (v_result->>'success')::boolean = true
     AND v_result->>'protocol' IS NOT NULL THEN
    RAISE NOTICE '[PASS] T02: PIN 6 digitos aceito. Protocolo: %', v_result->>'protocol';
  ELSE
    RAISE EXCEPTION '[FAIL] T02: Esperado success=true com protocolo, obteve: %', v_result;
  END IF;
END $t02$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T03: fn_submit_complaint — PIN nao numerico rejeitado
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t03$
DECLARE v_result jsonb;
BEGIN
  SELECT public.fn_submit_complaint(
    'test-alpha', 'Teste T03', 'Descricao T03',
    'other', true, NULL, NULL, NULL, NULL, NULL,
    'abcdef'
  ) INTO v_result;

  IF (v_result->>'success')::boolean = false
     AND v_result->>'error' = 'invalid_pin_format' THEN
    RAISE NOTICE '[PASS] T03: PIN nao numerico rejeitado';
  ELSE
    RAISE EXCEPTION '[FAIL] T03: Esperado invalid_pin_format, obteve: %', v_result;
  END IF;
END $t03$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T04: fn_submit_complaint — Tenant slug invalido rejeitado
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t04$
DECLARE v_result jsonb;
BEGIN
  SELECT public.fn_submit_complaint(
    'slug-inexistente', 'Teste T04', 'Descricao T04',
    'other', true, NULL, NULL, NULL, NULL, NULL,
    '123456'
  ) INTO v_result;

  IF (v_result->>'success')::boolean = false
     AND v_result->>'error' = 'invalid_tenant' THEN
    RAISE NOTICE '[PASS] T04: Tenant slug invalido rejeitado';
  ELSE
    RAISE EXCEPTION '[FAIL] T04: Esperado invalid_tenant, obteve: %', v_result;
  END IF;
END $t04$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T05: fn_access_complaint_v2 — PIN correto retorna dados da denuncia
--      v1.2.1: assinatura (text,text,text) com p_caller_ip_hash, service_role only
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t05$
DECLARE v_result jsonb;
BEGIN
  SELECT public.fn_access_complaint_v2('TSTACC01', '654321', NULL) INTO v_result;

  IF (v_result->>'success')::boolean = true
     AND v_result->'complaint' IS NOT NULL
     AND (v_result->'complaint'->>'status') = 'pending' THEN
    RAISE NOTICE '[PASS] T05: PIN correto retorna dados da denuncia (_v2)';
  ELSE
    RAISE EXCEPTION '[FAIL] T05: Esperado success=true com dados, obteve: %', v_result;
  END IF;
END $t05$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T06: fn_access_complaint_v2 — PIN incorreto retorna invalid_credentials
--      v1.2.1: registra falha com ip_hash via fn_record_pin_failure
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t06$
DECLARE
  v_result      jsonb;
  v_count_before bigint;
  v_count_after  bigint;
  v_has_hash    boolean;
BEGIN
  SELECT count(*) INTO v_count_before
  FROM public.complaint_pin_attempts WHERE protocol = 'TSTACC01';

  SELECT public.fn_access_complaint_v2('TSTACC01', '000000', 'hmac-test-hash-abc') INTO v_result;

  SELECT count(*) INTO v_count_after
  FROM public.complaint_pin_attempts WHERE protocol = 'TSTACC01';

  -- Verificar que ip_hash foi armazenado
  SELECT EXISTS (
    SELECT 1 FROM public.complaint_pin_attempts
    WHERE protocol = 'TSTACC01' AND ip_hash = 'hmac-test-hash-abc'
  ) INTO v_has_hash;

  IF (v_result->>'success')::boolean = false
     AND v_result->>'error' = 'invalid_credentials'
     AND v_count_after > v_count_before
     AND v_has_hash THEN
    RAISE NOTICE '[PASS] T06: PIN incorreto -> invalid_credentials + falha registrada com ip_hash';
  ELSE
    RAISE EXCEPTION '[FAIL] T06: Esperado invalid_credentials + registro com ip_hash, obteve: % (before=%, after=%, has_hash=%)',
      v_result, v_count_before, v_count_after, v_has_hash;
  END IF;
END $t06$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T07: fn_access_complaint_v2 — Protocolo inexistente (anti-enumeracao)
--      Deve retornar o mesmo erro que PIN incorreto
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t07$
DECLARE v_result jsonb;
BEGIN
  SELECT public.fn_access_complaint_v2('TSTNAOEX', '654321', NULL) INTO v_result;

  IF (v_result->>'success')::boolean = false
     AND v_result->>'error' = 'invalid_credentials' THEN
    RAISE NOTICE '[PASS] T07: Protocolo inexistente -> invalid_credentials (anti-enumeracao)';
  ELSE
    RAISE EXCEPTION '[FAIL] T07: Esperado invalid_credentials (anti-enum), obteve: %', v_result;
  END IF;
END $t07$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T08: fn_record_pin_failure — Registra tentativa falha com ip_hash
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t08$
DECLARE
  v_count_before bigint;
  v_count_after  bigint;
BEGIN
  DELETE FROM public.complaint_pin_attempts WHERE protocol = 'TSTFAIL08';

  SELECT count(*) INTO v_count_before
  FROM public.complaint_pin_attempts WHERE protocol = 'TSTFAIL08';

  PERFORM public.fn_record_pin_failure('TSTFAIL08', 'hash-ip-teste');

  SELECT count(*) INTO v_count_after
  FROM public.complaint_pin_attempts WHERE protocol = 'TSTFAIL08';

  IF v_count_after = v_count_before + 1 THEN
    RAISE NOTICE '[PASS] T08: fn_record_pin_failure registrou falha (% -> %)', v_count_before, v_count_after;
  ELSE
    RAISE EXCEPTION '[FAIL] T08: Esperado +1 registro, before=%, after=%', v_count_before, v_count_after;
  END IF;

  DELETE FROM public.complaint_pin_attempts WHERE protocol = 'TSTFAIL08';
END $t08$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T09: fn_check_pin_rate_limit_v2 — Bloqueia apos max_attempts (por protocolo)
--      v1.2.1: assinatura (text,text,int,int,int)
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t09$
DECLARE
  v_rate_ok boolean;
  i integer;
BEGIN
  DELETE FROM public.complaint_pin_attempts WHERE protocol = 'TSTBLOCK09';

  -- Registrar 5 falhas
  FOR i IN 1..5 LOOP
    PERFORM public.fn_record_pin_failure('TSTBLOCK09', NULL);
  END LOOP;

  -- A 6a consulta deve retornar FALSE (max_attempts=5)
  SELECT public.fn_check_pin_rate_limit_v2('TSTBLOCK09', NULL, 5, 15, 20) INTO v_rate_ok;

  IF NOT v_rate_ok THEN
    RAISE NOTICE '[PASS] T09: Rate limit por protocolo bloqueou apos 5 tentativas';
  ELSE
    RAISE EXCEPTION '[FAIL] T09: Rate limit deveria bloquear apos 5 falhas';
  END IF;

  DELETE FROM public.complaint_pin_attempts WHERE protocol = 'TSTBLOCK09';
END $t09$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T10: fn_check_pin_rate_limit_v2 — Permite quando abaixo do limite
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t10$
DECLARE v_rate_ok boolean;
BEGIN
  DELETE FROM public.complaint_pin_attempts WHERE protocol = 'TSTALLOW10';

  SELECT public.fn_check_pin_rate_limit_v2('TSTALLOW10', NULL, 5, 15, 20) INTO v_rate_ok;

  IF v_rate_ok THEN
    RAISE NOTICE '[PASS] T10: Rate limit permite com 0 tentativas';
  ELSE
    RAISE EXCEPTION '[FAIL] T10: Rate limit nao deveria bloquear com 0 tentativas';
  END IF;
END $t10$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T11: fn_send_reporter_message_v2 — Denuncia resolvida rejeita mensagem
--      v1.2.1: assinatura (text,text,text,text) com p_caller_ip_hash
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t11$
DECLARE v_result jsonb;
BEGIN
  DELETE FROM public.complaint_pin_attempts WHERE protocol = 'TSTRES01';

  SELECT public.fn_send_reporter_message_v2('TSTRES01', '654321', 'Mensagem de teste', NULL) INTO v_result;

  IF (v_result->>'success')::boolean = false
     AND v_result->>'error' = 'complaint_closed' THEN
    RAISE NOTICE '[PASS] T11: Denuncia resolvida rejeita mensagem com complaint_closed';
  ELSE
    RAISE EXCEPTION '[FAIL] T11: Esperado complaint_closed, obteve: %', v_result;
  END IF;
END $t11$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T12: check_plan_limit — Sem autenticacao retorna no_tenant
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t12$
DECLARE v_result jsonb;
BEGIN
  PERFORM test_clear_auth();

  SELECT public.check_plan_limit('establishments') INTO v_result;

  IF (v_result->>'allowed')::boolean = false
     AND v_result->>'reason' = 'no_tenant' THEN
    RAISE NOTICE '[PASS] T12: Sem auth -> no_tenant';
  ELSE
    RAISE EXCEPTION '[FAIL] T12: Esperado no_tenant, obteve: %', v_result;
  END IF;
END $t12$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T13: check_plan_limit — Usuario multi-org retorna multi_org_ambiguous
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t13$
DECLARE v_result jsonb;
BEGIN
  PERFORM test_set_auth('a0000005-0005-4005-a005-000000000005'::uuid);

  SELECT public.check_plan_limit('establishments') INTO v_result;

  IF (v_result->>'allowed')::boolean = false
     AND v_result->>'reason' = 'multi_org_ambiguous' THEN
    RAISE NOTICE '[PASS] T13: Multi-org -> multi_org_ambiguous';
  ELSE
    RAISE EXCEPTION '[FAIL] T13: Esperado multi_org_ambiguous, obteve: %', v_result;
  END IF;

  PERFORM test_clear_auth();
END $t13$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T14: check_plan_limit — Metrica desconhecida retorna unknown_metric
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t14$
DECLARE v_result jsonb;
BEGIN
  PERFORM test_set_auth('a0000001-0001-4001-a001-000000000001'::uuid);

  SELECT public.check_plan_limit('metrica_xyz_invalida') INTO v_result;

  IF (v_result->>'allowed')::boolean = false
     AND v_result->>'reason' IN ('unknown_metric', 'no_subscription') THEN
    RAISE NOTICE '[PASS] T14: Metrica desconhecida -> % (allowed=false)', v_result->>'reason';
  ELSE
    RAISE EXCEPTION '[FAIL] T14: Esperado allowed=false, obteve: %', v_result;
  END IF;

  PERFORM test_clear_auth();
END $t14$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T15: fn_remove_member — Owner remove viewer com sucesso
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t15$
DECLARE v_result jsonb;
BEGIN
  PERFORM test_set_auth('a0000001-0001-4001-a001-000000000001'::uuid);

  SELECT public.fn_remove_member('c0000002-0002-4002-c002-000000000002'::uuid) INTO v_result;

  IF (v_result->>'success')::boolean = true THEN
    RAISE NOTICE '[PASS] T15: Owner removeu viewer com sucesso';
  ELSE
    RAISE EXCEPTION '[FAIL] T15: Esperado success=true, obteve: %', v_result;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE id = 'c0000002-0002-4002-c002-000000000002'
      AND deleted_at IS NOT NULL
  ) THEN
    RAISE NOTICE '[PASS] T15: Soft delete confirmado (deleted_at IS NOT NULL)';
  ELSE
    RAISE EXCEPTION '[FAIL] T15: deleted_at deveria estar preenchido';
  END IF;

  PERFORM test_clear_auth();
END $t15$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T16: fn_remove_member — Caller de outro tenant (anti-enumeracao)
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t16$
DECLARE v_result jsonb;
BEGIN
  PERFORM test_set_auth('a0000004-0004-4004-a004-000000000004'::uuid);

  SELECT public.fn_remove_member('c0000003-0003-4003-c003-000000000003'::uuid) INTO v_result;

  IF (v_result->>'success')::boolean = false
     AND v_result->>'error' = 'member_not_found' THEN
    RAISE NOTICE '[PASS] T16: Cross-tenant -> member_not_found (anti-enumeracao)';
  ELSE
    RAISE EXCEPTION '[FAIL] T16: Esperado member_not_found, obteve: %', v_result;
  END IF;

  PERFORM test_clear_auth();
END $t16$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T17: fn_remove_member — Admin nao pode remover owner
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t17$
DECLARE v_result jsonb;
BEGIN
  PERFORM test_set_auth('a0000003-0003-4003-a003-000000000003'::uuid);

  SELECT public.fn_remove_member('c0000001-0001-4001-c001-000000000001'::uuid) INTO v_result;

  IF (v_result->>'success')::boolean = false
     AND v_result->>'error' = 'insufficient_privileges' THEN
    RAISE NOTICE '[PASS] T17: Admin nao pode remover owner -> insufficient_privileges';
  ELSE
    RAISE EXCEPTION '[FAIL] T17: Esperado insufficient_privileges, obteve: %', v_result;
  END IF;

  PERFORM test_clear_auth();
END $t17$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T18: fn_remove_member — Membro ja removido retorna already_removed
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t18$
DECLARE v_result jsonb;
BEGIN
  PERFORM test_set_auth('a0000001-0001-4001-a001-000000000001'::uuid);

  SELECT public.fn_remove_member('c0000002-0002-4002-c002-000000000002'::uuid) INTO v_result;

  IF (v_result->>'success')::boolean = false
     AND v_result->>'error' = 'already_removed' THEN
    RAISE NOTICE '[PASS] T18: Membro ja removido -> already_removed';
  ELSE
    RAISE EXCEPTION '[FAIL] T18: Esperado already_removed, obteve: %', v_result;
  END IF;

  PERFORM test_clear_auth();
END $t18$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T19: fn_remove_member — Auto-remocao bloqueada
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t19$
DECLARE v_result jsonb;
BEGIN
  PERFORM test_set_auth('a0000001-0001-4001-a001-000000000001'::uuid);

  SELECT public.fn_remove_member('c0000001-0001-4001-c001-000000000001'::uuid) INTO v_result;

  IF (v_result->>'success')::boolean = false
     AND v_result->>'error' = 'cannot_remove_self' THEN
    RAISE NOTICE '[PASS] T19: Auto-remocao bloqueada -> cannot_remove_self';
  ELSE
    RAISE EXCEPTION '[FAIL] T19: Esperado cannot_remove_self, obteve: %', v_result;
  END IF;

  PERFORM test_clear_auth();
END $t19$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T20: fn_get_complaint_list (3-arg) — Multi-org retorna erro
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t20$
DECLARE v_result jsonb;
BEGIN
  PERFORM test_set_auth('a0000005-0005-4005-a005-000000000005'::uuid);

  SELECT public.fn_get_complaint_list(NULL::text, 50, 0) INTO v_result;

  IF (v_result->>'success')::boolean = false
     AND v_result->>'error' = 'multi_org_ambiguous' THEN
    RAISE NOTICE '[PASS] T20: fn_get_complaint_list 3-arg multi-org -> multi_org_ambiguous';
  ELSE
    RAISE EXCEPTION '[FAIL] T20: Esperado multi_org_ambiguous, obteve: %', v_result;
  END IF;

  PERFORM test_clear_auth();
END $t20$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T21: fn_get_complaint_list (4-arg) — Tenant explicito funciona
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t21$
DECLARE v_result jsonb;
BEGIN
  PERFORM test_set_auth('a0000001-0001-4001-a001-000000000001'::uuid);

  SELECT public.fn_get_complaint_list(
    'b0000001-0001-4001-b001-000000000001'::uuid,
    NULL, 50, 0
  ) INTO v_result;

  IF (v_result->>'success')::boolean = true
     AND v_result->'complaints' IS NOT NULL
     AND (v_result->>'total')::int >= 10 THEN
    RAISE NOTICE '[PASS] T21: fn_get_complaint_list 4-arg com tenant explicito (total=%)', v_result->>'total';
  ELSE
    RAISE EXCEPTION '[FAIL] T21: Esperado success=true com >= 10 complaints, obteve: %', v_result;
  END IF;

  PERFORM test_clear_auth();
END $t21$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T22: fn_get_complaint_list — Paginacao retorna subconjunto correto
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t22$
DECLARE
  v_result    jsonb;
  v_page_size int;
BEGIN
  PERFORM test_set_auth('a0000001-0001-4001-a001-000000000001'::uuid);

  SELECT public.fn_get_complaint_list(
    'b0000001-0001-4001-b001-000000000001'::uuid,
    NULL, 3, 0
  ) INTO v_result;

  v_page_size := jsonb_array_length(v_result->'complaints');

  IF (v_result->>'success')::boolean = true
     AND v_page_size = 3
     AND (v_result->>'total')::int >= 10 THEN
    RAISE NOTICE '[PASS] T22: Paginacao retorna 3 de % total', v_result->>'total';
  ELSE
    RAISE EXCEPTION '[FAIL] T22: Esperado 3 complaints na pagina, obteve: % (total=%)',
      v_page_size, v_result->>'total';
  END IF;

  PERFORM test_clear_auth();
END $t22$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T23: fn_get_complaint_list (4-arg) — Cross-tenant retorna forbidden
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t23$
DECLARE v_result jsonb;
BEGIN
  PERFORM test_set_auth('a0000004-0004-4004-a004-000000000004'::uuid);

  SELECT public.fn_get_complaint_list(
    'b0000001-0001-4001-b001-000000000001'::uuid,
    NULL, 50, 0
  ) INTO v_result;

  IF (v_result->>'success')::boolean = false
     AND v_result->>'error' = 'forbidden' THEN
    RAISE NOTICE '[PASS] T23: Cross-tenant -> forbidden';
  ELSE
    RAISE EXCEPTION '[FAIL] T23: Esperado forbidden, obteve: %', v_result;
  END IF;

  PERFORM test_clear_auth();
END $t23$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T24: fn_prepare_campaign_send — Scope key 'roles' rejeitado
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t24$
DECLARE v_result jsonb;
BEGIN
  PERFORM test_set_auth('a0000001-0001-4001-a001-000000000001'::uuid);

  SELECT public.fn_prepare_campaign_send('cc000002-0002-4002-c002-000000000002'::uuid)
  INTO v_result;

  IF (v_result->>'success')::boolean = false
     AND v_result->>'error' = 'invalid_target_scope_key' THEN
    RAISE NOTICE '[PASS] T24: Scope key "roles" rejeitado -> invalid_target_scope_key';
  ELSE
    RAISE EXCEPTION '[FAIL] T24: Esperado invalid_target_scope_key, obteve: %', v_result;
  END IF;

  PERFORM test_clear_auth();
END $t24$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T25: fn_prepare_campaign_send — 0 deliveries retorna erro
--      v1.2: erro e 'no_deliveries' (nao 'no_recipients')
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t25$
DECLARE v_result jsonb;
BEGIN
  PERFORM test_set_auth('a0000004-0004-4004-a004-000000000004'::uuid);

  SELECT public.fn_prepare_campaign_send('cc000003-0003-4003-c003-000000000003'::uuid)
  INTO v_result;

  IF (v_result->>'success')::boolean = false
     AND v_result->>'error' = 'no_deliveries' THEN
    RAISE NOTICE '[PASS] T25: 0 deliveries -> no_deliveries';
  ELSE
    RAISE EXCEPTION '[FAIL] T25: Esperado no_deliveries, obteve: %', v_result;
  END IF;

  PERFORM test_clear_auth();
END $t25$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T26: fn_prepare_campaign_send — Campanha valida com recipients
--      Channel 'email', sem scope → 4 employees com email (emp_1,2,4,5)
--      v1.2: dedup normaliza email → emp_1 e emp_4 tem mesmo email (case diff)
--      Resultado: 4 recipients, 3 deliveries (emp_1/emp_4 deduplicados por email)
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t26$
DECLARE
  v_result          jsonb;
  v_delivery_count  int;
BEGIN
  PERFORM test_set_auth('a0000001-0001-4001-a001-000000000001'::uuid);

  SELECT public.fn_prepare_campaign_send('cc000001-0001-4001-c001-000000000001'::uuid)
  INTO v_result;

  IF (v_result->>'success')::boolean = true
     AND (v_result->>'total_recipients')::int = 4
     AND (v_result->>'total_deliveries')::int = 3 THEN
    RAISE NOTICE '[PASS] T26: Campanha valida com 4 recipients, 3 deliveries (dedup email)';
  ELSE
    RAISE EXCEPTION '[FAIL] T26: Esperado 4 recipients + 3 deliveries, obteve: %', v_result;
  END IF;

  PERFORM test_clear_auth();
END $t26$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T27: fn_prepare_campaign_send — Cross-tenant retorna forbidden
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t27$
DECLARE v_result jsonb;
BEGIN
  PERFORM test_set_auth('a0000001-0001-4001-a001-000000000001'::uuid);

  SELECT public.fn_prepare_campaign_send('cc000004-0004-4004-c004-000000000004'::uuid)
  INTO v_result;

  IF (v_result->>'success')::boolean = false
     AND v_result->>'error' = 'forbidden' THEN
    RAISE NOTICE '[PASS] T27: Cross-tenant campaign -> forbidden';
  ELSE
    RAISE EXCEPTION '[FAIL] T27: Esperado forbidden, obteve: %', v_result;
  END IF;

  PERFORM test_clear_auth();
END $t27$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T28: fn_prepare_campaign_send — UUID invalido em establishment_ids
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t28$
DECLARE v_result jsonb;
BEGIN
  PERFORM test_set_auth('a0000001-0001-4001-a001-000000000001'::uuid);

  SELECT public.fn_prepare_campaign_send('cc000005-0005-4005-c005-000000000005'::uuid)
  INTO v_result;

  IF (v_result->>'success')::boolean = false
     AND v_result->>'error' = 'invalid_establishment_ids' THEN
    RAISE NOTICE '[PASS] T28: UUID invalido em establishment_ids -> invalid_establishment_ids';
  ELSE
    RAISE EXCEPTION '[FAIL] T28: Esperado invalid_establishment_ids, obteve: %', v_result;
  END IF;

  PERFORM test_clear_auth();
END $t28$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T29: fn_prepare_campaign_send — Channel 'both' com deliveries independentes
--      v1.2: OR (email OU phone)
--      emp_1: email + phone → 2 deliveries (email + whatsapp)
--      emp_2: email only → 1 delivery (email)
--      emp_3: phone only → 1 delivery (whatsapp)
--      emp_4: email(dup) + phone → email deduped, 1 whatsapp delivery
--      emp_5: email + phone(dup) → 1 email, whatsapp deduped
--      Recipients: 5
--      Email deliveries: 3 (emp1, emp2, emp5 — emp4 deduped)
--      WhatsApp deliveries: 3 (emp1, emp3, emp4 — emp5 deduped)
--      Total deliveries: 6
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t29$
DECLARE
  v_result          jsonb;
  v_email_del       int;
  v_whatsapp_del    int;
BEGIN
  PERFORM test_set_auth('a0000001-0001-4001-a001-000000000001'::uuid);

  SELECT public.fn_prepare_campaign_send('cc000006-0006-4006-c006-000000000006'::uuid)
  INTO v_result;

  -- Contar deliveries por canal
  SELECT count(*) INTO v_email_del
  FROM public.campaign_deliveries
  WHERE campaign_id = 'cc000006-0006-4006-c006-000000000006' AND channel = 'email';

  SELECT count(*) INTO v_whatsapp_del
  FROM public.campaign_deliveries
  WHERE campaign_id = 'cc000006-0006-4006-c006-000000000006' AND channel = 'whatsapp';

  IF (v_result->>'success')::boolean = true
     AND (v_result->>'total_recipients')::int = 5
     AND (v_result->>'total_deliveries')::int = 6
     AND v_email_del = 3
     AND v_whatsapp_del = 3 THEN
    RAISE NOTICE '[PASS] T29: Channel "both" OR: 5 recipients, 6 deliveries (3 email + 3 whatsapp)';
  ELSE
    RAISE EXCEPTION '[FAIL] T29: Esperado 5 recipients, 6 deliveries (3e+3w). Obteve: % (email=%, whatsapp=%)',
      v_result, v_email_del, v_whatsapp_del;
  END IF;

  PERFORM test_clear_auth();
END $t29$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T30: ACL — fn_record_pin_failure NAO acessivel por anon
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t30$
DECLARE v_can_exec boolean;
BEGIN
  SELECT has_function_privilege('anon', 'public.fn_record_pin_failure(text,text)', 'EXECUTE')
  INTO v_can_exec;

  IF NOT v_can_exec THEN
    RAISE NOTICE '[PASS] T30: fn_record_pin_failure NAO acessivel por anon';
  ELSE
    RAISE EXCEPTION '[FAIL] T30: fn_record_pin_failure NAO deveria ser acessivel por anon';
  END IF;
END $t30$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T31: ACL — fn_check_pin_rate_limit_v2 NAO acessivel por authenticated
--      v1.2.1: assinatura (text,text,int,int,int)
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t31$
DECLARE v_can_exec boolean;
BEGIN
  SELECT has_function_privilege('authenticated', 'public.fn_check_pin_rate_limit_v2(text,text,integer,integer,integer)', 'EXECUTE')
  INTO v_can_exec;

  IF NOT v_can_exec THEN
    RAISE NOTICE '[PASS] T31: fn_check_pin_rate_limit_v2 NAO acessivel por authenticated';
  ELSE
    RAISE EXCEPTION '[FAIL] T31: fn_check_pin_rate_limit_v2 NAO deveria ser acessivel por authenticated';
  END IF;
END $t31$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T32: ACL — fn_submit_complaint IS acessivel por anon
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t32$
DECLARE v_can_exec boolean;
BEGIN
  SELECT has_function_privilege('anon',
    'public.fn_submit_complaint(text,text,text,text,boolean,text,text,text,text,text,text)',
    'EXECUTE')
  INTO v_can_exec;

  IF v_can_exec THEN
    RAISE NOTICE '[PASS] T32: fn_submit_complaint acessivel por anon';
  ELSE
    RAISE EXCEPTION '[FAIL] T32: fn_submit_complaint DEVERIA ser acessivel por anon';
  END IF;
END $t32$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T33: fn_check_pin_rate_limit_v2 — DUAL: bloqueia por ip_hash
--      v1.2.1: mesmo IP com protocolos diferentes, bloqueia no limite global de IP
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t33$
DECLARE
  v_rate_ok boolean;
  i integer;
BEGIN
  -- Limpar dados de teste
  DELETE FROM public.complaint_pin_attempts
  WHERE protocol LIKE 'TSTIP%' OR ip_hash = 'hmac-shared-ip-hash';

  -- Registrar 20 falhas com o mesmo ip_hash, cada uma em protocolo diferente
  -- (nenhum protocolo individualmente atinge o limite de 5)
  FOR i IN 1..20 LOOP
    PERFORM public.fn_record_pin_failure('TSTIP' || lpad(i::text, 3, '0'), 'hmac-shared-ip-hash');
  END LOOP;

  -- Protocolo novo, mesmo ip_hash → deve ser bloqueado pelo limite de IP (20)
  SELECT public.fn_check_pin_rate_limit_v2('TSTIP_NEW', 'hmac-shared-ip-hash', 5, 15, 20)
  INTO v_rate_ok;

  IF NOT v_rate_ok THEN
    RAISE NOTICE '[PASS] T33: Rate limit DUAL bloqueou por ip_hash (20 tentativas distribuidas)';
  ELSE
    RAISE EXCEPTION '[FAIL] T33: Rate limit deveria bloquear por ip_hash apos 20 tentativas';
  END IF;

  -- Limpar
  DELETE FROM public.complaint_pin_attempts
  WHERE protocol LIKE 'TSTIP%' OR ip_hash = 'hmac-shared-ip-hash';
END $t33$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T34: fn_prepare_campaign_send — jsonb_typeof invalido (establishment_ids como string)
--      v1.2: retorna invalid_target_scope_format, nao exception SQL
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t34$
DECLARE v_result jsonb;
BEGIN
  PERFORM test_set_auth('a0000001-0001-4001-a001-000000000001'::uuid);

  SELECT public.fn_prepare_campaign_send('cc000007-0007-4007-c007-000000000007'::uuid)
  INTO v_result;

  IF (v_result->>'success')::boolean = false
     AND v_result->>'error' = 'invalid_target_scope_format' THEN
    RAISE NOTICE '[PASS] T34: jsonb_typeof invalido -> invalid_target_scope_format';
  ELSE
    RAISE EXCEPTION '[FAIL] T34: Esperado invalid_target_scope_format, obteve: %', v_result;
  END IF;

  PERFORM test_clear_auth();
END $t34$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T35: ACL — fn_access_complaint_v2 NAO acessivel por anon
--      v1.2.1: mudou de anon+authenticated para service_role only
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t35$
DECLARE
  v_anon_exec boolean;
  v_auth_exec boolean;
  v_svc_exec  boolean;
BEGIN
  SELECT has_function_privilege('anon', 'public.fn_access_complaint_v2(text,text,text)', 'EXECUTE')
  INTO v_anon_exec;

  SELECT has_function_privilege('authenticated', 'public.fn_access_complaint_v2(text,text,text)', 'EXECUTE')
  INTO v_auth_exec;

  SELECT has_function_privilege('service_role', 'public.fn_access_complaint_v2(text,text,text)', 'EXECUTE')
  INTO v_svc_exec;

  IF NOT v_anon_exec AND NOT v_auth_exec AND v_svc_exec THEN
    RAISE NOTICE '[PASS] T35: fn_access_complaint_v2 service_role ONLY (anon=%, auth=%, svc=%)',
      v_anon_exec, v_auth_exec, v_svc_exec;
  ELSE
    RAISE EXCEPTION '[FAIL] T35: fn_access_complaint_v2 deveria ser service_role ONLY. anon=%, auth=%, svc=%',
      v_anon_exec, v_auth_exec, v_svc_exec;
  END IF;
END $t35$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T36: ACL — fn_send_reporter_message_v2 NAO acessivel por anon
--      v1.2.1: mudou de anon+authenticated para service_role only
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t36$
DECLARE
  v_anon_exec boolean;
  v_auth_exec boolean;
  v_svc_exec  boolean;
BEGIN
  SELECT has_function_privilege('anon', 'public.fn_send_reporter_message_v2(text,text,text,text)', 'EXECUTE')
  INTO v_anon_exec;

  SELECT has_function_privilege('authenticated', 'public.fn_send_reporter_message_v2(text,text,text,text)', 'EXECUTE')
  INTO v_auth_exec;

  SELECT has_function_privilege('service_role', 'public.fn_send_reporter_message_v2(text,text,text,text)', 'EXECUTE')
  INTO v_svc_exec;

  IF NOT v_anon_exec AND NOT v_auth_exec AND v_svc_exec THEN
    RAISE NOTICE '[PASS] T36: fn_send_reporter_message_v2 service_role ONLY (anon=%, auth=%, svc=%)',
      v_anon_exec, v_auth_exec, v_svc_exec;
  ELSE
    RAISE EXCEPTION '[FAIL] T36: fn_send_reporter_message_v2 deveria ser service_role ONLY. anon=%, auth=%, svc=%',
      v_anon_exec, v_auth_exec, v_svc_exec;
  END IF;
END $t36$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T37: check_plan_limit — Overload com tenant_id explicito
--      v1.2: check_plan_limit(uuid, text) para usuarios multi-org
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t37$
DECLARE v_result jsonb;
BEGIN
  -- user_a: owner de org_alpha
  PERFORM test_set_auth('a0000001-0001-4001-a001-000000000001'::uuid);

  SELECT public.check_plan_limit(
    'b0000001-0001-4001-b001-000000000001'::uuid,
    'establishments'
  ) INTO v_result;

  IF v_result->>'allowed' IS NOT NULL THEN
    RAISE NOTICE '[PASS] T37: check_plan_limit(uuid, text) retorna allowed=% (limit=%, current=%)',
      v_result->>'allowed', v_result->>'limit', v_result->>'current';
  ELSE
    RAISE EXCEPTION '[FAIL] T37: Esperado resultado valido, obteve: %', v_result;
  END IF;

  PERFORM test_clear_auth();
END $t37$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T38: check_plan_limit — Overload com tenant_id: forbidden para non-member
--      v1.2: Verifica que caller precisa ser membro do tenant
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t38$
DECLARE v_result jsonb;
BEGIN
  -- user_d: owner de org_beta (NAO membro de org_alpha)
  PERFORM test_set_auth('a0000004-0004-4004-a004-000000000004'::uuid);

  SELECT public.check_plan_limit(
    'b0000001-0001-4001-b001-000000000001'::uuid,  -- org_alpha
    'establishments'
  ) INTO v_result;

  IF (v_result->>'allowed')::boolean = false
     AND v_result->>'reason' = 'forbidden' THEN
    RAISE NOTICE '[PASS] T38: check_plan_limit(uuid, text) cross-tenant -> forbidden';
  ELSE
    RAISE EXCEPTION '[FAIL] T38: Esperado forbidden, obteve: %', v_result;
  END IF;

  PERFORM test_clear_auth();
END $t38$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T39: Dedup — Campanha 'both' com duplicatas de email normalizadas
--      Verifica que DISTINCT ON lower(trim(email)) elimina duplicatas
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t39$
DECLARE
  v_result          jsonb;
  v_email_del       int;
  v_whatsapp_del    int;
  v_total_del       int;
BEGIN
  PERFORM test_set_auth('a0000001-0001-4001-a001-000000000001'::uuid);

  SELECT public.fn_prepare_campaign_send('cc000008-0008-4008-c008-000000000008'::uuid)
  INTO v_result;

  -- Contar deliveries
  SELECT count(*) INTO v_email_del
  FROM public.campaign_deliveries
  WHERE campaign_id = 'cc000008-0008-4008-c008-000000000008' AND channel = 'email';

  SELECT count(*) INTO v_whatsapp_del
  FROM public.campaign_deliveries
  WHERE campaign_id = 'cc000008-0008-4008-c008-000000000008' AND channel = 'whatsapp';

  v_total_del := v_email_del + v_whatsapp_del;

  -- Email dedup: emp1@test.local e EMP1@TEST.LOCAL → 1 delivery
  -- Emails unicos: emp2@test.local, emp5@test.local → 2 deliveries
  -- Total email: 3
  -- Phone dedup: +5511999990001 e +55 11 99999-0001 → 1 delivery (apos normalizar)
  -- Phones unicos: +5511999990003, +5511999990004 → 2 deliveries
  -- Total whatsapp: 3
  IF v_email_del = 3 AND v_whatsapp_del = 3 THEN
    RAISE NOTICE '[PASS] T39: Dedup: 3 email + 3 whatsapp = % deliveries (duplicatas eliminadas)', v_total_del;
  ELSE
    RAISE EXCEPTION '[FAIL] T39: Esperado 3 email + 3 whatsapp. Obteve email=%, whatsapp=%',
      v_email_del, v_whatsapp_del;
  END IF;

  PERFORM test_clear_auth();
END $t39$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T40: fn_check_pin_rate_limit_v2 — ip_hash NULL nao bloqueia por IP
--      v1.2.1: se ip_hash e NULL ou vazio, so aplica limite por protocolo
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t40$
DECLARE
  v_rate_ok boolean;
  i integer;
BEGIN
  DELETE FROM public.complaint_pin_attempts WHERE protocol = 'TSTIPNULL';

  -- Registrar 3 falhas (abaixo do limite de protocolo de 5)
  FOR i IN 1..3 LOOP
    PERFORM public.fn_record_pin_failure('TSTIPNULL', NULL);
  END LOOP;

  -- ip_hash NULL → so verifica limite por protocolo (3 < 5 → permitido)
  SELECT public.fn_check_pin_rate_limit_v2('TSTIPNULL', NULL, 5, 15, 20)
  INTO v_rate_ok;

  IF v_rate_ok THEN
    RAISE NOTICE '[PASS] T40: ip_hash NULL nao aplica limite por IP (3 < 5 por protocolo)';
  ELSE
    RAISE EXCEPTION '[FAIL] T40: ip_hash NULL nao deveria bloquear com 3 tentativas (limite=5)';
  END IF;

  DELETE FROM public.complaint_pin_attempts WHERE protocol = 'TSTIPNULL';
END $t40$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T41: fn_send_reporter_message_v2 — PIN correto em denuncia pendente aceita mensagem
--      v1.2.1: assinatura (text,text,text,text) com p_caller_ip_hash
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t41$
DECLARE v_result jsonb;
BEGIN
  DELETE FROM public.complaint_pin_attempts WHERE protocol = 'TSTACC01';

  SELECT public.fn_send_reporter_message_v2('TSTACC01', '654321', 'Mensagem teste T41', 'hash-t41')
  INTO v_result;

  IF (v_result->>'success')::boolean = true
     AND v_result->>'message_id' IS NOT NULL THEN
    RAISE NOTICE '[PASS] T41: Mensagem aceita em denuncia pendente (message_id=%)', v_result->>'message_id';
  ELSE
    RAISE EXCEPTION '[FAIL] T41: Esperado success=true com message_id, obteve: %', v_result;
  END IF;
END $t41$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- T42: ACL — check_plan_limit(uuid, text) acessivel por authenticated e service_role
-- ═══════════════════════════════════════════════════════════════════════════════

DO $t42$
DECLARE
  v_anon_exec boolean;
  v_auth_exec boolean;
  v_svc_exec  boolean;
BEGIN
  SELECT has_function_privilege('anon', 'public.check_plan_limit(uuid,text)', 'EXECUTE')
  INTO v_anon_exec;

  SELECT has_function_privilege('authenticated', 'public.check_plan_limit(uuid,text)', 'EXECUTE')
  INTO v_auth_exec;

  SELECT has_function_privilege('service_role', 'public.check_plan_limit(uuid,text)', 'EXECUTE')
  INTO v_svc_exec;

  IF NOT v_anon_exec AND v_auth_exec AND v_svc_exec THEN
    RAISE NOTICE '[PASS] T42: check_plan_limit(uuid,text) ACL correto (anon=%, auth=%, svc=%)',
      v_anon_exec, v_auth_exec, v_svc_exec;
  ELSE
    RAISE EXCEPTION '[FAIL] T42: check_plan_limit(uuid,text) ACL incorreto. anon=%, auth=%, svc=%',
      v_anon_exec, v_auth_exec, v_svc_exec;
  END IF;
END $t42$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- CLEANUP: Remover todos os dados de teste
-- ═══════════════════════════════════════════════════════════════════════════════

DO $cleanup$
DECLARE
  v_org_alpha uuid := 'b0000001-0001-4001-b001-000000000001';
  v_org_beta  uuid := 'b0000002-0002-4002-b002-000000000002';
  v_user_a uuid := 'a0000001-0001-4001-a001-000000000001';
  v_user_b uuid := 'a0000002-0002-4002-a002-000000000002';
  v_user_c uuid := 'a0000003-0003-4003-a003-000000000003';
  v_user_d uuid := 'a0000004-0004-4004-a004-000000000004';
  v_user_e uuid := 'a0000005-0005-4005-a005-000000000005';
  v_user_f uuid := 'a0000006-0006-4006-a006-000000000006';
  v_user_g uuid := 'a0000007-0007-4007-a007-000000000007';
  v_plan_id uuid := 'd0000001-0001-4001-d001-000000000001';
BEGIN
  PERFORM test_clear_auth();

  -- Rate limit attempts
  DELETE FROM public.complaint_pin_attempts WHERE protocol LIKE 'TST%';

  -- Campaign chain (deliveries -> recipients -> campaigns)
  DELETE FROM public.campaign_acknowledgments
  WHERE campaign_id IN (SELECT id FROM public.campaigns WHERE tenant_id IN (v_org_alpha, v_org_beta));
  DELETE FROM public.campaign_deliveries
  WHERE campaign_id IN (SELECT id FROM public.campaigns WHERE tenant_id IN (v_org_alpha, v_org_beta));
  DELETE FROM public.campaign_recipients
  WHERE campaign_id IN (SELECT id FROM public.campaigns WHERE tenant_id IN (v_org_alpha, v_org_beta));
  DELETE FROM public.campaigns WHERE tenant_id IN (v_org_alpha, v_org_beta);

  -- Complaint chain (audit_log, messages, investigators, contents -> complaints)
  DELETE FROM public.complaint_audit_log
  WHERE complaint_id IN (SELECT id FROM public.complaints WHERE tenant_id IN (v_org_alpha, v_org_beta));
  DELETE FROM public.complaint_messages
  WHERE complaint_id IN (SELECT id FROM public.complaints WHERE tenant_id IN (v_org_alpha, v_org_beta));
  DELETE FROM public.complaint_investigators
  WHERE complaint_id IN (SELECT id FROM public.complaints WHERE tenant_id IN (v_org_alpha, v_org_beta));
  DELETE FROM public.complaint_contents
  WHERE complaint_id IN (SELECT id FROM public.complaints WHERE tenant_id IN (v_org_alpha, v_org_beta));
  DELETE FROM public.complaints WHERE tenant_id IN (v_org_alpha, v_org_beta);

  -- Employee profiles
  DELETE FROM public.employee_profiles WHERE tenant_id IN (v_org_alpha, v_org_beta);

  -- Departments and establishments
  DELETE FROM public.departments WHERE tenant_id IN (v_org_alpha, v_org_beta);
  DELETE FROM public.establishments WHERE tenant_id IN (v_org_alpha, v_org_beta);

  -- Organization audit log
  DELETE FROM public.organization_audit_log WHERE tenant_id IN (v_org_alpha, v_org_beta);

  -- Organization members
  DELETE FROM public.organization_members WHERE tenant_id IN (v_org_alpha, v_org_beta);

  -- Subscriptions
  DELETE FROM public.tenant_subscriptions WHERE tenant_id IN (v_org_alpha, v_org_beta);
  DELETE FROM public.subscription_plans WHERE id = v_plan_id;

  -- Organizations
  DELETE FROM public.organizations WHERE id IN (v_org_alpha, v_org_beta);

  -- Profiles and users
  DELETE FROM public.profiles WHERE id IN (v_user_a, v_user_b, v_user_c, v_user_d, v_user_e, v_user_f, v_user_g);
  DELETE FROM auth.users WHERE id IN (v_user_a, v_user_b, v_user_c, v_user_d, v_user_e, v_user_f, v_user_g);

  RAISE NOTICE '[CLEANUP] Dados de teste removidos';
END $cleanup$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- RESUMO
-- ═══════════════════════════════════════════════════════════════════════════════

DO $summary$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '══════════════════════════════════════════════════════════════';
  RAISE NOTICE ' SEC-BLOCK1-CONSOLIDATION v1.2.1 — Suite de Testes Funcionais';
  RAISE NOTICE '══════════════════════════════════════════════════════════════';
  RAISE NOTICE ' T01-T04: fn_submit_complaint (PIN, formato, tenant)';
  RAISE NOTICE ' T05-T07: fn_access_complaint_v2 (PIN correto/incorreto, anti-enum)';
  RAISE NOTICE ' T08-T10: Rate limiting (record, block, allow)';
  RAISE NOTICE ' T11:     fn_send_reporter_message_v2 (denuncia resolvida)';
  RAISE NOTICE ' T12-T14: check_plan_limit (no_tenant, multi_org, unknown_metric)';
  RAISE NOTICE ' T15-T19: fn_remove_member (owner/viewer, cross-tenant, admin/owner,';
  RAISE NOTICE '          already_removed, auto-remocao)';
  RAISE NOTICE ' T20-T23: fn_get_complaint_list (multi-org, explicit tenant,';
  RAISE NOTICE '          paginacao, cross-tenant)';
  RAISE NOTICE ' T24-T29: fn_prepare_campaign_send (roles rejeitado, 0 deliveries,';
  RAISE NOTICE '          valida+dedup, cross-tenant, UUID invalido, channel both OR)';
  RAISE NOTICE ' T30-T32: ACL (record_pin_failure, check_rate_limit_v2, submit_complaint)';
  RAISE NOTICE ' T33:     Rate limit DUAL (bloqueio por ip_hash distribuido)';
  RAISE NOTICE ' T34:     jsonb_typeof invalido -> erro controlado';
  RAISE NOTICE ' T35-T36: ACL (fn_access_complaint_v2, fn_send_reporter_message_v2 svc only)';
  RAISE NOTICE ' T37-T38: check_plan_limit overload (tenant_id + cross-tenant)';
  RAISE NOTICE ' T39:     Dedup (email normalizado + phone normalizado)';
  RAISE NOTICE ' T40:     Rate limit ip_hash NULL (so protocolo)';
  RAISE NOTICE ' T41:     fn_send_reporter_message_v2 aceita em denuncia pendente';
  RAISE NOTICE ' T42:     ACL check_plan_limit(uuid,text)';
  RAISE NOTICE '══════════════════════════════════════════════════════════════';
  RAISE NOTICE ' TOTAL: 42 testes';
  RAISE NOTICE ' Se todos passaram sem EXCEPTION, a suite esta verde.';
  RAISE NOTICE '══════════════════════════════════════════════════════════════';
END $summary$;
