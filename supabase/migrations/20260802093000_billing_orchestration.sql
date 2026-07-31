-- =============================================================================
-- ETAPA 12B — PERSISTÊNCIA DA ORQUESTRAÇÃO DE BILLING
-- =============================================================================
--
-- Forward-only. Versão 20260802093000, estritamente posterior a 20260801120000.
-- Puramente ADITIVA e inteiramente dentro do schema `billing`.
--
-- NÃO altera `20260801120000_billing_foundation.sql`, não toca em `public`, não
-- remove nem redefine objeto algum criado por ela.
--
-- ── POR QUE UMA SEGUNDA MIGRATION ERA INEVITÁVEL ────────────────────────────
--
-- A 12A entregou catálogo, assinatura, snapshot, grandfathering, cortesia e
-- auditoria. Quatro necessidades da 12B não cabem em nenhuma delas, e nenhuma
-- se resolve em código:
--
--   1. IDEMPOTÊNCIA. "Duas tentativas concorrentes produzem um único
--      resultado" só se prova com UNIQUE no banco. Conferir antes de escrever
--      perde a corrida: dois processos passam pela mesma checagem.
--   2. COBRANÇA. Saber a que PERÍODO um pagamento pertence é o que impede um
--      pagamento atrasado de reativar um ciclo posterior.
--   3. CLIENTE NO PROVIDER. `external_customer_id` por organização e provider.
--   4. REVOGAÇÃO DE CORTESIA. `courtesies` recebeu apenas SELECT e INSERT — por
--      decisão da 12A, nada é apagado. Revogar exige registro próprio,
--      append-only, e não um UPDATE.
--
-- ── EFEITO ESTRUTURAL ───────────────────────────────────────────────────────
--
-- Nenhum sobre `supabase/baseline/schema.sql`: tudo vive em `billing`, e o
-- snapshot é gerado com `pg_dump --schema=public`. Declarado como
-- `efeitoEstrutural: false` em `scripts/ci/build-expected-schema.mjs`.
--
-- ── FAIL-CLOSED ─────────────────────────────────────────────────────────────
--
-- Não se presume banco vazio. Tudo é `IF NOT EXISTS` / `ADD VALUE IF NOT
-- EXISTS` / `ADD COLUMN IF NOT EXISTS`. Pós-condições abortam a transação.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. TIPOS
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `ALTER TYPE ... ADD VALUE` dentro de transação é permitido no PostgreSQL 12+,
-- mas o valor novo NÃO pode ser usado na mesma transação. Por isso nenhuma
-- linha desta migration grava 'payment' ou 'charge': eles existem para a
-- aplicação usar depois do commit.

ALTER TYPE billing.audit_subject ADD VALUE IF NOT EXISTS 'payment';
ALTER TYPE billing.audit_subject ADD VALUE IF NOT EXISTS 'charge';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname = 'billing' AND t.typname = 'charge_status') THEN
    CREATE TYPE billing.charge_status AS ENUM ('pending', 'paid', 'failed', 'cancelled');
  END IF;

  -- Somente PIX e cartão: são os dois meios do modelo aprovado. Boleto ficou
  -- de fora de propósito — o enum antigo de `public` tem, este não.
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname = 'billing' AND t.typname = 'charge_method') THEN
    CREATE TYPE billing.charge_method AS ENUM ('pix', 'credit_card');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname = 'billing' AND t.typname = 'idempotency_scope') THEN
    CREATE TYPE billing.idempotency_scope AS ENUM ('provider_event', 'command');
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CLIENTE NO PROVIDER
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS billing.customers (
  organization_id      uuid NOT NULL
                         REFERENCES public.organizations(id) ON DELETE RESTRICT,
  provider             text NOT NULL CHECK (btrim(provider) <> ''),
  external_customer_id text NOT NULL CHECK (btrim(external_customer_id) <> ''),
  created_at           timestamptz NOT NULL DEFAULT now(),
  -- Um cliente por organização POR PROVIDER. Trocar de provider não apaga o
  -- vínculo anterior, e nenhum provider enxerga o identificador do outro.
  PRIMARY KEY (organization_id, provider)
);

