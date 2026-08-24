/**
 * PEÇAS COMUNS DOS CASOS DE USO
 *
 * ── O QUE SUMIU DAQUI, E POR QUÊ ────────────────────────────────────────────
 *
 * A versão anterior tinha `auditar()`: os casos de uso gravavam a trilha numa
 * chamada SEPARADA, depois do efeito. Eram duas requisições HTTP, logo duas
 * transações — e "a cobrança foi criada mas a auditoria falhou" era um estado
 * alcançável.
 *
 * Agora a auditoria acontece DENTRO da mesma RPC do efeito, na mesma
 * transação. Não há mais o que orquestrar aqui, e por isso a função deixou de
 * existir em vez de virar um invólucro.
 *
 * ── O QUE PERMANECE ─────────────────────────────────────────────────────────
 *
 * A autorização de fronteira: comparar o que o cliente pediu com o que o
 * servidor resolveu, ANTES de tocar repositório ou provider. O banco revalida
 * depois — as duas checagens são deliberadas, e nenhuma substitui a outra.
 */

import { digest } from "../core/digest";
import { fail, ok, type Result } from "../core/errors";
import type { BillingAuthContext, BillingDeps } from "../core/ports";
import type { BillingProviderPort } from "../core/provider";
import type {
  BillingRepository,
  ComandoContexto,
  StoredSubscription,
} from "../core/repository";

/** Tudo o que um caso de uso recebe. Nada é buscado de variável global. */
export interface UseCaseEnv extends BillingDeps {
  readonly repo: BillingRepository;
  readonly provider: BillingProviderPort;
  readonly auth: BillingAuthContext;
  /** Conta do provider. Entra na identidade global do recurso externo. */
  readonly providerAccountId: string;
  /** Liga todos os eventos de uma mesma operação. */
  readonly correlationId: string;
}

/** Campos que todo comando aceita do cliente. */
export interface ComandoBase {
  /**
   * A organização que o CLIENTE afirma. Nunca autoriza — só é comparada com a
   * que o servidor resolveu.
   */
  readonly requestedOrganizationId?: string;
}

/**
 * AS DUAS AUTORIZAÇÕES, NOMINALMENTE SEPARADAS
 *
 * ── POR QUE DUAS FUNÇÕES, E NÃO UM PARÂMETRO ────────────────────────────────
 *
 * A versão anterior tinha UMA função, `assertTenant`, que exigia `owner`
 * sempre. Isso fechava a porta para o membro comum consultar a decisão de
 * acesso — e a decisão de acesso é justamente o que o enforcement de
 * entitlements precisa consultar para TODO usuário, não só para quem paga.
 *
 * A correção poderia ter sido um booleano (`assertTenant(auth, org, exigirDono)`).
 * Duas funções com nomes distintos são melhores por um motivo prático: no
 * ponto de chamada dá para LER qual regra vale, e uma guarda consegue exigir
 * nominalmente que todo comando de escrita chame `assertTenantOwner`. Com um
 * booleano, trocar `true` por `false` é um caractere — e um caractere não
 * aparece numa revisão da mesma forma que um nome.
 *
 * ── O QUE AS DUAS COMPARTILHAM ──────────────────────────────────────────────
 *
 * A comparação de tenant e a recusa indistinguível. Em ambas, organização
 * inexistente e organização alheia produzem a MESMA recusa com a MESMA
 * mensagem: distingui-las entregaria "esta organização existe" a quem varre
 * identificadores. O banco faz igual em `billing.fn_require_member`, e o teste
 * de contrato compara os dois lados.
 */

/** Recusa comum. Um único texto, para que nada vaze por diferença de mensagem. */
function recusarTenant<T>(): Result<T> {
  return fail("not_owner", "somente o proprietário administra a assinatura");
}

/** Compara o tenant afirmado com o resolvido. Não olha papel. */
function conferirTenant<T>(
  auth: BillingAuthContext,
  requestedOrganizationId: string | undefined
): Result<T> | null {
  if (requestedOrganizationId === undefined) return null;
  if (typeof requestedOrganizationId !== "string" || requestedOrganizationId.trim() === "") {
    return fail("invalid_input", "organização inválida");
  }
  if (requestedOrganizationId !== auth.organizationId) return recusarTenant<T>();
  return null;
}

/**
 * Exige PROPRIETÁRIO do tenant.
 *
 * Toda escrita e toda leitura de dado financeiro restrito (CNPJ, contato
 * financeiro, preço praticado) passa por aqui. `assertTenantMember` NUNCA
 * substitui esta função num comando de escrita, e a guarda da 12C.2 reprova se
 * alguém tentar.
 */
export function assertTenantOwner<T>(
  auth: BillingAuthContext,
  requestedOrganizationId: string | undefined
): Result<T> | null {
  if (auth.role !== "owner") return recusarTenant<T>();
  return conferirTenant<T>(auth, requestedOrganizationId);
}

/**
 * Exige MEMBRO do tenant — qualquer papel, inclusive `owner`.
 *
 * Serve exatamente a duas coisas: o catálogo de preços e a decisão de acesso.
 * Nenhuma das duas devolve dado restrito ao proprietário, e é essa propriedade
 * — não o papel de quem chama — que autoriza a ampliação.
 *
 * O papel continua sendo resolvido no SERVIDOR. Esta função não afrouxa a
 * comparação de tenant: um membro de A continua sem alcançar B.
 */
export function assertTenantMember<T>(
  auth: BillingAuthContext,
  requestedOrganizationId: string | undefined
): Result<T> | null {
  return conferirTenant<T>(auth, requestedOrganizationId);
}

