/**
 * BANCADA DOS CASOS DE USO — determinística por construção.
 *
 * ── NENHUMA ESPERA, NENHUMA REDE, NENHUM RELÓGIO DE VERDADE ─────────────────
 *
 * O tempo é um valor que o teste controla e avança explicitamente. Não há
 * `Date.now()`, não há UUID aleatório, não há `setTimeout`. A borda "último
 * milissegundo do trial" e a expiração da lease só são testáveis assim.
 *
 * ── A BANCADA NÃO ABRE ATALHO ───────────────────────────────────────────────
 *
 * A inspeção do que ficou persistido é feita pelas MESMAS operações públicas
 * que a aplicação usa — `readState` e `readLedger`. Nenhum `Map` interno é
 * alcançado, e nenhum método do contrato morto é ressuscitado "só para o
 * teste": um teste que enxerga mais do que o produto mede o dublê, não o
 * produto.
 */

import { BillingProviderMock } from "@/lib/billing/providers/mock/deterministic";
import { InMemoryBillingRepository } from "@/lib/billing/repositories/in-memory";
import type { MembroFixture } from "@/lib/billing/repositories/in-memory";
import type { CatalogPrice } from "@/lib/billing/core/repository";
import type { Clock, IdGenerator } from "@/lib/billing/core/ports";
import type { UseCaseEnv } from "@/lib/billing/usecases/shared";
import type { MockScenario } from "@/lib/billing/providers/mock/deterministic";

export const ORG_A = "org-aaaa";
export const ORG_B = "org-bbbb";
export const DONO_A = "user-dono-a";
export const DONO_B = "user-dono-b";
export const COLAB_A = "user-colab-a";
export const ORG_FANTASMA = "org-inexistente";

export const T0 = "2026-08-01T00:00:00.000Z";

/** Relógio controlável: o teste diz que horas são, e quando avançam. */
export class RelogioDeTeste implements Clock {
  #agora: string;

  constructor(inicio: string) {
    this.#agora = inicio;
  }

  now(): string {
    return this.#agora;
  }

  /** Avança o tempo sem esperar. Nenhum teste desta suíte dorme. */
  avancarMs(ms: number): void {
    this.#agora = new Date(Date.parse(this.#agora) + ms).toISOString();
  }

  avancarDias(dias: number): void {
    this.avancarMs(dias * 86_400_000);
  }

  fixarEm(instante: string): void {
    this.#agora = instante;
  }
}

/** Gerador por contador. Determinístico, não criptográfico. */
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
  {
    catalogVersion: "2026-07-30.1",
    plan: "essencial",
    tier: "t1_20",
    monthlyCents: 9_990,
    yearlyCents: 107_892,
  },
  {
    catalogVersion: "2026-07-30.1",
    plan: "completo",
    tier: "t1_20",
    monthlyCents: 24_990,
    yearlyCents: 269_892,
  },
]);

/** Membros padrão: dois donos em organizações distintas e um colaborador. */
export const MEMBROS: readonly MembroFixture[] = Object.freeze([
  { actorId: DONO_A, organizationId: ORG_A, role: "owner" },
  { actorId: DONO_B, organizationId: ORG_B, role: "owner" },
  { actorId: COLAB_A, organizationId: ORG_A, role: "collaborator" },
]);

export interface BancadaOptions {
  readonly inicio?: string;
  readonly actorId?: string;
  readonly organizationId?: string;
  readonly scenarios?: readonly MockScenario[];
  readonly failAt?: ConstructorParameters<typeof InMemoryBillingRepository>[0]["failAt"];
  readonly grandfatheringCutoff?: string | null;
  readonly members?: readonly MembroFixture[];
}

export interface Bancada {
  readonly env: UseCaseEnv;
  readonly relogio: RelogioDeTeste;
  readonly provider: BillingProviderMock;
  readonly repo: InMemoryBillingRepository;
  /** Quantas vezes o provider recebeu um pedido de cobrança. */
  chamadasDoProvider(): number;
  /** Quantas vezes ESTA chave chegou ao provider. */
  chamadasComChave(chave: string): number;
  /** Última entrada apresentada ao provider, para conferir chave/fingerprint. */
  ultimaChamada(): { idempotencyKey: string; fingerprint: string; amountCents: number } | null;
  /** Cobranças persistidas, lidas pela operação pública. */
  cobrancas(): Promise<
    ReadonlyArray<{ id: string; externalChargeId: string; status: string; amountCents: number }>
  >;
  /** Assinatura persistida, lida pela operação pública. */
  assinatura(): Promise<{ state: string; plan: string; tier: string } | null>;
  /** Quantos snapshots de preço existem, pela operação pública. */
  snapshots(): Promise<number>;
}

/**
 * Monta a bancada.
 *
 * `failAt` injeta indisponibilidade em pontos nominais do repositório — é assim
 * que "o `finalize` falhou" e "o `fail` falhou" são simulados, sem monkey-patch
 * e sem tocar nas entranhas do dublê.
 */
export function montarBancada(opcoes: BancadaOptions = {}): Bancada {
  const relogio = new RelogioDeTeste(opcoes.inicio ?? T0);
  const ids = idsDeTeste();

  // Ambiente injetado: a bancada nunca depende do `NODE_ENV` do processo.
  const env = { NODE_ENV: "test", VERCEL_ENV: "development" };

  const repo = new InMemoryBillingRepository({
    clock: relogio,
    catalog: CATALOGO,
    members: opcoes.members ?? MEMBROS,
    failAt: opcoes.failAt,
    grandfatheringCutoff: opcoes.grandfatheringCutoff ?? null,
    env,
  });

  const provider = new BillingProviderMock({
    ids,
    scenarios: opcoes.scenarios,
    env,
  });

  const useCaseEnv: UseCaseEnv = {
    clock: relogio,
    ids,
    repo,
    provider,
    auth: {
      userId: opcoes.actorId ?? DONO_A,
      organizationId: opcoes.organizationId ?? ORG_A,
      role: "owner",
    },
    providerAccountId: "acct-teste",
    correlationId: "corr-teste",
  };

  async function lerLedger() {
    const r = await repo.readLedger(useCaseEnv.auth.userId, useCaseEnv.auth.organizationId);
    if (!r.ok) throw new Error(`readLedger falhou: ${r.error.code}`);
    return r.value;
  }

  return {
    env: useCaseEnv,
    relogio,
    provider,
    repo,

    chamadasDoProvider: () => provider.chamadasDeCobranca.length,
    chamadasComChave: (chave) => provider.contagemPorChave(chave),

    ultimaChamada() {
      const todas = provider.chamadasDeCobranca;
      const ultima = todas[todas.length - 1];
      if (ultima === undefined) return null;
      return {
        idempotencyKey: ultima.idempotencyKey,
        fingerprint: ultima.fingerprint,
        amountCents: ultima.amountCents,
      };
    },

    async cobrancas() {
      const l = await lerLedger();
      return l.charges.map((c) => ({
        id: c.id,
        externalChargeId: c.externalChargeId,
        status: c.status,
        amountCents: c.amountCents,
      }));
    },

    async assinatura() {
      const r = await repo.readState(useCaseEnv.auth.userId, useCaseEnv.auth.organizationId);
      if (!r.ok) throw new Error(`readState falhou: ${r.error.code}`);
      const s = r.value.subscription;
      return s === null ? null : { state: s.state, plan: s.plan, tier: s.tier };
    },

    async snapshots() {
      const l = await lerLedger();
      return l.snapshots.length;
    },
  };
}