COMMENT ON TABLE billing.customers IS
  'Vínculo organização → identificador de cliente no provider. Nunca guarda '
  'dado de cartão, token ou chave de API.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. COBRANÇAS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS billing.charges (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL
                        REFERENCES public.organizations(id) ON DELETE RESTRICT,
  subscription_id     uuid NOT NULL
                        REFERENCES billing.subscriptions(id) ON DELETE RESTRICT,
  provider            text NOT NULL CHECK (btrim(provider) <> ''),
  external_charge_id  text NOT NULL CHECK (btrim(external_charge_id) <> ''),
  method              billing.charge_method NOT NULL,
  amount_cents        integer NOT NULL CHECK (amount_cents > 0),
  status              billing.charge_status NOT NULL DEFAULT 'pending',
  -- A chave do COMANDO que criou esta cobrança.
  --
  -- Sem ela, uma repetição do checkout com a mesma chave não teria como
  -- encontrar a cobrança já criada, e devolveria erro em vez do resultado
  -- anterior — que é o oposto de idempotente. Nulo é permitido para cobranças
  -- de origem não-comandada (renovação automática, por exemplo), e várias
  -- linhas com NULL não colidem no UNIQUE.
  idempotency_key     text NULL,
  -- O PERÍODO que a cobrança quita. É o que impede um pagamento atrasado de
  -- reativar um ciclo posterior: o evento pertence ao ciclo da cobrança, não
  -- ao ciclo em que ele chegou.
  period_start        timestamptz NOT NULL,
  period_end          timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  paid_at             timestamptz NULL,
  failed_at           timestamptz NULL,
  CONSTRAINT charges_periodo_coerente CHECK (period_end > period_start),
  -- Idempotência natural: o mesmo identificador do provider não entra duas
  -- vezes para a mesma organização.
  CONSTRAINT charges_externo_unico UNIQUE (organization_id, provider, external_charge_id),
  -- Uma cobrança por comando. É o que torna o checkout repetível sem duplicar.
  CONSTRAINT charges_comando_unico UNIQUE (organization_id, idempotency_key),
  -- Estado e carimbo não podem divergir.
  CONSTRAINT charges_pago_tem_data CHECK ((status = 'paid') = (paid_at IS NOT NULL)),
  CONSTRAINT charges_falha_tem_data CHECK ((status = 'failed') = (failed_at IS NOT NULL))
);

COMMENT ON TABLE billing.charges IS
  'Cobranças por período. É a ÚNICA tabela de billing, além de subscriptions, '
  'que aceita UPDATE — o status muda ao longo do ciclo de vida da cobrança.';

CREATE INDEX IF NOT EXISTS charges_organization_idx
  ON billing.charges (organization_id, created_at);
CREATE INDEX IF NOT EXISTS charges_subscription_periodo_idx
  ON billing.charges (subscription_id, period_start, period_end);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. IDEMPOTÊNCIA
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A chave PERTENCE ao tenant e ao provider — os dois entram na unicidade.
-- Um `event_id` do provider A não colide com o do provider B, e nenhuma
-- organização alcança a chave de outra.
--
-- É esta UNIQUE, e não uma checagem em código, que faz a diferença entre
-- "conferi antes de escrever" (que perde para concorrência) e "só um consegue
-- escrever".

CREATE TABLE IF NOT EXISTS billing.idempotency_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
                    REFERENCES public.organizations(id) ON DELETE RESTRICT,
  scope           billing.idempotency_scope NOT NULL,
  provider        text NOT NULL CHECK (btrim(provider) <> ''),
  key             text NOT NULL CHECK (btrim(key) <> ''),
  result          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT idempotency_chave_unica UNIQUE (organization_id, scope, provider, key)
);

COMMENT ON TABLE billing.idempotency_records IS
  'Chaves de idempotência por (organização, escopo, provider, chave). '
  'Append-only: o resultado da primeira execução é devolvido nas repetições.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. REVOGAÇÃO DE CORTESIA — append-only
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A cortesia original NUNCA é alterada nem apagada: quem concedeu e por quê
-- continuam registrados. A revogação é um fato NOVO.

CREATE TABLE IF NOT EXISTS billing.courtesy_revocations (
  courtesy_id     uuid PRIMARY KEY
                    REFERENCES billing.courtesies(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL
                    REFERENCES public.organizations(id) ON DELETE RESTRICT,
  revoked_at      timestamptz NOT NULL,
  revoked_by      uuid NOT NULL,
  reason          text NOT NULL CHECK (btrim(reason) <> '')
);

COMMENT ON TABLE billing.courtesy_revocations IS
  'Revogação de cortesia. Append-only: a concessão original permanece, com '
  'autor e motivo — apagá-la apagaria a prova de que existiu.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. AUDITORIA — campos que a 12B exige como colunas
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Poderiam caber em `new_value`, que é jsonb. Ficariam sem índice e sem
-- constraint, e uma trilha em que a correlação está enterrada em texto livre
-- não se consulta. `ADD COLUMN` é aditivo e não reescreve linha existente.

ALTER TABLE billing.audit_events
  ADD COLUMN IF NOT EXISTS subscription_id uuid NULL,
  ADD COLUMN IF NOT EXISTS origin          text NULL,
  ADD COLUMN IF NOT EXISTS idempotency_key text NULL,
  ADD COLUMN IF NOT EXISTS correlation_id  text NULL;

COMMENT ON COLUMN billing.audit_events.origin IS
  'owner | provider_webhook | scheduler | admin — distingue o que a pessoa '
  'pediu do que um webhook trouxe e do que uma rotina executou.';

CREATE INDEX IF NOT EXISTS audit_events_correlation_idx
  ON billing.audit_events (correlation_id)
  WHERE correlation_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. FECHAMENTO — RLS e privilégios das tabelas novas
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Mesmo regime da 12A: RLS ligada, ZERO policies, nada para anon/authenticated,
-- DELETE para ninguém. `charges` é a única nova com UPDATE, porque o status da
-- cobrança muda; as demais são append-only.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'customers', 'charges', 'idempotency_records', 'courtesy_revocations'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE billing.%I FROM PUBLIC', t);
    EXECUTE format('REVOKE ALL ON TABLE billing.%I FROM anon', t);
    EXECUTE format('REVOKE ALL ON TABLE billing.%I FROM authenticated', t);
    EXECUTE format('ALTER TABLE billing.%I ENABLE ROW LEVEL SECURITY', t);

    IF t = 'charges' THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE billing.%I TO service_role', t);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT ON TABLE billing.%I TO service_role', t);
    END IF;
  END LOOP;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. PÓS-CONDIÇÕES
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_int  integer;
  v_txt  text;
