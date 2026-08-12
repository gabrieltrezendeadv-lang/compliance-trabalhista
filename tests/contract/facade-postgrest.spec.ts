/**
 * A FACHADA CONTRA O POSTGREST REAL — Etapa 12C.2
 *
 * ── POR QUE ISTO EXISTE, SE JÁ HÁ O CONTRATO DO REPOSITÓRIO ─────────────────
 *
 * O contrato do repositório prova que `SupabaseBillingRepository` e o dublê
 * respondem igual. Ele NÃO prova que a fachada, montando o ambiente por conta
 * própria, chega ao banco de verdade — e foi exatamente esse buraco que deixou
 * passar, na 12B, um repositório que nunca havia executado.
 *
 * Aqui a fachada roda com o repositório REAL, contra o PostgREST da stack
 * descartável, com as fixtures que o CI semeia. Sessão e papel entram por
 * injeção porque não há sessão HTTP num teste — mas TUDO o que vem depois é o
 * caminho de produção: mesmas RPCs, mesmo cliente supabase-js, mesma tradução.
 *
 * A variante se auto-pula sem `BILLING_CONTRACT_URL`, e o CI a define. O passo
 * do CI reprova se a suíte for pulada lá.
 */

import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import type { BillingAuthResult } from "@/lib/billing/authorization";
import type { DependenciasDaFachada } from "@/lib/billing/facade/dependencias";
import {
  aceitarTermos,
  atualizarEmailFinanceiro,
  iniciarTrial,
  lerAssinatura,
  lerCatalogo,
} from "@/lib/billing/facade";
import { SupabaseBillingRepository } from "@/lib/billing/repositories/supabase";
import { TERMS_VERSION } from "@/lib/billing/terms";

const URL_BASE = process.env.BILLING_CONTRACT_URL ?? "";
const CHAVE = process.env.BILLING_CONTRACT_KEY ?? "";
const ATIVO = URL_BASE !== "" && CHAVE !== "";

/**
 * Faixa DISJUNTA da do contrato do repositório, que vai de 0 a 59.
 *
 * Compartilhar a faixa deixaria uma suíte alcançar a fixture da outra conforme
 * a ordem de execução — e a falha apareceria como dado inexplicado, e não como
 * colisão.
 */
const PRIMEIRO_PAR = 60;
let proximoPar = PRIMEIRO_PAR;

function uuidDeFixture(tipo: "orgA" | "orgB" | "donoA" | "colabA", i: number): string {
  const sufixo = String(i).padStart(8, "0");
  const grupo = { orgA: "a001", orgB: "b001", donoA: "c001", colabA: "e001" }[tipo];
  return `0c07a000-0000-4000-8000-${grupo}${sufixo}`;
}

function exigirLoopback(url: string): void {
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error(`BILLING_CONTRACT_URL aponta para ${host}; só loopback.`);
  }
}

if (!ATIVO) {
  describe("fachada — PostgREST real", () => {
    it.skip("PULADO: defina BILLING_CONTRACT_URL e BILLING_CONTRACT_KEY", () => {});
  });
} else {
  exigirLoopback(URL_BASE);

  interface Ambiente {
    readonly deps: DependenciasDaFachada;
    readonly orgA: string;
    readonly orgB: string;
    readonly donoA: string;
    vezesProvider(): number;
  }

  function montar(opcoes: { flagLigada?: boolean; autorizacao?: BillingAuthResult } = {}): Ambiente {
    const i = proximoPar;
    proximoPar += 1;
    if (proximoPar > 80) {
      throw new Error("a suíte da fachada esgotou os pares reservados (60-79)");
    }

    const orgA = uuidDeFixture("orgA", i);
    const orgB = uuidDeFixture("orgB", i);
    const donoA = uuidDeFixture("donoA", i);

    const cliente = createClient(URL_BASE, CHAVE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let nProvider = 0;
    const deps: DependenciasDaFachada = {
      flagLigada: () => opcoes.flagLigada ?? true,
      autorizar: async (org) => {
        const base: BillingAuthResult =
          opcoes.autorizacao ?? { ok: true, principal: { userId: donoA, organizationId: orgA, role: "owner" } };
        if (base.ok && org !== undefined && org !== base.principal.organizationId) {
          return { ok: false, reason: "not_owner", message: "recusado" };
        }
        return base;
      },
      repositorio: () => new SupabaseBillingRepository(cliente),
      provider: () => {
        nProvider += 1;
        throw new Error("nenhum caso desta suíte usa provider");
      },
      clock: { now: () => "2026-08-01T00:00:00.000Z" },
      ids: { next: (p) => `${p}_contrato` },
      providerAccountId: "conta-de-contrato",
    };

    return { deps, orgA, orgB, donoA, vezesProvider: () => nProvider };
  }

  describe("fachada — PostgREST real", () => {
    it("billing desligado não chega ao banco", async () => {
      const amb = montar({ flagLigada: false });
      const r = await lerAssinatura({}, amb.deps);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("billing_disabled");
    });

    it("lê o catálogo da versão vigente pelo caminho real", async () => {
      const amb = montar();
      const r = await lerCatalogo({}, amb.deps);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.length).toBeGreaterThan(0);
    });

    it("inicia trial e persiste versão oficial e instante do servidor", async () => {
      const amb = montar();
      const r = await iniciarTrial(
        {
          plan: "essencial",
          period: "monthly",
          workerCount: 10,
          cnpj: "00000000000191",
          termsVersion: TERMS_VERSION,
          billingEmail: "financeiro@empresa.com.br",
        },
        amb.deps
      );
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.termsVersion).toBe(TERMS_VERSION);
      expect(r.value.termsAcceptedAt).toBe("2026-08-01T00:00:00.000Z");
      expect(r.value.billingEmail).toBe("financeiro@empresa.com.br");
      // Nenhum comando desta suíte resolve provider.
      expect(amb.vezesProvider()).toBe(0);
    });

    it("IDOR: organização alheia é recusada antes do banco", async () => {
      const amb = montar();
      const r = await lerAssinatura({ organizationId: amb.orgB }, amb.deps);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("not_owner");
    });

    it("contato financeiro inválido é recusado sem vazar o endereço", async () => {
      const amb = montar();
      await iniciarTrial(
        {
          plan: "essencial",
          period: "monthly",
          workerCount: 10,
          cnpj: "00000000000191",
          termsVersion: TERMS_VERSION,
        },
        amb.deps
      );
      const invalido = "nao-e-email";
      const r = await atualizarEmailFinanceiro({ billingEmail: invalido }, amb.deps);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.message).not.toContain(invalido);
    });

    it("versão de termos divergente não chega ao banco", async () => {
      const amb = montar();
      await iniciarTrial(
        {
          plan: "essencial",
          period: "monthly",
          workerCount: 10,
          cnpj: "00000000000191",
          termsVersion: TERMS_VERSION,
        },
        amb.deps
      );
      const r = await aceitarTermos({ termsVersion: "2020-01-01" }, amb.deps);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("invalid_input");
    });
  });
}
