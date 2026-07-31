-- =============================================================================
-- ETAPA 12A — FUNDAÇÃO SEGURA DE PLANOS E COBRANÇA
-- =============================================================================
--
-- Forward-only. Versão 20260801120000, estritamente posterior a 20260731094500,
-- que é a maior existente no repositório e no ledger remoto.
--
-- Ver docs/decisions/PLANOS-E-PRECIFICACAO.md.
--
-- ── O QUE ESTA MIGRATION FAZ ────────────────────────────────────────────────
--
--   1. cria o schema `billing` e todo o modelo novo dentro dele;
--   2. semeia o catálogo de preços aprovado e as faixas de porte;
--   3. torna imutáveis os snapshots de preço e a trilha de auditoria;
--   4. fecha o schema: sem USAGE para anon/authenticated, sem privilégio de
--      tabela para eles, RLS habilitada e sem policy nenhuma;
--   5. DESATIVA — sem remover — os planos antigos de public.subscription_plans.
--
-- ── O QUE ELA NÃO FAZ, E POR QUÊ ────────────────────────────────────────────
--
-- Não cria, altera nem remove UM ÚNICO objeto do schema `public`. O único
-- comando que toca `public` é um UPDATE de `is_active` — DML, não DDL.
--
-- Isso é deliberado e tem consequência verificável: `supabase/baseline/schema.sql`
-- é gerado com `pg_dump --schema=public`, e `scripts/ci/extract-security.sql`
-- filtra `nspname = 'public'`. Nenhum dos dois enxerga o schema `billing`.
-- Portanto a Âncora A, a Âncora B e o diff de segurança do
-- `migration-rebuild-verify` continuam valendo sem redeclaração de deltas —
-- e é por isso que `scripts/ci/build-expected-schema.mjs` registra esta
-- migration com `efeitoEstrutural: false`.
--
-- A contrapartida está declarada: `scripts/ci/assert-no-public-execute.sql` não
-- alcança `billing`. A cobertura equivalente vem de
-- `scripts/ci/assert-billing-security.sql`, executado no job `Verify` contra
-- PostgreSQL de verdade.
--
-- ── FAIL-CLOSED ─────────────────────────────────────────────────────────────
--
-- Não se presume banco vazio. Nada é apagado, nada é sobrescrito: os seeds usam
-- ON CONFLICT DO NOTHING e o UPDATE de `public.subscription_plans` é idempotente
-- e reversível. Ao final, um bloco de pós-condições confere o estado declarado e
-- ABORTA a transação inteira se algo não conferir.
--
-- ── SEGURANÇA ───────────────────────────────────────────────────────────────
--
-- `ALTER DEFAULT PRIVILEGES` NÃO é usado: exige superusuário, como SEC-001 já
-- registrou. Todo privilégio é concedido ou revogado objeto a objeto, à vista.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SCHEMA
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS billing;

COMMENT ON SCHEMA billing IS
  'Planos, precificação e cobrança (Etapa 12A). NÃO exposto ao PostgREST: '
  'nenhum cliente anon/authenticated endereça estas tabelas. '
  'Ver docs/decisions/PLANOS-E-PRECIFICACAO.md.';

-- Fecha o schema antes de criar qualquer objeto dentro dele.
REVOKE ALL ON SCHEMA billing FROM PUBLIC;
GRANT USAGE ON SCHEMA billing TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. TIPOS
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Vocabulário próprio, e não o do enum antigo `public.subscription_status`.
-- O antigo tem `partially_blocked` e `fully_blocked`, que descrevem bloqueio
-- gradual; o modelo aprovado degrada sempre para MODO LEITURA e nunca apaga
-- dado. Reaproveitar o enum antigo importaria estados que a regra não usa.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname = 'billing' AND t.typname = 'plan_slug') THEN
    CREATE TYPE billing.plan_slug AS ENUM ('essencial', 'completo');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname = 'billing' AND t.typname = 'tier_slug') THEN
    CREATE TYPE billing.tier_slug AS ENUM ('t1_20', 't21_50', 't51_100', 'enterprise');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname = 'billing' AND t.typname = 'billing_period') THEN
    CREATE TYPE billing.billing_period AS ENUM ('monthly', 'yearly');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname = 'billing' AND t.typname = 'subscription_state') THEN
    CREATE TYPE billing.subscription_state AS ENUM (
      'trialing', 'active', 'past_due_tolerance',
      'read_only', 'cancel_scheduled', 'terminated'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname = 'billing' AND t.typname = 'audit_subject') THEN
    CREATE TYPE billing.audit_subject AS ENUM (
      'worker_count', 'tier_change', 'plan_change', 'courtesy',
      'grandfathering', 'subscription_state', 'price_catalog'
    );
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. FAIXAS DE PORTE
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS billing.tiers (
  slug           billing.tier_slug PRIMARY KEY,
  min_workers    integer NOT NULL CHECK (min_workers >= 1),
  max_workers    integer NULL,
  requires_quote boolean NOT NULL,
  CONSTRAINT tiers_faixa_coerente
    CHECK (max_workers IS NULL OR max_workers >= min_workers)
);

