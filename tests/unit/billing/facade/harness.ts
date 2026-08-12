/**
 * BANCADA DA FACHADA — relógio, identificadores e fábricas OBSERVÁVEIS
 *
 * ── O QUE ESTA BANCADA MEDE, E QUE NENHUMA OUTRA MEDE ───────────────────────
 *
 * As dependências da fachada são FÁBRICAS (`repositorio()`, `provider()`), e
 * aqui elas ficam instrumentadas: cada teste pode perguntar quantas vezes cada
 * uma foi chamada. É assim que "billing desligado não consulta banco" deixa de
 * ser afirmação e vira medição — a diferença entre "não usou o repositório" e
 * "nem sequer o construiu".
 *
 * O provider também é uma fábrica: `providerFalhando()` simula provider não
 * configurado, e o contador prova que comandos de leitura nunca o pedem.
 */

import { InMemoryBillingRepository } from "@/lib/billing/repositories/in-memory";
import type { BillingAuthResult } from "@/lib/billing/authorization";
import type { Clock, IdGenerator } from "@/lib/billing/core/ports";
import type { BillingProviderPort } from "@/lib/billing/core/provider";
import type { BillingRepository, CatalogPrice } from "@/lib/billing/core/repository";
import type { DependenciasDaFachada } from "@/lib/billing/facade/dependencias";
import { BillingProviderMock } from "@/lib/billing/providers/mock/deterministic";
import type { MockScenario } from "@/lib/billing/providers/mock/deterministic";

export const ORG_A = "org-aaaa";
export const ORG_B = "org-bbbb";
export const DONO_A = "user-dono-a";
export const COLAB_A = "user-colab-a";
export const ORG_FANTASMA = "org-inexistente";
export const T0 = "2026-08-01T00:00:00.000Z";

export class RelogioDeTeste implements Clock {
  #agora: string;
  constructor(inicio: string = T0) {
    this.#agora = inicio;
  }
  now(): string {
    return this.#agora;
  }
  avancarDias(dias: number): void {
    this.#agora = new Date(Date.parse(this.#agora) + dias * 86_400_000).toISOString();
  }
}

export function idsDeTeste(semente = 0): IdGenerator {
  let n = semente;
  return {
    next(prefixo: string) {
      n += 1;
      return `${prefixo}_${String(n).padStart(6, "0")}`;
    },
  };
}

export const CATALOGO: readonly CatalogPrice[] = Object.freeze([
  Object.freeze({
    catalogVersion: "2026-07-30.1",
    plan: "essencial" as const,
    tier: "t1_20" as const,
    monthlyCents: 9990,
    yearlyCents: 99_900,
  }),
  Object.freeze({
    catalogVersion: "2026-07-30.1",
    plan: "completo" as const,
    tier: "t1_20" as const,
    monthlyCents: 24_990,
    yearlyCents: 249_900,
  }),
]);

const MEMBROS = Object.freeze([
  Object.freeze({ actorId: DONO_A, organizationId: ORG_A, role: "owner" as const }),
  Object.freeze({ actorId: COLAB_A, organizationId: ORG_A, role: "collaborator" as const }),
]);

export interface BancadaOptions {
  /** Flag da etapa 1. Padrão: ligada, para que os testes cheguem ao resto. */
  readonly flagLigada?: boolean;
  /** Resultado da autorização. Padrão: owner de A. */
  readonly autorizacao?: BillingAuthResult;
  /** Cenários do provider mock — injetados AQUI, nunca por entrada da fachada. */
  readonly scenarios?: readonly MockScenario[];
  /** Provider que falha ao ser construído (não configurado, proibido). */
  readonly providerFalha?: Error;
  readonly failAt?: ConstructorParameters<typeof InMemoryBillingRepository>[0]["failAt"];
  readonly inicio?: string;
}

export interface Bancada {
  readonly deps: DependenciasDaFachada;
  readonly repo: InMemoryBillingRepository;
  readonly relogio: RelogioDeTeste;
  /** Quantas vezes a fábrica de repositório foi chamada. */
  vezesRepositorio(): number;
  /** Quantas vezes a fábrica de provider foi chamada. */
  vezesProvider(): number;
  /** Quantas vezes a autorização foi consultada. */
  vezesAutorizacao(): number;
  /** O `organizationId` que a fachada entregou à autorização. */
  tenantsAfirmados(): readonly (string | undefined)[];
  /** Chamadas que o provider recebeu — zero em toda leitura. */
  chamadasDoProvider(): number;
  /** Chaves de idempotência que chegaram ao repositório, em ordem. */
  chavesUsadas(): readonly string[];
}

