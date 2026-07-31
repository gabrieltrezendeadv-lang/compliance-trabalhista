-- =============================================================================
-- VERIFICAÇÃO INDEPENDENTE — 20260801120000_billing_foundation
-- =============================================================================
--
-- Roda DEPOIS da aplicação, contra o banco de produção, e é INDEPENDENTE das
-- pós-condições embutidas na própria migration. A distinção não é formal: as
-- pós-condições rodam dentro da transação que aplica, foram escritas pela mesma
-- pessoa e carregam as mesmas suposições. Quando a suposição está errada, elas
-- erram junto — aconteceu na Fase 5A (`||` ambíguo) e na TG-12C (`\b` tratado
-- como fronteira de palavra).
--
-- Por isso este arquivo usa MÉTODO DIFERENTE onde é possível: onde a migration
-- explode ACL com `aclexplode`, aqui se pergunta ao PostgreSQL por
-- `has_schema_privilege` / `has_table_privilege` / `has_function_privilege`.
-- Duas leituras do mesmo fato por caminhos distintos; um erro de consulta
-- dificilmente aparece igual nos dois.
--
-- ── SOMENTE LEITURA, E SOMENTE CATÁLOGO ─────────────────────────────────────
--
-- Tudo dentro de `BEGIN TRANSACTION READ ONLY` encerrado por `ROLLBACK`.
-- Nenhuma fixture é criada e nenhuma tabela de negócio é lida. Teste de
-- comportamento com dado fabricado não roda em produção: o da imutabilidade do
-- price snapshot vive em `scripts/ci/assert-billing-security.sql`, executado
-- contra a stack descartável do CI.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. O schema existe, com as oito tabelas, RLS ligada e nenhuma policy
-- ─────────────────────────────────────────────────────────────────────────────

DO $estrutura$
DECLARE
  v_tabelas    integer;
  v_sem_rls    integer;
  v_policies   integer;
  v_faltando   text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'billing') THEN
    RAISE EXCEPTION 'VERIF 20260801120000: o schema billing não existe';
  END IF;

  SELECT string_agg(esperada, ', ' ORDER BY esperada)
    INTO v_faltando
    FROM unnest(ARRAY[
      'tiers', 'price_catalog', 'subscriptions', 'price_snapshots',
      'grandfathering_cutoff', 'grandfathered_organizations',
      'courtesies', 'audit_events', 'legacy_plan_state'
    ]) AS t(esperada)
   WHERE to_regclass('billing.' || quote_ident(t.esperada)) IS NULL;

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION 'VERIF 20260801120000: tabela(s) ausente(s) em billing: %', v_faltando;
  END IF;

  SELECT count(*) INTO v_tabelas
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'billing' AND c.relkind = 'r';
  IF v_tabelas <> 9 THEN
    RAISE EXCEPTION 'VERIF 20260801120000: billing tem % tabela(s), esperadas 9', v_tabelas;
  END IF;

  SELECT count(*) INTO v_sem_rls
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'billing' AND c.relkind = 'r' AND NOT c.relrowsecurity;
  IF v_sem_rls <> 0 THEN
    RAISE EXCEPTION 'VERIF 20260801120000: % tabela(s) de billing sem RLS', v_sem_rls;
  END IF;

  SELECT count(*) INTO v_policies
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'billing';
  IF v_policies <> 0 THEN
    RAISE EXCEPTION
      'VERIF 20260801120000: billing tem % policy(ies); a fundação exige RLS ligada e nenhuma',
      v_policies;
  END IF;

  RAISE NOTICE 'VERIF 20260801120000 OK: 9 tabelas, RLS em todas, 0 policies';
END
$estrutura$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1b. `search_path` fixado, FORCE ausente por decisão, service_role com BYPASSRLS
-- ─────────────────────────────────────────────────────────────────────────────
--
-- As três condições formam um conjunto: RLS ligada com zero policies só é
-- utilizável porque `service_role` contorna RLS, e FORCE está ausente porque
-- este próprio verificador lê as tabelas conectado como dono.

DO $configuracao$
DECLARE
  v_lista text;
  v_int   integer;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ')
    INTO v_lista
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'billing'
     AND NOT EXISTS (
       SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) cfg
        WHERE cfg LIKE 'search\_path=%'
     );
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION
      'VERIF 20260801120000: rotina(s) de billing sem search_path fixado: %', v_lista;
  END IF;

  SELECT count(*) INTO v_int
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'billing' AND c.relkind = 'r' AND c.relforcerowsecurity;
  IF v_int <> 0 THEN
    RAISE EXCEPTION
      'VERIF 20260801120000: % tabela(s) com FORCE RLS — a decisão da 12A é não usar FORCE',
      v_int;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'service_role' AND rolbypassrls
  ) THEN
    RAISE EXCEPTION
      'VERIF 20260801120000: service_role sem BYPASSRLS — a fundação ficaria inacessível ao servidor';
  END IF;

  RAISE NOTICE 'VERIF 20260801120000 OK: search_path fixado, sem FORCE, service_role contorna RLS';