COMMENT ON TABLE billing.tiers IS
  'Faixas de porte por quantidade de trabalhadores. Limites INCLUSIVOS nas duas '
  'pontas: 20 é t1_20, 21 é t21_50. max_workers NULL = sem teto (Enterprise).';

INSERT INTO billing.tiers (slug, min_workers, max_workers, requires_quote) VALUES
  ('t1_20',        1,   20, false),
  ('t21_50',      21,   50, false),
  ('t51_100',     51,  100, false),
  ('enterprise', 101, NULL, true)
ON CONFLICT (slug) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. CATÁLOGO DE PREÇOS — versionado, em centavos inteiros
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `integer` em CENTAVOS. Não `numeric`, não `money`, nunca ponto flutuante.
-- Uma linha nova de preço NÃO substitui a anterior: cada versão do catálogo
-- coexiste, e é isso que permite explicar uma fatura antiga depois de a tabela
-- mudar.

CREATE TABLE IF NOT EXISTS billing.price_catalog (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_version text NOT NULL CHECK (btrim(catalog_version) <> ''),
  plan            billing.plan_slug NOT NULL,
  tier            billing.tier_slug NOT NULL,
  monthly_cents   integer NULL CHECK (monthly_cents IS NULL OR monthly_cents >= 0),
  yearly_cents    integer NULL CHECK (yearly_cents  IS NULL OR yearly_cents  >= 0),
  effective_from  timestamptz NOT NULL,
  effective_to    timestamptz NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT price_catalog_versao_unica UNIQUE (catalog_version, plan, tier),
  CONSTRAINT price_catalog_vigencia_coerente
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  -- Enterprise é sob proposta: ou os dois preços existem, ou nenhum existe.
  -- Meio preço seria um valor utilizável por engano num checkout.
  CONSTRAINT price_catalog_preco_completo
    CHECK ((monthly_cents IS NULL) = (yearly_cents IS NULL))
);

COMMENT ON TABLE billing.price_catalog IS
  'Tabela de preços versionada, em CENTAVOS inteiros. Alterar preço cria linhas '
  'de uma NOVA catalog_version; nunca reescreve a anterior.';

-- Catálogo aprovado 2026-07-30.1. Anual = 12 mensalidades com 10% de desconto:
--   essencial t1_20    9990 * 12 * 9 / 10 = 107892
--   essencial t21_50  16990 * 12 * 9 / 10 = 183492
--   essencial t51_100 34990 * 12 * 9 / 10 = 377892
--   completo  t1_20   24990 * 12 * 9 / 10 = 269892
--   completo  t21_50  39990 * 12 * 9 / 10 = 431892
--   completo  t51_100 79990 * 12 * 9 / 10 = 863892
-- As seis divisões são exatas. O bloco de pós-condições reconfere cada uma.
INSERT INTO billing.price_catalog
  (catalog_version, plan, tier, monthly_cents, yearly_cents, effective_from)
VALUES
  ('2026-07-30.1', 'essencial', 't1_20',       9990, 107892, '2026-07-30T00:00:00Z'),
  ('2026-07-30.1', 'essencial', 't21_50',     16990, 183492, '2026-07-30T00:00:00Z'),
  ('2026-07-30.1', 'essencial', 't51_100',    34990, 377892, '2026-07-30T00:00:00Z'),
  ('2026-07-30.1', 'essencial', 'enterprise',  NULL,   NULL, '2026-07-30T00:00:00Z'),
  ('2026-07-30.1', 'completo',  't1_20',      24990, 269892, '2026-07-30T00:00:00Z'),
  ('2026-07-30.1', 'completo',  't21_50',     39990, 431892, '2026-07-30T00:00:00Z'),
  ('2026-07-30.1', 'completo',  't51_100',    79990, 863892, '2026-07-30T00:00:00Z'),
  ('2026-07-30.1', 'completo',  'enterprise',  NULL,   NULL, '2026-07-30T00:00:00Z')
