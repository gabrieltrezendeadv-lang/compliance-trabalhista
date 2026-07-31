/**
 * CATÁLOGO COMERCIAL APROVADO — fonte única de planos, faixas e preços
 *
 * Espelha docs/decisions/PLANOS-E-PRECIFICACAO.md §1 e §2. Todo valor monetário
 * é CENTAVO INTEIRO. Nenhum número deste arquivo é lido do banco, do ambiente
 * ou de configuração: o catálogo é código versionado, revisado em PR.
 *
 * ── POR QUE OS PREÇOS ANUAIS SÃO LITERAIS, SE HÁ FÓRMULA ────────────────────
 *
 * `precoAnual = (mensal * 12 * 9) / 10` está implementada em `pricing.ts` e é
 * testada. Ainda assim os anuais aparecem aqui por extenso, e os testes exigem
 * que os dois concordem.
 *
 * O motivo é que fórmula e tabela erram de formas diferentes. Se só houvesse a
 * fórmula, um erro nela produziria valores errados que "batem" com eles mesmos
 * e nenhuma asserção acusaria. Com as duas, um erro na fórmula diverge da
 * tabela aprovada, e um erro de digitação na tabela diverge da fórmula. É a
 * mesma lógica das âncoras A e B do rebuild-verify.
 */

import type {
  PlanDefinition,
  PlanSlug,
  PriceEntry,
  TierDefinition,
  TierSlug,
} from "./model";

/**
 * Versão do catálogo. Entra em todo `PriceSnapshot`, para que uma fatura antiga
 * possa ser explicada mesmo depois de a tabela mudar.
 *
 * Alterar preço, faixa ou recurso EXIGE incrementar esta versão.
 */
export const CATALOG_VERSION = "2026-07-30.1";

// ─── Faixas de porte ───────────────────────────────────────────────────────

export const TIERS: readonly TierDefinition[] = [
  { slug: "t1_20", minWorkers: 1, maxWorkers: 20, requiresQuote: false },
  { slug: "t21_50", minWorkers: 21, maxWorkers: 50, requiresQuote: false },
  { slug: "t51_100", minWorkers: 51, maxWorkers: 100, requiresQuote: false },
  { slug: "enterprise", minWorkers: 101, maxWorkers: null, requiresQuote: true },
] as const;

// ─── Planos e recursos ─────────────────────────────────────────────────────

/** Recursos do Essencial. O Completo é este conjunto MAIS os exclusivos. */
const ESSENCIAL_FEATURES = [
  "establishments",
  "departments",
  "users",
  "documents",
  "evidence",
  "action_plans",
  "campaigns_manual",
  "reports_basic",
] as const;

/** Exclusivos do Completo — os que aparecem com cadeado no Essencial. */
const COMPLETO_ONLY_FEATURES = [
  "risks",
  "complaints",
  "campaigns_automatic",
  "alerts",
  "reports_advanced",
  "history",
  "seal_hash",
  "priority_support",
] as const;

/** 1 GB = 1024 MiB. Declarado para que o número 2048 não pareça arbitrário. */
const MIB_PER_GIB = 1024;

export const PLANS: readonly PlanDefinition[] = [
  {
    slug: "essencial",
    name: "Essencial",
    features: ESSENCIAL_FEATURES,
    storageMib: 2 * MIB_PER_GIB,
    supportBusinessDays: 2,
  },
  {
    slug: "completo",
    name: "Completo",
    features: [...ESSENCIAL_FEATURES, ...COMPLETO_ONLY_FEATURES],
    storageMib: 10 * MIB_PER_GIB,
    supportBusinessDays: 1,
  },
] as const;

// ─── Tabela de preços, em centavos ─────────────────────────────────────────

export const PRICES: readonly PriceEntry[] = [
  // Essencial
  { plan: "essencial", tier: "t1_20", monthlyCents: 9_990, yearlyCents: 107_892 },
  { plan: "essencial", tier: "t21_50", monthlyCents: 16_990, yearlyCents: 183_492 },
  { plan: "essencial", tier: "t51_100", monthlyCents: 34_990, yearlyCents: 377_892 },
  { plan: "essencial", tier: "enterprise", monthlyCents: null, yearlyCents: null },
  // Completo
  { plan: "completo", tier: "t1_20", monthlyCents: 24_990, yearlyCents: 269_892 },
  { plan: "completo", tier: "t21_50", monthlyCents: 39_990, yearlyCents: 431_892 },
  { plan: "completo", tier: "t51_100", monthlyCents: 79_990, yearlyCents: 863_892 },
  { plan: "completo", tier: "enterprise", monthlyCents: null, yearlyCents: null },
] as const;

/** Desconto do plano anual: 10%, expresso como fração inteira 9/10. */
export const YEARLY_DISCOUNT_NUMERATOR = 9;
export const YEARLY_DISCOUNT_DENOMINATOR = 10;
export const MONTHS_PER_YEAR = 12;

/** Duração do trial, em dias. */
export const TRIAL_DAYS = 7;

/** Tolerância após falha de pagamento, em dias, com acesso normal. */
export const PAYMENT_TOLERANCE_DAYS = 7;

/** Antecedência obrigatória do aviso de renovação e de mudança de preço. */
export const RENEWAL_NOTICE_DAYS = 30;

/** Modo leitura após o encerramento definitivo, em meses. */
export const POST_TERMINATION_READ_ONLY_MONTHS = 12;

// ─── Acesso ────────────────────────────────────────────────────────────────

export function getPlan(slug: PlanSlug): PlanDefinition {
  const plan = PLANS.find((p) => p.slug === slug);
  // Inalcançável com tipos corretos. Existe para que um `as PlanSlug` errado em
  // borda não-tipada (JSON de webhook, linha de banco) falhe alto em vez de
  // devolver `undefined` e produzir um entitlement vazio — que seria
  // interpretado como "nenhum recurso liberado" e passaria por bloqueio válido.
  if (!plan) throw new Error(`plano desconhecido no catálogo: ${slug}`);
  return plan;
}

export function getTier(slug: TierSlug): TierDefinition {
  const tier = TIERS.find((t) => t.slug === slug);
  if (!tier) throw new Error(`faixa desconhecida no catálogo: ${slug}`);
  return tier;
}

export function getPriceEntry(plan: PlanSlug, tier: TierSlug): PriceEntry {
  const entry = PRICES.find((p) => p.plan === plan && p.tier === tier);
  if (!entry) throw new Error(`preço ausente do catálogo: ${plan}/${tier}`);
  return entry;
}
