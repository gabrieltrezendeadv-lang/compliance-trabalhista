-- =============================================================================
-- FIX-006 — retirar EXECUTE de PUBLIC em fn_process_webhook_event
-- =============================================================================
--
-- Primeira migration forward-only posterior à reconciliação do histórico
-- (PR #11, merge 3d4ea939efd45c322595925a7ec429a569c7ef45). As 36 versões
-- históricas permanecem congeladas e não foram tocadas.
--
-- ── O QUE ISTO CORRIGE ──────────────────────────────────────────────────────
--
-- Numa reconstrução limpa a partir das 36 migrations, esta função — que é
-- SECURITY DEFINER — fica executável por PUBLIC, e portanto por `anon`. O
-- baseline registra que apenas o proprietário `postgres` e `service_role`
-- devem executá-la.
--
--   ACL observada no banco reconstruído : {PUBLIC=X, postgres=X, service_role=X}
--   ACL registrada no baseline          : {postgres=X, service_role=X}
--
-- Constatado na Fase 4C — supabase/baseline/PHASE-4C-REBUILD-REPORT.md, §6.1.
--
-- ── DE ONDE VEM A DIVERGÊNCIA ───────────────────────────────────────────────
--
-- `20260726004007_sec001_revoke_public_execute_regrant.sql` revoga EXECUTE de
-- PUBLIC apenas das funções EXISTENTES naquele momento, e registra no próprio
-- corpo:
--
--   -- NOTE: ALTER DEFAULT PRIVILEGES skipped — requires superuser.
--   -- Each SEC migration includes its own explicit GRANT statements.
--
-- Ou seja, delega a cada migration posterior o seu próprio REVOKE. Das oito
-- migrations que criam função depois dela, sete cumprem; a exceção é
-- `20260726004230_sec006_webhook_transactional_idempotent.sql`, que cria esta
-- função com assinatura nova (o 8º argumento passou de `text` para
-- `timestamptz`, o que a torna outra função) e emite apenas
-- `GRANT EXECUTE ... TO service_role`, sem nenhum REVOKE.
--
-- Em produção a lacuna não se manifesta porque o endurecimento de default
-- privileges (SEC-005) foi aplicado manualmente pelo dashboard, fora do
-- histórico de migrations — ver supabase/manual/. A exposição existe em
-- ambientes reconstruídos a partir do repositório: preview, staging, projeto
-- novo.
--
-- ── ESCOPO ──────────────────────────────────────────────────────────────────
--
-- Uma única operação. Esta migration NÃO:
--   * recria, substitui ou altera o corpo da função;
--   * altera owner, SECURITY DEFINER, search_path, volatilidade ou retorno;
--   * concede privilégio a papel algum — `service_role` já tem o seu, de
--     sec006, e nada é acrescentado;
--   * revoga de `anon` ou `authenticated` — nenhum dos dois consta da ACL, nem
--     no baseline nem no banco reconstruído, então revogar seria inventar uma
--     operação sem efeito;
--   * toca tabela, RLS, policy, trigger ou qualquer outra função;
--   * lê dado algum.
--
-- Em produção é no-op: PUBLIC já não detém o privilégio. O efeito é sobre toda
-- reconstrução futura.
--
-- Idempotente: `REVOKE` de privilégio não detido é no-op silencioso no
-- PostgreSQL. Aplicar duas vezes produz o mesmo estado.
--
-- ── ASSINATURA ──────────────────────────────────────────────────────────────
--
-- Existe exatamente UMA `fn_process_webhook_event` — sem overload. Conferido
-- em três fontes independentes:
--
--   1. supabase/baseline/schema.sql:1896 — dump de produção, uma só
--      `CREATE FUNCTION`;
--   2. a extração de catálogo da Fase 4C, nos dois bancos comparados, uma só
--      entrada;
--   3. supabase/baseline/security.sql:154 — um só GRANT, para `service_role`.
--
-- A referência à assinatura toda-`text` que aparece em sec001 estava dentro de
-- um `DO $grants$` com `EXCEPTION WHEN undefined_function ... RAISE NOTICE`:
-- era no-op, para uma função que nunca existiu com aquela assinatura.
--
-- Se a assinatura abaixo não corresponder a nenhuma função, este comando falha
-- com `undefined_function` e a migration aborta — em vez de silenciosamente
-- não fazer nada. É o comportamento desejado.
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.fn_process_webhook_event(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamp with time zone,
  jsonb
) FROM PUBLIC;

-- ── Pós-condição ────────────────────────────────────────────────────────────
--
-- A migration confere o próprio efeito. `proacl` nulo significa "privilégios
-- default do PostgreSQL", que INCLUEM EXECUTE para PUBLIC — por isso o
-- COALESCE com acldefault(): testar apenas `proacl` não nulo deixaria passar
-- exatamente o caso perigoso.
DO $$
DECLARE
  v_acl text;
BEGIN
  SELECT COALESCE(p.proacl, acldefault('f', p.proowner))::text
    INTO v_acl
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'fn_process_webhook_event';

  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace,
           aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
     WHERE n.nspname = 'public'
       AND p.proname = 'fn_process_webhook_event'
       AND a.grantee = 0
       AND a.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'FIX-006 falhou: PUBLIC ainda detém EXECUTE em fn_process_webhook_event (ACL: %)',
      v_acl;
  END IF;

  RAISE NOTICE 'FIX-006: PUBLIC não detém EXECUTE em fn_process_webhook_event (ACL: %)', v_acl;
END
$$;
