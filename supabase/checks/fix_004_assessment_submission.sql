-- Verificação de FIX-004 — fn_submit_assessment
--
-- Extraída verbatim da cauda de
-- supabase/history/pre-reconciliation/20260728152000_fix_004_assessment_submission.sql
-- Corresponde à versão aplicada 20260728191046, cuja cauda NÃO integra o SQL
-- registrado no banco. Somente leitura. Ver ../checks/README.md.

-- Verificação pós-migration:
SELECT p.oid::regprocedure::text AS signature, p.prosecdef, p.proconfig, p.proacl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'fn_submit_assessment';
