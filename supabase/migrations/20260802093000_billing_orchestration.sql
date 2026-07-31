-- =============================================================================
-- ETAPA 12B — ORQUESTRAÇÃO TRANSACIONAL DE BILLING
-- =============================================================================
--
-- Forward-only. Versão 20260802093000, estritamente posterior a 20260801120000.
-- NÃO altera `20260801120000_billing_foundation.sql`.
--
-- ── POR QUE ESTA MIGRATION FOI REESCRITA ────────────────────────────────────
--
-- A primeira versão desta migration acompanhava um repositório TypeScript que
-- alcançava o schema `billing` por `.schema("billing").from(...)`. Isso NÃO
-- funciona, e a revisão final provou por quê: `.schema()` do supabase-js não
-- abre conexão SQL — define o cabeçalho HTTP `Accept-Profile` para o PostgREST,
-- que recusa qualquer schema fora de `db-schemas` com PGRST106. Como `billing`
-- nunca esteve exposto, toda chamada do repositório real teria falhado. Ninguém
-- percebeu porque nenhum teste instanciava a classe.
--
-- Duas consequências foram corrigidas AQUI, e não em código:
--
--   1. CAMINHO DE ACESSO. `public` já é exposto ao PostgREST. As RPCs desta
--      migration vivem em `public`, e são a ÚNICA porta: `billing` continua
--      inexposto, e o `service_role` perde todo privilégio direto sobre as
--      tabelas de billing. As funções, executadas como owner, alcançam o
--      schema por dentro.
--
--   2. ATOMICIDADE. Cada RPC é UMA transação. Antes, "cobrança + auditoria" era
--      duas requisições HTTP, logo duas transações, e um erro entre elas
--      deixava cobrança sem trilha. Uma sequência de chamadas HTTP não é uma
--      transação, e não adianta chamá-la assim no comentário.
--
-- ── A EXCEÇÃO NOMINAL EM `public` ───────────────────────────────────────────
--
-- A regra da 12A era "nenhum objeto de billing em public". Ela passa a admitir
-- UMA allowlist exata de funções, declarada em três lugares independentes:
--
--   * `scripts/ci/build-expected-schema.mjs`  — delta estrutural nominal;
--   * `scripts/ci/assert-billing-rpcs.sql`    — conjunto exato no catálogo;
--   * `tests/billing-orchestration-guard.mjs` — allowlist por assinatura.
--
-- Nenhuma tabela, view, sequence ou tipo de billing é criado em `public`.
-- Função fora da allowlist reprova; assinatura sobrecarregada reprova.
--
-- ── EFEITO ESTRUTURAL ───────────────────────────────────────────────────────
--
-- DEIXA DE SER NULO. `supabase/baseline/schema.sql` é gerado com
-- `pg_dump --schema=public`, e funções de `public` estão nesse dump. A
-- classificação passa a ser `efeitoEstrutural: "nominal"`, com as assinaturas
-- declaradas. A âncora B compara o dump SEM esses blocos; os blocos removidos
-- são verificados pelo catálogo, que é mais forte — o dump é tirado com
-- `--no-owner --no-privileges` e nunca teve como enxergar owner nem ACL.
--
-- ── FAIL-CLOSED ─────────────────────────────────────────────────────────────
--
-- Não se presume banco vazio. Pós-condições abortam a transação.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. TIPOS
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `ALTER TYPE ... ADD VALUE` dentro de transação é permitido no PostgreSQL 12+,
-- mas o valor novo NÃO pode ser usado na mesma transação. Nenhuma linha desta
-- migration grava 'payment' ou 'charge'.

ALTER TYPE billing.audit_subject ADD VALUE IF NOT EXISTS 'payment';
ALTER TYPE billing.audit_subject ADD VALUE IF NOT EXISTS 'charge';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname = 'billing' AND t.typname = 'charge_status') THEN
    CREATE TYPE billing.charge_status AS ENUM ('pending', 'paid', 'failed', 'cancelled');
  END IF;

  -- Somente PIX e cartão: são os dois meios do modelo aprovado.
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname = 'billing' AND t.typname = 'charge_method') THEN
    CREATE TYPE billing.charge_method AS ENUM ('pix', 'credit_card');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname = 'billing' AND t.typname = 'idempotency_scope') THEN
    CREATE TYPE billing.idempotency_scope AS ENUM ('provider_event', 'command');
  END IF;

  -- O estado que faltava. Sem ele, a reserva grava o resultado ANTES do efeito:
  -- se o efeito falha, a chave fica presa com um resultado que nunca aconteceu,
  -- e a repetição recebe "duplicado" para sempre. É uma pílula envenenada.
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname = 'billing' AND t.typname = 'idempotency_state') THEN
    CREATE TYPE billing.idempotency_state AS ENUM ('in_progress', 'completed', 'failed');
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CLIENTE NO PROVIDER
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `provider_account_id` entra na identidade porque o mesmo provider pode ter
-- mais de uma conta (sandbox e produção, ou duas subcontas). Sem ele, um
-- identificador externo da conta A colidiria com o da conta B.

CREATE TABLE IF NOT EXISTS billing.customers (
  organization_id      uuid NOT NULL
                         REFERENCES public.organizations(id) ON DELETE RESTRICT,
  provider             text NOT NULL CHECK (btrim(provider) <> ''),
  provider_account_id  text NOT NULL CHECK (btrim(provider_account_id) <> ''),
  external_customer_id text NOT NULL CHECK (btrim(external_customer_id) <> ''),
  created_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, provider, provider_account_id),
  -- RESOLUÇÃO DE TENANT: é esta unicidade GLOBAL que permite descobrir a
  -- organização a partir do identificador que o provider manda no webhook,
  -- em vez de acreditar num `organization_id` vindo de fora.
  CONSTRAINT customers_externo_unico
    UNIQUE (provider, provider_account_id, external_customer_id)
);

COMMENT ON TABLE billing.customers IS
  'Vínculo organização → cliente no provider. Nunca guarda cartão, token ou '
  'chave de API. A unicidade global do identificador externo é o que permite '
  'resolver o tenant de um webhook sem confiar no corpo do evento.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. COBRANÇAS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS billing.charges (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL
                         REFERENCES public.organizations(id) ON DELETE RESTRICT,
  subscription_id      uuid NOT NULL
                         REFERENCES billing.subscriptions(id) ON DELETE RESTRICT,
  provider             text NOT NULL CHECK (btrim(provider) <> ''),
  provider_account_id  text NOT NULL CHECK (btrim(provider_account_id) <> ''),
  external_customer_id text NOT NULL CHECK (btrim(external_customer_id) <> ''),
  external_charge_id   text NOT NULL CHECK (btrim(external_charge_id) <> ''),
  method               billing.charge_method NOT NULL,
  amount_cents         integer NOT NULL CHECK (amount_cents > 0),
  currency             text NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  billing_period       billing.billing_period NOT NULL,
  status               billing.charge_status NOT NULL DEFAULT 'pending',
  idempotency_key      text NULL,
  period_start         timestamptz NOT NULL,
  period_end           timestamptz NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  paid_at              timestamptz NULL,
  failed_at            timestamptz NULL,
  cancelled_at         timestamptz NULL,
  CONSTRAINT charges_periodo_coerente CHECK (period_end > period_start),
  -- UNICIDADE GLOBAL do identificador externo. A versão anterior era
  -- `(organization_id, provider, external_charge_id)` — por tenant. Isso
  -- permitia o MESMO identificador do MESMO provider existir em duas
  -- organizações, e com isso um evento podia ser aplicado ao tenant errado.
  CONSTRAINT charges_externo_unico
    UNIQUE (provider, provider_account_id, external_charge_id),
  -- Uma cobrança por comando. É o que torna o checkout repetível sem duplicar.
  CONSTRAINT charges_comando_unico UNIQUE (organization_id, idempotency_key),
  -- Estado e carimbo não podem divergir.
  CONSTRAINT charges_pago_tem_data      CHECK ((status = 'paid')      = (paid_at      IS NOT NULL)),
  CONSTRAINT charges_falha_tem_data     CHECK ((status = 'failed')    = (failed_at    IS NOT NULL)),
  CONSTRAINT charges_cancel_tem_data    CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);

