/**
 * INTENÇÃO DE CHECKOUT — a identidade que faltava, e a política que ela permite
 *
 * ── O DEFEITO QUE ESTE ARQUIVO CORRIGE ──────────────────────────────────────
 *
 * A versão anterior derivava a chave de idempotência de (operação, organização,
 * PERÍODO). Os três são invariantes dentro de um ciclo de cobrança, então a
 * chave era a MESMA para todas as tentativas do período. As consequências,
 * medidas contra o banco real:
 *
 *   * PIX recusado, ou expirado sem pagamento? Tentar cartão devolvia
 *     `fingerprint_conflict`. Para sempre — `fn_billing_claim_idempotency`
 *     compara o fingerprint ANTES de olhar o status, então nem o estado
 *     `failed` liberava a segunda tentativa.
 *   * Cobrança concluída e não paga? Toda nova tentativa era `replay` da mesma
 *     cobrança morta.
 *
 * A organização ficava presa a UMA cobrança por ciclo, sem caminho de saída. E
 * o pior: aquilo estava escrito como se fosse virtude, e havia teste afirmando
 * que o travamento era o comportamento correto.
 *
 * ── O QUE FALTAVA ERA UM CONCEITO, NÃO UM AJUSTE ────────────────────────────
 *
 * A chave respondia "que período é este?". A pergunta certa é "que TENTATIVA
 * COMERCIAL é esta?" — e período não responde isso, porque um mesmo período
 * comporta várias tentativas legítimas.
 *
 * A intenção é essa resposta. Com ela, as duas repetições que antes se
 * confundiam passam a ser distinguíveis:
 *
 *   RETRY TÉCNICO         mesma intenção. O usuário deu refresh, a rede caiu, o
 *                         formulário foi reenviado. Devolve o MESMO resultado —
 *                         nunca uma segunda cobrança.
 *
 *   NOVA TENTATIVA        intenção nova, pedida deliberadamente. O usuário
 *   COMERCIAL             desistiu do PIX e quer cartão; a cobrança expirou e
 *                         ele quer outra. Chave nova, cobrança nova, e isso é
 *                         o certo.
 *
 * A diferença entre as duas é uma DECISÃO DE QUEM CHAMA, e por isso precisa ser
 * explícita no protocolo em vez de inferida de relógio ou de estado.
 *
 * ── PROPRIEDADES DO IDENTIFICADOR ───────────────────────────────────────────
 *
 *   OPACO           `ci_` + 32 hex. Não carrega organização, período, ator nem
 *                   instante: quem o vê não aprende nada sobre o tenant.
 *
 *   128 BITS        de `crypto.getRandomValues`. Não é segredo — não precisa
 *                   ser — mas precisa não colidir, e 128 bits garantem isso com
 *                   folga que 32 bits jamais dariam.
 *
 *   INJETADO        vem de `deps.novaIntencao()`, uma dependência. O teste
 *                   controla a sequência e prova que retry não sorteia nada.
 *
 *   NÃO AUTORIZA    nada. Ator, tenant, papel, preço, período e fingerprint
 *                   continuam resolvidos pelo servidor a cada chamada, e toda
 *                   RPC revalida o membro no banco antes de olhar a chave. Um
 *                   identificador de outra organização é inútil: a reserva é
 *                   `UNIQUE (organization_id, scope, provider, key)`, e a chave
 *                   deriva da organização RESOLVIDA, não da afirmada.
 *
 *   NÃO É A CHAVE   `chaveDeIdempotencia` combina intenção + organização +
 *                   operação, dentro do caso de uso. Nem o cliente nem a
 *                   fachada calculam a chave.
 *
 * ── O FLUXO, E O QUE A 12C.3 VAI PRECISAR HONRAR ────────────────────────────
 *
 *   1. o wrapper chama `prepararIntencaoDeCheckout` e recebe o identificador;
 *   2. guarda-o com o formulário de pagamento;
 *   3. todo reenvio técnico manda o MESMO identificador;
 *   4. mudar de meio de pagamento, ou recomeçar após recusa, exige uma ação
 *      deliberada do usuário que pede uma intenção NOVA;
 *   5. alterar o payload sob a MESMA intenção continua sendo conflito — é
 *      assim que "o valor mudou entre a tela e o envio" é pego.
 *
 * O passo 3 é o único que a fachada não consegue impor sozinha: preservar o
 * identificador entre refresh e timeout é responsabilidade de quem tem estado
 * de tela. O contrato existe para que isso seja uma obrigação NOMEADA da 12C.3,
 * e não uma descoberta tardia.
 *
 * ── POR QUE NÃO HÁ TABELA DE INTENÇÕES ──────────────────────────────────────
 *
 * Cogitei persistir a intenção antes de devolvê-la. Não persiste, e a razão é
 * que a persistência não compraria nada:
 *
 *   * a intenção não autoriza, então não há o que revogar;
 *   * quem pode inventar um identificador já é proprietário do tenant e já pode
 *     pedir quantas intenções quiser — inventar uma é exatamente equivalente a
 *     clicar "tentar de novo", que é uma faculdade que ele TEM;
 *   * o efeito é governado pela reserva em `billing.idempotency_records`, que
 *     JÁ é persistida, atômica e escopada por organização.
 *
 * Uma tabela nova custaria uma migration para tornar auditável algo que a
 * trilha de `charges` e `audit_events` já registra. O formato é validado
 * (`ci_` + 32 hex) para que a entrada continue fechada.
 */

import "server-only";

/** Operações que reservam chave de idempotência. Fechada. */
export type OperacaoIdempotente = "checkout";

/** Prefixo legível para quem lê a tabela; o resto é opaco. */
const PREFIXO = "ci_";

/** 16 bytes = 128 bits. */
const BYTES = 16;

/** A forma exata que a fachada aceita. Nada além disto entra. */
export const FORMATO_DE_INTENCAO = /^ci_[0-9a-f]{32}$/;

/**
 * Cunha uma intenção.
 *
 * `crypto.getRandomValues` é o CSPRNG da plataforma — o mesmo em Node e no
 * runtime da Vercel. `Math.random()` seria inaceitável aqui não por segredo,
 * mas por previsibilidade: dois processos podem sortear a mesma sequência.
 */
export function cunharIntencao(): string {
  const bytes = new Uint8Array(BYTES);
  crypto.getRandomValues(bytes);
  return (
    PREFIXO +
    Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  );
}

/** A intenção tem a forma que o servidor cunha? */
export function intencaoValida(v: unknown): v is string {
  return typeof v === "string" && FORMATO_DE_INTENCAO.test(v);
}
