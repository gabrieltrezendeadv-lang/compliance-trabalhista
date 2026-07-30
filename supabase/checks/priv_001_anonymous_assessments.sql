-- Verificação de PRIV-001 — avaliações anônimas
--
-- Extraída verbatim da cauda de
-- supabase/history/pre-reconciliation/20260728152500_priv_001_anonymous_assessments.sql
-- Aquele arquivo foi aplicado FATIADO em três versões: 20260728191110 (_ddl),
-- 20260728191144 (_fns1) e 20260728191241 (_fns2_grants). Nenhuma das três
-- registrou esta cauda. Somente leitura. Ver ../checks/README.md.

-- Verificação pós-migration:
SELECT
  count(*) FILTER (WHERE token_hash IS NULL) AS missing_hashes,
  count(*) FILTER (WHERE token IS NOT NULL) AS legacy_plaintext_tokens
FROM public.assessment_invitations;

SELECT
  count(*) FILTER (WHERE submission_batch_id IS NULL) AS missing_batches,
  count(*) FILTER (WHERE invitation_id IS NULL) AS anonymous_answer_rows
FROM public.assessment_responses;
