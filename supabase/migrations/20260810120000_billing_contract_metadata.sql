-- =============================================================================
-- ETAPA 12C.1 — METADADOS CONTRATUAIS E CONTATO FINANCEIRO
-- =============================================================================
--
-- Forward-only. Versão 20260810120000, estritamente posterior a 20260802093000.
-- NÃO altera nenhuma das 40 migrations anteriores.
--
-- ── O QUE ESTA MIGRATION ACRESCENTA ─────────────────────────────────────────
--
-- Três colunas em `billing.subscriptions`:
--
--   billing_email      contato financeiro, OPCIONAL;
--   terms_version      versão do documento aceito, OBRIGATÓRIA em trial novo;
--   terms_accepted_at  instante do aceite.
--
-- E duas RPCs em `public`, elevando a allowlist de 16 para 18.
--
-- ── POR QUE DUAS RPCs NOVAS, E NÃO REAPROVEITAMENTO ─────────────────────────
--
-- O contato financeiro muda DEPOIS do trial: alguém troca o e-mail do setor
-- financeiro, e isso não é troca de plano nem contagem de trabalhadores. Uma
-- versão nova dos termos também é aceita depois do trial, e tampouco é troca
-- de plano. Encaixar qualquer das duas em `fn_billing_change_plan` ou em
-- `fn_billing_record_worker_count` seria abuso de responsabilidade: a RPC
-- passaria a aceitar parâmetros sem relação com o que seu nome promete, e a
-- auditoria registraria `plan_change` para algo que não é troca de plano.
--
--   fn_billing_update_billing_email  — só o contato financeiro.
--   fn_billing_accept_terms          — só o aceite.
--
-- ── A PROVA DO ACEITE VAI PARA `billing.audit_events` ───────────────────────
--
-- Nenhuma tabela nova. `audit_events` já carrega, desde a 12A e a 12B, tudo o
-- que o aceite precisa provar: `organization_id`, `subject`, `actor_id`,
-- `origin`, `occurred_at`, `new_value` (onde vai a versão), `correlation_id`.
-- É append-only por regime de privilégio — ninguém tem DELETE nem UPDATE.
-- Criar uma segunda tabela com as mesmas colunas seria duplicar a trilha e
-- abrir a pergunta de qual das duas vale.
--
-- O CONTEÚDO dos termos NÃO entra no banco. Entra a VERSÃO, que identifica o
-- documento publicado de forma imutável. Guardar o texto faria de cada aceite
-- uma cópia de um documento que já é público e versionado.
--
-- ── E-MAIL NA AUDITORIA: MÁSCARA, NÃO O VALOR ───────────────────────────────
--
-- `audit_events` é append-only e ninguém a apaga. Gravar o e-mail inteiro a
-- cada troca criaria um histórico IMUTÁVEL de dado pessoal — precisamente o
-- que não se consegue atender quando alguém pede correção ou eliminação. A
-- coluna corrente é corrigível; a trilha não seria.
--
-- A trilha grava a MÁSCARA (`g***@empresa.com.br`): preserva "mudou, de algo
-- neste domínio para algo naquele", que é o que uma auditoria de contato
-- precisa, sem imobilizar o endereço. Hash foi considerado e descartado: um
-- hash de e-mail é reversível por dicionário e não seria menos pessoal, só
-- menos legível.
--
-- ── ONDE A VERSÃO OFICIAL É DECIDIDA ────────────────────────────────────────
--
-- O banco valida FORMA: par completo, versão não vazia, formato `AAAA-MM-DD`,
-- e — em `fn_billing_accept_terms` — proíbe regredir para versão anterior à
-- já aceita. O banco NÃO conhece qual é a versão oficial vigente.
--
-- Isso é deliberado. Fixar a versão vigente aqui exigiria uma migration a cada
-- publicação de termos, e o item 6 do escopo pede exatamente o contrário: novo
-- aceite sem DDL. A identidade da versão vigente é do servidor de aplicação,
-- em `src/lib/billing/terms.ts`, comparada ANTES da chamada. O que o banco
-- garante sozinho é que nada malformado, nada vazio, nada desemparelhado e
-- nada retroativo se persiste — e isso vale mesmo que a camada TypeScript
-- inteira esteja errada.
--
-- ── FAIL-CLOSED ─────────────────────────────────────────────────────────────
--
-- Não se presume banco vazio. Pós-condições abortam a transação.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. NOVOS ASSUNTOS DE AUDITORIA
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `ALTER TYPE ... ADD VALUE` dentro de transação é permitido no PostgreSQL 12+,
-- mas o valor novo NÃO pode ser USADO na mesma transação. Nenhuma linha desta
-- migration grava 'terms_acceptance' ou 'billing_email'; as pós-condições
-- conferem a presença dos rótulos por `pg_enum`, sem convertê-los.
--
-- ASSIMETRIA DECLARADA: o PostgreSQL não tem `ALTER TYPE ... DROP VALUE`. O
-- rollback desta migration devolve colunas, RPCs, owner e ACL, mas os dois
-- rótulos permanecem no enum. Um rótulo sem uso não concede nada e não guarda
-- nada — mas fingir que o rollback é total seria mentira, e está escrito aqui e
-- no arquivo de rollback.

