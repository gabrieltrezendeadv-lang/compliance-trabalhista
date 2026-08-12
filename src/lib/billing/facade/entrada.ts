/**
 * ENTRADAS DA FACHADA — schemas FECHADOS, e o que nunca vem do chamador
 *
 * ── A LISTA DO QUE NÃO SE ACEITA É A PARTE IMPORTANTE ───────────────────────
 *
 * Estes schemas são `.strict()` por decisão, não por gosto: um campo a mais no
 * corpo é ERRO, e não silêncio. É a diferença entre "o servidor ignorou
 * `actorId`" e "o servidor recusou o pedido que trazia `actorId`" — e a segunda
 * é a única que aparece quando alguém tenta.
 *
 * Nada nesta camada aceita, como autoridade:
 *
 *   actorId · tenant resolvido · papel · termsAcceptedAt · instante atual ·
 *   origem · correlation ID · status · preço · faixa calculada · snapshot ·
 *   identificador externo do provider · chave de idempotência
 *
 * Todos eles são resolvidos no servidor. `organizationId` é aceito, e é a
 * exceção que confirma a regra: ele nunca autoriza — é apenas COMPARADO com o
 * tenant que o servidor resolveu, e divergência é recusa.
 *
 * `termsVersion` também é aceita, e também não decide: é a versão que a tela
 * EXIBIU, comparada com `TERMS_VERSION` antes de qualquer efeito. O que se
 * persiste é a constante do servidor.
 */

import "server-only";

import { z } from "zod";

/** Slug de organização vindo do cliente. Nunca autoriza; só é comparado. */
const organizacaoPedida = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .optional();

/**
 * CNPJ: catorze dígitos.
 *
 * Só forma, não validade de dígito verificador — o modelo aprovado exige o
 * número, e recusar CNPJ real por causa de uma tabela de validação embutida
 * seria pior do que aceitar um inválido que o backoffice corrige.
 */
const cnpj = z
  .string()
  .trim()
  .regex(/^\d{14}$/, "CNPJ deve ter 14 dígitos");

/**
 * Contagem de trabalhadores.
 *
 * Inteiro, positivo e com teto: é ela que escolhe a FAIXA de preço, e um número
 * absurdo produziria uma faixa absurda. O teto é folgado de propósito — acima
 * dele a faixa é Enterprise, que já não tem preço de tabela.
 */
const workerCount = z.number().int().min(1).max(1_000_000);

const plano = z.enum(["essencial", "completo"]);
const periodicidade = z.enum(["monthly", "yearly"]);

/** Versão dos termos: afirmação da tela, no formato oficial. */
const versaoDeTermos = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "versão de termos em formato inesperado");

/**
 * Contato financeiro. Vazio é intenção de LIMPAR, e não erro.
 *
 * O limite de 254 é o da RFC 5321, o mesmo do CHECK em
 * `billing.subscriptions`. A forma mínima também é a mesma — as duas camadas
 * concordam de propósito, e o banco continua sendo a que decide.
 */
const emailFinanceiro = z
  .string()
  .trim()
  .max(254)
  .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
    message: "contato financeiro inválido",
  });

const meio = z.enum(["pix", "credit_card"]);

export const IniciarTrialSchema = z
  .object({
    organizationId: organizacaoPedida,
    plan: plano,
    period: periodicidade,
    workerCount,
    cnpj,
    termsVersion: versaoDeTermos,
    billingEmail: emailFinanceiro.optional(),
  })
  .strict();

export const AtualizarEmailSchema = z
  .object({
    organizationId: organizacaoPedida,
    billingEmail: emailFinanceiro,
  })
  .strict();

export const AceitarTermosSchema = z
  .object({
    organizationId: organizacaoPedida,
    termsVersion: versaoDeTermos,
  })
  .strict();

export const RegistrarTrabalhadoresSchema = z
  .object({
    organizationId: organizacaoPedida,
    workerCount,
  })
  .strict();

export const EscolherPlanoSchema = z
  .object({
    organizationId: organizacaoPedida,
    plan: plano,
    period: periodicidade,
  })
  .strict();

export const UpgradeSchema = z
  .object({
    organizationId: organizacaoPedida,
    plan: plano,
  })
  .strict();

export const AgendarDowngradeSchema = z
  .object({
    organizationId: organizacaoPedida,
    plan: plano,
  })
  .strict();

export const CancelarSchema = z
  .object({
    organizationId: organizacaoPedida,
  })
  .strict();

/**
 * Checkout.
 *
 * NÃO aceita `idempotencyKey`: ela é DERIVADA no servidor, e recebê-la do
 * cliente devolveria a ele o controle de reprocessar ou de colidir com a chave
 * de outra operação. Ver `idempotencia.ts`.
 *
 * NÃO aceita cenário de mock, valor, faixa ou identificador externo.
 */
export const CriarCheckoutSchema = z
  .object({
    organizationId: organizacaoPedida,
    method: meio,
    customerName: z.string().trim().min(1).max(120),
    customerEmail: emailFinanceiro.refine((v) => v !== "", {
      message: "e-mail do pagador é obrigatório",
    }),
  })
  .strict();

export const ConsultaSchema = z
  .object({
    organizationId: organizacaoPedida,
  })
  .strict();

export type IniciarTrial = z.infer<typeof IniciarTrialSchema>;
export type AtualizarEmail = z.infer<typeof AtualizarEmailSchema>;
export type AceitarTermos = z.infer<typeof AceitarTermosSchema>;
export type RegistrarTrabalhadores = z.infer<typeof RegistrarTrabalhadoresSchema>;
export type EscolherPlano = z.infer<typeof EscolherPlanoSchema>;
export type Upgrade = z.infer<typeof UpgradeSchema>;
export type AgendarDowngrade = z.infer<typeof AgendarDowngradeSchema>;
export type Cancelar = z.infer<typeof CancelarSchema>;
export type CriarCheckout = z.infer<typeof CriarCheckoutSchema>;
export type Consulta = z.infer<typeof ConsultaSchema>;

/**
 * Campos que NENHUM schema pode declarar.
 *
 * Exportado para que a guarda estrutural da 12C.2 leia a lista daqui em vez de
 * manter uma cópia — duas listas divergem, uma não.
 */
export const CAMPOS_PROIBIDOS = Object.freeze([
  "actorId",
  "userId",
  "tenantId",
  "role",
  "termsAcceptedAt",
  "acceptedAt",
  "occurredAt",
  "now",
  "origin",
  "correlationId",
  "status",
  "state",
  "amountCents",
  "priceCents",
  "tier",
  "priceSnapshot",
  "snapshot",
  "externalChargeId",
  "externalCustomerId",
  "providerAccountId",
  "idempotencyKey",
  "fingerprint",
  "scenario",
  "scenarios",
]);