COMMENT ON TABLE billing.charges IS
  'Cobranças por período. Nenhum papel do PostgREST tem UPDATE aqui: o estado '
  'só muda por RPC autorizada, e as colunas de identidade e valor são '
  'imutáveis por trigger.';

CREATE INDEX IF NOT EXISTS charges_organization_idx
  ON billing.charges (organization_id, created_at);
CREATE INDEX IF NOT EXISTS charges_subscription_periodo_idx
  ON billing.charges (subscription_id, period_start, period_end);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3.1 IMUTABILIDADE DE COBRANÇA
-- ─────────────────────────────────────────────────────────────────────────────
--
-- O que NÃO pode mudar depois de criada: tenant, assinatura, provider, conta,
-- identificadores externos, valor, moeda, periodicidade, período, vínculo de
-- idempotência e data de criação.
--
-- Isto vale MESMO para o owner da tabela — as RPCs rodam como owner, e uma
-- função com defeito não pode ser a última linha de defesa contra troca de
-- tenant ou de valor.

CREATE OR REPLACE FUNCTION billing.fn_charges_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_campo text;
BEGIN
  v_campo := CASE
    WHEN NEW.organization_id      IS DISTINCT FROM OLD.organization_id      THEN 'organization_id'
    WHEN NEW.subscription_id      IS DISTINCT FROM OLD.subscription_id      THEN 'subscription_id'
    WHEN NEW.provider             IS DISTINCT FROM OLD.provider             THEN 'provider'
    WHEN NEW.provider_account_id  IS DISTINCT FROM OLD.provider_account_id  THEN 'provider_account_id'
    WHEN NEW.external_customer_id IS DISTINCT FROM OLD.external_customer_id THEN 'external_customer_id'
    WHEN NEW.external_charge_id   IS DISTINCT FROM OLD.external_charge_id   THEN 'external_charge_id'
    WHEN NEW.amount_cents         IS DISTINCT FROM OLD.amount_cents         THEN 'amount_cents'
    WHEN NEW.currency             IS DISTINCT FROM OLD.currency             THEN 'currency'
    WHEN NEW.method               IS DISTINCT FROM OLD.method               THEN 'method'
    WHEN NEW.billing_period       IS DISTINCT FROM OLD.billing_period       THEN 'billing_period'
    WHEN NEW.period_start         IS DISTINCT FROM OLD.period_start         THEN 'period_start'
    WHEN NEW.period_end           IS DISTINCT FROM OLD.period_end           THEN 'period_end'
    WHEN NEW.idempotency_key      IS DISTINCT FROM OLD.idempotency_key      THEN 'idempotency_key'
    WHEN NEW.created_at           IS DISTINCT FROM OLD.created_at           THEN 'created_at'
    ELSE NULL
  END;

  IF v_campo IS NOT NULL THEN
    RAISE EXCEPTION
      'billing.charges: % é imutável após a criação', v_campo
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END
$$;

-- Máquina de transições FECHADA. `pending` é o único estado de onde se sai;
-- `paid`, `failed` e `cancelled` são terminais. Regressão, salto e estado
-- desconhecido são recusados pelo banco, não pela aplicação.
CREATE OR REPLACE FUNCTION billing.fn_charges_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION
      'billing.charges: % é terminal; transição para % recusada',
      OLD.status, NEW.status
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.status NOT IN ('paid', 'failed', 'cancelled') THEN
    RAISE EXCEPTION
      'billing.charges: transição pending → % não existe', NEW.status
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS tg_charges_immutable ON billing.charges;
CREATE TRIGGER tg_charges_immutable
  BEFORE UPDATE ON billing.charges
  FOR EACH ROW EXECUTE FUNCTION billing.fn_charges_immutable();

DROP TRIGGER IF EXISTS tg_charges_transition ON billing.charges;
CREATE TRIGGER tg_charges_transition
  BEFORE UPDATE ON billing.charges
  FOR EACH ROW EXECUTE FUNCTION billing.fn_charges_transition();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. IDEMPOTÊNCIA COM ESTADO E FINGERPRINT
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Três estados, e cada um significa uma coisa diferente para quem repete:
--
--   in_progress  alguém está executando agora → não repita o efeito;
--   completed    executou → devolva EXATAMENTE o resultado gravado;
--   failed       não executou → repetir é permitido, com o mesmo fingerprint.
--
-- O `request_fingerprint` é o que separa "repetição" de "chave reusada com
-- outro pedido". Sem ele, mandar a mesma chave com outro valor devolve
-- silenciosamente o resultado do primeiro — e o segundo pedido some.

CREATE TABLE IF NOT EXISTS billing.idempotency_records (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL
                        REFERENCES public.organizations(id) ON DELETE RESTRICT,
  scope               billing.idempotency_scope NOT NULL,
  provider            text NOT NULL CHECK (btrim(provider) <> ''),
  key                 text NOT NULL CHECK (btrim(key) <> ''),
  status              billing.idempotency_state NOT NULL DEFAULT 'in_progress',
  -- Hash canônico do pedido. NUNCA o pedido em si: fingerprint não é lugar de
  -- guardar payload, e payload de pagamento não entra em tabela alguma.
  request_fingerprint text NOT NULL CHECK (btrim(request_fingerprint) <> ''),
  result              jsonb NULL,
  error_code          text NULL,
  correlation_id      text NULL,
  started_at          timestamptz NOT NULL,
  completed_at        timestamptz NULL,
  failed_at           timestamptz NULL,
  CONSTRAINT idempotency_chave_unica UNIQUE (organization_id, scope, provider, key),
  -- Estado e carimbo andam juntos, como em `charges`.
  CONSTRAINT idempotency_completo_tem_data
    CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
  CONSTRAINT idempotency_falho_tem_data
    CHECK ((status = 'failed') = (failed_at IS NOT NULL)),
  -- Resultado só existe quando completou. Um resultado gravado num registro
  -- `in_progress` seria exatamente a mentira que esta reescrita elimina.
  CONSTRAINT idempotency_resultado_so_completo
    CHECK (status = 'completed' OR result IS NULL)
);

COMMENT ON TABLE billing.idempotency_records IS
  'Chaves de idempotência com máquina de estados. O resultado só é gravado '
  'quando o efeito realmente aconteceu — antes disso o registro é in_progress.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. EVENTOS EXTERNOS
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Idempotência de COMANDO e de EVENTO são coisas diferentes e ficam em tabelas
-- diferentes. A do evento é única GLOBALMENTE por
-- (provider, provider_account_id, external_event_id) — sem `organization_id`,
-- porque a organização é RESULTADO da resolução, não entrada dela.

CREATE TABLE IF NOT EXISTS billing.provider_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider            text NOT NULL CHECK (btrim(provider) <> ''),
  provider_account_id text NOT NULL CHECK (btrim(provider_account_id) <> ''),
  external_event_id   text NOT NULL CHECK (btrim(external_event_id) <> ''),
  -- Resolvida pelo servidor a partir da cobrança/cliente. Nunca copiada do
  -- corpo do evento.
  organization_id     uuid NOT NULL
                        REFERENCES public.organizations(id) ON DELETE RESTRICT,
  charge_id           uuid NULL REFERENCES billing.charges(id) ON DELETE RESTRICT,
  event_type          text NOT NULL CHECK (btrim(event_type) <> ''),
  occurred_at         timestamptz NOT NULL,
  received_at         timestamptz NOT NULL,
  correlation_id      text NULL,
  CONSTRAINT provider_events_unico
    UNIQUE (provider, provider_account_id, external_event_id)
);

COMMENT ON TABLE billing.provider_events IS
  'Eventos recebidos do provider. A unicidade é GLOBAL: o mesmo evento não '
  'entra duas vezes, ainda que alguém tente atribuí-lo a outra organização.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. REVOGAÇÃO DE CORTESIA — append-only