END
$configuracao$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. anon e authenticated não alcançam nada — perguntado ao próprio PostgreSQL
-- ─────────────────────────────────────────────────────────────────────────────

DO $privilegios$
DECLARE
  r        record;
  v_papel  text;
  v_acusa  text := '';
BEGIN
  FOREACH v_papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_papel) THEN
      RAISE EXCEPTION 'VERIF 20260801120000: o papel % não existe neste banco', v_papel;
    END IF;

    IF has_schema_privilege(v_papel, 'billing', 'USAGE')
       OR has_schema_privilege(v_papel, 'billing', 'CREATE') THEN
      v_acusa := v_acusa || format(E'\n  %s alcança o schema billing', v_papel);
    END IF;

    FOR r IN
      SELECT c.oid::regclass::text AS tabela
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'billing' AND c.relkind = 'r'
       ORDER BY 1
    LOOP
      IF has_table_privilege(v_papel, r.tabela,
                             'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES') THEN
        v_acusa := v_acusa || format(E'\n  %s tem privilégio em %s', v_papel, r.tabela);
      END IF;
    END LOOP;

    FOR r IN
      SELECT p.oid::regprocedure::text AS rotina
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'billing'
       ORDER BY 1
    LOOP
      -- Se PUBLIC detiver EXECUTE, anon também detém: perguntar por anon cobre
      -- os dois casos por um caminho que não depende de ler `proacl`.
      IF has_function_privilege(v_papel, r.rotina, 'EXECUTE') THEN
        v_acusa := v_acusa || format(E'\n  %s pode executar %s', v_papel, r.rotina);
      END IF;
    END LOOP;
  END LOOP;

  IF v_acusa <> '' THEN
    RAISE EXCEPTION 'VERIF 20260801120000: schema billing alcançável pelo cliente:%', v_acusa;
  END IF;

  RAISE NOTICE 'VERIF 20260801120000 OK: anon e authenticated sem qualquer acesso a billing';
END
$privilegios$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Triggers de imutabilidade instaladas
-- ─────────────────────────────────────────────────────────────────────────────

DO $triggers$
DECLARE
  v_faltando text;
BEGIN
  SELECT string_agg(t.esperada, ', ' ORDER BY t.esperada)
    INTO v_faltando
    FROM unnest(ARRAY[
      'tg_price_snapshot_immutable',
      'tg_audit_events_append_only'
    ]) AS t(esperada)
   WHERE NOT EXISTS (
     SELECT 1
       FROM pg_trigger tg
       JOIN pg_class c ON c.oid = tg.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'billing'
        AND NOT tg.tgisinternal
        AND tg.tgname = t.esperada
   );

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION 'VERIF 20260801120000: trigger(s) de imutabilidade ausente(s): %', v_faltando;
  END IF;

  RAISE NOTICE 'VERIF 20260801120000 OK: as duas triggers de imutabilidade estão instaladas';
END
$triggers$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Catálogo aprovado — valores conferidos um a um, e não só pela fórmula
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A migration confere a IDENTIDADE `anual = mensal * 12 * 9 / 10`. Aqui os
-- doze valores são comparados contra a TABELA APROVADA, literal. Se a fórmula
-- estivesse errada nos dois lugares, a conferência por identidade aprovaria; a
-- conferência contra literais, não.

DO $catalogo$
DECLARE
  v_divergentes text;
  v_linhas      integer;
BEGIN
  SELECT count(*) INTO v_linhas
    FROM billing.price_catalog WHERE catalog_version = '2026-07-30.1';
  IF v_linhas <> 8 THEN
    RAISE EXCEPTION
      'VERIF 20260801120000: catálogo 2026-07-30.1 com % linha(s), esperadas 8', v_linhas;
  END IF;

  SELECT string_agg(
           format('%s/%s esperado %s/%s, encontrado %s/%s',
                  aprovado.plan, aprovado.tier,
                  aprovado.mensal, aprovado.anual,
                  coalesce(pc.monthly_cents::text, 'NULO'),
                  coalesce(pc.yearly_cents::text, 'NULO')),
           E'\n  ')
    INTO v_divergentes
    FROM (VALUES
      ('essencial', 't1_20',       9990, 107892),
      ('essencial', 't21_50',     16990, 183492),
      ('essencial', 't51_100',    34990, 377892),
      ('completo',  't1_20',      24990, 269892),
      ('completo',  't21_50',     39990, 431892),
      ('completo',  't51_100',    79990, 863892)
    ) AS aprovado(plan, tier, mensal, anual)
    LEFT JOIN billing.price_catalog pc
      ON pc.catalog_version = '2026-07-30.1'
     AND pc.plan::text = aprovado.plan
     AND pc.tier::text = aprovado.tier
   WHERE pc.monthly_cents IS DISTINCT FROM aprovado.mensal
      OR pc.yearly_cents  IS DISTINCT FROM aprovado.anual;

  IF v_divergentes IS NOT NULL THEN
    RAISE EXCEPTION E'VERIF 20260801120000: catálogo divergente do aprovado:\n  %', v_divergentes;
  END IF;

  -- Enterprise não pode ter preço de tabela: um valor ali passaria por checkout.
  IF EXISTS (
    SELECT 1 FROM billing.price_catalog
     WHERE catalog_version = '2026-07-30.1'
       AND tier = 'enterprise'
       AND (monthly_cents IS NOT NULL OR yearly_cents IS NOT NULL)
  ) THEN
    RAISE EXCEPTION
      'VERIF 20260801120000: Enterprise tem preço de tabela — deveria ser sob proposta';
  END IF;

  RAISE NOTICE 'VERIF 20260801120000 OK: catálogo confere com a tabela aprovada';
