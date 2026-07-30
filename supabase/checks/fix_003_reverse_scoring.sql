-- Verificação de FIX-003 — reverse scoring nas funções de avaliação
--
-- Extraída verbatim da cauda de
-- supabase/history/pre-reconciliation/20260728151000_fix_003_reverse_scoring.sql
-- Corresponde à versão aplicada 20260728191019, cuja cauda NÃO integra o SQL
-- registrado no banco. Somente leitura. Ver ../checks/README.md.

-- Verificação pós-migration:
SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid),
       p.prosecdef, p.proconfig, p.proacl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'fn_assessment_cycle_summary',
    'fn_assessment_group_results',
    'fn_import_risks_from_cycle'
  )
ORDER BY p.proname;