ON CONFLICT (catalog_version, plan, tier) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. ASSINATURAS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS billing.subscriptions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL UNIQUE
                             REFERENCES public.organizations(id) ON DELETE RESTRICT,
  plan                     billing.plan_slug NOT NULL,
  tier                     billing.tier_slug NOT NULL,
  period                   billing.billing_period NOT NULL,
  state                    billing.subscription_state NOT NULL DEFAULT 'trialing',
  -- Informado pelo proprietário e auditado. Não é limite comercial: define a
  -- faixa de preço, e mudança de faixa vale no próximo ciclo.
  worker_count             integer NOT NULL CHECK (worker_count >= 1),
  -- CNPJ é obrigatório para iniciar o trial.
  cnpj                     text NOT NULL CHECK (btrim(cnpj) <> ''),
  current_period_start     timestamptz NOT NULL,
  current_period_end       timestamptz NOT NULL,
  trial_ends_at            timestamptz NULL,
  payment_failed_at        timestamptz NULL,
  scheduled_downgrade_plan billing.plan_slug NULL,
  scheduled_downgrade_tier billing.tier_slug NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_periodo_coerente
    CHECK (current_period_end > current_period_start),
  -- Downgrade agendado é um par: plano e faixa juntos, ou nenhum dos dois.
  CONSTRAINT subscriptions_downgrade_par_completo
    CHECK ((scheduled_downgrade_plan IS NULL) = (scheduled_downgrade_tier IS NULL))
);

COMMENT ON TABLE billing.subscriptions IS
  'Uma assinatura por organização. O estado efetivo é DERIVADO das datas em '
  'src/lib/billing/plans/lifecycle.ts; a coluna state registra apenas as '
  'decisões que não se derivam de data (cancelamento e encerramento).';

CREATE INDEX IF NOT EXISTS subscriptions_state_idx
  ON billing.subscriptions (state);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. SNAPSHOTS DE PREÇO — imutáveis
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS billing.price_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL
                    REFERENCES billing.subscriptions(id) ON DELETE RESTRICT,
  plan            billing.plan_slug NOT NULL,
  tier            billing.tier_slug NOT NULL,
  period          billing.billing_period NOT NULL,
  amount_cents    integer NOT NULL CHECK (amount_cents >= 0),
  catalog_version text NOT NULL CHECK (btrim(catalog_version) <> ''),
  captured_at     timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE billing.price_snapshots IS
  'Preço contratado, congelado. IMUTÁVEL: UPDATE e DELETE são recusados por '
  'trigger. Alteração futura de preço não pode reescrever fatura ou período '
  'já emitido.';

