/**
 * BANCADA DOS CASOS DE USO — determinística por construção.
 *
 * Relógio e gerador de identificador são injetados; nenhum teste depende do
 * instante em que roda. O relógio é AVANÇÁVEL, e é isso que permite fixar as
 * bordas exatas — o milissegundo antes e o milissegundo depois de cada
 * vencimento.
 */

import { InMemoryBillingRepository, type InMemoryOptions } from "@/lib/billing/repositories/in-memory";
import { BillingProviderMock, type MockScenario } from "@/lib/billing/providers/mock/deterministic";
import { sequentialIds } from "@/lib/billing/core/ports";
import type { BillingActionOrigin, BillingAuthContext, Clock } from "@/lib/billing/core/ports";
import type { UseCaseEnv } from "@/lib/billing/usecases/shared";

export const ORG_A = "aaaaaaaa-0000-4000-8000-00000000000a";
export const ORG_B = "bbbbbbbb-0000-4000-8000-00000000000b";
export const OWNER_A = "aaaaaaaa-1111-4000-8000-000000000004";
export const OWNER_B = "bbbbbbbb-1111-4000-8000-000000000004";

export const T0 = "2026-08-01T00:00:00.000Z";

/** Relógio controlável. `set` move o instante; nada avança sozinho. */
export function relogioControlavel(inicial = T0) {
  let agora = inicial;
  const clock: Clock = { now: () => agora };
  return {
    clock,
    set(novo: string) {
      agora = novo;
    },
    avancarDias(dias: number) {
      agora = new Date(Date.parse(agora) + dias * 86_400_000).toISOString();
    },
    avancarMs(ms: number) {
      agora = new Date(Date.parse(agora) + ms).toISOString();
    },
  };
}

export interface BancadaOptions {
  readonly organizationId?: string;
  readonly userId?: string;
  readonly origin?: BillingActionOrigin;
  readonly scenarios?: readonly MockScenario[];
  readonly repo?: InMemoryOptions;
  readonly agora?: string;
}

export function bancada(options: BancadaOptions = {}) {
  const tempo = relogioControlavel(options.agora ?? T0);
  const ids = sequentialIds();

  const repo = new InMemoryBillingRepository({
    // Ambiente injetado: a bancada nunca depende do `NODE_ENV` do processo.
    env: { NODE_ENV: "test", VERCEL_ENV: "development" },
    ...options.repo,
  });

  const provider = new BillingProviderMock({
    ids,
    scenarios: options.scenarios,
    env: { NODE_ENV: "test", VERCEL_ENV: "development" },
  });

  const auth: BillingAuthContext = {
    userId: options.userId ?? OWNER_A,
    organizationId: options.organizationId ?? ORG_A,
    role: "owner",
  };

  const env: UseCaseEnv = {
    clock: tempo.clock,
    ids,
    repo,
    provider,
    auth,
    origin: options.origin ?? "owner",
    correlationId: "corr_teste",
  };

  return { env, repo, provider, tempo, ids, auth };
}

/** Extrai o valor, falhando o teste com a mensagem do erro se não houver. */
export function valor<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw new Error(`esperado sucesso, veio erro: ${r.error.message}`);
  return r.value;
}

/** Extrai o código de erro, falhando se a operação tiver dado certo. */
export function erro(r: { ok: true } | { ok: false; error: { code: string } }): string {
  if (r.ok) throw new Error("esperado erro, veio sucesso");
  return r.error.code;
}
