-- =============================================================================
-- Neo SST — VERIFICAÇÃO DO BASELINE
-- =============================================================================
--
-- Compara um banco contra o estado observado em tvwgzpgyfdfrbdaeoqzl em
-- 29/07/2026. Somente leitura: nenhum SELECT toca dados de tabela, apenas
-- catálogos do PostgreSQL.
--
-- Uso previsto: ambiente descartável, após restaurar schema.sql + security.sql.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/baseline/verify.sql
--
-- Falha com EXCEPTION na primeira divergência. Saída silenciosa = aprovado.
--
-- ⚠️  Seguro para rodar contra o banco real (é read-only), mas os números
--     esperados refletem o snapshot: divergência pode significar tanto
--     corrupção do baseline quanto evolução legítima do banco desde então.
-- =============================================================================

\echo '== Verificação do baseline Neo SST =='

-- =============================================================================
-- 1. CONTAGENS ESTRUTURAIS
-- =============================================================================
DO $$
DECLARE
  v_tabelas   int;
  v_rls       int;
  v_funcoes   int;
  v_policies  int;
  v_tipos     int;
  v_triggers  int;
BEGIN
  SELECT count(*) INTO v_tabelas
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r';
  IF v_tabelas <> 39 THEN
    RAISE EXCEPTION 'Tabelas: esperado 39, encontrado %', v_tabelas;
  END IF;

  SELECT count(*) INTO v_rls
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity;
  IF v_rls <> 39 THEN
    RAISE EXCEPTION 'Tabelas com RLS: esperado 39, encontrado %', v_rls;
  END IF;

  SELECT count(*) INTO v_funcoes
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public';
  IF v_funcoes <> 50 THEN
    RAISE EXCEPTION 'Funções: esperado 50, encontrado %', v_funcoes;
  END IF;

  SELECT count(*) INTO v_policies
    FROM pg_policy pol JOIN pg_class c ON c.oid=pol.polrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public';
  IF v_policies <> 78 THEN
    RAISE EXCEPTION 'Policies: esperado 78, encontrado %', v_policies;
  END IF;

  SELECT count(DISTINCT t.typname) INTO v_tipos
    FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
    JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public';
  IF v_tipos <> 24 THEN
    RAISE EXCEPTION 'Enums: esperado 24, encontrado %', v_tipos;
  END IF;

  SELECT count(*) INTO v_triggers
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND NOT t.tgisinternal;
  IF v_triggers <> 31 THEN
    RAISE EXCEPTION 'Triggers: esperado 31, encontrado %', v_triggers;
  END IF;

  RAISE NOTICE 'OK 1/8 — contagens estruturais';
END $$;

-- =============================================================================
-- 2. NOMES DAS TABELAS
-- =============================================================================
DO $$
DECLARE
  v_esperadas text[] := ARRAY[
    'assessment_cycles','assessment_dispatches','assessment_invitations',
    'assessment_responses','billing_events','campaign_acknowledgments',
    'campaign_deliveries','campaign_recipients','campaign_templates','campaigns',
    'complaint_audit_log','complaint_contents','complaint_investigators',
    'complaint_messages','complaint_pin_attempts','complaints','departments',
    'employee_profiles','establishments','evidence_audit_log',
    'evidence_package_items','evidence_packages','evidence_reports','invoices',
    'organization_audit_log','organization_members','organizations','profiles',
    'questionnaire_items','questionnaire_sections','questionnaire_templates',
    'risk_action_plans','risk_audit_log','risk_items','risk_reviews',
    'subscription_plans','tenant_subscriptions','usage_records','webhook_events'];
  v_faltando text[];
BEGIN
  SELECT array_agg(t) INTO v_faltando FROM unnest(v_esperadas) t
   WHERE NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                      WHERE n.nspname='public' AND c.relkind='r' AND c.relname=t);
  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION 'Tabelas ausentes: %', array_to_string(v_faltando, ', ');
  END IF;
  RAISE NOTICE 'OK 2/8 — nomes das 39 tabelas';
END $$;

-- =============================================================================
-- 3. NENHUM GRANT A PUBLIC EM FUNÇÕES
-- =============================================================================
-- Entrada de ACL sem papel nomeado (forma '=X/') significa grant a PUBLIC.
DO $$
DECLARE v_vazamentos text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_vazamentos
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proacl::text ~ '(\{|,)=';
  IF v_vazamentos IS NOT NULL THEN
    RAISE EXCEPTION 'Funções com EXECUTE para PUBLIC: %', v_vazamentos;
  END IF;
  RAISE NOTICE 'OK 3/8 — nenhuma função executável por PUBLIC';
END $$;