CREATE INDEX IF NOT EXISTS price_snapshots_subscription_idx
  ON billing.price_snapshots (subscription_id, captured_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. DIREITO ADQUIRIDO E CORTESIA
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A DATA DE CORTE NÃO É FIXADA NESTA ETAPA. A tabela nasce VAZIA, e vazia
-- significa "ninguém é elegível" — o padrão é negar, porque conceder gratuidade
-- permanente indevida é irreversível na prática.

CREATE TABLE IF NOT EXISTS billing.grandfathering_cutoff (
  -- Singleton: a coluna booleana com CHECK garante no máximo uma linha.
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  cutoff_at timestamptz NOT NULL,
  set_at    timestamptz NOT NULL DEFAULT now(),
  set_by    uuid NULL,
  reason    text NOT NULL CHECK (btrim(reason) <> '')
);

COMMENT ON TABLE billing.grandfathering_cutoff IS
  'Data de corte do direito adquirido. NASCE VAZIA por decisão da Etapa 12A: '
  'sem corte registrado, nenhuma organização é elegível.';

CREATE TABLE IF NOT EXISTS billing.grandfathered_organizations (
  -- A chave é a ORGANIZAÇÃO. Nunca o usuário: se o benefício seguisse o
  -- usuário, qualquer beneficiado criaria organizações novas indefinidamente e
  -- o corte não valeria nada.
  organization_id uuid PRIMARY KEY
                    REFERENCES public.organizations(id) ON DELETE RESTRICT,
  cutoff_at       timestamptz NOT NULL,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  granted_by      uuid NULL,
  reason          text NOT NULL CHECK (btrim(reason) <> '')
);

COMMENT ON TABLE billing.grandfathered_organizations IS
  'Essencial gratuito permanente. O direito pertence à ORGANIZAÇÃO e não se '
  'extingue por upgrade e posterior cancelamento.';

CREATE TABLE IF NOT EXISTS billing.courtesies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
                    REFERENCES public.organizations(id) ON DELETE RESTRICT,
  plan            billing.plan_slug NOT NULL,
  starts_at       timestamptz NOT NULL,
  -- Prazo OBRIGATÓRIO: cortesia sem prazo é plano gratuito disfarçado.
  ends_at         timestamptz NOT NULL,
  reason          text NOT NULL CHECK (btrim(reason) <> ''),
  granted_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT courtesies_prazo_coerente CHECK (ends_at > starts_at)
);

COMMENT ON TABLE billing.courtesies IS
  'Cortesia administrativa. Prazo, motivo e autor são obrigatórios por '
  'constraint, não por convenção de código.';

CREATE INDEX IF NOT EXISTS courtesies_organization_idx
  ON billing.courtesies (organization_id, starts_at, ends_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. AUDITORIA — append-only
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS billing.audit_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL,
  subject         billing.audit_subject NOT NULL,
  actor_id        uuid NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  previous_value  jsonb NULL,
  new_value       jsonb NULL,
  reason          text NULL
);

COMMENT ON TABLE billing.audit_events IS
  'Trilha de worker_count, faixa, plano, cortesia, grandfathering e estado. '
  'APPEND-ONLY: UPDATE e DELETE são recusados por trigger.';

