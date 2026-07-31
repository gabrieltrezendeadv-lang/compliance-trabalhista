-- =============================================================================
-- ROLLBACK — 20260801120000_billing_foundation.sql
-- =============================================================================
--
-- Desfaz a fundação de billing da Etapa 12A.
--
-- ── O QUE ELE DESFAZ ────────────────────────────────────────────────────────
--
--   1. restaura `public.subscription_plans.is_active` ao valor REAL anterior,
--      lido de `billing.legacy_plan_state`;
--   2. remove o schema `billing` inteiro, com tabelas, tipos, funções e
--      triggers.
--
-- A ORDEM IMPORTA e não é estética: a restauração lê uma tabela do schema que o
-- passo seguinte destrói. Invertê-la apagaria a única informação que permite
-- restaurar corretamente.
--
-- ── POR QUE NÃO É `SET is_active = true` ────────────────────────────────────
--
-- `is_active` é `boolean DEFAULT true` e NÃO é `NOT NULL`: os valores possíveis
-- são `true`, `false` e `NULL`. Uma reativação por lista de slugs estaria
-- errada em dois casos reais — plano já desativado ANTES desta migration
-- voltaria ativo, e plano com `NULL` viraria `true`. O banco terminaria num
-- estado que nunca existiu, e o defeito seria invisível.
--
-- Por isso o rollback restaura a partir da captura feita pela própria migration
-- (`billing.fn_restore_legacy_plans`), e não a partir de uma suposição.
-- O comportamento é exercido por teste contra PostgreSQL real em
-- `scripts/ci/assert-billing-security.sql`, incluindo o cenário do plano
-- previamente inativo.
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
-- Somente `public.subscription_plans` é tocada em `public`, e apenas em DML.
-- =============================================================================

-- 1. Restaurar ANTES de destruir. Falha alto se a captura não existir: um
--    rollback que "não achou o estado anterior" e seguisse em frente deixaria
--    os planos desativados para sempre.
DO $restaurar$
DECLARE
  v_restaurados integer;
BEGIN
  IF to_regclass('billing.legacy_plan_state') IS NULL THEN
    RAISE EXCEPTION
      'billing.legacy_plan_state não existe — sem ela não há como restaurar '
      'is_active com fidelidade. Rollback abortado de propósito.';
  END IF;

  SELECT billing.fn_restore_legacy_plans() INTO v_restaurados;
  RAISE NOTICE 'planos restaurados ao estado anterior: %', v_restaurados;
END
$restaurar$;

-- 2. Só então remover o schema.
DROP SCHEMA IF EXISTS billing CASCADE;

DO $conferir$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'billing') THEN
    RAISE EXCEPTION 'o schema billing continua existindo após o rollback';
  END IF;

  RAISE NOTICE 'OK: planos restaurados e fundação de billing removida';
END
$conferir$;