const AUTORIZACAO_PADRAO: BillingAuthResult = {
  ok: true,
  principal: { userId: DONO_A, organizationId: ORG_A, role: "owner" },
};

export function montarBancada(opcoes: BancadaOptions = {}): Bancada {
  const relogio = new RelogioDeTeste(opcoes.inicio ?? T0);
  const ambiente = { NODE_ENV: "test", VERCEL_ENV: "development" };

  const repo = new InMemoryBillingRepository({
    clock: relogio,
    catalog: CATALOGO,
    members: MEMBROS,
    failAt: opcoes.failAt,
    grandfatheringCutoff: null,
    env: ambiente,
  });

  let nRepo = 0;
  let nProvider = 0;
  let nAuth = 0;
  let nProviderChamado = 0;
  const tenants: (string | undefined)[] = [];
  const chaves: string[] = [];

  // O repositório é embrulhado para registrar as chaves de idempotência sem
  // alterar o dublê: a política de chave é da fachada, e é ela que se observa.
  const repoObservado = new Proxy(repo, {
    get(alvo, prop, receiver) {
      const original = Reflect.get(alvo, prop, receiver);
      if (typeof original !== "function") return original;
      return (...args: unknown[]) => {
        if (
          (prop === "claimIdempotency" || prop === "finalizeCheckout") &&
          typeof args[0] === "object" &&
          args[0] !== null
        ) {
          const k = (args[0] as { key?: unknown }).key;
          if (typeof k === "string") chaves.push(k);
        }
        return (original as (...a: unknown[]) => unknown).apply(alvo, args);
      };
    },
  }) as unknown as BillingRepository;

  const providerReal = new BillingProviderMock({
    ids: idsDeTeste(1000),
    scenarios: opcoes.scenarios,
    env: ambiente,
  });

  const providerObservado = new Proxy(providerReal, {
    get(alvo, prop, receiver) {
      const original = Reflect.get(alvo, prop, receiver);
      if (typeof original !== "function") return original;
      return (...args: unknown[]) => {
        nProviderChamado += 1;
        return (original as (...a: unknown[]) => unknown).apply(alvo, args);
      };
    },
  }) as unknown as BillingProviderPort;

  const deps: DependenciasDaFachada = {
    flagLigada: () => opcoes.flagLigada ?? true,
    autorizar: async (org) => {
      nAuth += 1;
      tenants.push(org);
      const base = opcoes.autorizacao ?? AUTORIZACAO_PADRAO;
      // A bancada reproduz a comparação de tenant que
      // `requireBillingOwnerFor` faz no servidor: identificador divergente é
      // recusa, e nunca "usa o do servidor".
      if (base.ok && org !== undefined && org !== base.principal.organizationId) {
        return { ok: false, reason: "not_owner", message: "recusado" };
      }
      return base;
    },
    repositorio: () => {
      nRepo += 1;
      return repoObservado;
    },
    provider: () => {
      nProvider += 1;
      if (opcoes.providerFalha) throw opcoes.providerFalha;
      return providerObservado;
    },
    clock: relogio,
    ids: idsDeTeste(),
    providerAccountId: "conta-de-teste",
  };

  return {
    deps,
    repo,
    relogio,
    vezesRepositorio: () => nRepo,
    vezesProvider: () => nProvider,
    vezesAutorizacao: () => nAuth,
    tenantsAfirmados: () => tenants,
    chamadasDoProvider: () => nProviderChamado,
    chavesUsadas: () => chaves,
  };
}

/** Trial pronto, para os comandos que exigem assinatura existente. */
export async function comTrial(b: Bancada): Promise<void> {
  const { iniciarTrial } = await import("@/lib/billing/facade");
  const r = await iniciarTrial(
    {
      plan: "essencial",
      period: "monthly",
      workerCount: 10,
      cnpj: "00000000000191",
      termsVersion: "2026-08-10",
    },
    b.deps
  );
  if (!r.ok) throw new Error(`comTrial falhou: ${r.error.code} ${r.error.message}`);
}
