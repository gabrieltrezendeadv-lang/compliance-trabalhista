/**
 * INTENÇÃO DE CHECKOUT — o caso de uso, e por que ele existe
 *
 * ── A CONTRADIÇÃO QUE ISTO RESOLVE ──────────────────────────────────────────
 *
 * A fachada afirma, na etapa 10: "um comando → exatamente um caso de uso, sem
 * exceção". E `prepararIntencaoDeCheckout` chamava `deps.novaIntencao()`
 * diretamente — ou seja, havia uma exceção, e ela estava escrita logo abaixo da
 * frase que dizia não haver nenhuma.
 *
 * Uma regra com uma exceção não documentada é pior do que uma regra mais fraca:
 * a guarda passa a medir doze comandos e a afirmar treze.
 *
 * ── POR QUE UM CASO DE USO PARA ALGO TÃO PEQUENO ────────────────────────────
 *
 * Porque o que ele faz não é pequeno: decide QUEM pode iniciar uma tentativa de
 * cobrança. Essa decisão pertence ao mesmo lugar que todas as outras — o
 * primeiro `assert…` de um caso de uso —, e não à camada que monta ambiente.
 *
 * Com ela aqui, a guarda consegue cobrar uma propriedade uniforme: *todo*
 * comando da fachada delega a autorização de domínio a um caso de uso. Sem ela,
 * a cobrança teria de abrir uma exceção nominal, e exceções nominais em guardas
 * de autorização envelhecem mal.
 *
 * ── ZERO I/O DE BILLING ─────────────────────────────────────────────────────
 *
 * Este caso de uso não recebe `BillingRepository` nem `BillingProviderPort`, e
 * não pode recebê-los: o tipo do ambiente não os tem. Não é disciplina, é
 * impossibilidade — que é a única forma de garantia que não se esquece.
 *
 * O I/O de autenticação e autorização continua existindo, e é anterior a este
 * ponto: a sessão e a membership foram consultadas para produzir o `auth`.
 */

import type { Result } from "../core/errors";
import { ok } from "../core/errors";
import type { BillingAuthContext } from "../core/ports";
import { assertTenantOwner, type ComandoBase } from "./shared";

/** O que o comando devolve. Nada além do identificador. */
export interface PreparedCheckoutIntent {
  readonly checkoutIntentId: string;
}

/**
 * Ambiente MÍNIMO deste caso de uso.
 *
 * Deliberadamente NÃO é `UseCaseEnv`: aceitar o ambiente completo permitiria
 * que alguém, um dia, alcançasse `env.repo` daqui — e a garantia "zero I/O de
 * billing" viraria uma promessa em vez de um tipo.
 */
export interface CheckoutIntentEnv {
  readonly auth: BillingAuthContext;
  /** Fábrica de intenção. Injetada para que o teste conte as cunhagens. */
  readonly novaIntencao: () => string;
}

/**
 * Prepara uma intenção de checkout.
 *
 * PROPRIETÁRIO: preparar-se para cobrar é ato de quem contrata.
 */
export async function prepareCheckoutIntent(
  env: CheckoutIntentEnv,
  input: ComandoBase
): Promise<Result<PreparedCheckoutIntent>> {
  const negado = assertTenantOwner<PreparedCheckoutIntent>(
    env.auth,
    input.requestedOrganizationId
  );
  if (negado) return negado;

  return ok({ checkoutIntentId: env.novaIntencao() });
}
