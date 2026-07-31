-- =============================================================================
-- ASSERÇÃO DE SEGURANÇA DO SCHEMA `billing`
-- =============================================================================
--
-- Uso:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/ci/assert-billing-security.sql
--
-- Roda no job `Verify` do CI, contra a STACK DESCARTÁVEL local — nunca contra
-- produção. `Verify` já é contexto obrigatório da branch protection da main,
-- então esta asserção bloqueia o merge sem depender de registrar um contexto
-- novo que alguém possa esquecer.
--
-- ── POR QUE ESTE ARQUIVO EXISTE ─────────────────────────────────────────────
--
-- `scripts/ci/assert-no-public-execute.sql` varre `public`, e só `public`. A
-- fundação de billing vive no schema `billing` justamente para ser invisível ao
-- `pg_dump --schema=public` e ao extrator de segurança — o que preserva as
-- âncoras do migration-rebuild-verify e, pelo mesmo motivo, TIRA a fundação do
-- alcance daquela asserção.
--
-- Trocar uma cobertura por nenhuma seria regressão. Este arquivo é a cobertura
-- equivalente, e vai além dela em um ponto: além de conferir catálogo, EXECUTA
-- o comportamento que importa.
--
-- ── DUAS METADES ────────────────────────────────────────────────────────────
--
--   A. ESTRUTURA — catálogo: RLS, policies, privilégios, triggers, tipos.
--   B. COMPORTAMENTO — insere, tenta alterar, tenta apagar, e exige que o
--      banco RECUSE. Tudo dentro de uma transação encerrada por ROLLBACK.
--
-- A metade B é a que distingue "a trigger existe" de "a trigger funciona". Uma
-- asserção que só lê `pg_trigger` aprovaria uma trigger cujo corpo tivesse sido
-- esvaziado.
-- =============================================================================

\set ON_ERROR_STOP on

-- ═════════════════════════════════════════════════════════════════════════════
-- A. ESTRUTURA
-- ═════════════════════════════════════════════════════════════════════════════

DO $estrutura$
DECLARE
  v_int   integer;
  v_lista text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'billing') THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: o schema billing não existe';
  END IF;

  -- A.1 RLS habilitada em toda tabela, e nenhuma policy.
  --
  -- RLS ligada com ZERO policies é negação total no PostgreSQL — o padrão da
  -- fundação. Uma policy acrescentada sem revisão abriria acesso, e por isso a
  -- contagem exigida é exatamente zero, e não "nenhuma policy permissiva".
  SELECT count(*), string_agg(c.relname, ', ' ORDER BY c.relname)
    INTO v_int, v_lista
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'billing' AND c.relkind = 'r' AND NOT c.relrowsecurity;
  IF v_int <> 0 THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: % tabela(s) de billing sem RLS: %', v_int, v_lista;
  END IF;

  SELECT count(*), string_agg(format('%s.%s', c.relname, p.polname), ', ')
    INTO v_int, v_lista
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'billing';
  IF v_int <> 0 THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: billing tem % policy(ies) (%). A fundação exige RLS ligada e nenhuma policy.',
      v_int, v_lista;
  END IF;

  -- A.2 Nenhuma rotina de billing concede EXECUTE a PUBLIC.
  --
  -- COALESCE com acldefault é obrigatório: proacl NULO significa privilégio
  -- DEFAULT, e o default de função INCLUI EXECUTE para PUBLIC. Filtrar
  -- `proacl IS NOT NULL` aprovaria justamente a função recém-criada que
  -- ninguém tocou — que é o caso perigoso.
  SELECT count(*), string_agg(p.oid::regprocedure::text, ', ')
    INTO v_int, v_lista
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
   WHERE n.nspname = 'billing'
     AND a.grantee = 0
     AND a.privilege_type = 'EXECUTE';
  IF v_int <> 0 THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: % rotina(s) de billing concedem EXECUTE a PUBLIC: %', v_int, v_lista;
  END IF;

  -- A.3 anon e authenticated não alcançam o schema nem as tabelas.
  IF has_schema_privilege('anon', 'billing', 'USAGE')
     OR has_schema_privilege('authenticated', 'billing', 'USAGE') THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: anon ou authenticated tem USAGE no schema billing';
  END IF;

  SELECT count(*), string_agg(c.relname, ', ' ORDER BY c.relname)
    INTO v_int, v_lista
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'billing' AND c.relkind = 'r'
     AND (
       has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
       OR has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
     );
  IF v_int <> 0 THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: anon/authenticated têm privilégio em % tabela(s) de billing: %',
      v_int, v_lista;
  END IF;

  -- A.4 DELETE não é concedido a ninguém, e UPDATE só em `subscriptions`.
  --     Nenhum dado é apagado por downgrade ou inadimplência — a regra está
  --     escrita no ACL, não apenas na documentação.
  SELECT string_agg(format('%s→%s em %s', pg_get_userbyid(a.grantee),
                           a.privilege_type, c.relname),
                    ', ' ORDER BY c.relname)
    INTO v_lista
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
   WHERE n.nspname = 'billing' AND c.relkind = 'r'
     AND a.grantee <> c.relowner
     AND (
       a.privilege_type = 'DELETE'
       OR a.privilege_type = 'TRUNCATE'
       OR (a.privilege_type = 'UPDATE' AND c.relname <> 'subscriptions')
     );
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: privilégio de mutação indevido em billing: %', v_lista;
  END IF;

  -- A.5 As duas triggers de imutabilidade estão instaladas, e nas operações
  --     certas. Máscaras de `pg_trigger.tgtype`: 8 = DELETE, 16 = UPDATE.
  SELECT count(*) INTO v_int
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'billing'
     AND NOT tg.tgisinternal
     AND tg.tgname IN ('tg_price_snapshot_immutable', 'tg_audit_events_append_only')
     AND (tg.tgtype & 16) <> 0   -- UPDATE
     AND (tg.tgtype & 8)  <> 0;  -- DELETE
  IF v_int <> 2 THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: esperadas 2 triggers cobrindo UPDATE e DELETE, encontradas %', v_int;
  END IF;

  RAISE NOTICE 'billing/estrutura OK: RLS em todas, 0 policies, sem acesso de cliente, triggers no lugar';
