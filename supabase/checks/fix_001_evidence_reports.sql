-- Verificação de FIX-001 — fn_generate_evidence_report
--
-- Extraída verbatim da cauda de
-- supabase/history/pre-reconciliation/20260728150000_fix_001_evidence_reports.sql
-- Corresponde à versão aplicada 20260728190937, cuja cauda NÃO integra o SQL
-- registrado no banco. Somente leitura. Ver ../checks/README.md.

-- Verificação pós-migration:
SELECT
  p.oid::regprocedure::text AS signature,
  p.prosecdef,
  p.proconfig,
  p.proacl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'fn_generate_evidence_report';