-- ─────────────────────────────────────────────────────────────────────────────

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
-- 7. AUDITORIA — colunas que a 12B exige
-- ─────────────────────────────────────────────────────────────────────────────

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
-- 8. AUXILIARES INTERNOS (schema `billing`, não expostos)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Ficam em `billing` de propósito: são detalhe de implementação das RPCs, e
-- nada fora delas os chama. Só as funções de `public` entram na allowlist.

-- AUTORIZAÇÃO. A validação em TypeScript não é confiada: esta função consulta a
-- membership de novo, no banco, dentro da mesma transação do efeito.
--
-- `auth.uid()` NÃO serve aqui — a chamada chega com `service_role`, e
-- `auth.uid()` seria nulo ou irrelevante. O ator é o que o servidor resolveu da
-- sessão e passou explicitamente, e é revalidado contra `organization_members`.
CREATE OR REPLACE FUNCTION billing.fn_require_member(
  p_actor_id        uuid,
  p_organization_id uuid,
  p_require_owner   boolean
) RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $fn$
DECLARE
  v_role public.organization_role;
BEGIN
  IF p_actor_id IS NULL OR p_organization_id IS NULL THEN
    RAISE EXCEPTION 'billing: ator nao autorizado nesta organizacao'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT om.role INTO v_role
    FROM public.organization_members om
   WHERE om.user_id = p_actor_id
     AND om.tenant_id = p_organization_id
     AND om.deleted_at IS NULL
   ORDER BY om.created_at ASC, om.id ASC
   LIMIT 1;

  -- Organização inexistente e organização alheia produzem A MESMA recusa, com
  -- a MESMA mensagem. Distingui-las entregaria "esta organização existe" a
  -- quem varre identificadores.
  IF v_role IS NULL OR (p_require_owner AND v_role <> 'owner') THEN
    RAISE EXCEPTION 'billing: ator nao autorizado nesta organizacao'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$fn$;

-- AUDITORIA. Toda escrita passa por aqui, na mesma transação do efeito.
CREATE OR REPLACE FUNCTION billing.fn_audit(
  p_organization_id uuid,
  p_subscription_id uuid,
  p_subject         billing.audit_subject,
  p_actor_id        uuid,
  p_origin          text,
  p_occurred_at     timestamptz,
  p_previous        jsonb,
  p_new             jsonb,
  p_reason          text,
  p_idempotency_key text,
  p_correlation_id  text
) RETURNS bigint
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE
  v_id bigint;
BEGIN
  IF p_origin NOT IN ('owner', 'provider_webhook', 'scheduler', 'admin') THEN
    RAISE EXCEPTION 'billing: origem de auditoria desconhecida: %', p_origin
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO billing.audit_events (
    organization_id, subscription_id, subject, actor_id, origin, occurred_at,
    previous_value, new_value, reason, idempotency_key, correlation_id
  ) VALUES (
    p_organization_id, p_subscription_id, p_subject,
    -- Ator humano só quando a origem é humana. Webhook e rotina não têm autor.
    CASE WHEN p_origin IN ('owner', 'admin') THEN p_actor_id ELSE NULL END,
    p_origin, p_occurred_at, p_previous, p_new, p_reason,
    p_idempotency_key, p_correlation_id
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END
$fn$;

-- SERIALIZAÇÃO. Retorno mínimo e tipado: nada de `SELECT *`, nada de coluna
-- que o chamador não precise.
CREATE OR REPLACE FUNCTION billing.fn_subscription_json(p_organization_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  SELECT to_jsonb(x) FROM (
    SELECT s.id,
           s.organization_id,
           s.plan::text          AS plan,
           s.tier::text          AS tier,
           s.period::text        AS period,
           s.state::text         AS state,
           s.worker_count,
           s.cnpj,
           s.current_period_start,
           s.current_period_end,
           s.trial_ends_at,
           s.payment_failed_at,
           s.scheduled_downgrade_plan::text AS scheduled_downgrade_plan,
           s.scheduled_downgrade_tier::text AS scheduled_downgrade_tier,
           (SELECT to_jsonb(y) FROM (
              SELECT ps.plan::text AS plan, ps.tier::text AS tier,
                     ps.period::text AS period,
                     ps.amount_cents, ps.catalog_version, ps.captured_at
                FROM billing.price_snapshots ps
               WHERE ps.subscription_id = s.id
               ORDER BY ps.captured_at DESC, ps.created_at DESC
               LIMIT 1
            ) y) AS price_snapshot
      FROM billing.subscriptions s
     WHERE s.organization_id = p_organization_id
  ) x;
$fn$;

CREATE OR REPLACE FUNCTION billing.fn_charge_json(p_charge_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  SELECT to_jsonb(x) FROM (
    SELECT c.id, c.organization_id, c.subscription_id, c.provider,
           c.provider_account_id, c.external_customer_id, c.external_charge_id,
           c.method::text AS method, c.amount_cents, c.currency,
           c.billing_period::text AS billing_period,
           c.status::text AS status,
           c.period_start, c.period_end, c.created_at,
           c.paid_at, c.failed_at, c.cancelled_at, c.idempotency_key
      FROM billing.charges c
     WHERE c.id = p_charge_id
  ) x;
$fn$;

-- ESCRITA DE ASSINATURA + SNAPSHOT + AUDITORIA, em um lugar só.
-- As RPCs públicas são finas e nominais; a lógica compartilhada mora aqui para
-- não ser reescrita — e esquecida pela metade — em cada uma delas.
CREATE OR REPLACE FUNCTION billing.fn_write_subscription(
  p_organization_id  uuid,
  p_actor_id         uuid,
  p_origin           text,
  p_plan             billing.plan_slug,
  p_tier             billing.tier_slug,
  p_period           billing.billing_period,
  p_state            billing.subscription_state,
  p_worker_count     integer,
  p_period_start     timestamptz,
  p_period_end       timestamptz,
  p_trial_ends_at    timestamptz,
  p_clear_trial      boolean,
  p_downgrade_plan   billing.plan_slug,
  p_downgrade_tier   billing.tier_slug,
  p_clear_downgrade  boolean,
  p_payment_failed   timestamptz,
  p_clear_failure    boolean,
  p_amount_cents     integer,
  p_catalog_version  text,
  p_subject          billing.audit_subject,
  p_reason           text,
  p_idempotency_key  text,
  p_correlation_id   text,
  p_now              timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE
  v_antes billing.subscriptions%ROWTYPE;
  v_dep   billing.subscriptions%ROWTYPE;
BEGIN
  -- `FOR UPDATE` serializa duas transições concorrentes sobre a MESMA
  -- assinatura. Sem ele, dois webhooks simultâneos leriam o mesmo estado
  -- anterior e a auditoria registraria uma transição que não aconteceu.
  SELECT * INTO v_antes
    FROM billing.subscriptions
   WHERE organization_id = p_organization_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'billing: nenhuma assinatura para esta organizacao'
      USING ERRCODE = 'no_data_found';
  END IF;

  UPDATE billing.subscriptions s
     SET plan   = COALESCE(p_plan,   s.plan),
         tier   = COALESCE(p_tier,   s.tier),
         period = COALESCE(p_period, s.period),
         state  = COALESCE(p_state,  s.state),
         worker_count = COALESCE(p_worker_count, s.worker_count),
         current_period_start = COALESCE(p_period_start, s.current_period_start),
         current_period_end   = COALESCE(p_period_end,   s.current_period_end),
         trial_ends_at = CASE WHEN p_clear_trial THEN NULL
                              ELSE COALESCE(p_trial_ends_at, s.trial_ends_at) END,
         payment_failed_at = CASE WHEN p_clear_failure THEN NULL
                                  ELSE COALESCE(p_payment_failed, s.payment_failed_at) END,
         scheduled_downgrade_plan = CASE WHEN p_clear_downgrade THEN NULL
                                         ELSE COALESCE(p_downgrade_plan, s.scheduled_downgrade_plan) END,
         scheduled_downgrade_tier = CASE WHEN p_clear_downgrade THEN NULL
                                         ELSE COALESCE(p_downgrade_tier, s.scheduled_downgrade_tier) END,
         updated_at = p_now
   WHERE s.organization_id = p_organization_id
  RETURNING * INTO v_dep;

  -- Snapshot só quando há preço a congelar. Preço nunca é derivado depois:
  -- o que valeu no ato fica gravado, e é por isso que a tabela é imutável.
  IF p_amount_cents IS NOT NULL AND p_catalog_version IS NOT NULL THEN
    INSERT INTO billing.price_snapshots (
      subscription_id, plan, tier, period, amount_cents, catalog_version, captured_at
    ) VALUES (
      v_dep.id, v_dep.plan, v_dep.tier, v_dep.period,
      p_amount_cents, p_catalog_version, p_now
    );
  END IF;

  PERFORM billing.fn_audit(
    p_organization_id, v_dep.id, p_subject, p_actor_id, p_origin, p_now,
    jsonb_build_object(
      'plan', v_antes.plan::text, 'tier', v_antes.tier::text,
      'period', v_antes.period::text, 'state', v_antes.state::text,
      'workerCount', v_antes.worker_count,
      'currentPeriodStart', v_antes.current_period_start,
      'currentPeriodEnd', v_antes.current_period_end
    ),
    jsonb_build_object(
      'plan', v_dep.plan::text, 'tier', v_dep.tier::text,
      'period', v_dep.period::text, 'state', v_dep.state::text,
      'workerCount', v_dep.worker_count,
      'currentPeriodStart', v_dep.current_period_start,
      'currentPeriodEnd', v_dep.current_period_end
    ),
    p_reason, p_idempotency_key, p_correlation_id
  );

  RETURN billing.fn_subscription_json(p_organization_id);
END
$fn$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 9. RPCs PÚBLICAS — a única porta
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Dezesseis funções, estreitas e nominais. Nenhuma aceita nome de tabela, de
-- coluna, de função ou fragmento de SQL; nenhuma monta SQL dinâmico com
-- entrada; nenhuma recebe jsonb livre. Os parâmetros são tipados, e os que
-- viram enum são convertidos por cast — um valor desconhecido aborta a
-- transação antes de qualquer escrita.
--
-- Todas: SECURITY DEFINER, `SET search_path = ''`, nomes qualificados por
-- schema, uma transação por chamada, retorno jsonb mínimo.
--
-- A allowlist destas assinaturas está em `scripts/ci/assert-billing-rpcs.sql`,
-- em `scripts/ci/build-expected-schema.mjs` e em
-- `tests/billing-orchestration-guard.mjs`. Acrescentar, remover, renomear ou
-- sobrecarregar qualquer uma reprova nos três.

-- ─── 9.1 LEITURA ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_billing_read_state(
  p_actor_id uuid,
  p_organization_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  -- Consulta de entitlement: qualquer membro ativo. Não exige owner.
  PERFORM billing.fn_require_member(p_actor_id, p_organization_id, false);

  RETURN jsonb_build_object(
    'subscription', billing.fn_subscription_json(p_organization_id),
    'courtesies', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.starts_at)
        FROM (
          SELECT c.id, c.organization_id, c.plan::text AS plan,
                 c.starts_at, c.ends_at, c.reason, c.granted_by,
                 r.revoked_at
            FROM billing.courtesies c
            LEFT JOIN billing.courtesy_revocations r ON r.courtesy_id = c.id
           WHERE c.organization_id = p_organization_id
        ) x
    ), '[]'::jsonb),
    'grandfathering', (
      SELECT to_jsonb(g) FROM (
        SELECT go.organization_id, go.cutoff_at, go.granted_at
          FROM billing.grandfathered_organizations go
         WHERE go.organization_id = p_organization_id
      ) g
    ),
    'grandfatheringCutoff', (SELECT gc.cutoff_at FROM billing.grandfathering_cutoff gc LIMIT 1)
  );
END
$fn$;

CREATE OR REPLACE FUNCTION public.fn_billing_read_catalog(
  p_actor_id uuid,
  p_organization_id uuid,
  p_catalog_version text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM billing.fn_require_member(p_actor_id, p_organization_id, false);

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.plan, x.tier)
      FROM (
        SELECT pc.catalog_version, pc.plan::text AS plan, pc.tier::text AS tier,
               pc.monthly_cents, pc.yearly_cents
          FROM billing.price_catalog pc
         WHERE pc.catalog_version = p_catalog_version
      ) x
  ), '[]'::jsonb);
