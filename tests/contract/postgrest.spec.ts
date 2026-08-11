/**
 * CONTRATO — variante POSTGREST REAL.
 *
 * As MESMAS expectativas de `in-memory.spec.ts`, importadas do mesmo arquivo,
 * executadas contra `SupabaseBillingRepository` falando com o PostgREST da
 * stack descartável — pelo mesmo cliente `supabase-js` que a aplicação usa.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE ─────────────────────────────────────────────
 *
 * A revisão final encontrou um repositório que NUNCA havia executado: ele
 * endereçava `billing` por `Accept-Profile`, o PostgREST recusava com PGRST106,
 * e nenhum teste percebia porque nenhum teste o instanciava. Este arquivo é a
 * correção estrutural desse buraco — daqui em diante, o caminho real é
 * exercitado ou o CI fica vermelho.
 *
 * ── COMO É ATIVADO ──────────────────────────────────────────────────────────
 *
 * Só roda quando `BILLING_CONTRACT_URL` e `BILLING_CONTRACT_KEY` existem, e é o
 * CI quem as define, apontando para a stack local. Fora disso a suíte se pula
 * — e diz por quê, para que a ausência não seja confundida com aprovação.
 *
 * ── FIXTURES ────────────────────────────────────────────────────────────────
 *
 * `organizations`, `profiles`, `auth.users` e `organization_members` não têm
 * RPC de billing, e não devem ter: criar uma RPC pública de escrita nessas
 * tabelas só para o teste abriria superfície que a aplicação não precisa.
 *
 * Elas são semeadas por `scripts/ci/seed-contract-fixtures.sql` como
 * proprietário, e removidas por `scripts/ci/teardown-contract-fixtures.sql`,
 * ambos executados pelo CI contra o descartável. Cada caso consome um PAR de
 * organizações novo, então não há interferência entre casos e não é preciso
 * limpar no meio.
 */

import { createClient } from "@supabase/supabase-js";
import { describe, it } from "vitest";

import { SupabaseBillingRepository } from "@/lib/billing/repositories/supabase";

import { definirContrato, type AmbienteDeContrato } from "./shared-expectations";

const URL_BASE = process.env.BILLING_CONTRACT_URL ?? "";
const CHAVE = process.env.BILLING_CONTRACT_KEY ?? "";
const ATIVO = URL_BASE !== "" && CHAVE !== "";

const AGORA = "2026-08-01T00:00:00.000Z";
const VERSAO = "2026-07-30.1";

/**
 * Guarda de destino.
 *
 * O setup `loopback-only.ts` já bloqueia a conexão, mas falhar AQUI dá uma
 * mensagem específica e falha antes de qualquer tentativa.
 */
function exigirLoopback(url: string): void {
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error(
      `BILLING_CONTRACT_URL aponta para ${host}. ` +
        "O contrato só roda contra a stack descartável local."
    );
  }
}

/**
 * Pares de organização semeados pelo CI.
 *
 * UUIDs determinísticos: o mesmo par sempre tem o mesmo identificador, o que
 * torna a falha reproduzível e a limpeza conferível.
 */
const PARES = 60;
let proximoPar = 0;

function uuidDeFixture(tipo: "orgA" | "orgB" | "donoA" | "donoB" | "colabA", i: number): string {
  const sufixo = String(i).padStart(8, "0");
  const grupo = { orgA: "a001", orgB: "b001", donoA: "c001", donoB: "d001", colabA: "e001" }[tipo];
  return `0c07a000-0000-4000-8000-${grupo}${sufixo}`;
}

if (!ATIVO) {
  describe("contrato do repositório — PostgREST real", () => {
    it.skip(
      "PULADO: defina BILLING_CONTRACT_URL e BILLING_CONTRACT_KEY (a stack descartável do CI faz isso)",
      () => {}
    );
  });
} else {
  exigirLoopback(URL_BASE);

  definirContrato({
    nome: "PostgREST real",

    async montar(): Promise<AmbienteDeContrato> {
      const i = proximoPar;
      proximoPar += 1;
      if (proximoPar > PARES) {
        throw new Error(
          `A suíte consumiu mais de ${PARES} pares de organização. ` +
            "Aumente o seed em scripts/ci/seed-contract-fixtures.sql."
        );
      }

      // O MESMO cliente que a aplicação usa. Nenhum atalho, nenhuma conexão
      // direta: se o PostgREST recusar, o teste reprova — que é exatamente o
      // que faltava antes.
      const cliente = createClient(URL_BASE, CHAVE, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      return {
        repo: new SupabaseBillingRepository(cliente),
        donoA: uuidDeFixture("donoA", i),
        orgA: uuidDeFixture("orgA", i),
        donoB: uuidDeFixture("donoB", i),
        orgB: uuidDeFixture("orgB", i),
        colaboradorA: uuidDeFixture("colabA", i),
        // Existe no formato, não existe no banco.
        orgFantasma: "0c07a000-0000-4000-8000-ffff99999999",
        agora: AGORA,
        catalogVersion: VERSAO,
      };
    },

    async limpar(): Promise<void> {
      // Cada caso usa um par NOVO, então não há o que limpar entre casos. A
      // remoção total e a conferência de vazio são feitas pelo CI com psql,
      // como proprietário — o teste não recebe permissão de apagar nada, e não
      // deve receber.
    },
  });
}
