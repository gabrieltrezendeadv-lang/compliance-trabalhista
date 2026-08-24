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
 * comparado ou obedecido, qual papel cada comando exige.
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
 *   5. papel mínimo            declarado POR COMANDO na matriz abaixo. Escrita
 *                              e dossiê comercial exigem proprietário; catálogo
 *                              e decisão de acesso bastam-se com membro.
 *   6. comparação de tenant    o identificador do cliente é comparado, jamais
 *                              obedecido. É o formato clássico do IDOR.
 *   7. validação               DEPOIS da autorização, de propósito: quem não
 *                              está autorizado não aprende quais campos
 *                              existem nem quais formatos passam.
 *   8. contexto confiável      ator, organização, PAPEL REAL, origem, relógio e
 *                              correlação montados aqui, do que o servidor
 *                              resolveu.
 *   9. provider                só quando a operação precisa. Só o checkout
 *                              precisa.
 *  10. um caso de uso          exatamente um, sem exceção. A fachada não lê o
 *                              banco por conta própria e não decide nada de
 *                              domínio: isso reintroduziria regra duplicada em
 *                              duas camadas, que é como divergências nascem.
 *  11. tradução                `Result` do domínio vira `FacadeResult`, com
 *                              mensagem escrita à mão. Nada do driver passa.
 *
 * ── A MATRIZ DE PAPÉIS, E O CRITÉRIO QUE A PRODUZ ───────────────────────────
 *
 * O critério NÃO é "leitura versus escrita". É O QUE A RESPOSTA CARREGA:
 *
 *   MEMBRO   `lerCatalogo`   preços públicos da versão vigente;
 *            `lerAcesso`     o que o tenant pode usar — sem dizer por qual
 *                            contrato, por qual preço ou para qual CNPJ.
 *
 *   OWNER    todo o resto, incluindo `lerAssinatura`, que devolve o dossiê
 *            comercial inteiro (CNPJ, contato financeiro, preço praticado,
 *            identificador externo).
 *
 * A decisão de acesso precisa valer para TODO usuário do tenant: é ela que a
 * 12C.3 vai consultar para aplicar entitlements, e exigir proprietário barraria
 * o colaborador de módulos que a organização pagou — ou empurraria a 12C.3 a
 * resolver acesso por fora desta camada, que é o que ela existe para impedir.
 *
 * ── O QUE ESTA ETAPA DELIBERADAMENTE NÃO OFERECE ────────────────────────────
 *
 * Cortesia e grandfathering são operações ADMINISTRATIVAS: quem as concede não
 * é o cliente, e expô-las numa fachada destinada ao frontend do cliente seria
 * convidar a 12C.3 a criar tela para elas. Ficam nos casos de uso, alcançáveis
 * por backoffice futuro.
 */

import "server-only";

import type { BillingAuthResult } from "../authorization";
import type { Result } from "../core/errors";
import type { BillingActionOrigin } from "../core/ports";
import type {
  BillingState,
  CatalogPrice,
  StoredSubscription,
} from "../core/repository";
import { TERMS_VERSION } from "../terms";
import { resolveBillingAccess, type AccessDecision } from "../usecases/access";
import { createCheckout, type CheckoutResult } from "../usecases/payments";
import { readCatalogUseCase, readSubscriptionState } from "../usecases/queries";
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
import {
  dependenciasDeProducao,
  type DependenciasDaFachada,
  type PapelMinimo,
} from "./dependencias";
import {
  AceitarTermosSchema,
  AgendarDowngradeSchema,
  AtualizarEmailSchema,
  CancelarSchema,
  ConsultaSchema,
  CriarCheckoutSchema,
  EscolherPlanoSchema,
  IniciarTrialSchema,
  PrepararIntencaoSchema,
  RegistrarTrabalhadoresSchema,
  UpgradeSchema,
} from "./entrada";
import { recusaPadrao, sucesso, traduzir, type FacadeResult } from "./resultado";

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

/**
 * Ambiente do caso de uso, montado a partir do que o SERVIDOR resolveu.
 *
 * O papel vem do `principal`, e não de um literal. Fixá-lo em "owner" — como a
 * versão anterior fazia — significaria que um membro resolvido pelo servidor
 * chegaria ao caso de uso disfarçado de proprietário, e `assertTenantOwner`
 * deixaria de proteger o que quer que fosse.
 */