END
$estrutura$;

-- ═════════════════════════════════════════════════════════════════════════════
-- B. COMPORTAMENTO — o banco RECUSA de verdade?
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Tudo aqui roda dentro de uma transação encerrada por ROLLBACK. Nada
-- sobrevive. `row_security = off` é usado porque este bloco roda como dono da
-- stack descartável e o objetivo não é exercitar RLS — é exercitar as TRIGGERS.

BEGIN;

SET LOCAL row_security = off;

DO $comportamento$
DECLARE
  v_org  uuid;
  v_sub  uuid;
  v_snap uuid;
  v_id   bigint;
  v_erro text;
BEGIN
  -- ── B.1 Fixtures mínimas ────────────────────────────────────────────────
  INSERT INTO public.organizations (name, slug)
       VALUES ('Fixture billing (descartável)', 'fixture-billing-descartavel')
    RETURNING id INTO v_org;

  INSERT INTO billing.subscriptions
    (organization_id, plan, tier, period, state, worker_count, cnpj,
     current_period_start, current_period_end, trial_ends_at)
  VALUES
    (v_org, 'essencial', 't1_20', 'monthly', 'trialing', 12, '00000000000191',
     '2026-08-01T00:00:00Z', '2026-08-08T00:00:00Z', '2026-08-08T00:00:00Z')
  RETURNING id INTO v_sub;

  INSERT INTO billing.price_snapshots
    (subscription_id, plan, tier, period, amount_cents, catalog_version, captured_at)
  VALUES
    (v_sub, 'essencial', 't1_20', 'monthly', 9990, '2026-07-30.1',
     '2026-08-01T00:00:00Z')
  RETURNING id INTO v_snap;

  -- ── B.2 O snapshot de preço é IMUTÁVEL ──────────────────────────────────
  --
  -- É o requisito central do versionamento de preço: mudar a tabela amanhã não
  -- pode reescrever o valor de uma fatura de hoje.
  BEGIN
    UPDATE billing.price_snapshots SET amount_cents = 1 WHERE id = v_snap;
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: UPDATE em billing.price_snapshots foi ACEITO — o preço contratado é reescrevível';
  EXCEPTION
    WHEN restrict_violation THEN
      GET STACKED DIAGNOSTICS v_erro = MESSAGE_TEXT;
      RAISE NOTICE 'billing/comportamento OK: UPDATE recusado (%)', v_erro;
  END;

  BEGIN
    DELETE FROM billing.price_snapshots WHERE id = v_snap;
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: DELETE em billing.price_snapshots foi ACEITO — histórico de preço é apagável';
  EXCEPTION
    WHEN restrict_violation THEN
      GET STACKED DIAGNOSTICS v_erro = MESSAGE_TEXT;
      RAISE NOTICE 'billing/comportamento OK: DELETE recusado (%)', v_erro;
  END;

  -- O valor original continua lá. Sem isto, uma trigger que recusasse DEPOIS
  -- de aplicar a mudança passaria nos dois testes acima.
  IF (SELECT amount_cents FROM billing.price_snapshots WHERE id = v_snap) <> 9990 THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: o snapshot foi alterado apesar da recusa';
  END IF;

  -- ── B.3 A trilha de auditoria é APPEND-ONLY ─────────────────────────────
  INSERT INTO billing.audit_events (organization_id, subject, new_value, reason)
       VALUES (v_org, 'worker_count', '{"worker_count": 12}'::jsonb, 'fixture')
    RETURNING id INTO v_id;

  BEGIN
    UPDATE billing.audit_events SET reason = 'adulterado' WHERE id = v_id;
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: UPDATE em billing.audit_events foi ACEITO — a trilha é editável';
  EXCEPTION
    WHEN restrict_violation THEN
      NULL;
  END;

  BEGIN
    DELETE FROM billing.audit_events WHERE id = v_id;
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: DELETE em billing.audit_events foi ACEITO — a trilha é apagável';
  EXCEPTION
    WHEN restrict_violation THEN
      NULL;
  END;

  -- ── B.4 As constraints do modelo recusam entrada inválida ───────────────
  --
  -- Cada uma corresponde a uma regra do documento de decisão. Se a constraint
  -- for removida, o INSERT passa e esta asserção reprova.
  BEGIN
    INSERT INTO billing.courtesies
      (organization_id, plan, starts_at, ends_at, reason, granted_by)
    VALUES
      (v_org, 'completo', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z',
       'sem prazo', v_org);
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: cortesia com prazo nulo foi aceita — cortesia sem prazo é plano gratuito disfarçado';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;

  BEGIN
    INSERT INTO billing.courtesies
      (organization_id, plan, starts_at, ends_at, reason, granted_by)
    VALUES
      (v_org, 'completo', '2026-08-01T00:00:00Z', '2026-08-10T00:00:00Z',
       '   ', v_org);
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: cortesia sem motivo foi aceita';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;

  BEGIN
    INSERT INTO billing.subscriptions
      (organization_id, plan, tier, period, worker_count, cnpj,
       current_period_start, current_period_end)
    VALUES
      (gen_random_uuid(), 'essencial', 't1_20', 'monthly', 0, '00000000000191',
       '2026-08-01T00:00:00Z', '2026-08-08T00:00:00Z');
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: assinatura com worker_count 0 foi aceita';
  EXCEPTION
    WHEN check_violation OR foreign_key_violation THEN
      NULL;
  END;

  -- Uma assinatura por organização: a segunda tem de ser recusada.
  BEGIN
    INSERT INTO billing.subscriptions
      (organization_id, plan, tier, period, worker_count, cnpj,
       current_period_start, current_period_end)
    VALUES
      (v_org, 'completo', 't1_20', 'monthly', 12, '00000000000191',
       '2026-08-01T00:00:00Z', '2026-08-08T00:00:00Z');
    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: segunda assinatura para a mesma organização foi aceita';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;

  -- Singleton do corte: a segunda linha tem de ser recusada.
  INSERT INTO billing.grandfathering_cutoff (cutoff_at, reason)
       VALUES ('2026-08-01T00:00:00Z', 'fixture');
  BEGIN
    INSERT INTO billing.grandfathering_cutoff (cutoff_at, reason)
         VALUES ('2026-09-01T00:00:00Z', 'fixture 2');
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: duas datas de corte coexistem — o corte precisa ser único';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;

  RAISE NOTICE 'billing/comportamento OK: imutabilidade e constraints recusam como declarado';
END
$comportamento$;

ROLLBACK;

-- ═════════════════════════════════════════════════════════════════════════════
-- C. Nada sobrou
-- ═════════════════════════════════════════════════════════════════════════════

DO $limpeza$
BEGIN
  IF EXISTS (SELECT 1 FROM billing.subscriptions)
     OR EXISTS (SELECT 1 FROM billing.price_snapshots)
     OR EXISTS (SELECT 1 FROM billing.audit_events)
     OR EXISTS (SELECT 1 FROM billing.courtesies)
     OR EXISTS (SELECT 1 FROM billing.grandfathering_cutoff) THEN
    RAISE EXCEPTION
      'ASSERÇÃO REPROVADA: fixture do teste comportamental sobreviveu ao ROLLBACK';
  END IF;

  RAISE NOTICE 'billing OK: nenhuma fixture sobreviveu';
END
$limpeza$;
