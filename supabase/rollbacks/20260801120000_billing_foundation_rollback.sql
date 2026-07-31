-- =============================================================================
-- ROLLBACK — 20260801120000_billing_foundation.sql
-- =============================================================================
--
-- Desfaz a fundação de billing da Etapa 12A.
--
-- ── O QUE ELE DESFAZ ────────────────────────────────────────────────────────
--
--   1. remove o schema `billing` inteiro, com tabelas, tipos, função e triggers;
--   2. reativa os três planos antigos de `public.subscription_plans`.
--
-- ── LIMITE DECLARADO, E ELE É REAL ──────────────────────────────────────────
--
-- `DROP SCHEMA billing CASCADE` APAGA DADO. Enquanto a fundação estiver apenas
-- instalada e sem jornada — que é a situação da Etapa 12A — não há dado a
-- perder: nenhuma assinatura é criada, e as únicas linhas são o catálogo de
-- preços e as faixas, ambos semeados pela própria migration.
--
-- A partir do momento em que existir assinatura real, ESTE ROLLBACK DEIXA DE
-- SER SEGURO e não deve ser executado sem extração prévia. Está escrito aqui, e
-- não num comentário de commit, porque é a única forma de o aviso chegar a quem
-- for executá-lo.
--
-- A reativação dos planos antigos é feita POR SLUG, e restaura exatamente os
-- três semeados por `20260724161707`. Um plano que já estivesse inativo antes
-- da migration por outro motivo continuaria inativo — o que é o comportamento
-- correto, e por isso a lista é nominal em vez de um `SET is_active = true`
-- geral.
--
-- Somente `public.subscription_plans` é tocada em `public`, e apenas em DML.
-- =============================================================================

DROP SCHEMA IF EXISTS billing CASCADE;

UPDATE public.subscription_plans
   SET is_active = true
 WHERE slug IN ('starter', 'professional', 'enterprise');

DO $$
DECLARE
  v_int integer;
BEGIN
  SELECT count(*) INTO v_int
    FROM pg_namespace WHERE nspname = 'billing';
  IF v_int <> 0 THEN
    RAISE EXCEPTION 'o schema billing continua existindo após o rollback';
  END IF;

  RAISE NOTICE 'OK: fundação de billing removida; planos antigos reativados';
END
$$;
