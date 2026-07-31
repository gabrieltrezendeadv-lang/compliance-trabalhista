/**
 * BILLING GUARD — verificação de entitlement, FAIL-CLOSED
 *
 * ── O QUE ESTE ARQUIVO SUBSTITUI ────────────────────────────────────────────
 *
 * A versão anterior terminava assim:
 *
 *     if (error) {
 *       // If RPC fails (e.g., no subscription table), allow operation
 *       return { allowed: true, reason: "ok" }
 *     }
 *
 * Isso é fail-open. E não era risco teórico: `check_plan_limit` está com
 * `EXECUTE` revogado de TODOS os papéis, inclusive `service_role`
 * (`20260728191311_..._sec_002_retire_plan_limit.sql`). A chamada falhava
 * SEMPRE, aquele ramo era o único alcançável, e o guard aprovava tudo. Um
 * controle que aprova sempre é pior que controle nenhum: ele parece proteger.
 *
 * A regra nova, sem exceção:
 *
 *   * erro ao verificar entitlement NUNCA produz `allowed: true`;
 *   * com billing ATIVO, falha de verificação NEGA a operação;
 *   * com billing DESATIVADO, a permissão sai por um desvio EXPLÍCITO e
 *     IDENTIFICÁVEL da feature flag — `reason: "billing_disabled"` e
 *     `bypass: true` —, jamais por captura genérica de erro.
 *
 * A diferença entre os dois últimos itens é o ponto inteiro. Com `catch →
 * allow`, "não havia assinatura" e "não consegui verificar" produzem o mesmo
 * resultado e ficam indistinguíveis no log. Aqui são estados diferentes, com
 * nomes diferentes, e só um deles permite.
 *
 * Nenhuma função deste arquivo chama `check_plan_limit`. SEC-002 permanece
 * intacta e nenhum `GRANT` é reconcedido.
 *
 * ── LIMITE DECLARADO DESTA ETAPA ────────────────────────────────────────────
 *
 * A fonte de dados de assinatura vive no schema `billing`, que NÃO é exposto ao
 * PostgREST — de propósito (ver docs/decisions/PLANOS-E-PRECIFICACAO.md §8.1).
 * A fachada que a tornará legível pelo servidor é da Etapa 12B.
 *
 * Consequência, declarada e deliberada: **com a feature flag ligada hoje, toda
 * verificação NEGA**, porque não há como verificar. É o comportamento correto
 * de um guard fail-closed, e é a razão de a flag nascer desligada. Ligá-la
 * antes da 12B não libera nada indevidamente — bloqueia tudo.
 */

import { createClient } from "@/lib/supabase/server";
import { isBillingEnabled } from "./flag";
import { canWrite, planIncludes } from "./plans/entitlements";
import type {
  EntitlementDecision,
  EntitlementDenialReason,
  FeatureKey,
  PlanSlug,
  SubscriptionState,
} from "./plans/model";

const MENSAGENS: Record<EntitlementDenialReason, string> = {
  billing_disabled: "",
  feature_not_in_plan:
    "Este recurso não está incluído no seu plano. Faça upgrade para o Completo.",
  read_only:
    "Sua conta está em modo somente leitura. Os dados continuam disponíveis para consulta.",
  no_subscription: "Nenhuma assinatura ativa encontrada para esta organização.",
  verification_failed:
    "Não foi possível verificar seu plano no momento. Tente novamente.",
  not_authenticated: "Sessão expirada. Faça login novamente.",
  no_organization: "Organização não encontrada.",
  not_owner: "Somente o proprietário pode administrar a assinatura.",
};

function negar(reason: EntitlementDenialReason): EntitlementDecision {
  return { allowed: false, reason, message: MENSAGENS[reason] };
}

/**
 * O ÚNICO caminho que permite sem verificar.
 *
 * Isolado numa função própria, com nome próprio e marca própria (`bypass`),
 * para que seja localizável por busca e por teste. Um `return { allowed: true }`
 * espalhado pelo arquivo seria indistinguível de um fail-open.
 */
