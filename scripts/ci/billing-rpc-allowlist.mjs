/**
 * ALLOWLIST DAS RPCs DE BILLING EM `public`
 *
 * A 12A estabeleceu "nenhum objeto de billing em public". A 12B abre UMA
 * exceção, e ela é nominal: exatamente estas dezesseis funções, com estas
 * assinaturas.
 *
 * ── POR QUE ASSINATURA COMPLETA, E NÃO NOME ─────────────────────────────────
 *
 * O PostgreSQL permite sobrecarga. `fn_billing_read_state(uuid, uuid)` e
 * `fn_billing_read_state(uuid, uuid, text)` são funções DIFERENTES com o mesmo
 * nome, e o PostgREST escolhe entre elas pelos parâmetros que o chamador
 * mandar. Uma allowlist por nome aprovaria a segunda sem que ninguém a tivesse
 * revisado — e ela poderia fazer qualquer coisa.
 *
 * Por isso a chave é `nome(tipos)`, no formato exato de
 * `pg_get_function_identity_arguments`, que é como o catálogo do PostgreSQL
 * descreve a identidade de uma função.
 *
 * ── QUEM CONSOME ESTA LISTA ─────────────────────────────────────────────────
 *
 *   * `scripts/ci/build-expected-schema.mjs` — declara o efeito estrutural
 *     nominal em `public`;
 *   * `scripts/ci/split-public-rpcs.mjs`     — separa estes blocos do dump;
 *   * `tests/billing-orchestration-guard.mjs` — confere a migration e o
 *     repositório TypeScript.
 *
 * `scripts/ci/assert-billing-rpcs.sql` mantém a MESMA lista escrita à mão, de
 * propósito: é o verificador independente, e um verificador que importa a
 * declaração do verificado não verifica nada. Se as duas divergirem, uma
 * asserção reprova — que é exatamente o resultado desejado.
 */

/** Assinaturas exatas, ordenadas. Formato: `nome(tipo, tipo, …)`. */
export const RPCS_DE_BILLING = Object.freeze([
  "fn_billing_apply_provider_event(text, text, text, text, text, timestamp with time zone, text, timestamp with time zone)",
  "fn_billing_cancel_at_period_end(uuid, uuid, text, text, timestamp with time zone)",
  "fn_billing_change_plan(uuid, uuid, text, text, text, text, timestamp with time zone, timestamp with time zone, integer, text, text, text, text, text, timestamp with time zone)",
  "fn_billing_claim_idempotency(uuid, uuid, text, text, text, text, text, timestamp with time zone)",
  "fn_billing_fail_idempotency(uuid, uuid, text, text, text, text, text, timestamp with time zone)",
  "fn_billing_finalize_checkout(uuid, uuid, text, text, text, text, text, integer, timestamp with time zone, timestamp with time zone, text, text, text, timestamp with time zone)",
  "fn_billing_grant_courtesy(uuid, uuid, text, timestamp with time zone, timestamp with time zone, text, text)",
  "fn_billing_read_catalog(uuid, uuid, text)",
  "fn_billing_read_ledger(uuid, uuid)",
  "fn_billing_read_state(uuid, uuid)",
  "fn_billing_record_worker_count(uuid, uuid, integer, text, timestamp with time zone)",
  "fn_billing_revoke_courtesy(uuid, uuid, uuid, timestamp with time zone, text, text)",
  "fn_billing_save_grandfathering(uuid, uuid, timestamp with time zone, timestamp with time zone, text)",
  "fn_billing_schedule_downgrade(uuid, uuid, text, text, text, text, timestamp with time zone)",
  "fn_billing_start_trial(uuid, uuid, text, text, text, integer, text, timestamp with time zone, timestamp with time zone, timestamp with time zone, integer, text, text)",
  "fn_billing_transition_state(uuid, uuid, text, text, text, text, timestamp with time zone)",
]);

/** Só os nomes — para asserções que não dependem dos tipos. */
export const NOMES_DE_RPC = Object.freeze(
  RPCS_DE_BILLING.map((a) => a.slice(0, a.indexOf("(")))
);

/**
 * Cabeçalho de bloco que o `pg_dump` emite para cada função.
 *
 * O formato é o do dump versionado em `supabase/baseline/schema.sql` — não é
 * presumido. Exemplo verificável lá:
 *
 *   -- Name: fn_resolve_tenant_id(); Type: FUNCTION; Schema: public; Owner: -
 *
 * O `Owner: -` é consequência de `--no-owner`, que é como todos os dumps deste
 * repositório são tirados.
 */
export function cabecalhoDeBloco(assinatura) {
  return `-- Name: ${assinatura}; Type: FUNCTION; Schema: public; Owner: -`;
}