END
$fn$;

CREATE OR REPLACE FUNCTION public.fn_billing_read_ledger(
  p_actor_id uuid,
  p_organization_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  -- Trilha e cobranças são dado financeiro: exige owner.
  PERFORM billing.fn_require_member(p_actor_id, p_organization_id, true);

  RETURN jsonb_build_object(
    'charges', COALESCE((
      SELECT jsonb_agg(billing.fn_charge_json(c.id) ORDER BY c.created_at)
        FROM billing.charges c
       WHERE c.organization_id = p_organization_id
    ), '[]'::jsonb),
    'snapshots', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.captured_at)
        FROM (
          SELECT ps.plan::text AS plan, ps.tier::text AS tier,
                 ps.period::text AS period, ps.amount_cents,
                 ps.catalog_version, ps.captured_at
            FROM billing.price_snapshots ps
            JOIN billing.subscriptions s ON s.id = ps.subscription_id
           WHERE s.organization_id = p_organization_id
        ) x
    ), '[]'::jsonb),
    'auditEvents', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)
        FROM (
          SELECT ae.id::text AS id, ae.organization_id, ae.subscription_id,
                 ae.subject::text AS subject, ae.actor_id, ae.origin,
                 ae.occurred_at, ae.previous_value, ae.new_value, ae.reason,
                 ae.idempotency_key, ae.correlation_id
            FROM billing.audit_events ae
           WHERE ae.organization_id = p_organization_id
        ) x
    ), '[]'::jsonb)
  );
END
$fn$;

