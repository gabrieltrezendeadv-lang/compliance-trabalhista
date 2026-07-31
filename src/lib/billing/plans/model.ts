/**
 * MODELO DE DOMÍNIO DE PLANOS E COBRANÇA — Etapa 12A
 *
 * Tipos puros. Sem I/O, sem Supabase, sem `process.env`, sem data implícita:
 * toda função que depende do "agora" recebe o instante como argumento. É o que
 * torna os cálculos determinísticos e testáveis sem relógio falso.
 *
 * ── POR QUE UM MODELO NOVO, E NÃO O ANTIGO ──────────────────────────────────
 *
 * A estrutura antiga (`public.subscription_plans`, tipo `plan_limits`) precifica
 * por CAPACIDADE — teto de estabelecimentos, membros, campanhas. O modelo
 * aprovado precifica por PORTE (faixa de trabalhadores) e diferencia por
 * RECURSO (Essencial × Completo), declarando explicitamente que **não há limite
 * comercial** de usuários, estabelecimentos ou campanhas.
 *
 * Não é um ajuste de valores: as duas modelagens respondem perguntas
 * diferentes. Reaproveitar `plan_limits` obrigaria a representar "faixa" num
 * tipo que não tem onde guardá-la, e manteria vivos campos que o modelo
 * aprovado proíbe usar como limite comercial.
 *
 * Ver docs/decisions/PLANOS-E-PRECIFICACAO.md.
 */

// ─── Planos ────────────────────────────────────────────────────────────────

/** Planos com checkout automático. */
export type PlanSlug = "essencial" | "completo";

/**
 * Faixa de porte. `enterprise` é a faixa acima de 100 trabalhadores: existe no
 * modelo, mas não tem preço de tabela e não passa por checkout.
 */
export type TierSlug = "t1_20" | "t21_50" | "t51_100" | "enterprise";

export type BillingPeriod = "monthly" | "yearly";

// ─── Recursos ──────────────────────────────────────────────────────────────

/**
 * Chaves de recurso sujeitas a entitlement.
 *
 * Deliberadamente fechadas: um `string` livre permitiria que um chamador
 * inventasse uma chave, não encontrasse regra para ela e caísse num ramo
 * default. Aqui a chave desconhecida é erro de tipo em tempo de compilação e
 * negação em tempo de execução.
 */
export type FeatureKey =
  | "establishments"
  | "departments"
  | "users"
  | "documents"
  | "evidence"
  | "action_plans"
  | "campaigns_manual"
  | "reports_basic"
  | "risks"
  | "complaints"
  | "campaigns_automatic"
  | "alerts"
  | "reports_advanced"
  | "history"
  | "seal_hash"
  | "priority_support";

/** Definição imutável de um plano no catálogo aprovado. */
export interface PlanDefinition {
  readonly slug: PlanSlug;
  readonly name: string;
  /** Recursos liberados. Ausência da chave = bloqueado. */
  readonly features: readonly FeatureKey[];
  /** Armazenamento incluído, em mebibytes inteiros. */
  readonly storageMib: number;
  /** SLA de suporte, em dias úteis. */
  readonly supportBusinessDays: number;
}

/** Faixa de porte, com limites inclusivos. `maxWorkers: null` = sem teto. */
export interface TierDefinition {
  readonly slug: TierSlug;
  readonly minWorkers: number;
  readonly maxWorkers: number | null;
  /** `true` quando a faixa exige proposta comercial e não tem checkout. */
  readonly requiresQuote: boolean;
}

/**
 * Preço de tabela para (plano, faixa), em CENTAVOS inteiros.
 *
 * `null` significa "sem preço de tabela" — Enterprise. Não é zero, e a
 * distinção importa: zero seria um preço válido e passaria por qualquer
 * checkout.
 */
export interface PriceEntry {
  readonly plan: PlanSlug;
  readonly tier: TierSlug;
  readonly monthlyCents: number | null;
  readonly yearlyCents: number | null;
}

// ─── Assinatura ────────────────────────────────────────────────────────────