-- =============================================================================
-- 4. FUNÇÕES PRIORITÁRIAS — assinatura, retorno, owner, prosecdef, proconfig
-- =============================================================================
DO $$
DECLARE r record;
BEGIN
  SELECT p.oid::regprocedure::text AS assinatura,
         pg_get_function_result(p.oid) AS retorno,
         pg_get_userbyid(p.proowner) AS owner,
         p.prosecdef, p.proconfig::text AS cfg, p.proacl::text AS acl
    INTO r
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='fn_resolve_tenant_id';

  IF r IS NULL THEN RAISE EXCEPTION 'fn_resolve_tenant_id ausente'; END IF;
  IF r.assinatura <> 'fn_resolve_tenant_id()' THEN
    RAISE EXCEPTION 'fn_resolve_tenant_id assinatura: %', r.assinatura; END IF;
  IF r.retorno <> 'uuid' THEN
    RAISE EXCEPTION 'fn_resolve_tenant_id retorno: esperado uuid, encontrado %', r.retorno; END IF;
  IF r.owner <> 'postgres' THEN
    RAISE EXCEPTION 'fn_resolve_tenant_id owner: %', r.owner; END IF;
  IF NOT r.prosecdef THEN
    RAISE EXCEPTION 'fn_resolve_tenant_id deve ser SECURITY DEFINER'; END IF;
  IF r.cfg IS NULL OR r.cfg NOT LIKE '%search_path%' THEN
    RAISE EXCEPTION 'fn_resolve_tenant_id sem search_path fixo: %', r.cfg; END IF;
  IF r.acl LIKE '%anon=X%' THEN
    RAISE EXCEPTION 'fn_resolve_tenant_id NÃO deve ser executável por anon'; END IF;

  RAISE NOTICE 'OK 4/8 — fn_resolve_tenant_id';
END $$;

-- =============================================================================
-- 5. fn_resolve_tenant_id — DEFINIÇÃO E DETERMINISMO
-- =============================================================================
DO $$
DECLARE
  v_def        text;
  v_tem_order  boolean := false;
  v_tg12       boolean := false;
  v_historicas integer := 0;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='fn_resolve_tenant_id';

  IF v_def NOT LIKE '%organization_members%' THEN
    RAISE EXCEPTION 'fn_resolve_tenant_id não consulta organization_members'; END IF;
  IF v_def NOT LIKE '%auth.uid()%' THEN
    RAISE EXCEPTION 'fn_resolve_tenant_id não usa auth.uid()'; END IF;
  IF v_def NOT LIKE '%deleted_at IS NULL%' THEN
    RAISE EXCEPTION 'fn_resolve_tenant_id não filtra membership inativa'; END IF;

  -- ── Determinismo: a expectativa depende do ESTADO, não é fixa ─────────────
  --
  -- Este arquivo passou a ser executado contra bancos em estágios diferentes:
  --
  --   baseline restaurado    schema.sql + security.sql, sem ledger de
  --                          migrations  -> TG-12 ainda não existe
  --   36 históricas          reconstrução parcial, ledger com as 36
  --                          -> TG-12 ainda não existe
  --   reconstrução completa  36 históricas + forward-only ordenadas
  --                          -> TG-12 aplicada, ORDER BY obrigatório
  --
  -- Fixar uma expectativa única tornaria o arquivo errado em dois dos três
  -- casos. A fonte da verdade sobre o estágio é o próprio ledger local — e
  -- NÃO o manifesto histórico, que continua com exatamente as 36 versões e
  -- não registra forward-only.
  v_tem_order := v_def ~* 'order\s+by';

  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    SELECT count(*) FILTER (WHERE version <= '20260728191324'),
           COALESCE(bool_or(version = '20260731094500'), false)
      INTO v_historicas, v_tg12
      FROM supabase_migrations.schema_migrations;
  END IF;

  IF v_tg12 THEN
    -- Estado reconstruído esperado: TG-12 aplicada.
    IF NOT v_tem_order THEN
      RAISE EXCEPTION 'TG-12 consta do ledger mas fn_resolve_tenant_id NÃO tem ORDER BY — migration não teve efeito';
    END IF;
    -- `\y` é a fronteira de palavra na regex do PostgreSQL; `\b` é backspace na
    -- ARE do POSIX e jamais casaria. Ver o mesmo comentário na migration.
    IF v_def !~* 'order\s+by[^;]*\ycreated_at\y'
       OR v_def !~* 'order\s+by[^;]*\yid\y' THEN
      RAISE EXCEPTION 'TG-12 aplicada com ordenação sem critério total (esperado created_at e id). Definição encontrada: %', v_def;
    END IF;
    RAISE NOTICE 'OK 5/8 — TG-12 no ledger e resolução determinística por created_at, id (% históricas)', v_historicas;
  ELSE
    -- Baseline ou reconstrução só das históricas: o snapshot NÃO tem ORDER BY.
    -- Encontrar ORDER BY aqui é incoerência, não melhoria: significa que a
    -- definição divergiu do estágio declarado pelo ledger.
    IF v_tem_order THEN
      RAISE EXCEPTION 'fn_resolve_tenant_id tem ORDER BY mas TG-12 não consta do ledger — estado incoerente com o estágio';
    END IF;
    RAISE NOTICE 'OK 5/8 — estágio sem TG-12: sem ORDER BY, conforme snapshot (% históricas no ledger; ver TG-12)', v_historicas;
  END IF;