function desvioDaFeatureFlag(): EntitlementDecision {
  return { allowed: true, reason: "billing_disabled", bypass: true };
}

// ─── Contexto ──────────────────────────────────────────────────────────────

interface BillingContext {
  readonly organizationId: string;
  readonly plan: PlanSlug;
  readonly state: SubscriptionState;
}

type ContextResult =
  | { readonly ok: true; readonly context: BillingContext }
  | { readonly ok: false; readonly reason: EntitlementDenialReason };

/**
 * Carrega o contexto de billing da organização do chamador.
 *
 * A resolução de organização É feita — ela já vale hoje, e é onde a ordenação
 * determinística do TG-12 precisa estar. A leitura da assinatura ainda não
 * existe (ver o limite declarado no cabeçalho); a Etapa 12B substitui apenas o
 * trecho final.
 */
async function loadBillingContext(): Promise<ContextResult> {
  const supabase = await createClient();

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError) return { ok: false, reason: "verification_failed" };

  const user = auth?.user;
  if (!user) return { ok: false, reason: "not_authenticated" };

  const { data: membership, error } = await supabase
    .from("organization_members")
    .select("tenant_id")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) return { ok: false, reason: "verification_failed" };
  if (!membership) return { ok: false, reason: "no_organization" };

  // A assinatura vive em `billing`, inalcançável pelo cliente PostgREST. Sem
  // fachada não há verificação possível — e "não consigo verificar" NEGA.
  return { ok: false, reason: "verification_failed" };
}

// ─── API ───────────────────────────────────────────────────────────────────

/**
 * O recurso está liberado para a organização do chamador?
 *
 * Chame no TOPO de qualquer server action que exponha recurso sujeito a plano.
 * O cadeado da interface não substitui esta chamada.
 */
export async function enforceFeature(
  feature: FeatureKey
): Promise<EntitlementDecision> {
  if (!isBillingEnabled()) return desvioDaFeatureFlag();

  const ctx = await loadBillingContext();
  if (!ctx.ok) return negar(ctx.reason);

  if (!planIncludes(ctx.context.plan, feature)) {
    return negar("feature_not_in_plan");
  }
  if (!canWrite(ctx.context.state)) return negar("read_only");

  return { allowed: true, reason: "ok" };
}

/**
 * O estado da assinatura permite ESCREVER agora?
 *
 * Para operações que não são específicas de recurso — editar um registro já
 * existente, por exemplo. Leitura nunca passa por aqui: nenhum dado desaparece
 * por inadimplência ou por downgrade.
 */
export async function enforceWriteAccess(): Promise<EntitlementDecision> {
  if (!isBillingEnabled()) return desvioDaFeatureFlag();

  const ctx = await loadBillingContext();
  if (!ctx.ok) return negar(ctx.reason);

  return canWrite(ctx.context.state)
    ? { allowed: true, reason: "ok" }
    : negar("read_only");
}

export interface SubscriptionWarning {
  readonly level: "info" | "warning" | "critical";
  readonly title: string;
  readonly message: string;
  readonly state: SubscriptionState;
}

/**
 * Aviso de estado da assinatura, para a interface.
 *
 * Com billing desligado devolve `null` — nenhum banner aparece e o layout
 * continua sem qualquer referência a billing. Falha de verificação também
 * devolve `null`: aviso é informação, e informação não verificada não se
 * exibe.
 */
export async function getSubscriptionWarning(): Promise<SubscriptionWarning | null> {
  if (!isBillingEnabled()) return null;

  const ctx = await loadBillingContext();
  if (!ctx.ok) return null;

  const { state } = ctx.context;

  if (state === "past_due_tolerance") {
    return {
      level: "warning",
      title: "Pagamento pendente",
      message:
        "Existe uma fatura vencida. Regularize o pagamento para manter o acesso completo.",
      state,
    };
  }

  if (state === "read_only") {
    return {
      level: "critical",
      title: "Conta em modo somente leitura",
      message:
        "Seus dados continuam disponíveis para consulta. Regularize a assinatura para voltar a editar.",
      state,
    };
  }

  return null;
}
