/**
 * FACHADA DE APLICAÇÃO DE BILLING — Etapa 12C.2
 *
 * Camada server-side entre o futuro frontend e os casos de uso da 12B/12C.1.
 * Ela PREPARA a 12C.3 e não publica nada: não há página, rota, server action
 * nem webhook que a alcance, e `LR-16`/`CM-25` reprovam se aparecer.
 *
 * ── POR QUE UMA FACHADA, SE JÁ HÁ CASOS DE USO ──────────────────────────────
 *
 * Os casos de uso recebem `UseCaseEnv` já montado: ator resolvido, organização
 * resolvida, relógio, provider, correlação. Alguém precisa montá-lo, e esse
 * alguém decide TUDO o que importa para segurança — se a flag foi consultada,
 * se a sessão foi resolvida no servidor, se o `organizationId` do cliente foi
 * comparado ou obedecido, se o provider foi construído antes ou depois de a PII
 * entrar em jogo.
 *
 * Sem esta camada, cada server action da 12C.3 montaria o ambiente por conta
 * própria, e a ordem de segurança viraria convenção — repetida em N lugares,
 * verificada em nenhum. Aqui ela é UMA função, e as onze etapas são as onze
 * linhas de `executarComando`.
 *
 * ── AS ONZE ETAPAS, NA ORDEM, E POR QUE NESTA ORDEM ─────────────────────────
 *
 *   1. flag                    billing desligado não consulta banco nem
 *   2. billing_disabled        constrói provider: a etapa não existe para quem
 *                              chamou, e "não existe" não faz I/O.
 *   3. sessão                  resolvida no servidor, nunca recebida.
 *   4. organização e papel     idem, e da mesma consulta.
 *   5. owner                   comandos comerciais exigem proprietário.
 *   6. comparação de tenant    o identificador do cliente é comparado, jamais
 *                              obedecido. É o formato clássico do IDOR.
 *   7. validação               DEPOIS da autorização, de propósito: quem não
 *                              está autorizado não aprende quais campos
 *                              existem nem quais formatos passam.
 *   8. contexto confiável      ator, organização, origem, relógio e correlação
 *                              montados aqui, a partir do que o servidor
 *                              resolveu.
 *   9. provider                só quando a operação precisa. Só o checkout
 *                              precisa.
 *  10. um caso de uso          exatamente um. A fachada não orquestra dois
 *                              efeitos: isso reintroduziria a escrita parcial
 *                              que a 12B eliminou ao tornar cada RPC uma
 *                              transação.
 *  11. tradução                `Result` do domínio vira `FacadeResult`, com
 *                              mensagem escrita à mão. Nada do driver passa.
 *
 * ── O QUE ESTA ETAPA DELIBERADAMENTE NÃO OFERECE ────────────────────────────
 *
 * Cortesia e grandfathering são operações ADMINISTRATIVAS: quem as concede não
 * é o cliente, e expô-las numa fachada destinada ao frontend do cliente seria
 * convidar a 12C.3 a criar tela para elas. Ficam nos casos de uso, alcançáveis
 * por backoffice futuro.
 *
 * Leitura por membro comum também não: `BillingAuthContext.role` é o literal
 * `"owner"`, e `assertTenant` recusa qualquer outro papel. O banco permite que
 * um membro leia o próprio estado (`fn_billing_read_state` não exige owner),
 * mas ampliar isso é decisão de domínio, não de fachada.
 */

import "server-only";

import type { BillingAuthResult } from "../authorization";
import { fail, type Result } from "../core/errors";
import type { BillingActionOrigin } from "../core/ports";
import type {
  BillingState,
  CatalogPrice,
  StoredSubscription,
} from "../core/repository";
import { CATALOG_VERSION } from "../plans/catalog";
import { TERMS_VERSION } from "../terms";
import { resolveBillingAccess, type AccessDecision } from "../usecases/access";
import { createCheckout, type CheckoutResult } from "../usecases/payments";
import type { UseCaseEnv } from "../usecases/shared";
import {
  acceptTerms,
  cancelAtPeriodEnd,
  choosePlan,
  recordWorkerCount,
  scheduleDowngradeUseCase,
  startTrial,
  updateBillingEmail,
  upgradeSubscription,
  type UpgradeResult,
} from "../usecases/subscription";
import { dependenciasDeProducao, type DependenciasDaFachada } from "./dependencias";
import {
  AceitarTermosSchema,
  AgendarDowngradeSchema,
  AtualizarEmailSchema,
  CancelarSchema,
  ConsultaSchema,
  CriarCheckoutSchema,
  EscolherPlanoSchema,
  IniciarTrialSchema,
  RegistrarTrabalhadoresSchema,
  UpgradeSchema,
} from "./entrada";
import { derivarChave } from "./idempotencia";
import { recusaPadrao, traduzir, type FacadeResult } from "./resultado";