function montarEnv(
  deps: DependenciasDaFachada,
  principal: { userId: string; organizationId: string; role: "owner" | "member" },
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
      role: principal.role,
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
      "fachada: esta operação não usa provider, mas alguém acessou " + String(prop)
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
 * `papelMinimo` e `precisaDeProvider` são explícitos e não inferidos: inferir
 * levaria a "exige owner sempre, por garantia" e a "resolve provider sempre,
 * por garantia" — e os dois "por garantia" são exatamente os defeitos que as
 * etapas 5 e 9 existem para impedir.
 */
async function executarComando<TEntrada, TSaida>(
  deps: DependenciasDaFachada,
  papelMinimo: PapelMinimo,
  schema: ComEntrada,
  bruto: unknown,
  executar: (env: UseCaseEnv, entrada: TEntrada) => Promise<Result<TSaida>>,
  precisaDeProvider = false
): Promise<FacadeResult<TSaida>> {
  // 1–2. A FLAG, ANTES DE TUDO. Nenhum I/O acontece com billing desligado.
  if (!deps.flagLigada()) return recusaPadrao("billing_disabled");

  // 3–6. Sessão, organização, papel e comparação de tenant, no servidor.
  const autorizacao = await deps.autorizar(papelMinimo, tenantAfirmado(bruto));
  if (!autorizacao.ok) return traduzirNegacao<TSaida>(autorizacao);

  // 7. Validação, só depois de autorizado.
  const parsed = schema.safeParse(bruto);
  if (!parsed.success) return recusaPadrao("invalid_input");

  // 9. Provider só para quem precisa.
  //
  //    A validação (etapa 7) já processou a entrada, PII inclusive — e isso é
  //    correto: validar é o que impede um pedido malformado de chegar a
  //    qualquer lugar. A propriedade que importa é outra, e vale: nenhuma PII é
  //    ENVIADA ao provider antes de ele ser resolvido e validado, e nenhum
  //    provider é resolvido fora do checkout.
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
 * Catálogo de preços da versão vigente. MEMBRO.
 *
 * Preço de tabela não é dado do contrato: é a mesma informação que estará na
 * página pública de planos. Exigir proprietário aqui impediria a tela de
 * upgrade de sequer mostrar a comparação a quem vai pedir o upgrade ao dono.
 */
export function lerCatalogo(
  bruto: unknown,
  deps: DependenciasDaFachada = dependenciasDeProducao()
): Promise<FacadeResult<readonly CatalogPrice[]>> {
  return executarComando<{ organizationId?: string }, readonly CatalogPrice[]>(
    deps,
    "member",
    ConsultaSchema,
    bruto,
    (env, e) => readCatalogUseCase(env, { requestedOrganizationId: e.organizationId })
  );
}

/**
 * Estado da assinatura, cortesias e direito adquirido. PROPRIETÁRIO.
 *
 * Devolve `StoredSubscription` inteiro: CNPJ, contato financeiro, preço
 * praticado, faixa e identificador externo. É o dossiê comercial, e nada disso
 * é assunto de quem não administra a assinatura. Quem só precisa saber o que
 * pode usar chama `lerAcesso`.
 */
export function lerAssinatura(
  bruto: unknown,
  deps: DependenciasDaFachada = dependenciasDeProducao()
): Promise<FacadeResult<BillingState>> {
  return executarComando<{ organizationId?: string }, BillingState>(
    deps,
    "owner",
    ConsultaSchema,
    bruto,
    (env, e) => readSubscriptionState(env, { requestedOrganizationId: e.organizationId })
  );
}

/**
 * Decisão de acesso. MEMBRO.
 *
 * É a consulta que o enforcement de entitlements faz, e ele precisa de resposta
 * para todo usuário do tenant — não só para quem paga. `AccessDecision` carrega
 * direitos e o motivo deles; não carrega CNPJ, contato financeiro, preço nem
 * identificador externo. É essa propriedade da SAÍDA que autoriza a ampliação,
 * não o papel de quem chama.
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
    "member",
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
  >(deps, "owner", IniciarTrialSchema, bruto, (env, e) =>
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
    "owner",
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
    "owner",
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
    "owner",
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
  >(deps, "owner", EscolherPlanoSchema, bruto, (env, e) =>
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
  >(deps, "owner", UpgradeSchema, bruto, (env, e) =>
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
  >(deps, "owner", AgendarDowngradeSchema, bruto, (env, e) =>
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
    "owner",
    CancelarSchema,
    bruto,
    (env, e) => cancelAtPeriodEnd(env, { requestedOrganizationId: e.organizationId })
  );
}

// ─── Checkout ───────────────────────────────────────────────────────────────

/** O que `prepararIntencaoDeCheckout` devolve. Nada além do identificador. */
export interface IntencaoPreparada {
  readonly checkoutIntentId: string;
}

/**
 * Prepara uma INTENÇÃO de checkout e devolve o identificador opaco.
 *
 * ── POR QUE ISTO É UM COMANDO, E NÃO UM DETALHE DE `criarCheckout` ──────────
 *
 * Porque a diferença entre "tentei de novo porque a rede caiu" e "quero uma
 * cobrança nova" é uma DECISÃO de quem chama, e não algo que o servidor possa
 * inferir de relógio, de contador ou de estado. Torná-la um passo explícito é o
 * que permite ao retry técnico repetir o identificador e à nova tentativa
 * comercial pedir outro.
 *
 * Exige proprietário: preparar-se para cobrar é ato de quem contrata.
 *
 * Nenhum efeito e nenhum I/O de billing além da autorização — nem repositório,
 * nem provider. É um comando puro que devolve entropia com autorização na
 * frente, e por isso não passa por `executarComando`: não há caso de uso, não
 * há env a montar, e forçá-lo a existir só para caber no molde criaria um
 * repositório que ninguém usaria.
 */
export async function prepararIntencaoDeCheckout(
  bruto: unknown,
  deps: DependenciasDaFachada = dependenciasDeProducao()
): Promise<FacadeResult<IntencaoPreparada>> {
  // 1–2. A flag, antes de tudo — mesma primeira etapa dos demais comandos.
  if (!deps.flagLigada()) return recusaPadrao("billing_disabled");

  // 3–6. Sessão, organização, papel e comparação de tenant, no servidor.
  const autorizacao = await deps.autorizar("owner", tenantAfirmado(bruto));
  if (!autorizacao.ok) return traduzirNegacao<IntencaoPreparada>(autorizacao);

  // 7. Validação, depois da autorização.
  const parsed = PrepararIntencaoSchema.safeParse(bruto);
  if (!parsed.success) return recusaPadrao("invalid_input");

  return sucesso({ checkoutIntentId: deps.novaIntencao() });
}

/**
 * Cria o checkout sob uma intenção já preparada.
 *
 * ── UMA LEITURA, UM CASO DE USO ─────────────────────────────────────────────
 *
 * A versão anterior lia `readState` AQUI para descobrir o período, derivava a
 * chave dele, decidia `not_found` por conta própria e só então chamava
 * `createCheckout` — que lia o estado DE NOVO. Duas leituras independentes, um
 * TOCTOU entre derivar a chave e reservá-la, e a regra de domínio "sem
 * assinatura não há checkout" escrita em dois lugares.
 *
 * Agora a fachada não lê nada. A chave é derivada da INTENÇÃO dentro de
 * `createCheckout`, a partir de dados que não vêm do banco — o que faz a janela
 * de corrida desaparecer em vez de ser mitigada — e a única leitura de estado é
 * a que o caso de uso já fazia.
 */
export function criarCheckout(
  bruto: unknown,
  deps: DependenciasDaFachada = dependenciasDeProducao()
): Promise<FacadeResult<CheckoutResult>> {
  return executarComando<
    {
      organizationId?: string;
      checkoutIntentId: string;
      method: "pix" | "credit_card";
      customerName: string;
      customerEmail: string;
    },
    CheckoutResult
  >(
    deps,
    "owner",
    CriarCheckoutSchema,
    bruto,
    (env, e) =>
      createCheckout(env, {
        requestedOrganizationId: e.organizationId,
        method: e.method,
        customerName: e.customerName,
        customerEmail: e.customerEmail,
        checkoutIntentId: e.checkoutIntentId,
      }),
    true
  );
}

// ─── Superfície declarada ───────────────────────────────────────────────────

/**
 * Os treze comandos e o papel mínimo de cada um, nominalmente.
 *
 * Existe para que a guarda estrutural compare a superfície REAL com a
 * declarada, em vez de contar exports — e para que acrescentar um comando, ou
 * rebaixar o papel de um existente, sem revisar a matriz REPROVE.
 */
export const COMANDOS_DA_FACHADA = Object.freeze({
  lerCatalogo: "member",
  lerAcesso: "member",
  lerAssinatura: "owner",
  iniciarTrial: "owner",
  atualizarEmailFinanceiro: "owner",
  aceitarTermos: "owner",
  registrarTrabalhadores: "owner",
  escolherPlano: "owner",
  fazerUpgrade: "owner",
  agendarDowngrade: "owner",
  cancelarNoFimDoPeriodo: "owner",
  prepararIntencaoDeCheckout: "owner",
  criarCheckout: "owner",
} as const satisfies Record<string, PapelMinimo>);

/** A versão de termos que o servidor reconhece. Reexportada para a 12C.3. */
export { TERMS_VERSION, ORIGEM };