BEGIN
  -- 8.1 As quatro tabelas novas existem; o schema passa a ter 13.
  SELECT count(*) INTO v_int
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'billing' AND c.relkind = 'r';
  IF v_int <> 13 THEN
    RAISE EXCEPTION 'esperadas 13 tabelas em billing após a 12B, encontradas %', v_int;
  END IF;

  -- 8.2 RLS ligada em todas, e nenhuma policy em lugar nenhum.
  SELECT count(*) INTO v_int
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'billing' AND c.relkind = 'r' AND NOT c.relrowsecurity;
  IF v_int <> 0 THEN
    RAISE EXCEPTION '% tabela(s) de billing sem RLS', v_int;
  END IF;

  SELECT count(*) INTO v_int
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'billing';
  IF v_int <> 0 THEN
    RAISE EXCEPTION 'billing ganhou % policy(ies)', v_int;
  END IF;

  -- 8.3 Nada para anon/authenticated, e DELETE para ninguém.
  SELECT string_agg(format('%s→%s em %s', pg_get_userbyid(a.grantee),
                           a.privilege_type, c.relname), ', ')
    INTO v_txt
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
   WHERE n.nspname = 'billing' AND c.relkind = 'r'
     AND a.grantee <> c.relowner
     AND (
       a.grantee = 0
       OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated')
       OR a.privilege_type IN ('DELETE', 'TRUNCATE')
       OR (a.privilege_type = 'UPDATE' AND c.relname NOT IN ('subscriptions', 'charges'))
     );
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'privilégio indevido em billing: %', v_txt;
  END IF;

  -- 8.4 A unicidade da idempotência existe e é sobre as quatro colunas.
  --     Sem ela, concorrência não tem como ser resolvida pelo banco.
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'idempotency_chave_unica'
       AND conrelid = 'billing.idempotency_records'::regclass
       AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'a unicidade da chave de idempotência não foi criada';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'charges_externo_unico'
       AND conrelid = 'billing.charges'::regclass
       AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'a unicidade do identificador externo da cobrança não foi criada';
  END IF;

  -- 8.5 A auditoria ganhou as quatro colunas exigidas.
  SELECT string_agg(esperada, ', ' ORDER BY esperada)
    INTO v_txt
    FROM unnest(ARRAY['subscription_id', 'origin', 'idempotency_key', 'correlation_id'])
         AS t(esperada)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'billing' AND table_name = 'audit_events'
        AND column_name = t.esperada
   );
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'audit_events sem coluna(s): %', v_txt;
  END IF;

  -- 8.6 As triggers de imutabilidade da 12A continuam no lugar. Acrescentar
  --     colunas não pode ter derrubado a append-only da trilha.
  SELECT count(*) INTO v_int
    FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'billing' AND NOT tg.tgisinternal
     AND tg.tgname IN ('tg_price_snapshot_immutable', 'tg_audit_events_append_only');
  IF v_int <> 2 THEN
    RAISE EXCEPTION 'as triggers de imutabilidade da 12A sumiram (encontradas %)', v_int;
  END IF;

  -- 8.7 Nada foi criado em public.
  SELECT count(*) INTO v_int
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND c.relname IN ('customers', 'charges', 'idempotency_records', 'courtesy_revocations');
  IF v_int <> 0 THEN
    RAISE EXCEPTION '% objeto(s) da 12B foram criados em public', v_int;
  END IF;

  RAISE NOTICE 'OK: orquestração de billing instalada (13 tabelas, RLS ligada, 0 policies)';
END
$$;
