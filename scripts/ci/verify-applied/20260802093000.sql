-- =============================================================================
-- VERIFICAÇÃO INDEPENDENTE — 20260802093000_billing_orchestration
-- =============================================================================
--
-- Roda DEPOIS da aplicação e é independente das pós-condições da própria
-- migration: aquelas rodam dentro da transação que aplica, escritas pela mesma
-- pessoa e com as mesmas suposições. Quando a suposição está errada, erram
-- junto.
--
-- Onde a migration explode ACL com `aclexplode`, aqui se pergunta ao PostgreSQL
-- por `has_table_privilege` / `has_schema_privilege`. Dois caminhos para o
-- mesmo fato.
--
-- SOMENTE LEITURA: `BEGIN TRANSACTION READ ONLY` … `ROLLBACK`. Nenhuma fixture.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. As quatro tabelas novas, com RLS e sem policy
-- ─────────────────────────────────────────────────────────────────────────────

DO $estrutura$
DECLARE
  v_faltando text;
  v_int      integer;
BEGIN
  SELECT string_agg(t.esperada, ', ' ORDER BY t.esperada)
    INTO v_faltando
    FROM unnest(ARRAY['customers', 'charges', 'idempotency_records', 'courtesy_revocations'])
         AS t(esperada)
   WHERE to_regclass('billing.' || quote_ident(t.esperada)) IS NULL;
  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION 'VERIF 20260802093000: tabela(s) ausente(s): %', v_faltando;
  END IF;

  -- A fundação da 12A tem de continuar inteira: esta migration é aditiva.
  SELECT string_agg(t.esperada, ', ' ORDER BY t.esperada)
    INTO v_faltando
    FROM unnest(ARRAY[
      'tiers', 'price_catalog', 'subscriptions', 'price_snapshots',
      'grandfathering_cutoff', 'grandfathered_organizations',
      'courtesies', 'audit_events', 'legacy_plan_state'
    ]) AS t(esperada)
   WHERE to_regclass('billing.' || quote_ident(t.esperada)) IS NULL;
  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION
      'VERIF 20260802093000: a 12B removeu tabela da 12A: %', v_faltando;
  END IF;

  SELECT count(*) INTO v_int
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'billing' AND c.relkind = 'r' AND NOT c.relrowsecurity;
  IF v_int <> 0 THEN
    RAISE EXCEPTION 'VERIF 20260802093000: % tabela(s) sem RLS', v_int;
  END IF;

  SELECT count(*) INTO v_int
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'billing';
  IF v_int <> 0 THEN
    RAISE EXCEPTION 'VERIF 20260802093000: billing tem % policy(ies)', v_int;
  END IF;

  RAISE NOTICE 'VERIF 20260802093000 OK: 4 tabelas novas, 12A intacta, RLS em todas, 0 policies';
END
$estrutura$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Cliente não alcança nada — perguntado ao próprio PostgreSQL
-- ─────────────────────────────────────────────────────────────────────────────

DO $privilegios$
DECLARE
  r       record;
  v_papel text;
  v_acusa text := '';
BEGIN
  FOREACH v_papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
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
  END LOOP;

  IF v_acusa <> '' THEN
    RAISE EXCEPTION 'VERIF 20260802093000: billing alcançável pelo cliente:%', v_acusa;
  END IF;

  -- DELETE para ninguém; UPDATE só em subscriptions e charges.
  FOR r IN
    SELECT c.relname, pg_get_userbyid(a.grantee) AS papel, a.privilege_type
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
     WHERE n.nspname = 'billing' AND c.relkind = 'r'
       AND a.grantee <> c.relowner
       AND (
         a.privilege_type IN ('DELETE', 'TRUNCATE')
         OR (a.privilege_type = 'UPDATE' AND c.relname NOT IN ('subscriptions', 'charges'))
       )
  LOOP
    v_acusa := v_acusa || format(E'\n  %s→%s em %s', r.papel, r.privilege_type, r.relname);
  END LOOP;

  IF v_acusa <> '' THEN
    RAISE EXCEPTION 'VERIF 20260802093000: privilégio de mutação indevido:%', v_acusa;
  END IF;

  RAISE NOTICE 'VERIF 20260802093000 OK: sem acesso de cliente, sem DELETE, UPDATE restrito';
