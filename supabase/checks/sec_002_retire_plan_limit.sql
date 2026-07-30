-- Verificação de SEC-002 — retirada de check_plan_limit
--
-- Extraída verbatim da cauda de
-- supabase/history/pre-reconciliation/20260728154500_sec_002_retire_plan_limit.sql
-- Corresponde à versão aplicada 20260728191311, cuja cauda NÃO integra o SQL
-- registrado no banco. Somente leitura. Ver ../checks/README.md.

SELECT
  p.oid::regprocedure::text AS signature,
  p.proacl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'check_plan_limit'
ORDER BY signature;
