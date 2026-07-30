-- Verificação de FIX-005 — fn_close_expired_assessment_cycles
--
-- Extraída verbatim da cauda de
-- supabase/history/pre-reconciliation/20260728155000_fix_005_close_expired_cycles.sql
-- Corresponde à versão aplicada 20260728191324, cuja cauda NÃO integra o SQL
-- registrado no banco. Somente leitura. Ver ../checks/README.md.

SELECT p.oid::regprocedure::text, p.prosecdef, p.proconfig, p.proacl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'fn_close_expired_assessment_cycles';
