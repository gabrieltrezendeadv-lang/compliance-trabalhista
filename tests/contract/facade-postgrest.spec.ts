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
 * ── O QUE FALTAVA AQUI, E QUE AGORA ESTÁ ────────────────────────────────────
 *
 * A primeira versão desta suíte cobria leitura, trial, IDOR e metadados — e
 * PULAVA o checkout, com a justificativa de que ele "depende do provider e fica
 * para a 12D". A justificativa não se sustentava: o checkout depende do
 * `BillingProviderMock`, que é código local sem rede. O que ficava sem prova
 * eram `claimIdempotency` e `finalizeCheckout` — as duas RPCs com lease,
 * takeover e conflito de fingerprint, isto é, as de maior consequência
 * financeira do conjunto inteiro.
 *
 * Agora o checkout roda aqui, ponta a ponta:
 *
 *   `SupabaseBillingRepository` real · PostgREST local · `BillingProviderMock`
 *   · stack descartável · zero rede externa · fixtures semeadas e derrubadas.
 *
 * A 12D continua reservada ao ADAPTADOR Asaas e ao sandbox externo. Ela não
 * empresta mais o nome para adiar a prova da fachada contra o repositório.
 *
 * ── O QUE CONTINUA INJETADO, E POR QUÊ ──────────────────────────────────────
 *
 * Sessão e papel: não há sessão HTTP num teste. Tudo o que vem DEPOIS é o
 * caminho de produção — mesmas RPCs, mesmo cliente supabase-js, mesma tradução.
 * O relógio também, porque provar lease exige avançar o tempo sem esperar cinco
 * minutos reais.
 *
 * A variante se auto-pula sem `BILLING_CONTRACT_URL`, e o CI a define. O passo
 * do CI reprova se a suíte for pulada lá.
 */

import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import type { BillingAuthResult } from "@/lib/billing/authorization";
import type { BillingRepository } from "@/lib/billing/core/repository";
import type { DependenciasDaFachada } from "@/lib/billing/facade/dependencias";
import {
  aceitarTermos,
  atualizarEmailFinanceiro,
  criarCheckout,
  escolherPlano,
  iniciarTrial,
  lerAcesso,
  lerAssinatura,
  lerCatalogo,
  prepararIntencaoDeCheckout,
} from "@/lib/billing/facade";
import { BillingProviderMock } from "@/lib/billing/providers/mock/deterministic";
import type { MockScenario } from "@/lib/billing/providers/mock/deterministic";
import { SupabaseBillingRepository } from "@/lib/billing/repositories/supabase";
import { TERMS_VERSION } from "@/lib/billing/terms";
import { chaveDeIdempotencia } from "@/lib/billing/usecases/shared";

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
const ULTIMO_PAR = 99;
let proximoPar = PRIMEIRO_PAR;

/**
 * Sequência GLOBAL dos identificadores externos do mock.
 *
 * ── POR QUE GLOBAL, E NÃO POR AMBIENTE ──────────────────────────────────────
 *
 * `billing.charges` tem `UNIQUE (provider, provider_account_id,
 * external_charge_id)` — unicidade GLOBAL, não por tenant. A 12B a alargou de
 * propósito: com escopo por organização, o mesmo identificador do mesmo
 * provider podia existir em dois tenants, e um evento seria aplicado ao tenant
 * errado.
 *
 * Um contador por ambiente fazia a organização A e a B receberem `chg_..._0001`
 * as duas, e o `finalize` da segunda batia na restrição. Não era defeito do
 * produto: era a restrição funcionando, e a fixture mentindo — um provider real
 * cunha identificadores únicos no mundo, não por cliente.
 */
let sequenciaExterna = 0;

const T0 = "2026-08-01T00:00:00.000Z";
/** A mesma política que o SQL declara: `interval '5 minutes'`. */
const LEASE_MS = 5 * 60_000;

const PAGADOR = { customerName: "Contrato Checkout", customerEmail: "pagador@contrato.test" };