CREATE INDEX IF NOT EXISTS audit_events_organization_idx
  ON billing.audit_events (organization_id, occurred_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8b. ESTADO ANTERIOR DOS PLANOS ANTIGOS — para um rollback exato
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Declarada aqui, junto das demais, para que passe pelo mesmo fechamento de RLS
-- e privilégios da seção 10. É preenchida na seção 11, imediatamente antes do
-- UPDATE que ela existe para poder desfazer.

CREATE TABLE IF NOT EXISTS billing.legacy_plan_state (
  -- Sem FOREIGN KEY para `public.subscription_plans` de propósito: uma FK
  -- criaria gatilho interno na tabela referenciada, e o compromisso desta
  -- migration é não tocar em estrutura de `public`. A integridade que importa
  -- aqui é histórica, não referencial — a linha registra o que havia, mesmo
  -- que o plano deixe de existir depois.
  plan_id     uuid PRIMARY KEY,
  slug        text NOT NULL,
  was_active  boolean NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE billing.legacy_plan_state IS
  'Estado de is_active de public.subscription_plans imediatamente ANTES da '
  'desativação feita por esta migration. Existe para que o rollback restaure o '
  'valor real — inclusive NULL e false — em vez de presumir true.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. IMUTABILIDADE — por trigger, não por convenção
-- ─────────────────────────────────────────────────────────────────────────────
--
-- SECURITY INVOKER (o padrão) de propósito: uma trigger de recusa não precisa
-- de privilégio elevado, e SECURITY DEFINER aqui só ampliaria a superfície.
-- `search_path` fixado mesmo assim — a função não resolve nenhum nome não
-- qualificado, e o fixamento impede que passe a resolver.

CREATE OR REPLACE FUNCTION billing.fn_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
BEGIN
  RAISE EXCEPTION
    'billing.%: registro imutável — % recusado. Corrija criando um registro novo.',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;

COMMENT ON FUNCTION billing.fn_reject_mutation() IS
  'Recusa UPDATE e DELETE. Usada por price_snapshots (preço contratado não se '
  'reescreve) e audit_events (trilha não se edita).';

-- Rotina nova nasce com EXECUTE para PUBLIC por default do PostgreSQL — é a
-- causa raiz registrada em SEC-001, e a razão de existir a asserção de
-- EXECUTE/PUBLIC. Revogado aqui, na própria migration que cria a função.
REVOKE ALL ON FUNCTION billing.fn_reject_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION billing.fn_reject_mutation() FROM anon;
REVOKE ALL ON FUNCTION billing.fn_reject_mutation() FROM authenticated;

DROP TRIGGER IF EXISTS tg_price_snapshot_immutable ON billing.price_snapshots;
CREATE TRIGGER tg_price_snapshot_immutable
  BEFORE UPDATE OR DELETE ON billing.price_snapshots
  FOR EACH ROW EXECUTE FUNCTION billing.fn_reject_mutation();

DROP TRIGGER IF EXISTS tg_audit_events_append_only ON billing.audit_events;
CREATE TRIGGER tg_audit_events_append_only
  BEFORE UPDATE OR DELETE ON billing.audit_events
  FOR EACH ROW EXECUTE FUNCTION billing.fn_reject_mutation();

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. FECHAMENTO — RLS e privilégios explícitos
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ── FORCE ROW LEVEL SECURITY: ausência DELIBERADA, e o motivo é concreto ────
--
-- `FORCE` faz a RLS valer também para o DONO da tabela. Aqui isso quebraria
-- dois consumidores legítimos que se conectam como dono:
--
--   * `scripts/ci/verify-applied/20260801120000.sql`, a verificação
--     independente da rota de aplicação, que LÊ `billing.price_catalog`,
--     `billing.tiers` e `billing.grandfathering_cutoff` para conferir o efeito
--     da migration. Com FORCE e zero policies, essas leituras voltariam vazias
--     e o verificador reprovaria uma aplicação correta;
--   * a própria rota de migrations, que conecta com o usuário `postgres`.
--
-- O que FORCE acrescentaria seria proteção contra acesso em contexto de DONO —
-- e nenhum caminho da aplicação usa esse contexto: o cliente PostgREST não
-- alcança o schema, e o servidor usará `service_role`.
--
-- A ausência de FORCE portanto NÃO afrouxa o modelo: as quatro negações abaixo
-- continuam valendo para todo papel que não seja dono, e a pós-condição 12.8c
-- exige que `service_role` tenha BYPASSRLS, que é o que torna a combinação
-- "RLS ligada + zero policies" utilizável pelo servidor na Etapa 12B sem abrir
-- nada para `anon` ou `authenticated`.
--
-- Quatro negações independentes, e nenhuma delas depende da interface:
--
--   1. o schema não é exposto ao PostgREST;
--   2. anon e authenticated não têm USAGE no schema;
--   3. anon e authenticated não têm privilégio nenhum nas tabelas;
--   4. RLS habilitada SEM NENHUMA POLICY — o padrão do PostgreSQL com RLS
--      ligada e zero policies é negar tudo.
--
-- Só `service_role` recebe privilégio, e ele nunca vai para o cliente.

-- O privilégio concedido a `service_role` é o MÍNIMO de cada tabela, e os três
-- grupos abaixo são a regra de negócio escrita em ACL:
--
--   REFERÊNCIA   tiers, price_catalog — semeadas por migration. Só leitura em
--                tempo de execução; mudar preço é criar catalog_version nova,
--                o que é migration, não escrita de aplicação.
--   APPEND-ONLY  price_snapshots, audit_events, grandfathered_organizations,
--                grandfathering_cutoff, courtesies — inserem e leem, nunca
--                atualizam. Nas duas primeiras a trigger também recusa; aqui a
--                recusa é anterior, por ausência de privilégio.
--   MUTÁVEL      subscriptions — a única que muda de estado.
--
-- DELETE não é concedido a NENHUMA delas. O modelo aprovado é explícito: nenhum
-- dado é apagado por downgrade ou inadimplência, e o direito adquirido não se
-- extingue. Remoção, se um dia for necessária, será decisão própria e migration
-- própria.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tiers', 'price_catalog', 'subscriptions', 'price_snapshots',
    'grandfathering_cutoff', 'grandfathered_organizations',
    'courtesies', 'audit_events', 'legacy_plan_state'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE billing.%I FROM PUBLIC', t);
    EXECUTE format('REVOKE ALL ON TABLE billing.%I FROM anon', t);
    EXECUTE format('REVOKE ALL ON TABLE billing.%I FROM authenticated', t);
    EXECUTE format('ALTER TABLE billing.%I ENABLE ROW LEVEL SECURITY', t);

    IF t IN ('tiers', 'price_catalog') THEN
      EXECUTE format('GRANT SELECT ON TABLE billing.%I TO service_role', t);
    ELSIF t = 'subscriptions' THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE billing.%I TO service_role', t);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT ON TABLE billing.%I TO service_role', t);
    END IF;
  END LOOP;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. PLANOS ANTIGOS — desativados, não removidos
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `public.subscription_plans` traz Starter / Professional / Enterprise a
-- R$ 199 / 499 / 1.499, que contradizem o modelo aprovado em nome, em valor e
-- em forma de cobrança (por capacidade, e não por porte).
--
-- Não são removidos: `public.tenant_subscriptions.plan_id` os referencia, e a
-- regra do repositório é forward-only não destrutivo. Desativar preserva toda
-- referência existente, é idempotente e é revertido pelo rollback.
--
-- DML, não DDL: não altera a estrutura de `public` e não afeta o dump.
--
-- ── POR QUE O ESTADO ANTERIOR É GRAVADO ANTES ───────────────────────────────
--
-- `public.subscription_plans.is_active` é `boolean DEFAULT true`, e NÃO é
-- `NOT NULL`. Logo há três estados possíveis por linha: `true`, `false` e
-- `NULL`.
--
-- Um rollback que fizesse `SET is_active = true` para os três slugs conhecidos
-- estaria ERRADO em dois casos concretos: um plano que já estivesse desativado
-- antes desta migration voltaria ativo, e um plano com `NULL` viraria `true`.
-- Em ambos, o "rollback" deixaria o banco num estado que nunca existiu.
--
-- Por isso o estado anterior é capturado linha a linha ANTES do UPDATE, e o
-- rollback restaura a partir da captura em vez de assumir qual era o valor.
-- `ON CONFLICT DO NOTHING` preserva a PRIMEIRA captura: reaplicar a migration
-- não sobrescreve o estado original com o estado já desativado.

INSERT INTO billing.legacy_plan_state (plan_id, slug, was_active)
SELECT id, slug, is_active FROM public.subscription_plans
ON CONFLICT (plan_id) DO NOTHING;

UPDATE public.subscription_plans
   SET is_active = false
 WHERE is_active IS DISTINCT FROM false;

-- A restauração é FUNÇÃO, e não SQL solto no arquivo de rollback, por um motivo
-- prático: assim ela pode ser exercida por teste de comportamento contra
-- PostgreSQL de verdade (`scripts/ci/assert-billing-security.sql`), inclusive
-- no cenário que o rollback ingênuo errava — plano previamente inativo.
CREATE OR REPLACE FUNCTION billing.fn_restore_legacy_plans()
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.subscription_plans p
     SET is_active = s.was_active
    FROM billing.legacy_plan_state s
   WHERE s.plan_id = p.id
     AND p.is_active IS DISTINCT FROM s.was_active;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$$;

COMMENT ON FUNCTION billing.fn_restore_legacy_plans() IS
  'Restaura is_active a partir de billing.legacy_plan_state. Idempotente. '
  'Usada pelo rollback da 20260801120000.';

REVOKE ALL ON FUNCTION billing.fn_restore_legacy_plans() FROM PUBLIC;
REVOKE ALL ON FUNCTION billing.fn_restore_legacy_plans() FROM anon;
REVOKE ALL ON FUNCTION billing.fn_restore_legacy_plans() FROM authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. PÓS-CONDIÇÕES — abortam a transação inteira se o estado não conferir
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_int integer;
  v_txt text;
BEGIN
  -- 12.1 As nove tabelas existem, todas com RLS ligada e ZERO policies.
  SELECT count(*) INTO v_int
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'billing' AND c.relkind = 'r';
  IF v_int <> 9 THEN
    RAISE EXCEPTION 'esperadas 9 tabelas em billing, encontradas %', v_int;
  END IF;

  SELECT count(*) INTO v_int
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'billing' AND c.relkind = 'r' AND NOT c.relrowsecurity;
  IF v_int <> 0 THEN
    RAISE EXCEPTION '% tabela(s) de billing sem RLS habilitada', v_int;
  END IF;

  SELECT count(*) INTO v_int
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'billing';
  IF v_int <> 0 THEN
    RAISE EXCEPTION
      'billing tem % policy(ies); a fundação exige RLS ligada e nenhuma policy', v_int;
  END IF;

  -- 12.2 Nem anon nem authenticated têm qualquer privilégio no schema ou nas
  --      tabelas. Conferido pelo catálogo, não pela intenção do DDL acima.
  SELECT count(*) INTO v_int
    FROM pg_namespace n, aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a
   WHERE n.nspname = 'billing'
     AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated'));
  IF v_int <> 0 THEN
    RAISE EXCEPTION 'schema billing concede % privilégio(s) a PUBLIC/anon/authenticated', v_int;
  END IF;

  SELECT count(*) INTO v_int
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace,
         aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
   WHERE n.nspname = 'billing' AND c.relkind = 'r'
     AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated'));
  IF v_int <> 0 THEN
    RAISE EXCEPTION 'tabelas de billing concedem % privilégio(s) a PUBLIC/anon/authenticated', v_int;
  END IF;

  -- 12.2b Nenhuma tabela de billing concede DELETE a quem quer que seja, e
  --       UPDATE só existe em `subscriptions`.
  SELECT string_agg(format('%s(%s→%s)', c.relname, pg_get_userbyid(a.grantee), a.privilege_type),
                    ', ' ORDER BY c.relname)
    INTO v_txt
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace,
         aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
   WHERE n.nspname = 'billing' AND c.relkind = 'r'
     AND pg_get_userbyid(a.grantee) <> pg_get_userbyid(c.relowner)
     AND (
       a.privilege_type = 'DELETE'
       OR (a.privilege_type = 'UPDATE' AND c.relname <> 'subscriptions')
     );
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'privilégio de mutação indevido em billing: %', v_txt;
  END IF;

  -- 12.3 Nenhuma rotina de billing concede EXECUTE a PUBLIC. Mesma armadilha de
  --      SEC-001: proacl nulo significa DEFAULT, e o default INCLUI PUBLIC.
  SELECT count(*) INTO v_int
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
         aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
   WHERE n.nspname = 'billing' AND a.grantee = 0 AND a.privilege_type = 'EXECUTE';
  IF v_int <> 0 THEN
    RAISE EXCEPTION '% rotina(s) de billing concedem EXECUTE a PUBLIC', v_int;
  END IF;

  -- 12.4 As duas triggers de imutabilidade estão instaladas.
  SELECT count(*) INTO v_int
    FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'billing' AND NOT tg.tgisinternal
     AND tg.tgname IN ('tg_price_snapshot_immutable', 'tg_audit_events_append_only');
  IF v_int <> 2 THEN
    RAISE EXCEPTION 'esperadas 2 triggers de imutabilidade em billing, encontradas %', v_int;
  END IF;

  -- 12.5 O catálogo aprovado está semeado, e cada preço anual é exatamente
  --      12 mensalidades com 10% de desconto, em centavos inteiros.
  SELECT count(*) INTO v_int
    FROM billing.price_catalog WHERE catalog_version = '2026-07-30.1';
  IF v_int <> 8 THEN
    RAISE EXCEPTION 'catálogo 2026-07-30.1 com % linha(s), esperadas 8', v_int;
  END IF;

  SELECT string_agg(format('%s/%s', plan, tier), ', ' ORDER BY plan, tier)
    INTO v_txt
    FROM billing.price_catalog
   WHERE catalog_version = '2026-07-30.1'
     AND monthly_cents IS NOT NULL
     AND yearly_cents <> (monthly_cents * 12 * 9) / 10;
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'preço anual divergente de 12 mensalidades com 10%% em: %', v_txt;
  END IF;

  SELECT count(*) INTO v_int
    FROM billing.price_catalog
   WHERE catalog_version = '2026-07-30.1'
     AND monthly_cents IS NOT NULL
     AND (monthly_cents * 12 * 9) % 10 <> 0;
  IF v_int <> 0 THEN
    RAISE EXCEPTION '% preço(s) anuais não fecham em centavos inteiros', v_int;
  END IF;

  -- 12.6 As quatro faixas cobrem 1..∞ sem lacuna e sem sobreposição.
  SELECT count(*) INTO v_int FROM billing.tiers;
  IF v_int <> 4 THEN
    RAISE EXCEPTION 'esperadas 4 faixas, encontradas %', v_int;
  END IF;

  SELECT count(*) INTO v_int
    FROM billing.tiers a JOIN billing.tiers b
      ON a.slug <> b.slug
     AND a.min_workers <= COALESCE(b.max_workers, 2147483647)
     AND b.min_workers <= COALESCE(a.max_workers, 2147483647);
  IF v_int <> 0 THEN
    RAISE EXCEPTION 'faixas de porte se sobrepõem em % par(es)', v_int;
  END IF;

  -- 12.7 A data de corte NÃO foi fixada nesta etapa.
  SELECT count(*) INTO v_int FROM billing.grandfathering_cutoff;
  IF v_int <> 0 THEN
    RAISE EXCEPTION
      'billing.grandfathering_cutoff deveria nascer vazia: a ativação do '
      'grandfathering é fase posterior, e sem corte ninguém é elegível';
  END IF;

  -- 12.8 Nenhum plano antigo continua ativo, e TODO plano tem estado anterior
  --      capturado. A segunda metade é o que torna o rollback exato: sem uma
  --      linha por plano, a restauração precisaria adivinhar um valor.
  SELECT count(*) INTO v_int
    FROM public.subscription_plans WHERE is_active IS DISTINCT FROM false;
  IF v_int <> 0 THEN
    RAISE EXCEPTION '% plano(s) antigo(s) continuam ativos em public.subscription_plans', v_int;
  END IF;

  SELECT count(*) INTO v_int
    FROM public.subscription_plans p
   WHERE NOT EXISTS (
     SELECT 1 FROM billing.legacy_plan_state s WHERE s.plan_id = p.id
   );
  IF v_int <> 0 THEN
    RAISE EXCEPTION
      '% plano(s) sem estado anterior capturado — o rollback não conseguiria '
      'restaurar o valor real de is_active', v_int;
  END IF;

  -- 12.8b Toda rotina de billing tem `search_path` fixado.
  --
  -- Sem `SET search_path`, uma rotina resolve nomes pelo caminho de quem a
  -- chama. Basta um schema temporário à frente para que um objeto homônimo
  -- sequestre a resolução. É por isso que TODA função deste repositório fixa o
  -- caminho, e é isto que garante que a próxima também fixe.
  SELECT string_agg(p.oid::regprocedure::text, ', ')
    INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'billing'
     AND NOT EXISTS (
       SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) cfg
        WHERE cfg LIKE 'search\_path=%'
     );
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'rotina(s) de billing sem search_path fixado: %', v_txt;
  END IF;

  -- 12.8c `service_role` precisa contornar RLS.
  --
  -- A fundação usa RLS ligada com ZERO policies, que é negação total. Isso só
  -- é sustentável porque `service_role` tem BYPASSRLS: é assim que o servidor
  -- da Etapa 12B poderá ler e escrever sem que nenhuma policy abra brecha para
  -- `anon` ou `authenticated`.
  --
  -- Se a premissa não valer neste banco, é melhor descobrir AGORA, com a
  -- transação abortando, do que na 12B com a fundação inacessível.
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'service_role' AND rolbypassrls
  ) THEN
    RAISE EXCEPTION
      'service_role não tem BYPASSRLS neste banco — a fundação ficaria '
      'inacessível ao servidor, porque RLS está ligada sem nenhuma policy';
  END IF;

  -- 12.9 A migration não criou nada em public. Se criou, o baseline e as
  --      âncoras do rebuild-verify deixaram de valer sem ninguém notar.
  SELECT count(*) INTO v_int
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND c.relname IN (
       'tiers', 'price_catalog', 'subscriptions', 'price_snapshots',
       'grandfathering_cutoff', 'grandfathered_organizations',
       'courtesies', 'audit_events', 'legacy_plan_state'
     );
  IF v_int <> 0 THEN
    RAISE EXCEPTION
      '% objeto(s) da fundação de billing foram criados em public — o schema '
      'correto é billing', v_int;
  END IF;

  RAISE NOTICE 'OK: fundação de billing instalada e fechada (9 tabelas, RLS ligada, 0 policies)';
END
$$;
