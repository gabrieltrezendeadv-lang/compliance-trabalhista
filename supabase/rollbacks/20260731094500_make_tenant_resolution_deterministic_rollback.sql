-- =============================================================================
-- ROLLBACK do TG-12 — restaura a resolução NÃO determinística
-- =============================================================================
--
-- Desfaz `supabase/migrations/20260731094500_make_tenant_resolution_deterministic.sql`
-- e nada além disso.
--
-- NÃO desfaz nem altera `20260730123613_revoke_public_webhook_execute.sql`:
-- as duas forward-only são independentes, tocam objetos diferentes
-- (`fn_process_webhook_event` × `fn_resolve_tenant_id`) e nenhuma depende da
-- outra.
--
-- ⚠️ Restaurar isto REINTRODUZ o TG-12: `LIMIT 1` sem `ORDER BY` volta a
--    escolher de forma não determinística a membership do usuário, e as 31
--    policies e `fn_user_has_role` voltam a herdar essa indeterminação. Só faz
--    sentido como reversão emergencial, nunca como estado desejado.
--
-- O corpo abaixo é a definição EXATA registrada em
-- `supabase/baseline/schema.sql:2174` — snapshot de 29/07/2026, o estado
-- aplicado em produção antes desta correção. Reproduzi-lo literalmente é o que
-- faz o `prosrc` voltar a ser idêntico ao anterior, e é o que o teste de
-- rollback confere.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_resolve_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT tenant_id
  FROM organization_members
  WHERE user_id = auth.uid()
    AND deleted_at IS NULL
  LIMIT 1;
$$;

-- ── Pós-condições do rollback ───────────────────────────────────────────────
DO $tg12rb$
DECLARE
  v_def      text;
  v_owner    text;
  v_config   text;
  v_policies integer;
BEGIN
  SELECT pg_get_functiondef(p.oid),
         pg_get_userbyid(p.proowner),
         COALESCE(array_to_string(p.proconfig, ','), '<NULO>')
    INTO v_def, v_owner, v_config
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_resolve_tenant_id';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'rollback TG-12: fn_resolve_tenant_id não encontrada';
  END IF;
  IF v_def ~* 'order\s+by' THEN
    RAISE EXCEPTION 'rollback TG-12: ORDER BY ainda presente — a reversão não teve efeito';
  END IF;
  IF v_def !~* 'deleted_at\s+is\s+null' THEN
    RAISE EXCEPTION 'rollback TG-12: filtro deleted_at IS NULL ausente';
  END IF;
  IF v_owner <> 'postgres' THEN
    RAISE EXCEPTION 'rollback TG-12: proprietário virou %, esperado postgres', v_owner;
  END IF;
  IF v_config <> 'search_path=public, pg_temp' THEN
    RAISE EXCEPTION 'rollback TG-12: search_path virou "%"', v_config;
  END IF;

  SELECT count(*) INTO v_policies
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND (COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '') LIKE '%fn_resolve_tenant_id%'
       OR COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), '') LIKE '%fn_resolve_tenant_id%');

  IF v_policies <> 31 THEN
    RAISE EXCEPTION 'rollback TG-12: esperadas 31 policies dependentes, encontradas %', v_policies;
  END IF;

  RAISE NOTICE 'rollback TG-12 aplicado: fn_resolve_tenant_id voltou ao estado do snapshot (sem ORDER BY). TG-12 REINTRODUZIDO.';
END
$tg12rb$;
