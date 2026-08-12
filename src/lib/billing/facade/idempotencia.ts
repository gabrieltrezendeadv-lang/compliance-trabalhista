/**
 * POLÍTICA DE IDEMPOTÊNCIA DO CHECKOUT — a chave é DERIVADA, nunca recebida
 *
 * ── A POLÍTICA, ESCRITA ANTES DO CÓDIGO QUE A USA ───────────────────────────
 *
 * 1. A chave é OPACA e não autoriza nada. É um hash; quem a tiver não ganha
 *    acesso a coisa alguma, porque toda RPC revalida ator e organização no
 *    banco antes de olhar para a chave.
 *
 * 2. Ela é derivada de (organização, operação, período vigente). Os três são
 *    resolvidos NO SERVIDOR: a organização vem da sessão, a operação é um
 *    literal, e o período vem da assinatura lida do banco.
 *
 * 3. Retry legítimo reutiliza a MESMA chave. Nada é sorteado, nada depende de
 *    relógio, nada é guardado em memória — duas tentativas com o mesmo estado
 *    produzem a mesma string, inclusive entre processos e entre deploys.
 *
 * 4. Pedido diferente sob a mesma chave é CONFLITO. É aqui que a divisão de
 *    trabalho entre chave e fingerprint importa, e é por isso que ela existe:
 *
 *      a CHAVE cobre organização + operação + período — a INTENÇÃO;
 *      o FINGERPRINT cobre o pedido inteiro, inclusive meio de pagamento e
 *      valor — o CONTEÚDO. Ele é calculado por `createCheckout`, não aqui.
 *
 *    Trocar o meio de pagamento no mesmo período mantém a chave e muda o
 *    fingerprint, e `fn_billing_claim_idempotency` devolve
 *    `fingerprint_conflict`. Se a chave também cobrisse o meio, cada tentativa
 *    viraria uma cobrança nova e o conflito nunca aconteceria — que é o defeito
 *    que a idempotência existe para impedir.
 *
 * 5. O cliente não escolhe ator, tenant nem fingerprint. Também não escolhe a
 *    chave: `CriarCheckoutSchema` é `.strict()` e não declara `idempotencyKey`,
 *    então mandá-la é ERRO, não campo ignorado.
 *
 * 6. Nenhuma ausência silenciosa gera chave nova. Não há ramo "se não veio,
 *    invente": a chave é sempre calculada dos mesmos três dados, e se um deles
 *    faltar a operação PARA antes — sem assinatura não há checkout.
 *
 * ── A CORRIDA QUE SOBRA, E POR QUE ELA FALHA FECHADA ────────────────────────
 *
 * Entre a leitura do período aqui e a leitura que `createCheckout` faz por
 * conta própria, o período pode mudar — renovação, troca de plano. Nesse caso a
 * chave é a do período antigo e o fingerprint é o do novo, e o resultado é
 * `fingerprint_conflict`: uma recusa, e não uma cobrança errada. É a direção
 * certa para a corrida terminar.
 */

import "server-only";

import { fingerprintDe } from "../usecases/shared";

/** Operações que reservam chave. Fechada: uma nova exige tocar aqui. */
export type OperacaoIdempotente = "checkout";

/**
 * Deriva a chave de idempotência.
 *
 * Reusa `fingerprintDe` de propósito: é a MESMA canonicalização e o MESMO
 * FNV-1a que o domínio já usa para o fingerprint. Duas implementações de hash
 * no mesmo fluxo divergiriam algum dia, e ninguém perceberia até uma chave
 * deixar de bater com ela mesma.
 */
export function derivarChave(
  operacao: OperacaoIdempotente,
  organizationId: string,
  periodStart: string,
  periodEnd: string
): string {
  const fp = fingerprintDe({
    op: operacao,
    org: organizationId,
    inicio: periodStart,
    fim: periodEnd,
  });
  // Prefixo legível para quem lê a tabela; o resto é opaco.
  return `idem_${operacao}_${fp}`;
}