END
$catalogo$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Faixas, corte não fixado e planos antigos desativados
-- ─────────────────────────────────────────────────────────────────────────────

DO $estado$
DECLARE
  v_int integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM billing.tiers
     WHERE slug = 't1_20' AND min_workers = 1 AND max_workers = 20
  ) OR NOT EXISTS (
    SELECT 1 FROM billing.tiers
     WHERE slug = 't21_50' AND min_workers = 21 AND max_workers = 50
  ) OR NOT EXISTS (
    SELECT 1 FROM billing.tiers
     WHERE slug = 't51_100' AND min_workers = 51 AND max_workers = 100
  ) OR NOT EXISTS (
    SELECT 1 FROM billing.tiers
     WHERE slug = 'enterprise' AND min_workers = 101 AND max_workers IS NULL
  ) THEN
    RAISE EXCEPTION 'VERIF 20260801120000: as faixas de porte não são as aprovadas';
  END IF;

  -- A ativação do grandfathering é fase posterior. Corte fixado agora seria
  -- concessão de gratuidade permanente que ninguém autorizou nesta etapa.
  SELECT count(*) INTO v_int FROM billing.grandfathering_cutoff;
  IF v_int <> 0 THEN
    RAISE EXCEPTION
      'VERIF 20260801120000: a data de corte foi fixada, e a Etapa 12A não autoriza isso';
  END IF;

  SELECT count(*) INTO v_int
    FROM public.subscription_plans WHERE is_active IS DISTINCT FROM false;
  IF v_int <> 0 THEN
    RAISE EXCEPTION
      'VERIF 20260801120000: % plano(s) antigo(s) continuam ativos', v_int;
  END IF;

  -- Sem uma linha de estado anterior por plano, o rollback teria de presumir o
  -- valor de is_active — e presumir `true` estaria errado para plano que já era
  -- inativo e para plano com valor nulo.
  SELECT count(*) INTO v_int
    FROM public.subscription_plans p
   WHERE NOT EXISTS (
     SELECT 1 FROM billing.legacy_plan_state s WHERE s.plan_id = p.id
   );
  IF v_int <> 0 THEN
    RAISE EXCEPTION
      'VERIF 20260801120000: % plano(s) sem estado anterior capturado — o rollback '
      'não teria como restaurar o valor real', v_int;
  END IF;

  RAISE NOTICE 'VERIF 20260801120000 OK: faixas conferem, corte não fixado, planos inativos com estado capturado';
END
$estado$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. `public` continua sendo o que era
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A premissa que sustenta as âncoras do migration-rebuild-verify é que esta
-- migration NÃO cria objeto em `public`. Se criasse, o baseline e as duas
-- âncoras deixariam de valer sem que nada acusasse.

DO $publico$
DECLARE
  v_int  integer;
  v_lista text;
BEGIN
  SELECT count(*), string_agg(c.relname, ', ' ORDER BY c.relname)
    INTO v_int, v_lista
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND c.relname IN (
       'tiers', 'price_catalog', 'subscriptions', 'price_snapshots',
       'grandfathering_cutoff', 'grandfathered_organizations',
       'courtesies', 'audit_events', 'legacy_plan_state'
     );
  IF v_int <> 0 THEN
    RAISE EXCEPTION
      'VERIF 20260801120000: objeto da fundação criado em public: %', v_lista;
  END IF;

  SELECT count(*), string_agg(p.proname, ', ')
    INTO v_int, v_lista
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('fn_reject_mutation', 'fn_restore_legacy_plans');
  IF v_int <> 0 THEN
    RAISE EXCEPTION
      'VERIF 20260801120000: rotina da fundação criada em public: %', v_lista;
  END IF;

  RAISE NOTICE 'VERIF 20260801120000 OK: nenhum objeto da fundação em public';
END
$publico$;

ROLLBACK;