function uuidDeFixture(tipo: "orgA" | "orgB" | "donoA" | "donoB" | "colabA", i: number): string {
  const sufixo = String(i).padStart(8, "0");
  const grupo = { orgA: "a001", orgB: "b001", donoA: "c001", donoB: "d001", colabA: "e001" }[tipo];
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
    readonly repo: BillingRepository;
    readonly provider: BillingProviderMock;
    readonly orgA: string;
    readonly orgB: string;
    readonly donoA: string;
    readonly colabA: string;
    /** Move o relógio injetado; é assim que a lease vence sem esperar. */
    avancar(ms: number): void;
    vezesProvider(): number;
    /** Chaves de idempotência que chegaram ao repositório, em ordem. */
    chavesUsadas(): readonly string[];
    /** Faz o PRÓXIMO `finalizeCheckout` falhar no transporte, uma só vez. */
    derrubarProximoFinalize(): void;
  }

  interface Opcoes {
    readonly flagLigada?: boolean;
    readonly autorizacao?: BillingAuthResult;
    readonly scenarios?: readonly MockScenario[];
    /** Usa o par de fixtures da organização B, para provar isolamento. */
    readonly comoOrgB?: boolean;
    /** Autoriza como COLABORADOR de A, com o papel real. */
    readonly comoMembro?: boolean;
    /** Compartilha o par de fixtures com outro ambiente já montado. */
    readonly mesmoPar?: number;
  }

  function montar(opcoes: Opcoes = {}): Ambiente & { par: number } {
    const i = opcoes.mesmoPar ?? proximoPar;
    if (opcoes.mesmoPar === undefined) proximoPar += 1;
    if (i > ULTIMO_PAR) {
      throw new Error(
        `a suíte da fachada esgotou os pares reservados (${PRIMEIRO_PAR}-${ULTIMO_PAR}); ` +
          "amplie o seed em vez de reciclar organização"
      );
    }

    const orgA = uuidDeFixture("orgA", i);
    const orgB = uuidDeFixture("orgB", i);
    const donoA = uuidDeFixture("donoA", i);
    const donoB = uuidDeFixture("donoB", i);
    const colabA = uuidDeFixture("colabA", i);

    const cliente = createClient(URL_BASE, CHAVE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let agora = T0;
    let nProvider = 0;
    let nIntencao = 0;
    const chaves: string[] = [];
    let derrubarFinalize = false;

    const repoReal = new SupabaseBillingRepository(cliente);

    /**
     * O repositório é REAL. O embrulho faz duas coisas, e nenhuma delas é
     * simular resposta do banco:
     *
     *   1. registra a chave que chegou ao `claim`/`finalize` — observação pura;
     *   2. quando armado, derruba UMA chamada de `finalizeCheckout` ANTES de
     *      ela sair, simulando a rede morrer entre o provider e o banco.
     *
     * O (2) é a única forma honesta de exercitar "o provider concluiu e o
     * finalize não chegou" sem desligar o PostgREST no meio do teste. O que se
     * observa depois — a reserva presa em `in_progress`, a retomada após a
     * lease, uma única cobrança — vem inteiramente do banco real.
     */
    const repo = new Proxy(repoReal, {
      get(alvo, prop, receiver) {
        const original = Reflect.get(alvo, prop, receiver);
        if (typeof original !== "function") return original;
        return (...args: unknown[]) => {
          if (
            (prop === "claimIdempotency" || prop === "finalizeCheckout") &&
            typeof args[0] === "object" &&
            args[0] !== null
          ) {
            const k = (args[0] as { key?: unknown; idempotencyKey?: unknown });
            const valor = typeof k.key === "string" ? k.key : k.idempotencyKey;
            if (typeof valor === "string") chaves.push(valor);
          }
          if (prop === "finalizeCheckout" && derrubarFinalize) {
            derrubarFinalize = false;
            // A MESMA forma que `SupabaseBillingRepository` produz quando o
            // transporte morre: `#chamar` embrulha a exceção em
            // `repository_unavailable`. Rejeitar a promessa seria simular algo
            // que o repositório real não faz, e o teste passaria a provar um
            // caminho inexistente.
            return Promise.resolve({
              ok: false,
              error: {
                code: "repository_unavailable" as const,
                message: "finalizar checkout: transporte indisponível",
              },
            });
          }
          return (original as (...a: unknown[]) => unknown).apply(alvo, args);
        };
      },
    }) as unknown as BillingRepository;

    const provider = new BillingProviderMock({
      ids: {
        // Único no mundo, como o de um provider de verdade.
        next: (p) => {
          sequenciaExterna += 1;
          return `${p}_${String(sequenciaExterna).padStart(6, "0")}`;
        },
      },
      scenarios: opcoes.scenarios,
      env: { NODE_ENV: "test", VERCEL_ENV: "development" },
    });

    const orgDoAmbiente = opcoes.comoOrgB ? orgB : orgA;
    const atorDoAmbiente = opcoes.comoOrgB ? donoB : opcoes.comoMembro ? colabA : donoA;

    const deps: DependenciasDaFachada = {
      flagLigada: () => opcoes.flagLigada ?? true,
      autorizar: async (papelMinimo, org) => {
        const base: BillingAuthResult =
          opcoes.autorizacao ?? {
            ok: true,
            principal: {
              userId: atorDoAmbiente,
              organizationId: orgDoAmbiente,
              role: opcoes.comoMembro ? "member" : "owner",
            },
          };
        if (base.ok && papelMinimo === "owner" && base.principal.role !== "owner") {
          return { ok: false, reason: "not_owner", message: "recusado" };
        }
        if (base.ok && org !== undefined && org !== base.principal.organizationId) {
          return { ok: false, reason: "not_owner", message: "recusado" };
        }
        return base;
      },
      repositorio: () => repo,
      provider: () => {
        nProvider += 1;
        return provider;
      },
      clock: { now: () => agora },
      ids: { next: (p) => `${p}_contrato_${i}` },
      providerAccountId: `conta-de-contrato-${i}`,
      novaIntencao: () => {
        nIntencao += 1;
        return `ci_${String(i).padStart(4, "0")}${String(nIntencao).padStart(28, "0")}`;
      },
    };

    return {
      par: i,
      deps,
      repo,
      provider,
      orgA,
      orgB,
      donoA,
      colabA,
      avancar: (ms) => {
        agora = new Date(Date.parse(agora) + ms).toISOString();
      },
      vezesProvider: () => nProvider,
      chavesUsadas: () => chaves,
      derrubarProximoFinalize: () => {
        derrubarFinalize = true;
      },
    };
  }

  const TRIAL = {
    plan: "essencial" as const,
    period: "monthly" as const,
    workerCount: 10,
    cnpj: "00000000000191",
    termsVersion: TERMS_VERSION,
  };

  /** Trial real, pelo caminho da fachada, contra o banco real. */
  async function comTrial(amb: Ambiente): Promise<void> {
    const r = await iniciarTrial(TRIAL, amb.deps);
    if (!r.ok) throw new Error(`trial não criado no contrato: ${r.error.code}`);
  }

  async function intencao(amb: Ambiente): Promise<string> {
    const r = await prepararIntencaoDeCheckout({}, amb.deps);
    if (!r.ok) throw new Error(`intenção não preparada: ${r.error.code}`);
    return r.value.checkoutIntentId;
  }

  /** Ator do ambiente, para as leituras de conferência direto no repositório. */
  async function ledgerDe(amb: Ambiente, ator: string, org: string) {
    const r = await amb.repo.readLedger(ator, org);
    if (!r.ok) throw new Error(`readLedger falhou: ${r.error.code}`);
    return r.value;
  }

  // ─── Leitura, autorização e metadados ────────────────────────────────────

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
      const r = await iniciarTrial({ ...TRIAL, billingEmail: "financeiro@empresa.com.br" }, amb.deps);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.termsVersion).toBe(TERMS_VERSION);
      expect(r.value.termsAcceptedAt).toBe(T0);
      expect(r.value.billingEmail).toBe("financeiro@empresa.com.br");
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
      await comTrial(amb);
      const invalido = "nao-e-email";
      const r = await atualizarEmailFinanceiro({ billingEmail: invalido }, amb.deps);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.message).not.toContain(invalido);
    });

    it("versão de termos divergente não chega ao banco", async () => {
      const amb = montar();
      await comTrial(amb);
      const r = await aceitarTermos({ termsVersion: "2020-01-01" }, amb.deps);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("invalid_input");
    });
  });

  // ─── Membro × proprietário, contra o banco real ──────────────────────────

  describe("fachada — papéis contra o PostgREST real", () => {
    it("MEMBRO comum obtém a decisão de acesso do tenant", async () => {
      const dono = montar();
      await comTrial(dono);

      // Mesmo par de fixtures, ator colaborador. É o caso real: quem contratou
      // foi o dono, e quem consulta o direito é o colaborador.
      const membro = montar({ comoMembro: true, mesmoPar: dono.par });
      const r = await lerAcesso({}, membro.deps);

      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.reason).toBe("trial_em_curso");
        // E nada do dossiê comercial atravessou.
        const texto = JSON.stringify(r.value);
        expect(texto).not.toContain("00000000000191");
        expect(texto).not.toContain("cnpj");
      }
    });

    it("MEMBRO comum lê o catálogo", async () => {
      const amb = montar({ comoMembro: true });
      const r = await lerCatalogo({}, amb.deps);
      expect(r.ok).toBe(true);
    });

    it("MEMBRO comum NÃO lê o dossiê nem escreve nada", async () => {
      const dono = montar();
      await comTrial(dono);
      const membro = montar({ comoMembro: true, mesmoPar: dono.par });

      const dossie = await lerAssinatura({}, membro.deps);
      expect(dossie.ok).toBe(false);
      if (!dossie.ok) expect(dossie.error.code).toBe("not_owner");

      const escrita = await escolherPlano({ plan: "completo", period: "monthly" }, membro.deps);
      expect(escrita.ok).toBe(false);
      if (!escrita.ok) expect(escrita.error.code).toBe("not_owner");

      const intencaoNegada = await prepararIntencaoDeCheckout({}, membro.deps);
      expect(intencaoNegada.ok).toBe(false);
    });
  });

  // ─── O checkout, ponta a ponta, contra o banco real ──────────────────────

  describe("fachada — checkout completo contra o PostgREST real", () => {
    it("aprovado: exatamente UMA cobrança, UM snapshot e auditoria", async () => {
      const amb = montar({ scenarios: ["pix_pending"] });
      await comTrial(amb);
      const i1 = await intencao(amb);

      const r = await criarCheckout({ checkoutIntentId: i1, method: "pix", ...PAGADOR }, amb.deps);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.replay).toBe(false);

      const ledger = await ledgerDe(amb, amb.donoA, amb.orgA);
      expect(ledger.charges).toHaveLength(1);
      expect(ledger.snapshots).toHaveLength(1);
      // A trilha registra a cobrança, e sob a chave DERIVADA — nunca a intenção.
      const daCobranca = ledger.auditEvents.filter((e) => e.subject === "charge");
      expect(daCobranca.length).toBeGreaterThanOrEqual(1);
      const esperada = chaveDeIdempotencia("checkout", amb.orgA, i1);
      expect(daCobranca.some((e) => e.idempotencyKey === esperada)).toBe(true);
      expect(JSON.stringify(ledger.auditEvents)).not.toContain(i1);
    });

    it("replay: mesma intenção e mesmo payload devolvem o MESMO resultado", async () => {
      const amb = montar({ scenarios: ["pix_pending"] });
      await comTrial(amb);
      const i1 = await intencao(amb);
      const pedido = { checkoutIntentId: i1, method: "pix" as const, ...PAGADOR };

      const primeira = await criarCheckout(pedido, amb.deps);
      const segunda = await criarCheckout(pedido, amb.deps);

      expect(primeira.ok).toBe(true);
      expect(segunda.ok).toBe(true);
      if (primeira.ok && segunda.ok) {
        expect(segunda.value.replay).toBe(true);
        expect(segunda.value.charge.id).toBe(primeira.value.charge.id);
        expect(segunda.value.charge.externalChargeId).toBe(primeira.value.charge.externalChargeId);
      }

      const ledger = await ledgerDe(amb, amb.donoA, amb.orgA);
      expect(ledger.charges).toHaveLength(1);
      // Uma única chave nas duas tentativas: nada foi sorteado no caminho.
      expect(new Set(amb.chavesUsadas()).size).toBe(1);
    });

    it("concluída: o provider NÃO é chamado de novo no replay", async () => {
      const amb = montar({ scenarios: ["pix_pending"] });
      await comTrial(amb);
      const i1 = await intencao(amb);
      const pedido = { checkoutIntentId: i1, method: "pix" as const, ...PAGADOR };

      await criarCheckout(pedido, amb.deps);
      const depoisDaPrimeira = amb.provider.chamadasDeCobranca.length;
      expect(depoisDaPrimeira).toBe(1);

      await criarCheckout(pedido, amb.deps);
      // O `claim` devolveu `completed`, e o caso de uso retornou ANTES do
      // provider. Sem isso, a segunda cobrança nasceria do lado de fora.
      expect(amb.provider.chamadasDeCobranca).toHaveLength(1);
    });

    it("MESMA intenção com payload DIFERENTE é conflito, e não cobrança nova", async () => {
      const amb = montar({ scenarios: ["pix_pending", "approve"] });
      await comTrial(amb);
      const i1 = await intencao(amb);

      const pix = await criarCheckout({ checkoutIntentId: i1, method: "pix", ...PAGADOR }, amb.deps);
      expect(pix.ok).toBe(true);

      const cartao = await criarCheckout(
        { checkoutIntentId: i1, method: "credit_card", ...PAGADOR },
        amb.deps
      );
      expect(cartao.ok).toBe(false);
      if (!cartao.ok) expect(cartao.error.code).toBe("conflict");

      const ledger = await ledgerDe(amb, amb.donoA, amb.orgA);
      expect(ledger.charges).toHaveLength(1);
      // O provider não foi tocado pelo pedido conflitante.
      expect(amb.provider.chamadasDeCobranca).toHaveLength(1);
    });

    it("NOVA intenção permite tentativa legítima: PIX e depois CARTÃO", async () => {
      const amb = montar({ scenarios: ["pix_pending", "approve"] });
      await comTrial(amb);

      const i1 = await intencao(amb);
      const pix = await criarCheckout({ checkoutIntentId: i1, method: "pix", ...PAGADOR }, amb.deps);
      expect(pix.ok).toBe(true);

      // A ação deliberada. Na versão anterior isto era `conflict` PARA SEMPRE,
      // porque a chave vinha do período e o período não muda dentro do ciclo.
      const i2 = await intencao(amb);
      expect(i2).not.toBe(i1);

      const cartao = await criarCheckout(
        { checkoutIntentId: i2, method: "credit_card", ...PAGADOR },
        amb.deps
      );
      expect(cartao.ok).toBe(true);
      if (cartao.ok && pix.ok) {
        expect(cartao.value.replay).toBe(false);
        expect(cartao.value.charge.id).not.toBe(pix.value.charge.id);
      }

      const ledger = await ledgerDe(amb, amb.donoA, amb.orgA);
      expect(ledger.charges).toHaveLength(2);
      expect(new Set(amb.chavesUsadas()).size).toBe(2);
    });

    it("recusa DETERMINÍSTICA marca `failed` e libera a repetição imediata", async () => {
      // A política de `payments.ts` divide as falhas em duas classes:
      //
      //   AMBÍGUA        (`provider_unavailable`, `provider_timeout`) — pode ter
      //                  criado o recurso. Fica `in_progress`, a lease governa.
      //   DETERMINÍSTICA (o provider disse "não") — nada existe do lado de fora.
      //                  Vira `failed`, e repetir o MESMO pedido é legítimo.
      //
      // Este é o ramo determinístico, e até agora ele não tinha prova alguma:
      // nenhum cenário do mock devolvia um código não-ambíguo.
      const amb = montar({ scenarios: ["rejected", "approve"] });
      await comTrial(amb);

      const i1 = await intencao(amb);
      const recusado = await criarCheckout(
        { checkoutIntentId: i1, method: "pix", ...PAGADOR },
        amb.deps
      );
      expect(recusado.ok).toBe(false);

      // Mesma intenção e MESMO pedido: repetir é legítimo, e o banco libera
      // porque `failed` significa que o efeito não aconteceu.
      const repetido = await criarCheckout(
        { checkoutIntentId: i1, method: "pix", ...PAGADOR },
        amb.deps
      );
      expect(repetido.ok).toBe(true);

      const ledger = await ledgerDe(amb, amb.donoA, amb.orgA);
      expect(ledger.charges).toHaveLength(1);
    });

    it("PIX recusado não impede nova intenção com CARTÃO", async () => {
      const amb = montar({ scenarios: ["rejected", "approve"] });
      await comTrial(amb);

      const i1 = await intencao(amb);
      const pix = await criarCheckout(
        { checkoutIntentId: i1, method: "pix", ...PAGADOR },
        amb.deps
      );
      expect(pix.ok).toBe(false);

      // O caso que a versão anterior tornava impossível PARA SEMPRE: recusado
      // no PIX, o proprietário troca de meio. Com a chave vinda do período, a
      // segunda tentativa batia em `fingerprint_conflict` e a organização
      // ficava sem forma de pagar até o ciclo virar.
      const i2 = await intencao(amb);
      const cartao = await criarCheckout(
        { checkoutIntentId: i2, method: "credit_card", ...PAGADOR },
        amb.deps
      );
      expect(cartao.ok).toBe(true);

      const ledger = await ledgerDe(amb, amb.donoA, amb.orgA);
      expect(ledger.charges).toHaveLength(1);
    });

    it("indisponibilidade AMBÍGUA preserva `in_progress` e não duplica", async () => {
      // O provider criou a cobrança e falhou ao responder. Marcar `failed`
      // seria mentira: o recurso externo EXISTE.
      const amb = montar({ scenarios: ["unavailable_after_persist"] });
      await comTrial(amb);
      const i1 = await intencao(amb);
      const pedido = { checkoutIntentId: i1, method: "pix" as const, ...PAGADOR };

      const ambigua = await criarCheckout(pedido, amb.deps);
      expect(ambigua.ok).toBe(false);
      if (!ambigua.ok) expect(ambigua.error.code).toBe("provider_unavailable");

      // Dentro da lease, a repetição é recusada e o provider NÃO é tocado.
      const cedo = await criarCheckout(pedido, amb.deps);
      expect(cedo.ok).toBe(false);
      if (!cedo.ok) expect(cedo.error.code).toBe("conflict");
      expect(amb.provider.chamadasDeCobranca).toHaveLength(1);

      const ledger = await ledgerDe(amb, amb.donoA, amb.orgA);
      expect(ledger.charges).toHaveLength(0);
    });

    it("retomada após a lease: MESMA intenção, MESMO recurso externo, UMA cobrança", async () => {
      const amb = montar({ scenarios: ["unavailable_after_persist"] });
      await comTrial(amb);
      const i1 = await intencao(amb);
      const pedido = { checkoutIntentId: i1, method: "pix" as const, ...PAGADOR };

      await criarCheckout(pedido, amb.deps);
      const externoPrimeiro = amb.provider.chamadasDeCobranca[0];

      amb.avancar(LEASE_MS);
      const retomado = await criarCheckout(pedido, amb.deps);
      expect(retomado.ok).toBe(true);

      // Duas apresentações ao provider, com a MESMA chave e o MESMO
      // fingerprint — é essa igualdade que recupera o recurso já criado.
      const chamadas = amb.provider.chamadasDeCobranca;
      expect(chamadas).toHaveLength(2);
      expect(chamadas[1].idempotencyKey).toBe(externoPrimeiro.idempotencyKey);
      expect(chamadas[1].fingerprint).toBe(externoPrimeiro.fingerprint);

      const ledger = await ledgerDe(amb, amb.donoA, amb.orgA);
      expect(ledger.charges).toHaveLength(1);
      expect(new Set(ledger.charges.map((c) => c.externalChargeId)).size).toBe(1);
    });

    it("falha no `finalizeCheckout` não duplica cobrança na retomada", async () => {
      const amb = montar({ scenarios: ["pix_pending"] });
      await comTrial(amb);
      const i1 = await intencao(amb);
      const pedido = { checkoutIntentId: i1, method: "pix" as const, ...PAGADOR };

      // O provider concluiu; o finalize não chegou ao banco.
      amb.derrubarProximoFinalize();
      const perdido = await criarCheckout(pedido, amb.deps);
      expect(perdido.ok).toBe(false);

      // Nada foi gravado, e a reserva ficou presa — deliberadamente.
      expect((await ledgerDe(amb, amb.donoA, amb.orgA)).charges).toHaveLength(0);

      amb.avancar(LEASE_MS);
      const retomado = await criarCheckout(pedido, amb.deps);
      expect(retomado.ok).toBe(true);

      const ledger = await ledgerDe(amb, amb.donoA, amb.orgA);
      expect(ledger.charges).toHaveLength(1);
      expect(amb.provider.chamadasDeCobranca).toHaveLength(2);
      expect(new Set(amb.provider.chamadasDeCobranca.map((c) => c.idempotencyKey)).size).toBe(1);
    });

    it("mudança de plano no meio não mistura conteúdo: conflita, e não cobra errado", async () => {
      const amb = montar({ scenarios: ["pix_pending", "approve"] });
      await comTrial(amb);
      const i1 = await intencao(amb);

      const primeira = await criarCheckout(
        { checkoutIntentId: i1, method: "pix", ...PAGADOR },
        amb.deps
      );
      expect(primeira.ok).toBe(true);

      // O pedido comercial muda embaixo da MESMA tentativa.
      const mudou = await escolherPlano({ plan: "completo", period: "monthly" }, amb.deps);
      expect(mudou.ok).toBe(true);

      const depois = await criarCheckout(
        { checkoutIntentId: i1, method: "pix", ...PAGADOR },
        amb.deps
      );
      expect(depois.ok).toBe(false);
      if (!depois.ok) expect(depois.error.code).toBe("conflict");

      // Uma cobrança, do valor do pedido original. Nenhuma mistura.
      const ledger = await ledgerDe(amb, amb.donoA, amb.orgA);
      expect(ledger.charges).toHaveLength(1);
      // E a chave continua a mesma: ela não depende do período nem do plano.
      expect(new Set(amb.chavesUsadas()).size).toBe(1);
    });

    it("isolamento: a mesma intenção em outra organização é outra reserva", async () => {
      const a = montar({ scenarios: ["pix_pending"] });
      await comTrial(a);
      const i1 = await intencao(a);
      const pedido = { checkoutIntentId: i1, method: "pix" as const, ...PAGADOR };
      const rA = await criarCheckout(pedido, a.deps);
      expect(rA.ok).toBe(true);

      // Mesma STRING de intenção, organização diferente. A chave deriva da
      // organização RESOLVIDA, então as reservas não se cruzam — e a restrição
      // `UNIQUE (organization_id, scope, provider, key)` confirma do lado do
      // banco.
      const b = montar({ scenarios: ["pix_pending"], comoOrgB: true, mesmoPar: a.par });
      await comTrial(b);
      const rB = await criarCheckout(pedido, b.deps);
      expect(rB.ok).toBe(true);
      if (rA.ok && rB.ok) {
        expect(rB.value.replay).toBe(false);
        expect(rB.value.charge.id).not.toBe(rA.value.charge.id);
        // E o identificador EXTERNO também difere. `charges_externo_unico` é
        // global (`provider, provider_account_id, external_charge_id`), e é
        // essa unicidade que impede um evento do provider de ser aplicado ao
        // tenant errado.
        expect(rB.value.charge.externalChargeId).not.toBe(rA.value.charge.externalChargeId);
      }

      expect(chaveDeIdempotencia("checkout", a.orgA, i1)).not.toBe(
        chaveDeIdempotencia("checkout", a.orgB, i1)
      );

      // Cada organização enxerga apenas a própria cobrança.
      expect((await ledgerDe(a, a.donoA, a.orgA)).charges).toHaveLength(1);
      const ledgerB = await b.repo.readLedger(uuidDeFixture("donoB", b.par), b.orgB);
      expect(ledgerB.ok).toBe(true);
      if (ledgerB.ok) expect(ledgerB.value.charges).toHaveLength(1);
    });

    it("IDOR no checkout: organização alheia recusa antes de provider e banco", async () => {
      const amb = montar({ scenarios: ["pix_pending"] });
      await comTrial(amb);
      const i1 = await intencao(amb);

      const r = await criarCheckout(
        { organizationId: amb.orgB, checkoutIntentId: i1, method: "pix", ...PAGADOR },
        amb.deps
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("not_owner");
      expect(amb.provider.chamadasDeCobranca).toHaveLength(0);
    });

    it("o chamador não escolhe chave, fingerprint nem cenário", async () => {
      const amb = montar({ scenarios: ["pix_pending"] });
      await comTrial(amb);
      const i1 = await intencao(amb);

      for (const extra of [
        { idempotencyKey: "escolhida" },
        { fingerprint: "forjado" },
        { scenario: "approve" },
        { amountCents: 1 },
      ]) {
        const r = await criarCheckout(
          { checkoutIntentId: i1, method: "pix", ...PAGADOR, ...extra },
          amb.deps
        );
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe("invalid_input");
      }
      expect(amb.provider.chamadasDeCobranca).toHaveLength(0);
    });
  });
}