/**
 * Estados da assinatura no modelo aprovado.
 *
 * Vocabulário próprio, e não o do enum antigo `public.subscription_status`.
 * O antigo tem `partially_blocked` e `fully_blocked`, que descrevem um bloqueio
 * gradual que o modelo aprovado não usa: aqui a degradação é sempre para
 * **modo leitura**, e nenhum dado é apagado.
 */
export type SubscriptionState =
  | "trialing"
  | "active"
  /** Falha de pagamento, dentro dos 7 dias de tolerância: acesso normal. */
  | "past_due_tolerance"
  /** Trial vencido, tolerância vencida ou encerramento: somente leitura. */
  | "read_only"
  /** Cancelamento pedido; acesso normal até o fim do período pago. */
  | "cancel_scheduled"
  /** Período encerrado. Seguem-se 12 meses de modo leitura. */
  | "terminated";

/** Origem do direito de acesso vigente, em ordem de precedência. */
export type EntitlementSource =
  | "courtesy"
  | "grandfathered"
  | "subscription"
  | "trial"
  | "none";

/**
 * Preço congelado no momento da contratação.
 *
 * É snapshot, não referência: alteração futura da tabela de preços não pode
 * reescrever período ou fatura já emitidos.
 */
export interface PriceSnapshot {
  readonly plan: PlanSlug;
  readonly tier: TierSlug;
  readonly period: BillingPeriod;
  readonly amountCents: number;
  /** Instante em que o preço foi congelado, em ISO 8601 UTC. */
  readonly capturedAt: string;
  /** Versão do catálogo que originou o valor. */
  readonly catalogVersion: string;
}

export interface Subscription {
  readonly organizationId: string;
  readonly plan: PlanSlug;
  readonly tier: TierSlug;
  readonly period: BillingPeriod;
  readonly state: SubscriptionState;
  /** Preço contratado, congelado. */
  readonly priceSnapshot: PriceSnapshot;
  /** Início do período vigente, ISO 8601 UTC. */
  readonly currentPeriodStart: string;
  /** Fim do período vigente, ISO 8601 UTC. */
  readonly currentPeriodEnd: string;
  /** Fim do trial, quando houver. */
  readonly trialEndsAt: string | null;
  /** Início da tolerância por falha de pagamento, quando houver. */
  readonly paymentFailedAt: string | null;
  /** Downgrade agendado para a renovação, quando houver. */
  readonly scheduledDowngrade: { plan: PlanSlug; tier: TierSlug } | null;
  /** Quantidade de trabalhadores declarada pelo proprietário. */
  readonly workerCount: number;
}

// ─── Grandfathering e cortesia ─────────────────────────────────────────────

/**
 * Direito adquirido de Essencial gratuito permanente.
 *
 * Vinculado a `organizationId`. Nunca a usuário: o benefício pertence à
 * organização, e organização nova do mesmo usuário não o herda.
 */
export interface Grandfathering {
  readonly organizationId: string;
  /** Data de corte vigente quando o direito foi registrado, ISO 8601 UTC. */
  readonly cutoffAt: string;
  readonly grantedAt: string;
}

/** Cortesia administrativa. Prazo, motivo e autor são obrigatórios. */
export interface Courtesy {
  readonly organizationId: string;
  readonly plan: PlanSlug;
  readonly startsAt: string;
  /** Obrigatório: cortesia sem prazo é plano gratuito disfarçado. */
  readonly endsAt: string;
  readonly reason: string;
  readonly grantedBy: string;
}

// ─── Resultado de verificação ──────────────────────────────────────────────

export type EntitlementDenialReason =
  | "billing_disabled"
  | "feature_not_in_plan"
  | "read_only"
  | "no_subscription"
  | "verification_failed"
  | "not_authenticated"
  | "no_organization"
  | "not_owner";

export interface EntitlementDecision {
  readonly allowed: boolean;
  readonly reason: EntitlementDenialReason | "ok";
  /**
   * Marca o único caminho autorizado a permitir sem verificar: o desvio
   * explícito da feature flag. Existe para que "passou porque billing está
   * desligado" seja distinguível de "passou porque foi verificado".
   */
  readonly bypass?: true;
  readonly message?: string;
}