ALTER TYPE billing.audit_subject ADD VALUE IF NOT EXISTS 'terms_acceptance';
ALTER TYPE billing.audit_subject ADD VALUE IF NOT EXISTS 'billing_email';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. AS TRÊS COLUNAS
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Todas NULL. Linha preexistente — e há assinaturas reais desde a 12B — segue
-- válida com os três campos nulos. `NOT NULL` aqui exigiria backfill inventado
-- de um aceite que nunca aconteceu, que é falsificar prova contratual.

ALTER TABLE billing.subscriptions
  ADD COLUMN IF NOT EXISTS billing_email     text NULL,
  ADD COLUMN IF NOT EXISTS terms_version     text NULL,
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz NULL;

COMMENT ON COLUMN billing.subscriptions.billing_email IS
  'Contato financeiro. OPCIONAL, e alterável a qualquer momento por '
  'public.fn_billing_update_billing_email. Vazio nunca se persiste: a RPC '
  'normaliza para NULL antes de gravar.';

COMMENT ON COLUMN billing.subscriptions.terms_version IS
  'Versão IMUTÁVEL do documento de termos aceito. O conteúdo dos termos não '
  'fica no banco — esta coluna identifica o documento publicado.';

COMMENT ON COLUMN billing.subscriptions.terms_accepted_at IS
  'Instante do aceite. Sempre casado com terms_version: os dois nulos ou os '
  'dois preenchidos, por CHECK.';

-- `ADD CONSTRAINT IF NOT EXISTS` não existe para CHECK. O bloco confere o
-- catálogo e só então acrescenta — a migration continua reaplicável.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'billing' AND t.relname = 'subscriptions'
       AND c.conname = 'subscriptions_termos_par_completo'
  ) THEN
    -- O par. Versão sem instante seria aceite sem data; instante sem versão
    -- seria data sem documento. Nenhum dos dois é prova de coisa alguma.
    ALTER TABLE billing.subscriptions
      ADD CONSTRAINT subscriptions_termos_par_completo
      CHECK ((terms_version IS NULL) = (terms_accepted_at IS NULL));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'billing' AND t.relname = 'subscriptions'
       AND c.conname = 'subscriptions_termos_versao_valida'
  ) THEN
    -- Vazia, só espaços, ou fora do formato de data: recusadas pelo BANCO.
    -- O formato `AAAA-MM-DD` não é enfeite: é o que torna a comparação lexical
    -- de `fn_billing_accept_terms` equivalente à cronológica, e é assim que a
    -- proibição de regredir de versão funciona sem tabela de versões.
    ALTER TABLE billing.subscriptions
      ADD CONSTRAINT subscriptions_termos_versao_valida
      CHECK (
        terms_version IS NULL
        OR (terms_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND length(terms_version) = 10)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'billing' AND t.relname = 'subscriptions'
       AND c.conname = 'subscriptions_billing_email_valido'
  ) THEN
    -- Limite de tamanho: 254 é o máximo de um endereço em `MAIL FROM`/`RCPT TO`
    -- pela RFC 5321. Acima disso não é e-mail, é carga.
    --
    -- A forma exigida é mínima de propósito — sem espaço, um `@`, e um ponto no
    -- domínio. Validação de e-mail mais esperta do que isso reprova endereço
    -- legítimo, e o que interessa aqui é impedir lixo e vazio, não bancar
    -- autoridade sobre a RFC 5322.
    ALTER TABLE billing.subscriptions
      ADD CONSTRAINT subscriptions_billing_email_valido
      CHECK (
        billing_email IS NULL
        OR (
          length(billing_email) <= 254
          AND billing_email = btrim(billing_email)
          AND billing_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        )
      );
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. AUXILIARES INTERNOS
-- ─────────────────────────────────────────────────────────────────────────────