END
$privilegios$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. As unicidades que sustentam a idempotência
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Sem elas, "duas tentativas concorrentes produzem um único resultado" seria
-- afirmação sem base: duas transações passariam pela mesma checagem em código.

DO $unicidade$
DECLARE
  v_cols text;
BEGIN
  SELECT string_agg(att.attname, ',' ORDER BY att.attnum)
    INTO v_cols
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
   WHERE con.conname = 'idempotency_chave_unica'
     AND con.conrelid = 'billing.idempotency_records'::regclass
     AND con.contype = 'u';

  IF v_cols IS DISTINCT FROM 'organization_id,scope,provider,key' THEN
    RAISE EXCEPTION
      'VERIF 20260802093000: a unicidade da idempotência é sobre (%), esperado '
      '(organization_id,scope,provider,key)', coalesce(v_cols, 'inexistente');
  END IF;

  SELECT string_agg(att.attname, ',' ORDER BY att.attnum)
    INTO v_cols
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
   WHERE con.conname = 'charges_externo_unico'
     AND con.conrelid = 'billing.charges'::regclass
     AND con.contype = 'u';

  IF v_cols IS DISTINCT FROM 'organization_id,provider,external_charge_id' THEN
    RAISE EXCEPTION
      'VERIF 20260802093000: a unicidade da cobrança é sobre (%)',
      coalesce(v_cols, 'inexistente');
  END IF;

  RAISE NOTICE 'VERIF 20260802093000 OK: unicidades de idempotência e de cobrança conferem';
END
$unicidade$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Auditoria ganhou as colunas, e continua append-only
-- ─────────────────────────────────────────────────────────────────────────────

DO $auditoria$
DECLARE
  v_faltando text;
  v_int      integer;
BEGIN
  SELECT string_agg(t.esperada, ', ' ORDER BY t.esperada)
    INTO v_faltando
    FROM unnest(ARRAY['subscription_id', 'origin', 'idempotency_key', 'correlation_id'])
         AS t(esperada)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'billing' AND table_name = 'audit_events'
        AND column_name = t.esperada
   );
  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION 'VERIF 20260802093000: audit_events sem coluna(s): %', v_faltando;
  END IF;

  SELECT count(*) INTO v_int
    FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'billing' AND NOT tg.tgisinternal
     AND tg.tgname IN ('tg_price_snapshot_immutable', 'tg_audit_events_append_only')
     AND (tg.tgtype & 16) <> 0 AND (tg.tgtype & 8) <> 0;
  IF v_int <> 2 THEN
    RAISE EXCEPTION
      'VERIF 20260802093000: a imutabilidade da 12A não sobreviveu ao ALTER TABLE (%)', v_int;
  END IF;

  RAISE NOTICE 'VERIF 20260802093000 OK: colunas de auditoria presentes, imutabilidade preservada';
END
$auditoria$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Nada em public, e search_path continua fixado
-- ─────────────────────────────────────────────────────────────────────────────

DO $publico$
DECLARE
  v_int   integer;
  v_lista text;
BEGIN
  SELECT count(*), string_agg(c.relname, ', ' ORDER BY c.relname)
    INTO v_int, v_lista
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND c.relname IN ('customers', 'charges', 'idempotency_records', 'courtesy_revocations');
  IF v_int <> 0 THEN
    RAISE EXCEPTION 'VERIF 20260802093000: objeto da 12B criado em public: %', v_lista;
  END IF;

  SELECT string_agg(p.oid::regprocedure::text, ', ')
    INTO v_lista
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'billing'
     AND NOT EXISTS (
       SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) cfg
        WHERE cfg LIKE 'search\_path=%'
     );
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION 'VERIF 20260802093000: rotina sem search_path fixado: %', v_lista;
  END IF;

  RAISE NOTICE 'VERIF 20260802093000 OK: nada em public, search_path fixado';
END
$publico$;

ROLLBACK;