END $$;

-- =============================================================================
-- 6. fn_create_organization_with_owner — DEFINIÇÃO E ACL
-- =============================================================================
DO $$
DECLARE r record; v_def text;
BEGIN
  SELECT p.oid::regprocedure::text AS assinatura,
         pg_get_function_result(p.oid) AS retorno,
         pg_get_userbyid(p.proowner) AS owner,
         p.prosecdef, p.proacl::text AS acl
    INTO r
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='fn_create_organization_with_owner';

  IF r IS NULL THEN RAISE EXCEPTION 'fn_create_organization_with_owner ausente'; END IF;
  IF r.assinatura <> 'fn_create_organization_with_owner(text,text,text)' THEN
    RAISE EXCEPTION 'assinatura inesperada: %', r.assinatura; END IF;
  IF r.retorno <> 'uuid' THEN
    RAISE EXCEPTION 'retorno: esperado uuid (snapshot), encontrado %', r.retorno; END IF;
  IF NOT r.prosecdef THEN
    RAISE EXCEPTION 'deve ser SECURITY DEFINER'; END IF;
  IF r.acl NOT LIKE '%authenticated=X%' THEN
    RAISE EXCEPTION 'authenticated deve ter EXECUTE'; END IF;
  IF r.acl NOT LIKE '%service_role=X%' THEN
    RAISE EXCEPTION 'service_role deve ter EXECUTE (estado do snapshot)'; END IF;
  IF r.acl LIKE '%anon=X%' THEN
    RAISE EXCEPTION 'anon NÃO deve ter EXECUTE'; END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='fn_create_organization_with_owner';
  IF v_def NOT LIKE '%auth.uid()%' THEN
    RAISE EXCEPTION 'não usa auth.uid()'; END IF;

  RAISE NOTICE 'OK 6/8 — fn_create_organization_with_owner';
END $$;

-- =============================================================================
-- 7. CONSTRAINTS CRÍTICAS
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
     WHERE c.relname='organization_members' AND con.contype='u'
       AND pg_get_constraintdef(con.oid)='UNIQUE (tenant_id, user_id)') THEN
    RAISE EXCEPTION 'organization_members: falta UNIQUE (tenant_id, user_id)'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
     WHERE c.relname='organizations' AND con.contype='u'
       AND pg_get_constraintdef(con.oid)='UNIQUE (slug)') THEN
    RAISE EXCEPTION 'organizations: falta UNIQUE (slug) global'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
     WHERE c.relname='organization_members' AND con.contype='f'
       AND pg_get_constraintdef(con.oid) LIKE '%auth.users(id)%') THEN
    RAISE EXCEPTION 'organization_members: falta FK para auth.users'; END IF;

  RAISE NOTICE 'OK 7/8 — constraints críticas';
END $$;

-- =============================================================================
-- 8. POLICIES DE TENANT — USING / WITH CHECK
-- =============================================================================
DO $$
DECLARE v_deps int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol JOIN pg_class c ON c.oid=pol.polrelid
     WHERE c.relname='organization_members' AND pol.polname='organization_members_select_tenant'
       AND pg_get_expr(pol.polqual,pol.polrelid) LIKE '%fn_resolve_tenant_id()%') THEN
    RAISE EXCEPTION 'policy organization_members_select_tenant ausente ou alterada'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol JOIN pg_class c ON c.oid=pol.polrelid
     WHERE c.relname='organizations' AND pol.polname='organizations_select_member'
       AND pg_get_expr(pol.polqual,pol.polrelid) LIKE '%fn_resolve_tenant_id()%') THEN
    RAISE EXCEPTION 'policy organizations_select_member ausente ou alterada'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol JOIN pg_class c ON c.oid=pol.polrelid
     WHERE c.relname='profiles' AND pol.polname='profiles_update_own'
       AND pg_get_expr(pol.polwithcheck,pol.polrelid) IS NOT NULL) THEN
    RAISE EXCEPTION 'profiles_update_own deve ter WITH CHECK'; END IF;

  -- Raio de impacto de fn_resolve_tenant_id (snapshot: 31 policies).
  SELECT count(*) INTO v_deps FROM pg_policy
   WHERE COALESCE(pg_get_expr(polqual,polrelid),'') LIKE '%fn_resolve_tenant_id%'
      OR COALESCE(pg_get_expr(polwithcheck,polrelid),'') LIKE '%fn_resolve_tenant_id%';
  IF v_deps <> 31 THEN
    RAISE EXCEPTION 'Policies dependentes de fn_resolve_tenant_id: esperado 31, encontrado %', v_deps; END IF;

  RAISE NOTICE 'OK 8/8 — policies de tenant (31 dependências confirmadas)';
END $$;

\echo '== Baseline verificado com sucesso =='
