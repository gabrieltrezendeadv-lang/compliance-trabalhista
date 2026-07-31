/**
 * CONTRATO — variante EM MEMÓRIA.
 *
 * Mesmas expectativas de `postgrest.spec.ts`, importadas do mesmo arquivo.
 * Se o dublê divergir do produto em qualquer ponto observável, uma das duas
 * execuções reprova.
 */

import { InMemoryBillingRepository } from "@/lib/billing/repositories/in-memory";
import type { CatalogPrice } from "@/lib/billing/core/repository";

import { definirContrato, type AmbienteDeContrato } from "./shared-expectations";

const AGORA = "2026-08-01T00:00:00.000Z";
const VERSAO = "2026-07-30.1";

const CATALOGO: readonly CatalogPrice[] = [
  {
    catalogVersion: VERSAO,
    plan: "essencial",
    tier: "t1_20",
    monthlyCents: 9_990,
    yearlyCents: 107_892,
  },
  {
    catalogVersion: VERSAO,
    plan: "completo",
    tier: "t1_20",
    monthlyCents: 24_990,
    yearlyCents: 269_892,
  },
];

const ORG_A = "org-contrato-a";
const ORG_B = "org-contrato-b";
const DONO_A = "user-contrato-dono-a";
const DONO_B = "user-contrato-dono-b";
const COLAB_A = "user-contrato-colab-a";

definirContrato({
  nome: "in-memory",

  async montar(): Promise<AmbienteDeContrato> {
    // Instância nova por caso: o isolamento entre casos é dado pelo próprio
    // ciclo de vida do objeto, sem estado compartilhado.
    const repo = new InMemoryBillingRepository({
      clock: { now: () => AGORA },
      catalog: CATALOGO,
      members: [
        { actorId: DONO_A, organizationId: ORG_A, role: "owner" },
        { actorId: DONO_B, organizationId: ORG_B, role: "owner" },
        { actorId: COLAB_A, organizationId: ORG_A, role: "collaborator" },
      ],
      env: { NODE_ENV: "test", VERCEL_ENV: "development" },
    });

    return {
      repo,
      donoA: DONO_A,
      orgA: ORG_A,
      donoB: DONO_B,
      orgB: ORG_B,
      colaboradorA: COLAB_A,
      orgFantasma: "org-que-nao-existe",
      agora: AGORA,
      catalogVersion: VERSAO,
    };
  },

  async limpar(): Promise<void> {
    // Nada a fazer: cada caso recebe uma instância própria, e ela morre com o
    // escopo. Declarado explicitamente para que a ausência de limpeza seja uma
    // decisão visível, e não um esquecimento.
  },
});