/** Contexto de comando, montado a partir do que o servidor resolveu. */
export function contexto(env: UseCaseEnv): ComandoContexto {
  return {
    actorId: env.auth.userId,
    organizationId: env.auth.organizationId,
    correlationId: env.correlationId,
  };
}

/** Lê a assinatura da organização autorizada, ou falha de forma tipada. */
export async function exigirAssinatura(
  env: UseCaseEnv
): Promise<Result<StoredSubscription>> {
  const estado = await env.repo.readState(env.auth.userId, env.auth.organizationId);
  if (!estado.ok) return estado;
  if (estado.value.subscription === null) {
    return fail("not_found", "nenhuma assinatura para esta organização");
  }
  return ok(estado.value.subscription);
}

/**
 * NORMALIZAÇÃO DO PEDIDO — definida aqui, e em um lugar só
 *
 * ── POR QUE ISTO PRECISA SER NOMINAL ────────────────────────────────────────
 *
 * O fingerprint decide se dois pedidos de cobrança são o MESMO. Sem uma regra
 * escrita, `"  Fulano "` e `"Fulano"` seriam pedidos diferentes e um reenvio
 * trivial viraria conflito falso; e `"F@X.COM"` e `"f@x.com"` também.
 *
 * A política, por extenso:
 *
 *   CNPJ    só os dígitos. Máscara é apresentação, não identidade.
 *   NOME    `trim`. Espaço interno é preservado — "Maria  Silva" e
 *           "Maria Silva" SÃO pedidos diferentes, porque é isso que vai
 *           impresso na cobrança e não cabe ao billing decidir que são iguais.
 *   E-MAIL  `trim` e caixa baixa. O domínio é insensível a caixa por RFC, e a
 *           parte local é sensível na letra da norma mas insensível em todo
 *           provedor real — tratar `F@x.com` como outro pedido produziria
 *           conflito onde o usuário não vê diferença alguma.
 *
 * O valor NORMALIZADO é o que vai ao fingerprint E ao provider. Normalizar só
 * para o fingerprint faria a identidade dizer "mesmo pedido" enquanto o
 * provider recebe bytes diferentes — que é a divergência que isto existe para
 * impedir.
 *
 * Nada disto é persistido: só o SHA-256 entra em `billing.idempotency_records`.
 */

/** Só os dígitos. Máscara é apresentação. */
export function normalizarCnpj(v: string): string {
  return v.replace(/\D/g, "");
}

/** `trim`. Espaço interno é significativo: vai impresso na cobrança. */
export function normalizarNome(v: string): string {
  return v.trim();
}

/** `trim` e caixa baixa. */
export function normalizarEmail(v: string): string {
  return v.trim().toLowerCase();
}

/**
 * Fingerprint canônico do pedido.
 *
 * ── POR QUE ISTO EXISTE ─────────────────────────────────────────────────────
 *
 * A chave de idempotência sozinha diz "é a mesma tentativa". Ela NÃO diz "é o
 * mesmo pedido". Sem fingerprint, mandar a mesma chave com outro valor devolve
 * silenciosamente o resultado do primeiro, e o segundo pedido some.
 *
 * ── POR QUE É UM HASH, E NÃO O PEDIDO ───────────────────────────────────────
 *
 * O fingerprint é gravado no banco. Guardar o pedido inteiro colocaria dado de
 * pagamento numa tabela que não precisa dele. O hash basta para comparar, e não
 * reconstrói nada.
 *
 * A canonicalização ordena as chaves: `{a,b}` e `{b,a}` são o MESMO pedido, e
 * precisam produzir o mesmo fingerprint — senão um reenvio com outra ordem de
 * campos viraria conflito falso.
 *
 * ── POR QUE SHA-256, E NÃO O FNV-1a QUE ESTAVA AQUI ─────────────────────────
 *
 * Trinta e dois bits colidem. Este valor decide se dois pedidos de COBRANÇA são
 * o mesmo; uma colisão aqui recusa um checkout legítimo, ou pior, confunde dois
 * pedidos distintos. `core/digest.ts` explica a troca e a canonicalização
 * injetiva que veio junto.
 */
export function fingerprintDe(campos: Readonly<Record<string, string | number>>): string {
  return digest("fp", campos);
}

/**
 * Chave de idempotência: (operação, organização, INTENÇÃO).
 *
 * ── O QUE MUDOU, E POR QUE IMPORTA ──────────────────────────────────────────
 *
 * A versão anterior derivava a chave de (operação, organização, PERÍODO). O
 * período é invariante dentro do ciclo, então a chave era a mesma para todas as
 * tentativas do período — e o proprietário ficava preso a UMA cobrança por
 * ciclo. Recusado no PIX, não conseguia tentar cartão: mesma chave, fingerprint
 * diferente, `fingerprint_conflict` para sempre.
 *
 * Trocar o período pela INTENÇÃO conserta os dois lados de uma vez:
 *
 *   * o retry técnico repete a mesma intenção, logo a mesma chave, logo replay;
 *   * a nova tentativa comercial pede uma intenção nova, logo uma chave nova,
 *     logo uma cobrança nova — deliberada, e não acidental.
 *
 * E, de brinde, o TOCTOU desaparece: a chave não depende mais de nada lido do
 * banco, então não há janela entre "ler o período" e "reservar a chave".
 */
export function chaveDeIdempotencia(
  operacao: string,
  organizationId: string,
  checkoutIntentId: string
): string {
  return digest("idem", { op: operacao, org: organizationId, intent: checkoutIntentId });
}