/** Origem de tudo o que a fachada faz: pedido do proprietário. */
const ORIGEM: Extract<BillingActionOrigin, "owner"> = "owner";

/** Schema mínimo que todo comando aceita, para extrair o tenant afirmado. */
type ComEntrada = { readonly safeParse: (v: unknown) => SafeParse };
interface SafeParse {
  readonly success: boolean;
  readonly data?: unknown;
}

/**
 * Extrai o `organizationId` AFIRMADO pelo cliente, sem validar o resto.
 *
 * Precisa acontecer antes da validação completa porque a comparação de tenant é
 * etapa 6 e a validação é etapa 7 — e essa ordem é deliberada. O valor extraído
 * aqui não é confiado: ele só é entregue a `autorizar`, que o COMPARA com o que
 * o servidor resolveu por conta própria.
 */
function tenantAfirmado(bruto: unknown): string | undefined {
  if (typeof bruto !== "object" || bruto === null) return undefined;
  const v = (bruto as Record<string, unknown>).organizationId;
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

/** Ambiente do caso de uso, montado a partir do que o SERVIDOR resolveu. */
function montarEnv(
  deps: DependenciasDaFachada,
  principal: { userId: string; organizationId: string },
  provider: UseCaseEnv["provider"]
): UseCaseEnv {
  return {
    clock: deps.clock,
    ids: deps.ids,
    repo: deps.repositorio(),
    provider,
    auth: {
      userId: principal.userId,
      organizationId: principal.organizationId,
      role: "owner",
    },
    providerAccountId: deps.providerAccountId,
    correlationId: deps.ids.next("corr"),
  };
}

/**
 * Provider inexistente.
 *
 * Comandos que não falam com o provider recebem ESTE objeto, e não o real: se
 * algum deles passar a chamá-lo por engano, o teste quebra com uma mensagem
 * nominal em vez de abrir conexão. `deps.provider()` fica sem ser chamada, e é
 * isso que os testes observam.
 */
const PROVIDER_NAO_USADO = new Proxy({} as UseCaseEnv["provider"], {
  get(_alvo, prop) {
    throw new Error(
      `fachada: esta operação não usa provider, mas alguém acessou "${String(prop)}"`
    );
  },
});

/** Erro de autorização traduzido para o vocabulário da fachada. */
function traduzirNegacao<T>(r: Extract<BillingAuthResult, { ok: false }>): FacadeResult<T> {
  switch (r.reason) {
    case "not_authenticated":
      return recusaPadrao("unauthenticated");
    case "verification_failed":
      return recusaPadrao("repository_unavailable");
    // `no_organization` e `not_owner` convergem: distingui-los diria a quem
    // varre identificadores que a organização existe.
    default:
      return recusaPadrao("not_owner");
  }
}

/**
 * As onze etapas, uma vez só.
 *
 * `precisaDeProvider` é explícito e não inferido: inferir levaria a "resolve
 * sempre, por garantia", e resolver sempre é exatamente o que a etapa 9 proíbe.
 */
async function executarComando<TEntrada, TSaida>(
  deps: DependenciasDaFachada,
  schema: ComEntrada,
  bruto: unknown,
  executar: (env: UseCaseEnv, entrada: TEntrada) => Promise<Result<TSaida>>,
  precisaDeProvider = false
): Promise<FacadeResult<TSaida>> {
  // 1–2. A FLAG, ANTES DE TUDO. Nenhum I/O acontece com billing desligado.
  if (!deps.flagLigada()) return recusaPadrao("billing_disabled");

  // 3–6. Sessão, organização, papel e comparação de tenant, no servidor.
  const autorizacao = await deps.autorizar(tenantAfirmado(bruto));
  if (!autorizacao.ok) return traduzirNegacao<TSaida>(autorizacao);

  // 7. Validação, só depois de autorizado.
  const parsed = schema.safeParse(bruto);
  if (!parsed.success) return recusaPadrao("invalid_input");

  // 9. Provider só para quem precisa. Construído ANTES de qualquer PII entrar
  //    no fluxo, que é a regra que `LR-16` cobra dos entrypoints.
  let provider: UseCaseEnv["provider"] = PROVIDER_NAO_USADO;
  if (precisaDeProvider) {
    try {
      provider = deps.provider();
    } catch {
      // Provider não configurado, não implementado ou proibido no ambiente.
      // Nenhum detalhe atravessa: o motivo fica no log do servidor.
      return recusaPadrao("misconfigured");
    }
  }

  // 8. Contexto confiável.
  const env = montarEnv(deps, autorizacao.principal, provider);

  // 10–11. Exatamente um caso de uso, e a tradução do `Result`.
  const r = await executar(env, parsed.data as TEntrada);
  return traduzir(r);
}

// ─── Consultas ──────────────────────────────────────────────────────────────

/**
 * Catálogo de preços da versão vigente.
 *
 * A versão do catálogo é do SERVIDOR: pedir a de outra versão permitiria montar
 * uma tela com preço antigo.
 */
export function lerCatalogo(
  bruto: unknown,
  deps: DependenciasDaFachada = dependenciasDeProducao()
): Promise<FacadeResult<readonly CatalogPrice[]>> {
  return executarComando<{ organizationId?: string }, readonly CatalogPrice[]>(
    deps,
    ConsultaSchema,
    bruto,
    (env) => env.repo.readCatalog(env.auth.userId, env.auth.organizationId, CATALOG_VERSION)
  );
}

/** Estado da assinatura, cortesias e direito adquirido, numa leitura só. */
export function lerAssinatura(
  bruto: unknown,
  deps: DependenciasDaFachada = dependenciasDeProducao()
): Promise<FacadeResult<BillingState>> {
  return executarComando<{ organizationId?: string }, BillingState>(
    deps,
    ConsultaSchema,
    bruto,
    (env) => env.repo.readState(env.auth.userId, env.auth.organizationId)
  );
}

/**
 * Decisão de acesso.
 *
 * `billingEnabled` NÃO vem do chamador: quem responde por ele é a mesma flag da
 * etapa 1, e chegar aqui já significa que ela está ligada.
 */
export function lerAcesso(
  bruto: unknown,
  deps: DependenciasDaFachada = dependenciasDeProducao()
): Promise<FacadeResult<AccessDecision>> {
  return executarComando<{ organizationId?: string }, AccessDecision>(
    deps,
    ConsultaSchema,
    bruto,
    (env, entrada) =>
      resolveBillingAccess(env, {
        requestedOrganizationId: entrada.organizationId,
        billingEnabled: true,
      })
  );
}

// ─── Ciclo de vida ──────────────────────────────────────────────────────────

export function iniciarTrial(
  bruto: unknown,
  deps: DependenciasDaFachada = dependenciasDeProducao()
): Promise<FacadeResult<StoredSubscription>> {
  return executarComando<
    {
      organizationId?: string;
      plan: "essencial" | "completo";
      period: "monthly" | "yearly";
      workerCount: number;
      cnpj: string;
      termsVersion: string;
      billingEmail?: string;
    },
    StoredSubscription
  >(deps, IniciarTrialSchema, bruto, (env, e) =>
    startTrial(env, {
      requestedOrganizationId: e.organizationId,
      plan: e.plan,
      period: e.period,
      workerCount: e.workerCount,
      cnpj: e.cnpj,
      // A versão que a TELA exibiu. `startTrial` a compara com `TERMS_VERSION`
      // e persiste a constante — nunca esta string. O instante do aceite nem
      // aparece aqui: vem do `Clock`.
      termsVersion: e.termsVersion,
      billingEmail: e.billingEmail ?? null,
    })
  );
}

export function atualizarEmailFinanceiro(
  bruto: unknown,
  deps: DependenciasDaFachada = dependenciasDeProducao()
): Promise<FacadeResult<StoredSubscription>> {
  return executarComando<{ organizationId?: string; billingEmail: string }, StoredSubscription>(
    deps,
    AtualizarEmailSchema,
    bruto,
    (env, e) =>
      updateBillingEmail(env, {
        requestedOrganizationId: e.organizationId,
        billingEmail: e.billingEmail,
      })
  );
}

export function aceitarTermos(
  bruto: unknown,
  deps: DependenciasDaFachada = dependenciasDeProducao()
): Promise<FacadeResult<StoredSubscription>> {
  return executarComando<{ organizationId?: string; termsVersion: string }, StoredSubscription>(
    deps,
    AceitarTermosSchema,
    bruto,
    (env, e) =>
      acceptTerms(env, {
        requestedOrganizationId: e.organizationId,
        termsVersion: e.termsVersion,
      })
  );
}

export function registrarTrabalhadores(
  bruto: unknown,
  deps: DependenciasDaFachada = dependenciasDeProducao()
): Promise<FacadeResult<StoredSubscription>> {
  return executarComando<{ organizationId?: string; workerCount: number }, StoredSubscription>(
    deps,
    RegistrarTrabalhadoresSchema,
    bruto,
    (env, e) =>
      recordWorkerCount(env, {
        requestedOrganizationId: e.organizationId,
        workerCount: e.workerCount,
      })
  );
}

export function escolherPlano(
  bruto: unknown,
  deps: DependenciasDaFachada = dependenciasDeProducao()
): Promise<FacadeResult<StoredSubscription>> {
  return executarComando<
    { organizationId?: string; plan: "essencial" | "completo"; period: "monthly" | "yearly" },
    StoredSubscription
  >(deps, EscolherPlanoSchema, bruto, (env, e) =>
    choosePlan(env, {
      requestedOrganizationId: e.organizationId,
      plan: e.plan,
      period: e.period,
    })
  );
}

export function fazerUpgrade(
  bruto: unknown,
  deps: DependenciasDaFachada = dependenciasDeProducao()
): Promise<FacadeResult<UpgradeResult>> {
  return executarComando<
    { organizationId?: string; plan: "essencial" | "completo" },
    UpgradeResult
  >(deps, UpgradeSchema, bruto, (env, e) =>
    upgradeSubscription(env, {
      requestedOrganizationId: e.organizationId,
      plan: e.plan,
    })
  );
}

export function agendarDowngrade(
  bruto: unknown,
  deps: DependenciasDaFachada = dependenciasDeProducao()
): Promise<FacadeResult<StoredSubscription>> {
  return executarComando<
    { organizationId?: string; plan: "essencial" | "completo" },
    StoredSubscription
  >(deps, AgendarDowngradeSchema, bruto, (env, e) =>
    scheduleDowngradeUseCase(env, {
      requestedOrganizationId: e.organizationId,
      plan: e.plan,
    })
  );
}

export function cancelarNoFimDoPeriodo(
  bruto: unknown,
  deps: DependenciasDaFachada = dependenciasDeProducao()
): Promise<FacadeResult<StoredSubscription>> {
  return executarComando<{ organizationId?: string }, StoredSubscription>(
    deps,
    CancelarSchema,
    bruto,
    (env, e) => cancelAtPeriodEnd(env, { requestedOrganizationId: e.organizationId })
  );
}

// ─── Checkout ───────────────────────────────────────────────────────────────

/**
 * Cria o checkout, com chave de idempotência DERIVADA no servidor.
 *
 * A leitura de estado que precede o comando existe para derivar a chave a
 * partir do período vigente — ver `idempotencia.ts`. Sem assinatura não há
 * checkout, e a recusa é a mesma de tenant alheio.
 */
export function criarCheckout(
  bruto: unknown,
  deps: DependenciasDaFachada = dependenciasDeProducao()
): Promise<FacadeResult<CheckoutResult>> {
  return executarComando<
    { organizationId?: string; method: "pix" | "credit_card"; customerName: string; customerEmail: string },
    CheckoutResult
  >(
    deps,
    CriarCheckoutSchema,
    bruto,
    async (env, e) => {
      const estado = await env.repo.readState(env.auth.userId, env.auth.organizationId);
      if (!estado.ok) return estado;

      const assinatura = estado.value.subscription;
      // Mesma recusa de tenant alheio: "não há assinatura" não pode ser
      // distinguível de "não é sua".
      if (assinatura === null) {
        return fail<CheckoutResult>("not_found", "assinatura inexistente");
      }

      return createCheckout(env, {
        requestedOrganizationId: e.organizationId,
        method: e.method,
        customerName: e.customerName,
        customerEmail: e.customerEmail,
        idempotencyKey: derivarChave(
          "checkout",
          env.auth.organizationId,
          assinatura.currentPeriodStart,
          assinatura.currentPeriodEnd
        ),
      });
    },
    true
  );
}

// ─── Superfície declarada ───────────────────────────────────────────────────

/**
 * Os dez comandos, nominalmente.
 *
 * Existe para que a guarda estrutural compare a superfície REAL com a
 * declarada, em vez de contar exports — e para que acrescentar um comando sem
 * revisar a matriz de autorização reprove.
 */
export const COMANDOS_DA_FACHADA = Object.freeze([
  "lerCatalogo",
  "lerAssinatura",
  "lerAcesso",
  "iniciarTrial",
  "atualizarEmailFinanceiro",
  "aceitarTermos",
  "registrarTrabalhadores",
  "escolherPlano",
  "fazerUpgrade",
  "agendarDowngrade",
  "cancelarNoFimDoPeriodo",
  "criarCheckout",
] as const);

/** A versão de termos que o servidor reconhece. Reexportada para a 12C.3. */
export { TERMS_VERSION, ORIGEM };