-- MÁSCARA. Primeira letra, três asteriscos, domínio. Nunca o endereço.
CREATE OR REPLACE FUNCTION billing.fn_mask_email(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  SELECT CASE
    WHEN p_email IS NULL OR btrim(p_email) = '' THEN NULL
    ELSE left(split_part(p_email, '@', 1), 1) || '***@' || split_part(p_email, '@', 2)
  END;
$fn$;

COMMENT ON FUNCTION billing.fn_mask_email(text) IS
  'Máscara para a trilha de auditoria. audit_events é append-only: gravar o '
  'endereço inteiro criaria histórico imutável de dado pessoal.';

-- NORMALIZAÇÃO DETERMINÍSTICA DO E-MAIL.
--
-- Vazio e só-espaços viram NULL — uma decisão, não uma omissão: "apagar o
-- contato" e "não informar contato" são a mesma intenção, e recusar string
-- vazia obrigaria o cliente a saber mandar `null` para limpar o campo.
-- Qualquer outro valor é devolvido SEM espaços nas pontas, e daí em diante o
-- CHECK da tabela decide se é aceitável.
CREATE OR REPLACE FUNCTION billing.fn_normalize_email(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  SELECT CASE WHEN btrim(coalesce(p_email, '')) = '' THEN NULL ELSE btrim(p_email) END;
$fn$;

-- VALIDAÇÃO DO E-MAIL, ANTES de a linha chegar ao CHECK.
--
-- ── POR QUE NÃO DEIXAR O CHECK RECUSAR ──────────────────────────────────────
--
-- O CHECK recusa, e recusar é o que importa — mas a mensagem que ele produz
-- traz `DETAIL: Failing row contains (...)`, com a LINHA INTEIRA, endereço
-- incluído. Essa mensagem vai para o log do PostgreSQL e para o log do
-- servidor de aplicação, e o requisito desta etapa é que o endereço NÃO seja
-- reproduzido em log nem em mensagem de erro.
--
-- Validar aqui produz uma recusa limpa, com o mesmo efeito e sem o endereço.
-- O CHECK permanece: ele é a última linha de defesa contra uma RPC futura que
-- erre, e `scripts/ci/assert-billing-orchestration.sql` o exercita por UPDATE
-- direto justamente por isso.
CREATE OR REPLACE FUNCTION billing.fn_require_email(p_email text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $fn$
DECLARE
  v_email text;
BEGIN
  v_email := billing.fn_normalize_email(p_email);
  IF v_email IS NULL THEN
    RETURN NULL;
  END IF;
  IF length(v_email) > 254
     OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    -- SEM o endereço. Nem por %, nem em DETAIL.
    RAISE EXCEPTION 'billing: contato financeiro invalido'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN v_email;
END
$fn$;

-- VALIDAÇÃO DA VERSÃO DOS TERMOS, com a MESMA recusa em todo caminho.
CREATE OR REPLACE FUNCTION billing.fn_require_terms_version(p_versao text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $fn$
BEGIN
  IF p_versao IS NULL OR btrim(p_versao) = '' THEN
    RAISE EXCEPTION 'billing: aceite dos termos e obrigatorio'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF btrim(p_versao) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'billing: versao de termos invalida'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN btrim(p_versao);
END
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. SERIALIZAÇÃO — as três colunas passam a sair na leitura
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Sem isto, `fn_billing_read_state` e todo retorno de RPC continuariam calados
-- sobre o aceite, e a interface da 12C.3 não teria como saber se ele existe.

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
           s.billing_email,
           s.terms_version,
           s.terms_accepted_at,
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. TROCA DE ASSINATURA DE `fn_billing_start_trial`
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `CREATE OR REPLACE FUNCTION` NÃO altera a lista de argumentos de entrada: ele
-- criaria uma SEGUNDA função, sobrecarregada. Duas versões alcançáveis pelo
-- PostgREST seriam o pior desfecho possível — ele escolhe entre sobrecargas
-- pelas CHAVES do corpo JSON, então um cliente que omitisse `p_terms_version`
-- cairia silenciosamente na versão antiga, sem aceite, sem auditoria de termos,
-- e passaria em todo teste que só olhasse a versão nova.
--
-- Por isso a antiga é removida NOMINALMENTE, pela assinatura exata. Sem
-- `CASCADE`: se algo depender dela, é para falhar aqui e ser revisado.

DROP FUNCTION IF EXISTS public.fn_billing_start_trial(
  uuid, uuid, text, text, text, integer, text,
  timestamptz, timestamptz, timestamptz, integer, text, text
);

-- `OR REPLACE` na NOVA, e `DROP` na ANTIGA: são coisas diferentes. O DROP é o
-- que elimina a sobrecarga; o OR REPLACE é o que deixa esta migration
-- reaplicável depois de um rollback, sem o qual o CI de reconstrução
-- quebraria na segunda passagem. A pós-condição 9.4 exige UMA versão, então
-- afrouxar o DROP não passa por aqui só porque o CREATE virou idempotente.
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
  p_correlation_id text,
  p_billing_email text,
  p_terms_version text,
  p_terms_accepted_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_id      uuid;
  v_versao  text;
  v_email   text;
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

  -- ACEITE OBRIGATÓRIO, e conferido ANTES de qualquer escrita. Trial novo sem
  -- termos não existe — nem por omissão do cliente, nem por versão vazia.
  v_versao := billing.fn_require_terms_version(p_terms_version);
  IF p_terms_accepted_at IS NULL THEN
    RAISE EXCEPTION 'billing: instante do aceite e obrigatorio'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_email := billing.fn_require_email(p_billing_email);

  INSERT INTO billing.subscriptions (
    organization_id, plan, tier, period, state, worker_count, cnpj,
    current_period_start, current_period_end, trial_ends_at,
    billing_email, terms_version, terms_accepted_at
  ) VALUES (
    p_organization_id, p_plan::billing.plan_slug, p_tier::billing.tier_slug,
    p_period::billing.billing_period, 'trialing', p_worker_count, p_cnpj,
    p_period_start, p_period_end, p_trial_ends_at,
    v_email, v_versao, p_terms_accepted_at
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

  -- O ACEITE É UM EVENTO PRÓPRIO, na MESMA transação do INSERT.
  --
  -- Separado do `subscription_state` de propósito: "a assinatura entrou em
  -- trial" e "esta pessoa aceitou a versão X dos termos neste instante" são
  -- fatos distintos, e quem audita contrato procura o segundo. Se este PERFORM
  -- levantar, o INSERT acima não sobrevive — não existe trial sem prova de
  -- aceite gravada.
  PERFORM billing.fn_audit(
    p_organization_id, v_id, 'terms_acceptance', p_actor_id, 'owner',
    p_terms_accepted_at, NULL,
    jsonb_build_object('termsVersion', v_versao, 'acceptedAt', p_terms_accepted_at),
    'aceite dos termos no inicio do trial', NULL, p_correlation_id
  );

  IF v_email IS NOT NULL THEN
    PERFORM billing.fn_audit(
      p_organization_id, v_id, 'billing_email', p_actor_id, 'owner',
      p_period_start, NULL,
      jsonb_build_object('mask', billing.fn_mask_email(v_email)),
      'contato financeiro informado no inicio do trial', NULL, p_correlation_id
    );
  END IF;

  RETURN billing.fn_subscription_json(p_organization_id);
END
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RPC NOVA — CONTATO FINANCEIRO
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Estreita por decisão: recebe o e-mail e nada mais. Não aceita plano, não
-- aceita estado, não aceita contagem. Uma RPC que pudesse mudar duas coisas
-- seria uma RPC que se pode enganar a mudar a segunda.

CREATE OR REPLACE FUNCTION public.fn_billing_update_billing_email(
  p_actor_id uuid,
  p_organization_id uuid,
  p_billing_email text,
  p_now timestamptz,
  p_correlation_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_id     uuid;
  v_antes  text;
  v_novo   text;
BEGIN
  -- SOMENTE OWNER. E a organização é revalidada no banco, contra
  -- `public.organization_members`, dentro desta transação: o que a camada
  -- TypeScript resolveu não é confiado aqui.
  PERFORM billing.fn_require_member(p_actor_id, p_organization_id, true);

  IF p_now IS NULL THEN
    RAISE EXCEPTION 'billing: instante do pedido e obrigatorio'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_novo := billing.fn_require_email(p_billing_email);

  SELECT s.id, s.billing_email INTO v_id, v_antes
    FROM billing.subscriptions s
   WHERE s.organization_id = p_organization_id
   FOR UPDATE;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'billing: nenhuma assinatura para esta organizacao'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Repetir o mesmo valor não gera evento: a trilha registra MUDANÇA, e um
  -- carimbo por requisição repetida encheria a auditoria de nada.
  IF v_antes IS NOT DISTINCT FROM v_novo THEN
    RETURN billing.fn_subscription_json(p_organization_id);
  END IF;

  UPDATE billing.subscriptions
     SET billing_email = v_novo,
         updated_at    = p_now
   WHERE id = v_id;

  -- MÁSCARA nos dois lados. O endereço não entra na trilha, e a mensagem de
  -- erro deste caminho nunca o cita — nem quando o CHECK da tabela recusa,
  -- porque quem levanta ali é o banco, com o nome da constraint.
  PERFORM billing.fn_audit(
    p_organization_id, v_id, 'billing_email', p_actor_id, 'owner',
    p_now,
    jsonb_build_object('mask', billing.fn_mask_email(v_antes)),
    jsonb_build_object('mask', billing.fn_mask_email(v_novo)),
    'contato financeiro alterado', NULL, p_correlation_id
  );

  RETURN billing.fn_subscription_json(p_organization_id);
END
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RPC NOVA — ACEITE DE TERMOS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_billing_accept_terms(
  p_actor_id uuid,
  p_organization_id uuid,
  p_terms_version text,
  p_accepted_at timestamptz,
  p_correlation_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_id     uuid;
  v_antes  text;
  v_quando timestamptz;
  v_versao text;
BEGIN
  PERFORM billing.fn_require_member(p_actor_id, p_organization_id, true);

  v_versao := billing.fn_require_terms_version(p_terms_version);
  IF p_accepted_at IS NULL THEN
    RAISE EXCEPTION 'billing: instante do aceite e obrigatorio'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT s.id, s.terms_version, s.terms_accepted_at
    INTO v_id, v_antes, v_quando
    FROM billing.subscriptions s
   WHERE s.organization_id = p_organization_id
   FOR UPDATE;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'billing: nenhuma assinatura para esta organizacao'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- REPETIÇÃO IDEMPOTENTE. Reenviar o aceite da versão já vigente devolve o
  -- estado e NÃO grava evento novo: o instante do aceite original é a prova, e
  -- sobrescrevê-lo por um reenvio apagaria a data que interessa.
  IF v_antes IS NOT DISTINCT FROM v_versao THEN
    RETURN billing.fn_subscription_json(p_organization_id);
  END IF;

  -- REGRESSÃO PROIBIDA, no banco. O formato `AAAA-MM-DD` faz a comparação
  -- lexical coincidir com a cronológica, então isto recusa "aceitar de novo a
  -- versão antiga" sem precisar de tabela de versões publicadas.
  IF v_antes IS NOT NULL AND v_versao < v_antes THEN
    RAISE EXCEPTION 'billing: versao de termos anterior a ja aceita'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE billing.subscriptions
     SET terms_version     = v_versao,
         terms_accepted_at = p_accepted_at,
         updated_at        = p_accepted_at
   WHERE id = v_id;

  PERFORM billing.fn_audit(
    p_organization_id, v_id, 'terms_acceptance', p_actor_id, 'owner',
    p_accepted_at,
    CASE WHEN v_antes IS NULL THEN NULL
         ELSE jsonb_build_object('termsVersion', v_antes, 'acceptedAt', v_quando) END,
    jsonb_build_object('termsVersion', v_versao, 'acceptedAt', p_accepted_at),
    'aceite de nova versao dos termos', NULL, p_correlation_id
  );

  RETURN billing.fn_subscription_json(p_organization_id);
END
$fn$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 8. PRIVILÉGIOS
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Mesmo regime da 12B, aplicado ao conjunto que agora é DEZOITO. Auxiliares de
-- `billing` não são chamáveis de fora; as RPCs de `public` só pelo
-- `service_role`.

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

-- O default do PostgreSQL para funções é EXECUTE para PUBLIC. Sem o REVOKE
-- abaixo, `anon` e `authenticated` chamariam as RPCs novas pelo PostgREST — e,
-- como são SECURITY DEFINER, rodariam como owner.
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

  IF v_int <> 18 THEN
    RAISE EXCEPTION 'esperadas 18 RPCs de billing em public, encontradas %', v_int;
  END IF;
END
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 9. PÓS-CONDIÇÕES
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Um bloco por asserção, com tag nomeada: o CLI do Supabase reporta só o número
-- do statement, e um bloco gigante deixa a falha indiagnosticável.

-- 9.1 As três colunas, com os tipos certos e todas anuláveis.
DO $pc_colunas$
DECLARE
  v_txt text;
  v_int integer;
BEGIN
  SELECT count(*) INTO v_int
    FROM information_schema.columns
   WHERE table_schema = 'billing' AND table_name = 'subscriptions'
     AND column_name IN ('billing_email', 'terms_version', 'terms_accepted_at');
  IF v_int <> 3 THEN
    RAISE EXCEPTION '12C.1: esperadas 3 colunas novas, encontradas %', v_int;
  END IF;

  SELECT string_agg(format('%s é %s/%s', column_name, data_type, is_nullable), ', ')
    INTO v_txt
    FROM information_schema.columns
   WHERE table_schema = 'billing' AND table_name = 'subscriptions'
     AND ((column_name = 'billing_email'     AND (data_type <> 'text' OR is_nullable <> 'YES'))
       OR (column_name = 'terms_version'     AND (data_type <> 'text' OR is_nullable <> 'YES'))
       OR (column_name = 'terms_accepted_at' AND (data_type <> 'timestamp with time zone' OR is_nullable <> 'YES')));
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION '12C.1: coluna com tipo ou nulidade errada: %', v_txt;
  END IF;
END
$pc_colunas$;

-- 9.2 As três constraints existem.
DO $pc_constraints$
DECLARE
  v_txt text;
BEGIN
  SELECT string_agg(e, ', ') INTO v_txt
    FROM unnest(ARRAY[
      'subscriptions_termos_par_completo',
      'subscriptions_termos_versao_valida',
      'subscriptions_billing_email_valido'
    ]) AS e
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'billing' AND t.relname = 'subscriptions'
        AND c.conname = e AND c.contype = 'c'
   );
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION '12C.1: CHECK ausente: %', v_txt;
  END IF;
END
$pc_constraints$;

-- 9.3 Os dois rótulos de auditoria estão no enum.
--
-- Conferidos por `pg_enum`, sem CONVERTER: valor de enum acrescentado nesta
-- transação não pode ser usado nela.
DO $pc_enum$
DECLARE
  v_txt text;
BEGIN
  SELECT string_agg(e, ', ') INTO v_txt
    FROM unnest(ARRAY['terms_acceptance', 'billing_email']) AS e
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_enum en
       JOIN pg_type t ON t.oid = en.enumtypid
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'billing' AND t.typname = 'audit_subject'
        AND en.enumlabel = e
   );
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION '12C.1: rotulo de auditoria ausente: %', v_txt;
  END IF;
END
$pc_enum$;

-- 9.4 A assinatura antiga de `fn_billing_start_trial` SUMIU, e a nova existe.
--
-- É a pós-condição mais importante desta migration. Sobrecarga sobrevivente
-- significaria um caminho alcançável pelo PostgREST que grava trial sem aceite.
DO $pc_assinatura$
DECLARE
  v_int integer;
BEGIN
  SELECT count(*) INTO v_int
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_billing_start_trial';
  IF v_int <> 1 THEN
    RAISE EXCEPTION
      '12C.1: fn_billing_start_trial tem % versoes em public, deveria ter 1', v_int;
  END IF;

  IF to_regprocedure(
       'public.fn_billing_start_trial(uuid, uuid, text, text, text, integer, text, '
       'timestamp with time zone, timestamp with time zone, timestamp with time zone, '
       'integer, text, text)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION '12C.1: a assinatura ANTIGA de fn_billing_start_trial sobreviveu';
  END IF;

  IF to_regprocedure(
       'public.fn_billing_start_trial(uuid, uuid, text, text, text, integer, text, '
       'timestamp with time zone, timestamp with time zone, timestamp with time zone, '
       'integer, text, text, text, text, timestamp with time zone)'
     ) IS NULL THEN
    RAISE EXCEPTION '12C.1: a assinatura NOVA de fn_billing_start_trial nao existe';
  END IF;
END
$pc_assinatura$;

-- 9.5 As duas RPCs novas existem, com a assinatura exata.
DO $pc_novas$
DECLARE
  v_txt text;
BEGIN
  SELECT string_agg(e, ', ') INTO v_txt
    FROM unnest(ARRAY[
      'public.fn_billing_update_billing_email(uuid, uuid, text, timestamp with time zone, text)',
      'public.fn_billing_accept_terms(uuid, uuid, text, timestamp with time zone, text)'
    ]) AS e
   WHERE to_regprocedure(e) IS NULL;
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION '12C.1: RPC nova ausente ou com assinatura diferente: %', v_txt;
  END IF;
END
$pc_novas$;

-- 9.6 Dezoito RPCs, todas SECURITY DEFINER, search_path vazio, mesmo owner.
DO $pc_seguranca$
DECLARE
  v_txt   text;
  v_int   integer;
  v_owner oid;
BEGIN
  SELECT count(*) INTO v_int
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%';
  IF v_int <> 18 THEN
    RAISE EXCEPTION '12C.1: esperadas 18 RPCs em public, encontradas %', v_int;
  END IF;

  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%'
     AND (NOT p.prosecdef
          OR NOT EXISTS (
               SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS cfg
                -- As DUAS formas: o catálogo grava `search_path=` em algumas versões e
                -- `search_path=""` em outras. Aceitar só uma reprovaria instalação correta.
                WHERE cfg IN ('search_path=', 'search_path=""')
             ));
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION
      '12C.1: RPC sem SECURITY DEFINER ou sem search_path vazio: %', v_txt;
  END IF;

  -- MESMA fonte de owner que a 12B usa: o dono da tabela, não o do schema. Os
  -- dois coincidem hoje, e comparar contra outra fonte reprovaria por diferença
  -- que não é defeito.
  SELECT c.relowner INTO v_owner FROM pg_class c WHERE c.oid = 'billing.subscriptions'::regclass;
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%'
     AND p.proowner <> v_owner;
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION '12C.1: RPC com owner diferente do schema billing: %', v_txt;
  END IF;
END
$pc_seguranca$;

-- 9.7 EXECUTE somente para `service_role`.
DO $pc_acl$
DECLARE
  v_txt text;
  v_int integer;
BEGIN
  SELECT string_agg(format('%s para %s', p.oid::regprocedure::text, papel), ', ')
    INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS papel
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%'
     AND has_function_privilege(papel, p.oid, 'EXECUTE');
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION '12C.1: EXECUTE indevido: %', v_txt;
  END IF;

  -- PUBLIC concede a todo mundo, inclusive a papel criado depois. Conferido
  -- diretamente no ACL, porque `has_function_privilege` de um papel específico
  -- não distingue "concedido a ele" de "concedido a PUBLIC".
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%'
     AND EXISTS (
       SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
     );
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION '12C.1: EXECUTE concedido a PUBLIC: %', v_txt;
  END IF;

  SELECT count(*) INTO v_int
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_billing\_%'
     AND has_function_privilege('service_role', p.oid, 'EXECUTE');
  IF v_int <> 18 THEN
    RAISE EXCEPTION
      '12C.1: service_role alcanca % RPC(s), esperadas 18', v_int;
  END IF;
END
$pc_acl$;

-- 9.8 Os auxiliares novos continuam FORA do alcance de qualquer papel.
DO $pc_internos$
DECLARE
  v_txt text;
BEGIN
  SELECT string_agg(format('%s para %s', p.oid::regprocedure::text, papel), ', ')
    INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN unnest(ARRAY['anon', 'authenticated', 'service_role']) AS papel
   WHERE n.nspname = 'billing'
     AND has_function_privilege(papel, p.oid, 'EXECUTE');
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION '12C.1: auxiliar de billing alcancavel: %', v_txt;
  END IF;
END
$pc_internos$;

-- 9.9 O schema `billing` continua fechado, e nada novo apareceu em `public`.
DO $pc_fechado$
DECLARE
  v_txt text;
BEGIN
  IF has_schema_privilege('service_role', 'billing', 'USAGE')
     OR has_schema_privilege('anon', 'billing', 'USAGE')
     OR has_schema_privilege('authenticated', 'billing', 'USAGE') THEN
    RAISE EXCEPTION '12C.1: papel do PostgREST recuperou USAGE em billing';
  END IF;

  -- NENHUM objeto de billing em `public`. A exceção nominal vale só para
  -- FUNÇÃO, e continua valendo.
  --
  -- ── POR QUE LISTA FECHADA, E NÃO `LIKE '%billing%'` ──────────────────────
  --
  -- A primeira versão desta asserção varria por substring e reprovava a
  -- instalação CORRETA: `public.billing_events` é uma das cinco tabelas
  -- LEGADAS que a 12C.0 preservou de propósito, e os índices dela também casam.
  -- O prefixo das tabelas velhas e o nome do schema novo coincidem — varredura
  -- por substring não distingue os dois, e nunca teve como distinguir.
  --
  -- A pergunta certa é nominal: nenhum objeto DESTAS migrations pode ter
  -- nascido em `public`.
  SELECT string_agg(format('%s.%s', n.nspname, c.relname), ', ') INTO v_txt
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN (
       -- 12A
       'tiers', 'price_catalog', 'subscriptions', 'price_snapshots',
       'grandfathering_cutoff', 'grandfathered_organizations', 'courtesies',
       'audit_events', 'legacy_plan_state',
       -- 12B
       'customers', 'charges', 'idempotency_records', 'courtesy_revocations',
       'provider_events',
       -- 12C.1: se alguém trocar as colunas por uma tabela própria, ela cai aqui
       'terms_acceptances', 'billing_contacts'
     );
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION '12C.1: relacao de billing em public: %', v_txt;
  END IF;

  SELECT string_agg(t.typname, ', ') INTO v_txt
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE n.nspname = 'public'
     AND t.typname IN (
       'plan_slug', 'tier_slug', 'billing_period', 'subscription_state',
       'audit_subject', 'charge_status', 'charge_method',
       'idempotency_scope', 'idempotency_state'
     );
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION '12C.1: tipo de billing em public: %', v_txt;
  END IF;
END
$pc_fechado$;

-- 9.10 O aceite é EXIGIDO pelo corpo instalado, não só pelo arquivo.
--
-- Uma pós-condição textual sobre `pg_get_functiondef` parece frouxa, mas é a
-- única que pega o caso em que alguém reescreve a RPC num hotfix e deixa o
-- arquivo intacto. Ela confere o que o BANCO tem, não o que o repositório diz.
DO $pc_corpo$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_billing_start_trial';

  IF v_def !~ 'fn_require_terms_version' THEN
    RAISE EXCEPTION
      '12C.1: fn_billing_start_trial instalada nao exige versao de termos';
  END IF;
  IF v_def !~ 'terms_acceptance' THEN
    RAISE EXCEPTION
      '12C.1: fn_billing_start_trial instalada nao audita o aceite';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_billing_update_billing_email';

  IF v_def !~ 'fn_require_member\([^)]*true' THEN
    RAISE EXCEPTION
      '12C.1: fn_billing_update_billing_email instalada nao exige owner';
  END IF;
  IF v_def !~ 'fn_mask_email' THEN
    RAISE EXCEPTION
      '12C.1: fn_billing_update_billing_email instalada audita sem mascara';
  END IF;
END
$pc_corpo$;