-- ─── 9.2 CICLO DE VIDA ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_billing_start_trial(
  p_actor_id uuid,
  p_organization_id uuid,
  p_plan text,
  p_tier text,
  p_period text,
  p_worker_count integer,
  p_cnpj text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_trial_ends_at timestamptz,
  p_amount_cents integer,
  p_catalog_version text,
  p_correlation_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  PERFORM billing.fn_require_member(p_actor_id, p_organization_id, true);

  IF p_cnpj IS NULL OR btrim(p_cnpj) = '' THEN
    RAISE EXCEPTION 'billing: CNPJ e obrigatorio para iniciar o trial'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_worker_count IS NULL OR p_worker_count < 1 THEN
    RAISE EXCEPTION 'billing: numero de trabalhadores invalido'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO billing.subscriptions (
    organization_id, plan, tier, period, state, worker_count, cnpj,
    current_period_start, current_period_end, trial_ends_at
  ) VALUES (
    p_organization_id, p_plan::billing.plan_slug, p_tier::billing.tier_slug,
    p_period::billing.billing_period, 'trialing', p_worker_count, p_cnpj,
    p_period_start, p_period_end, p_trial_ends_at
  )
  RETURNING id INTO v_id;

  IF p_amount_cents IS NOT NULL AND p_catalog_version IS NOT NULL THEN
    INSERT INTO billing.price_snapshots (
      subscription_id, plan, tier, period, amount_cents, catalog_version, captured_at
    ) VALUES (
      v_id, p_plan::billing.plan_slug, p_tier::billing.tier_slug,
      p_period::billing.billing_period, p_amount_cents, p_catalog_version,
      p_period_start
    );
  END IF;

  PERFORM billing.fn_audit(
    p_organization_id, v_id, 'subscription_state', p_actor_id, 'owner',
    p_period_start, NULL,
    jsonb_build_object('state', 'trialing', 'plan', p_plan, 'tier', p_tier,
                       'trialEndsAt', p_trial_ends_at),
    'inicio de trial', NULL, p_correlation_id
  );

  RETURN billing.fn_subscription_json(p_organization_id);
END
$fn$;

CREATE OR REPLACE FUNCTION public.fn_billing_change_plan(
  p_actor_id uuid,
  p_organization_id uuid,
  p_plan text,
  p_tier text,
  p_period text,
  p_state text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_amount_cents integer,
  p_catalog_version text,
  p_subject text,
  p_reason text,
  p_idempotency_key text,
  p_correlation_id text,
  p_now timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM billing.fn_require_member(p_actor_id, p_organization_id, true);

  IF p_subject NOT IN ('plan_change', 'tier_change', 'subscription_state') THEN
    RAISE EXCEPTION 'billing: assunto de auditoria invalido para troca de plano'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN billing.fn_write_subscription(
    p_organization_id, p_actor_id, 'owner',
    p_plan::billing.plan_slug, p_tier::billing.tier_slug,
    p_period::billing.billing_period, p_state::billing.subscription_state,
    NULL, p_period_start, p_period_end,
    NULL, false, NULL, NULL, true, NULL, false,
    p_amount_cents, p_catalog_version,
    p_subject::billing.audit_subject, p_reason, p_idempotency_key,
    p_correlation_id, p_now
  );
END
$fn$;

CREATE OR REPLACE FUNCTION public.fn_billing_schedule_downgrade(
  p_actor_id uuid,
  p_organization_id uuid,
  p_plan text,
  p_tier text,
  p_reason text,
  p_correlation_id text,
  p_now timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM billing.fn_require_member(p_actor_id, p_organization_id, true);

  RETURN billing.fn_write_subscription(
    p_organization_id, p_actor_id, 'owner',
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false,
    p_plan::billing.plan_slug, p_tier::billing.tier_slug, false,
    NULL, false, NULL, NULL,
    'plan_change', p_reason, NULL, p_correlation_id, p_now
  );
END
$fn$;

CREATE OR REPLACE FUNCTION public.fn_billing_cancel_at_period_end(
  p_actor_id uuid,
  p_organization_id uuid,
  p_reason text,
  p_correlation_id text,
  p_now timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM billing.fn_require_member(p_actor_id, p_organization_id, true);

  RETURN billing.fn_write_subscription(
    p_organization_id, p_actor_id, 'owner',
    NULL, NULL, NULL, 'cancel_scheduled'::billing.subscription_state,
    NULL, NULL, NULL, NULL, false, NULL, NULL, true, NULL, false,
    NULL, NULL,
    'subscription_state', p_reason, NULL, p_correlation_id, p_now
  );
END
$fn$;

CREATE OR REPLACE FUNCTION public.fn_billing_transition_state(
  p_actor_id uuid,
  p_organization_id uuid,
  p_state text,
  p_origin text,
  p_reason text,
  p_correlation_id text,
  p_now timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  -- Transição por rotina (`scheduler`) não tem dono humano; por pedido do
  -- proprietário, tem. Nos dois casos a organização é revalidada.
  IF p_origin = 'owner' THEN
    PERFORM billing.fn_require_member(p_actor_id, p_organization_id, true);
  ELSIF p_origin <> 'scheduler' THEN
    RAISE EXCEPTION 'billing: origem invalida para transicao de estado'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN billing.fn_write_subscription(
    p_organization_id, p_actor_id, p_origin,
    NULL, NULL, NULL, p_state::billing.subscription_state,
    NULL, NULL, NULL, NULL, false, NULL, NULL, false, NULL, false,
    NULL, NULL,
    'subscription_state', p_reason, NULL, p_correlation_id, p_now
  );
END
$fn$;

CREATE OR REPLACE FUNCTION public.fn_billing_record_worker_count(
  p_actor_id uuid,
  p_organization_id uuid,
  p_worker_count integer,
  p_correlation_id text,
  p_now timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM billing.fn_require_member(p_actor_id, p_organization_id, true);

  IF p_worker_count IS NULL OR p_worker_count < 1 THEN
    RAISE EXCEPTION 'billing: numero de trabalhadores invalido'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Declarar trabalhadores NÃO muda faixa nem preço agora: a faixa é
  -- recalculada na renovação. Por isso plano, faixa e preço vão nulos.
  RETURN billing.fn_write_subscription(
    p_organization_id, p_actor_id, 'owner',
    NULL, NULL, NULL, NULL, p_worker_count, NULL, NULL, NULL, false,
    NULL, NULL, false, NULL, false, NULL, NULL,
    'worker_count', NULL, NULL, p_correlation_id, p_now
  );
END
$fn$;

-- ─── 9.3 IDEMPOTÊNCIA: claim / fail ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_billing_claim_idempotency(
  p_actor_id uuid,
  p_organization_id uuid,
  p_scope text,
  p_provider text,
  p_key text,
  p_fingerprint text,
  p_correlation_id text,
  p_now timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_rec billing.idempotency_records%ROWTYPE;
BEGIN
  PERFORM billing.fn_require_member(p_actor_id, p_organization_id, true);

  IF p_fingerprint IS NULL OR btrim(p_fingerprint) = '' THEN
    RAISE EXCEPTION 'billing: fingerprint do pedido e obrigatorio'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- INSERT SEM SELECT ANTES. Entre um select e um insert cabe outra
  -- transação, e é exatamente aí que a duplicata nasceria. Um INSERT comum
  -- BLOQUEIA na linha em conflito ainda não comitada e só então falha — que é
  -- o comportamento que resolve a corrida. `ON CONFLICT DO NOTHING` seria
  -- errado aqui: ele não espera, e o SELECT seguinte não enxergaria a linha
  -- do vencedor.
  BEGIN
    INSERT INTO billing.idempotency_records (
      organization_id, scope, provider, key, status, request_fingerprint,
      correlation_id, started_at
    ) VALUES (
      p_organization_id, p_scope::billing.idempotency_scope, p_provider, p_key,
      'in_progress', p_fingerprint, p_correlation_id, p_now
    );
    RETURN jsonb_build_object('outcome', 'claimed');
  EXCEPTION WHEN unique_violation THEN
    NULL;  -- perdeu a corrida; o vencedor é lido abaixo
  END;

  SELECT * INTO v_rec
    FROM billing.idempotency_records
   WHERE organization_id = p_organization_id
     AND scope = p_scope::billing.idempotency_scope
     AND provider = p_provider
     AND key = p_key
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'billing: chave de idempotencia em disputa'
      USING ERRCODE = 'serialization_failure';
  END IF;

  -- Mesma chave com OUTRO pedido não é repetição: é reuso de chave, e devolver
  -- o resultado do primeiro faria o segundo pedido sumir sem aviso.
  IF v_rec.request_fingerprint IS DISTINCT FROM p_fingerprint THEN
    RETURN jsonb_build_object('outcome', 'fingerprint_conflict');
  END IF;

  IF v_rec.status = 'completed' THEN
    RETURN jsonb_build_object('outcome', 'completed', 'result', v_rec.result);
  END IF;

  IF v_rec.status = 'in_progress' THEN
    RETURN jsonb_build_object('outcome', 'in_progress');
  END IF;

  -- `failed` significa que o efeito NÃO aconteceu. Repetir é legítimo, desde
  -- que o pedido seja o mesmo — daí a checagem de fingerprint acima.
  UPDATE billing.idempotency_records
     SET status = 'in_progress', started_at = p_now,
         failed_at = NULL, error_code = NULL, correlation_id = p_correlation_id
   WHERE id = v_rec.id;

  RETURN jsonb_build_object('outcome', 'claimed');
END
$fn$;

CREATE OR REPLACE FUNCTION public.fn_billing_fail_idempotency(
  p_actor_id uuid,
  p_organization_id uuid,
  p_scope text,
  p_provider text,
  p_key text,
  p_fingerprint text,
  p_error_code text,
  p_now timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_rec billing.idempotency_records%ROWTYPE;
BEGIN
  PERFORM billing.fn_require_member(p_actor_id, p_organization_id, true);

  SELECT * INTO v_rec
    FROM billing.idempotency_records
   WHERE organization_id = p_organization_id
     AND scope = p_scope::billing.idempotency_scope
     AND provider = p_provider
     AND key = p_key
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'billing: reserva de idempotencia inexistente'
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_rec.request_fingerprint IS DISTINCT FROM p_fingerprint THEN
    RETURN jsonb_build_object('outcome', 'fingerprint_conflict');
  END IF;
  IF v_rec.status <> 'in_progress' THEN
    RETURN jsonb_build_object('outcome', v_rec.status::text);
  END IF;

  -- Marca a falha SEM declarar efeito. `result` continua nulo, e a constraint
  -- `idempotency_resultado_so_completo` garante que continue.
  UPDATE billing.idempotency_records
     SET status = 'failed', failed_at = p_now, error_code = p_error_code
   WHERE id = v_rec.id;

  RETURN jsonb_build_object('outcome', 'failed');
END
$fn$;

-- ─── 9.4 CHECKOUT: finalize ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_billing_finalize_checkout(
  p_actor_id uuid,
  p_organization_id uuid,
  p_provider text,
  p_provider_account_id text,
  p_external_customer_id text,
  p_external_charge_id text,
  p_method text,
  p_amount_cents integer,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_idempotency_key text,
  p_fingerprint text,
  p_correlation_id text,
  p_now timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_rec    billing.idempotency_records%ROWTYPE;
  v_sub    billing.subscriptions%ROWTYPE;
  v_charge uuid;
BEGIN
  PERFORM billing.fn_require_member(p_actor_id, p_organization_id, true);

  SELECT * INTO v_rec
    FROM billing.idempotency_records
   WHERE organization_id = p_organization_id
     AND scope = 'command'
     AND provider = p_provider
     AND key = p_idempotency_key
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'billing: finalizacao sem reserva previa'
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_rec.request_fingerprint IS DISTINCT FROM p_fingerprint THEN
    RETURN jsonb_build_object('outcome', 'fingerprint_conflict');
  END IF;
  IF v_rec.status = 'completed' THEN
    RETURN jsonb_build_object('outcome', 'completed', 'result', v_rec.result);
  END IF;
  IF v_rec.status <> 'in_progress' THEN
    RAISE EXCEPTION 'billing: reserva nao esta em andamento'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_sub
    FROM billing.subscriptions
   WHERE organization_id = p_organization_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'billing: nenhuma assinatura para esta organizacao'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Cliente do provider. O vencedor de uma corrida é quem já está gravado:
  -- trocar o identificador abandonaria o cliente criado no provider.
  INSERT INTO billing.customers (
    organization_id, provider, provider_account_id, external_customer_id, created_at
  ) VALUES (
    p_organization_id, p_provider, p_provider_account_id, p_external_customer_id, p_now
  )
  ON CONFLICT (organization_id, provider, provider_account_id) DO NOTHING;

  INSERT INTO billing.charges (
    organization_id, subscription_id, provider, provider_account_id,
    external_customer_id, external_charge_id, method, amount_cents,
    billing_period, idempotency_key, period_start, period_end,
    created_at, updated_at
  ) VALUES (
    p_organization_id, v_sub.id, p_provider, p_provider_account_id,
    p_external_customer_id, p_external_charge_id, p_method::billing.charge_method,
    p_amount_cents, v_sub.period, p_idempotency_key, p_period_start, p_period_end,
    p_now, p_now
  )
  RETURNING id INTO v_charge;

  PERFORM billing.fn_audit(
    p_organization_id, v_sub.id, 'charge', p_actor_id, 'owner', p_now,
    NULL,
    jsonb_build_object('externalChargeId', p_external_charge_id,
                       'amountCents', p_amount_cents, 'method', p_method,
                       'periodStart', p_period_start, 'periodEnd', p_period_end),
    NULL, p_idempotency_key, p_correlation_id
  );

  -- O resultado só é gravado AGORA, com o efeito já dentro da mesma transação.
  UPDATE billing.idempotency_records
     SET status = 'completed', completed_at = p_now,
         result = jsonb_build_object('chargeId', v_charge::text)
   WHERE id = v_rec.id;

  RETURN jsonb_build_object(
    'outcome', 'completed',
    'result', jsonb_build_object('chargeId', v_charge::text),
    'charge', billing.fn_charge_json(v_charge)
  );
END
$fn$;

-- ─── 9.5 EVENTO DO PROVIDER ─────────────────────────────────────────────────
--
-- NÃO recebe `organization_id`. O tenant é RESOLVIDO a partir da cobrança, que
-- por sua vez é única globalmente por (provider, conta, identificador externo).
-- Aceitar a organização do corpo do webhook seria deixar quem manda o evento
-- escolher a quem ele se aplica.

CREATE OR REPLACE FUNCTION public.fn_billing_apply_provider_event(
  p_provider text,
  p_provider_account_id text,
  p_external_event_id text,
  p_external_charge_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_correlation_id text,
  p_now timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_charge billing.charges%ROWTYPE;
  v_sub    billing.subscriptions%ROWTYPE;
  v_estado billing.subscription_state;
  v_status billing.charge_status;
BEGIN
  IF p_event_type NOT IN ('charge_paid', 'charge_failed') THEN
    RAISE EXCEPTION 'billing: tipo de evento desconhecido: %', p_event_type
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_charge
    FROM billing.charges
   WHERE provider = p_provider
     AND provider_account_id = p_provider_account_id
     AND external_charge_id = p_external_charge_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'billing: cobranca desconhecida'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Unicidade GLOBAL do evento, na mesma transação do efeito. Duplicata não
  -- reaplica nada.
  BEGIN
    INSERT INTO billing.provider_events (
      provider, provider_account_id, external_event_id, organization_id,
      charge_id, event_type, occurred_at, received_at, correlation_id
    ) VALUES (
      p_provider, p_provider_account_id, p_external_event_id,
      v_charge.organization_id, v_charge.id, p_event_type,
      p_occurred_at, p_now, p_correlation_id
    );
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('outcome', 'duplicate');
  END;

  SELECT * INTO v_sub
    FROM billing.subscriptions
   WHERE organization_id = v_charge.organization_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'billing: assinatura ausente para a cobranca'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- ORDEM. O evento pertence ao ciclo em que a cobrança foi emitida, e não ao
  -- ciclo em que ele chegou: um pagamento atrasado não reativa período novo.
  IF p_occurred_at < v_charge.period_start THEN
    RETURN jsonb_build_object('outcome', 'out_of_order',
                              'reason', 'evento anterior ao periodo da cobranca');
  END IF;
  IF v_charge.period_end <= v_sub.current_period_start THEN
    RETURN jsonb_build_object('outcome', 'out_of_order',
                              'reason', 'cobranca de periodo ja encerrado');
  END IF;

  IF p_event_type = 'charge_paid' THEN
    v_status := 'paid'; v_estado := 'active';
  ELSE
    v_status := 'failed'; v_estado := 'past_due_tolerance';
  END IF;

  -- A trigger de transição recusa se a cobrança já for terminal.
  UPDATE billing.charges
     SET status = v_status,
         paid_at   = CASE WHEN v_status = 'paid'   THEN p_occurred_at ELSE paid_at   END,
         failed_at = CASE WHEN v_status = 'failed' THEN p_occurred_at ELSE failed_at END,
         updated_at = p_now
   WHERE id = v_charge.id;

  UPDATE billing.subscriptions
     SET state = v_estado,
         payment_failed_at = CASE WHEN v_status = 'failed' THEN p_occurred_at ELSE NULL END,
         updated_at = p_now
   WHERE id = v_sub.id;

  PERFORM billing.fn_audit(
    v_charge.organization_id, v_sub.id, 'payment', NULL, 'provider_webhook',
    p_occurred_at,
    jsonb_build_object('state', v_sub.state::text, 'chargeStatus', v_charge.status::text),
    jsonb_build_object('state', v_estado::text, 'chargeStatus', v_status::text,
                       'externalChargeId', v_charge.external_charge_id,
                       'amountCents', v_charge.amount_cents),
    NULL, p_external_event_id, p_correlation_id
  );

  RETURN jsonb_build_object(
    'outcome', 'applied',
    'organizationId', v_charge.organization_id,
    'charge', billing.fn_charge_json(v_charge.id),
    'subscription', billing.fn_subscription_json(v_charge.organization_id)
  );
END
$fn$;

-- ─── 9.6 CORTESIA E DIREITO ADQUIRIDO ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_billing_grant_courtesy(
  p_actor_id uuid,
  p_organization_id uuid,
  p_plan text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reason text,
  p_correlation_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  PERFORM billing.fn_require_member(p_actor_id, p_organization_id, true);

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'billing: cortesia exige motivo'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION 'billing: cortesia exige prazo positivo'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO billing.courtesies (
    organization_id, plan, starts_at, ends_at, reason, granted_by
  ) VALUES (
    p_organization_id, p_plan::billing.plan_slug, p_starts_at, p_ends_at,
    p_reason, p_actor_id
  )
  RETURNING id INTO v_id;

  PERFORM billing.fn_audit(
    p_organization_id, NULL, 'courtesy', p_actor_id, 'admin', p_starts_at,
    NULL,
    jsonb_build_object('courtesyId', v_id::text, 'plan', p_plan,
                       'startsAt', p_starts_at, 'endsAt', p_ends_at),
    p_reason, NULL, p_correlation_id
  );

  RETURN jsonb_build_object('id', v_id::text, 'organizationId', p_organization_id,
                            'plan', p_plan, 'startsAt', p_starts_at,
                            'endsAt', p_ends_at, 'reason', p_reason,
                            'grantedBy', p_actor_id, 'revokedAt', NULL);
END
$fn$;

CREATE OR REPLACE FUNCTION public.fn_billing_revoke_courtesy(
  p_actor_id uuid,
  p_organization_id uuid,
  p_courtesy_id uuid,
  p_revoked_at timestamptz,
  p_reason text,
  p_correlation_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM billing.fn_require_member(p_actor_id, p_organization_id, true);

  -- A cortesia precisa ser DESTA organização.
  IF NOT EXISTS (
    SELECT 1 FROM billing.courtesies
     WHERE id = p_courtesy_id AND organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'billing: cortesia inexistente para esta organizacao'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Append-only: a concessão original permanece, com autor e motivo. Apagá-la
  -- apagaria a prova de que existiu.
  BEGIN
    INSERT INTO billing.courtesy_revocations (
      courtesy_id, organization_id, revoked_at, revoked_by, reason
    ) VALUES (
      p_courtesy_id, p_organization_id, p_revoked_at, p_actor_id, p_reason
    );
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('outcome', 'already_revoked');
  END;

  PERFORM billing.fn_audit(
    p_organization_id, NULL, 'courtesy', p_actor_id, 'admin', p_revoked_at,
    jsonb_build_object('courtesyId', p_courtesy_id::text, 'revoked', false),
    jsonb_build_object('courtesyId', p_courtesy_id::text, 'revoked', true),
    p_reason, NULL, p_correlation_id
  );

  RETURN jsonb_build_object('outcome', 'revoked', 'courtesyId', p_courtesy_id::text,
                            'revokedAt', p_revoked_at, 'revokedBy', p_actor_id);
END
$fn$;

CREATE OR REPLACE FUNCTION public.fn_billing_save_grandfathering(
  p_actor_id uuid,
  p_organization_id uuid,
  p_cutoff_at timestamptz,
  p_granted_at timestamptz,
  p_correlation_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM billing.fn_require_member(p_actor_id, p_organization_id, true);

  -- Direito adquirido é por ORGANIZAÇÃO, nunca por usuário: quem trocar de
  -- dono não perde o direito, e quem entrar na organização não o ganha à
  -- revelia.
  BEGIN
    INSERT INTO billing.grandfathered_organizations (
      organization_id, cutoff_at, granted_at, reason
    ) VALUES (
      p_organization_id, p_cutoff_at, p_granted_at,
      'organizacao existente na data de corte'
    );
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('outcome', 'already_granted');
  END;

  PERFORM billing.fn_audit(
    p_organization_id, NULL, 'grandfathering', p_actor_id, 'admin', p_granted_at,
    NULL,
    jsonb_build_object('cutoffAt', p_cutoff_at, 'grantedAt', p_granted_at),
    NULL, NULL, p_correlation_id
  );

  RETURN jsonb_build_object('outcome', 'granted', 'organizationId', p_organization_id,
                            'cutoffAt', p_cutoff_at, 'grantedAt', p_granted_at);
END
$fn$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 10. PRIVILÉGIOS
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Mudança de regime em relação à 12A: o `service_role` PERDE todo acesso direto
-- às tabelas de billing, inclusive SELECT, e perde USAGE no schema.
--
-- Antes, ele lia e escrevia direto — e era isso que tornava o filtro por
-- `organization_id` no cliente a ÚNICA barreira entre dois tenants, já que
-- `service_role` tem BYPASSRLS. Agora ele não alcança tabela alguma: só executa
-- as dezesseis funções, que rodam como owner e revalidam ator e organização no
-- banco.
--
-- Defesa em profundidade permanece inteira: RLS ligada, zero policies, triggers
-- de imutabilidade e de transição, constraints, e DELETE/TRUNCATE para ninguém.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tiers', 'price_catalog', 'subscriptions', 'price_snapshots',
    'grandfathering_cutoff', 'grandfathered_organizations', 'courtesies',
    'audit_events', 'legacy_plan_state',
    'customers', 'charges', 'idempotency_records', 'courtesy_revocations',
    'provider_events'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE billing.%I FROM PUBLIC', t);
    EXECUTE format('REVOKE ALL ON TABLE billing.%I FROM anon', t);
    EXECUTE format('REVOKE ALL ON TABLE billing.%I FROM authenticated', t);
    EXECUTE format('REVOKE ALL ON TABLE billing.%I FROM service_role', t);
    EXECUTE format('ALTER TABLE billing.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;

-- O schema deixa de ser navegável até pelo `service_role`. As funções alcançam
-- por dentro, como owner.
REVOKE ALL ON SCHEMA billing FROM PUBLIC;
REVOKE ALL ON SCHEMA billing FROM anon;
REVOKE ALL ON SCHEMA billing FROM authenticated;
REVOKE USAGE ON SCHEMA billing FROM service_role;

-- Auxiliares internos: não são chamáveis de fora.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS assinatura
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'billing'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.assinatura);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.assinatura);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.assinatura);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM service_role', r.assinatura);
  END LOOP;
END
$$;

-- As dezesseis RPCs: EXECUTE exclusivamente para `service_role`.
--
-- O default do PostgreSQL para funções é EXECUTE para PUBLIC. Sem o REVOKE
-- abaixo, `anon` e `authenticated` chamariam cada uma delas pelo PostgREST —
-- e como são SECURITY DEFINER, rodariam como owner. É o erro exato que
-- `assert-no-public-execute.sql` existe para pegar, e aqui ele é impedido na
-- origem.
DO $$
DECLARE
  r record;
  v_int integer := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS assinatura
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.assinatura);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.assinatura);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.assinatura);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.assinatura);
    v_int := v_int + 1;
  END LOOP;

  IF v_int <> 16 THEN
    RAISE EXCEPTION 'esperadas 16 RPCs de billing em public, encontradas %', v_int;
  END IF;
END
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 11. PÓS-CONDIÇÕES
-- ═════════════════════════════════════════════════════════════════════════════

-- Cada asserção em seu PRÓPRIO bloco, com tag nomeada.
-- Motivo: o CLI do Supabase reporta só o número do statement e despeja o
-- bloco inteiro, sem a mensagem do RAISE. Com um bloco por asserção, a
-- falha diz qual invariante caiu — que é a informação de que se precisa.

DO $pc_tabelas$
DECLARE
  v_int   integer;
  v_txt   text;
  v_owner oid;
BEGIN
-- 11.1 As cinco tabelas novas; o schema passa a ter 14.
  SELECT count(*) INTO v_int
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'billing' AND c.relkind = 'r';
  IF v_int <> 14 THEN
    RAISE EXCEPTION 'esperadas 14 tabelas em billing apos a 12B, encontradas %', v_int;
  END IF;
END
$pc_tabelas$;

DO $pc_rls$
DECLARE
  v_int   integer;
  v_txt   text;
  v_owner oid;
BEGIN
-- 11.2 RLS ligada em todas, e nenhuma policy.
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
END
$pc_rls$;

DO $pc_privilegios$
DECLARE
  v_int   integer;
  v_txt   text;
  v_owner oid;
BEGIN
-- 11.3 NENHUM privilégio para nenhum papel do PostgREST em nenhuma tabela.
  --      Não há mais allowlist de UPDATE: não há mais UPDATE concedido.
  SELECT string_agg(format('%s→%s em %s', pg_get_userbyid(a.grantee),
                           a.privilege_type, c.relname), ', ')
    INTO v_txt
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
   WHERE n.nspname = 'billing' AND c.relkind = 'r'
     AND a.grantee <> c.relowner
     AND (a.grantee = 0
          OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated', 'service_role'));
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'privilegio direto sobrevivente em billing: %', v_txt;
  END IF;
END
$pc_privilegios$;

DO $pc_public$
DECLARE
  v_int   integer;
  v_txt   text;
  v_owner oid;
BEGIN
-- 11.4 Nenhuma TABELA, VIEW, SEQUENCE ou TIPO de billing em `public`.
  --      A exceção nominal vale só para FUNÇÃO.
  SELECT count(*) INTO v_int
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('customers', 'charges', 'idempotency_records',
                       'courtesy_revocations', 'provider_events');
  IF v_int <> 0 THEN
    RAISE EXCEPTION '% objeto(s) da 12B foram criados em public', v_int;
  END IF;

  SELECT count(*) INTO v_int
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE n.nspname = 'public'
     AND t.typname IN ('charge_status', 'charge_method', 'idempotency_scope',
                       'idempotency_state');
  IF v_int <> 0 THEN
    RAISE EXCEPTION '% tipo(s) da 12B foram criados em public', v_int;
  END IF;
END
$pc_public$;

DO $pc_assinaturas$
DECLARE
  v_int   integer;
  v_txt   text;
  v_owner oid;
BEGIN
-- 11.5 As dezesseis RPCs existem, com o conjunto EXATO de assinaturas.
  --      Uma função a mais, a menos, ou uma sobrecarga, reprova aqui.
  SELECT string_agg(esperada, ', ' ORDER BY esperada) INTO v_txt
    FROM unnest(ARRAY[
      'fn_billing_apply_provider_event(text, text, text, text, text, timestamp with time zone, text, timestamp with time zone)',
      'fn_billing_cancel_at_period_end(uuid, uuid, text, text, timestamp with time zone)',
      'fn_billing_change_plan(uuid, uuid, text, text, text, text, timestamp with time zone, timestamp with time zone, integer, text, text, text, text, text, timestamp with time zone)',
      'fn_billing_claim_idempotency(uuid, uuid, text, text, text, text, text, timestamp with time zone)',
      'fn_billing_fail_idempotency(uuid, uuid, text, text, text, text, text, timestamp with time zone)',
      'fn_billing_finalize_checkout(uuid, uuid, text, text, text, text, text, integer, timestamp with time zone, timestamp with time zone, text, text, text, timestamp with time zone)',
      'fn_billing_grant_courtesy(uuid, uuid, text, timestamp with time zone, timestamp with time zone, text, text)',
      'fn_billing_read_catalog(uuid, uuid, text)',
      'fn_billing_read_ledger(uuid, uuid)',
      'fn_billing_read_state(uuid, uuid)',
      'fn_billing_record_worker_count(uuid, uuid, integer, text, timestamp with time zone)',
      'fn_billing_revoke_courtesy(uuid, uuid, uuid, timestamp with time zone, text, text)',
      'fn_billing_save_grandfathering(uuid, uuid, timestamp with time zone, timestamp with time zone, text)',
      'fn_billing_schedule_downgrade(uuid, uuid, text, text, text, text, timestamp with time zone)',
      'fn_billing_start_trial(uuid, uuid, text, text, text, integer, text, timestamp with time zone, timestamp with time zone, timestamp with time zone, integer, text, text)',
      'fn_billing_transition_state(uuid, uuid, text, text, text, text, timestamp with time zone)'
    ]) AS t(esperada)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = t.esperada
   );
  IF v_txt IS NOT NULL THEN
    -- A mensagem carrega o que o CATÁLOGO realmente rendeu, e não apenas o que
    -- se esperava. Sem isso, "assinatura diferente" não diz em quê ela difere —
    -- e foi exatamente essa a informação que faltou na primeira execução real.
    RAISE EXCEPTION E'RPC(s) ausente(s) ou com assinatura diferente:\n  esperado: %\n  no catalogo: %',
      v_txt,
      (SELECT string_agg(
                p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
                E'\n              ' ORDER BY p.proname)
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%');
  END IF;
END
$pc_assinaturas$;

DO $pc_definer$
DECLARE
  v_int   integer;
  v_txt   text;
  v_owner oid;
BEGIN
-- 11.6 Todas SECURITY DEFINER, com search_path VAZIO e mesmo owner do schema.
  SELECT c.relowner INTO v_owner FROM pg_class c WHERE c.oid = 'billing.subscriptions'::regclass;

  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%'
     AND (NOT p.prosecdef
          OR p.proowner <> v_owner
          OR NOT EXISTS (
               SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS cfg
                WHERE cfg IN ('search_path=', 'search_path=""')
             ));
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION
      'RPC(s) sem SECURITY DEFINER, com owner inesperado ou sem search_path vazio: %', v_txt;
  END IF;
END
$pc_definer$;

DO $pc_execute$
DECLARE
  v_int   integer;
  v_txt   text;
  v_owner oid;
BEGIN
-- 11.7 EXECUTE somente para service_role.
  SELECT string_agg(format('%s→%s', p.proname, pg_get_userbyid(a.grantee)), ', ')
    INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%'
     AND a.grantee <> p.proowner
     AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) <> 'service_role');
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'EXECUTE indevido em RPC de billing: %', v_txt;
  END IF;
END
$pc_execute$;

DO $pc_triggers$
DECLARE
  v_int   integer;
  v_txt   text;
  v_owner oid;
BEGIN
-- 11.8 Triggers de cobrança e imutabilidades da 12A.
  SELECT count(*) INTO v_int
    FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'billing' AND NOT tg.tgisinternal
     AND tg.tgname IN ('tg_price_snapshot_immutable', 'tg_audit_events_append_only',
                       'tg_charges_immutable', 'tg_charges_transition');
  IF v_int <> 4 THEN
    RAISE EXCEPTION 'esperadas 4 triggers de integridade, encontradas %', v_int;
  END IF;
END
$pc_triggers$;

DO $pc_unicidades$
DECLARE
  v_int   integer;
  v_txt   text;
  v_owner oid;
BEGIN
-- 11.9 Unicidades que sustentam idempotência e resolução de tenant.
  SELECT string_agg(esperada, ', ' ORDER BY esperada) INTO v_txt
    FROM unnest(ARRAY[
      'idempotency_chave_unica', 'charges_externo_unico', 'charges_comando_unico',
      'customers_externo_unico', 'provider_events_unico'
    ]) AS t(esperada)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_constraint WHERE conname = t.esperada AND contype = 'u'
   );
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'unicidade(s) ausente(s): %', v_txt;
  END IF;
END
$pc_unicidades$;

DO $pc_final$
BEGIN
  RAISE NOTICE
    'OK: orquestracao 12B instalada (14 tabelas, 16 RPCs, 0 privilegio direto)';
END
$pc_final$;
