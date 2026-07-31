/**
 * CONTRATO DO REPOSITÓRIO — expectativas COMPARTILHADAS
 *
 * ── POR QUE UM ARQUIVO SÓ ───────────────────────────────────────────────────
 *
 * Duas suítes parecidas em arquivos diferentes não provam paridade: provam que
 * duas pessoas escreveram testes parecidos. Aqui as expectativas são
 * LITERALMENTE as mesmas — `definirContrato` é chamada duas vezes, uma com o
 * dublê em memória e outra com `SupabaseBillingRepository` falando com o
 * PostgREST local.
 *
 * Se as duas implementações divergirem em qualquer ponto observável, uma das
 * duas execuções reprova.
 *
 * ── O QUE ESTE CONTRATO NÃO COBRE ───────────────────────────────────────────
 *
 * Concorrência real entre processos e transação do PostgreSQL. Nenhuma das
 * duas é observável por esta interface, e por isso continuam provadas por
 * `scripts/ci/assert-billing-concurrency.sh` e
 * `scripts/ci/assert-billing-orchestration.sql`.
 */

import { describe, expect, it } from "vitest";

import type {
  BillingRepository,
  ComandoContexto,
} from "@/lib/billing/core/repository";

export interface AmbienteDeContrato {
  readonly repo: BillingRepository;
  /** Dono da organização A. */
  readonly donoA: string;
  readonly orgA: string;
  /** Dono da organização B — usado para provar isolamento. */
  readonly donoB: string;
  readonly orgB: string;
  /** Membro de A que NÃO é dono. */
  readonly colaboradorA: string;
  /** Organização que não existe. */
  readonly orgFantasma: string;
  /** Instante base; cada caso deriva o seu a partir daqui. */
  readonly agora: string;
  readonly catalogVersion: string;
}

export interface ContratoOptions {
  readonly nome: string;
  /** Monta um ambiente limpo. Chamado uma vez por caso de teste. */
  readonly montar: () => Promise<AmbienteDeContrato>;
  /** Limpeza. Roda em `finally`, sempre, inclusive quando o caso falha. */
  readonly limpar: (amb: AmbienteDeContrato) => Promise<void>;
  /** Confere que nada sobrou. Roda ao final da suíte. */
  readonly conferirVazio?: () => Promise<void>;
}

const DIA = 86_400_000;

function ctx(amb: AmbienteDeContrato, org?: string): ComandoContexto {
  return {
    actorId: amb.donoA,
    organizationId: org ?? amb.orgA,
    correlationId: "corr-contrato",
  };
}

function maisDias(iso: string, dias: number): string {
  return new Date(Date.parse(iso) + dias * DIA).toISOString();
}

export function definirContrato(opcoes: ContratoOptions): void {
  describe(`contrato do repositório — ${opcoes.nome}`, () => {
    /** Executa um caso com montagem e limpeza garantidas. */
    async function comAmbiente(
      corpo: (amb: AmbienteDeContrato) => Promise<void>
    ): Promise<void> {
      const amb = await opcoes.montar();
      try {
        await corpo(amb);
      } finally {
        // `finally`: um caso que falha no meio não pode deixar fixture para
        // trás e contaminar o próximo.
        await opcoes.limpar(amb);
      }
    }

    async function comTrial(amb: AmbienteDeContrato, org?: string) {
      const r = await amb.repo.startTrial({
        ...ctx(amb, org),
        actorId: org === amb.orgB ? amb.donoB : amb.donoA,
        plan: "essencial",
        tier: "t1_20",
        period: "monthly",
        workerCount: 10,
        cnpj: "00000000000191",
        periodStart: amb.agora,
        periodEnd: maisDias(amb.agora, 30),
        trialEndsAt: maisDias(amb.agora, 7),
        amountCents: 9_990,
        catalogVersion: amb.catalogVersion,
      });
      expect(r.ok).toBe(true);
      return r;
    }

    // ── Autorização ───────────────────────────────────────────────────────

    it("recusa de tenant alheio e inexistente é INDISTINGUÍVEL", async () => {
      await comAmbiente(async (amb) => {
        const alheia = await amb.repo.readState(amb.donoA, amb.orgB);
        const inexistente = await amb.repo.readState(amb.donoA, amb.orgFantasma);

        expect(alheia.ok).toBe(false);
        expect(inexistente.ok).toBe(false);
        if (!alheia.ok && !inexistente.ok) {
          expect(alheia.error.code).toBe(inexistente.error.code);
          expect(alheia.error.message).toBe(inexistente.error.message);
        }
      });
    });

    it("membro não-dono não lê a trilha financeira", async () => {
      await comAmbiente(async (amb) => {
        const r = await amb.repo.readLedger(amb.colaboradorA, amb.orgA);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe("not_owner");
      });
    });

    it("membro não-dono lê o estado (consulta de entitlement)", async () => {
      await comAmbiente(async (amb) => {
        const r = await amb.repo.readState(amb.colaboradorA, amb.orgA);
        expect(r.ok).toBe(true);
      });
    });

    // ── Leitura ───────────────────────────────────────────────────────────

    it("catálogo é lido pela versão pedida", async () => {
      await comAmbiente(async (amb) => {
        const r = await amb.repo.readCatalog(amb.donoA, amb.orgA, amb.catalogVersion);
        expect(r.ok).toBe(true);
        if (r.ok) {
          expect(r.value.length).toBeGreaterThan(0);
          for (const linha of r.value) {
            expect(linha.catalogVersion).toBe(amb.catalogVersion);
          }
        }
      });
    });

    it("estado sem assinatura devolve nulo, não erro", async () => {
      await comAmbiente(async (amb) => {
        const r = await amb.repo.readState(amb.donoA, amb.orgA);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.value.subscription).toBeNull();
      });
    });

    // ── Ciclo de vida ─────────────────────────────────────────────────────

    it("trial persiste assinatura, snapshot e trilha numa operação", async () => {
      await comAmbiente(async (amb) => {
        await comTrial(amb);

        const estado = await amb.repo.readState(amb.donoA, amb.orgA);
        expect(estado.ok).toBe(true);
        if (estado.ok) {
          expect(estado.value.subscription?.state).toBe("trialing");
          expect(estado.value.subscription?.priceSnapshot.amountCents).toBe(9_990);
        }

        const ledger = await amb.repo.readLedger(amb.donoA, amb.orgA);
        expect(ledger.ok).toBe(true);
        if (ledger.ok) {
          expect(ledger.value.snapshots).toHaveLength(1);
          expect(ledger.value.auditEvents.length).toBeGreaterThanOrEqual(1);
        }
      });
    });

    it("segunda assinatura na mesma organização é recusada", async () => {
      await comAmbiente(async (amb) => {
        await comTrial(amb);
        const segunda = await amb.repo.startTrial({
          ...ctx(amb),
          plan: "completo",
          tier: "t1_20",
          period: "monthly",
          workerCount: 10,
          cnpj: "00000000000191",
          periodStart: amb.agora,
          periodEnd: maisDias(amb.agora, 30),
          trialEndsAt: maisDias(amb.agora, 7),
          amountCents: 24_990,
          catalogVersion: amb.catalogVersion,
        });
        expect(segunda.ok).toBe(false);
      });
    });

    it("mudança de plano grava snapshot novo e preserva o anterior", async () => {
      await comAmbiente(async (amb) => {
        await comTrial(amb);
        const r = await amb.repo.changePlan({
          ...ctx(amb),
          plan: "completo",
          tier: "t1_20",
          period: "monthly",
          state: "active",
          periodStart: null,
          periodEnd: null,
          amountCents: 24_990,
          catalogVersion: amb.catalogVersion,
          subject: "plan_change",
          reason: "upgrade",
          idempotencyKey: null,
          now: maisDias(amb.agora, 1),
        });
        expect(r.ok).toBe(true);

        const ledger = await amb.repo.readLedger(amb.donoA, amb.orgA);
        expect(ledger.ok).toBe(true);
        if (ledger.ok) {
          // Append-only: o snapshot antigo continua lá.
          expect(ledger.value.snapshots).toHaveLength(2);
          // Ordenação NUMÉRICA: `.sort()` sem comparador ordena como texto, e
          // "24990" viria antes de "9990".
          const valores = ledger.value.snapshots
            .map((s) => s.amountCents)
            .sort((a, b) => a - b);
          expect(valores).toEqual([9_990, 24_990]);
        }
      });
    });

    it("downgrade agendado, cancelamento e transição de estado persistem", async () => {
      await comAmbiente(async (amb) => {
        await comTrial(amb);

        const d = await amb.repo.scheduleDowngrade(
          ctx(amb), "essencial", "t1_20", "agendado", maisDias(amb.agora, 1)
        );
        expect(d.ok).toBe(true);
        if (d.ok) expect(d.value.scheduledDowngrade?.plan).toBe("essencial");

        const c = await amb.repo.cancelAtPeriodEnd(ctx(amb), "pedido", maisDias(amb.agora, 2));
        expect(c.ok).toBe(true);
        if (c.ok) expect(c.value.state).toBe("cancel_scheduled");

        const t = await amb.repo.transitionState(
          ctx(amb), "read_only", "scheduler", "rotina", maisDias(amb.agora, 3)
        );
        expect(t.ok).toBe(true);
        if (t.ok) expect(t.value.state).toBe("read_only");
      });
    });

    it("worker count é registrado sem mudar faixa", async () => {
      await comAmbiente(async (amb) => {
        await comTrial(amb);
        const r = await amb.repo.recordWorkerCount(ctx(amb), 40, maisDias(amb.agora, 1));
        expect(r.ok).toBe(true);
        if (r.ok) {
          expect(r.value.workerCount).toBe(40);
          expect(r.value.tier).toBe("t1_20");
        }
      });
    });

    // ── Idempotência ──────────────────────────────────────────────────────

    function reserva(amb: AmbienteDeContrato, chave: string, fp: string, quando?: string) {
      return {
        ...ctx(amb),
        scope: "command" as const,
        provider: "mock",
        key: chave,
        fingerprint: fp,
        now: quando ?? amb.agora,
      };
    }

    it("claim novo, replay em andamento e conflito de fingerprint", async () => {
      await comAmbiente(async (amb) => {
        await comTrial(amb);

        const um = await amb.repo.claimIdempotency(reserva(amb, "ck-1", "fp-a"));
        expect(um.ok && um.value.kind).toBe("claimed");

        const dois = await amb.repo.claimIdempotency(reserva(amb, "ck-1", "fp-a"));
        expect(dois.ok && dois.value.kind).toBe("in_progress");

        const outro = await amb.repo.claimIdempotency(reserva(amb, "ck-1", "fp-DIFERENTE"));
        expect(outro.ok && outro.value.kind).toBe("fingerprint_conflict");
      });
    });

    it("finalize grava cobrança e conclui a chave; replay devolve a mesma", async () => {
      await comAmbiente(async (amb) => {
        await comTrial(amb);
        await amb.repo.claimIdempotency(reserva(amb, "ck-2", "fp-b"));

        const fin = await amb.repo.finalizeCheckout({
          ...ctx(amb),
          provider: "mock",
          providerAccountId: "acct-1",
          externalCustomerId: "cus-1",
          externalChargeId: "chg-1",
          method: "pix",
          amountCents: 9_990,
          periodStart: amb.agora,
          periodEnd: maisDias(amb.agora, 30),
          idempotencyKey: "ck-2",
          fingerprint: "fp-b",
          now: amb.agora,
        });

        expect(fin.ok).toBe(true);
        if (!fin.ok || fin.value.kind !== "completed") throw new Error("finalize não concluiu");
        const idCobranca = fin.value.charge.id;
        expect(fin.value.charge.status).toBe("pending");

        // Replay pela reserva devolve o mesmo resultado.
        const replay = await amb.repo.claimIdempotency(reserva(amb, "ck-2", "fp-b"));
        expect(replay.ok && replay.value.kind).toBe("completed");
        if (replay.ok && replay.value.kind === "completed") {
          expect(replay.value.result.chargeId).toBe(idCobranca);
        }

        const ledger = await amb.repo.readLedger(amb.donoA, amb.orgA);
        expect(ledger.ok && ledger.value.charges).toHaveLength(1);
      });
    });

    it("fail marca a reserva SEM declarar resultado, e permite retomada", async () => {
      await comAmbiente(async (amb) => {
        await comTrial(amb);
        const r = reserva(amb, "ck-3", "fp-c");
        await amb.repo.claimIdempotency(r);

        const falhou = await amb.repo.failIdempotency(r, "provider_declined");
        expect(falhou.ok && falhou.value.kind).toBe("failed");

        const retomada = await amb.repo.claimIdempotency(r);
        expect(retomada.ok && retomada.value.kind).toBe("claimed");
      });
    });

    it("fail repetido é idempotente", async () => {
      await comAmbiente(async (amb) => {
        await comTrial(amb);
        const r = reserva(amb, "ck-4", "fp-d");
        await amb.repo.claimIdempotency(r);
        const um = await amb.repo.failIdempotency(r, "x");
        const dois = await amb.repo.failIdempotency(r, "x");
        expect(um.ok && um.value.kind).toBe("failed");
        expect(dois.ok && dois.value.kind).toBe("failed");
      });
    });

    // ── Evento do provider ────────────────────────────────────────────────

    /**
     * Identificador externo derivado da ORGANIZAÇÃO.
     *
     * ── POR QUE NÃO PODE SER CONSTANTE ────────────────────────────────────
     *
     * `customers_externo_unico` e `charges_externo_unico` são unicidades
     * GLOBAIS: `(provider, provider_account_id, external_*_id)`, sem
     * `organization_id`. É essa globalidade que permite resolver o tenant a
     * partir do identificador que o provider manda no webhook.
     *
     * Um identificador fixo entre casos significaria o MESMO cliente externo
     * pertencendo a duas organizações — exatamente o que a constraint proíbe,
     * e com razão. O dublê não pegava isso porque cada caso recebe uma
     * instância nova, e a unicidade global não tinha com o que colidir; o
     * banco compartilhado pegou. É a diferença que esta suíte existe para
     * expor.
     */
    function externoDe(prefixo: string, org: string): string {
      return `${prefixo}-${org.slice(-12)}`;
    }

    async function comCobranca(amb: AmbienteDeContrato, marca = "ev") {
      await comTrial(amb);
      await amb.repo.claimIdempotency(reserva(amb, "ck-ev", "fp-ev"));
      const fin = await amb.repo.finalizeCheckout({
        ...ctx(amb),
        provider: "mock",
        providerAccountId: "acct-1",
        externalCustomerId: externoDe("cus", amb.orgA),
        externalChargeId: externoDe(`chg-${marca}`, amb.orgA),
        method: "pix",
        amountCents: 9_990,
        periodStart: amb.agora,
        periodEnd: maisDias(amb.agora, 30),
        idempotencyKey: "ck-ev",
        fingerprint: "fp-ev",
        now: amb.agora,
      });
      if (!fin.ok) {
        throw new Error(`preparação falhou: ${fin.error.code} — ${fin.error.message}`);
      }
      if (fin.value.kind !== "completed") {
        throw new Error(`preparação falhou: finalize devolveu ${fin.value.kind}`);
      }
      return fin.value.charge;
    }

    it("evento aplica, resolve o tenant e não aceita repetição", async () => {
      await comAmbiente(async (amb) => {
        const cobranca = await comCobranca(amb);

        const aplicado = await amb.repo.applyProviderEvent({
          provider: "mock",
          providerAccountId: "acct-1",
          externalEventId: "ev-1",
          externalChargeId: cobranca.externalChargeId,
          eventType: "charge_paid",
          occurredAt: maisDias(amb.agora, 2),
          correlationId: "corr",
          now: maisDias(amb.agora, 2),
        });

        expect(aplicado.ok).toBe(true);
        if (aplicado.ok && aplicado.value.kind === "applied") {
          // O tenant veio da RESOLUÇÃO, não de entrada.
          expect(aplicado.value.organizationId).toBe(amb.orgA);
          expect(aplicado.value.charge.status).toBe("paid");
          expect(aplicado.value.subscription.state).toBe("active");
        } else {
          throw new Error("evento não foi aplicado");
        }

        const repetido = await amb.repo.applyProviderEvent({
          provider: "mock",
          providerAccountId: "acct-1",
          externalEventId: "ev-1",
          externalChargeId: cobranca.externalChargeId,
          eventType: "charge_paid",
          occurredAt: maisDias(amb.agora, 2),
          correlationId: "corr",
          now: maisDias(amb.agora, 3),
        });
        expect(repetido.ok && repetido.value.kind).toBe("duplicate");
      });
    });

    it("evento anterior ao período da cobrança é recusado", async () => {
      await comAmbiente(async (amb) => {
        const cobranca = await comCobranca(amb, "ord");

        const r = await amb.repo.applyProviderEvent({
          provider: "mock",
          providerAccountId: "acct-1",
          externalEventId: "ev-antigo",
          externalChargeId: cobranca.externalChargeId,
          eventType: "charge_paid",
          occurredAt: maisDias(amb.agora, -30),
          correlationId: "corr",
          now: amb.agora,
        });

        expect(r.ok && r.value.kind).toBe("out_of_order");
      });
    });

    it("cobrança desconhecida não é aplicada", async () => {
      await comAmbiente(async (amb) => {
        await comTrial(amb);
        const r = await amb.repo.applyProviderEvent({
          provider: "mock",
          providerAccountId: "acct-1",
          externalEventId: "ev-x",
          externalChargeId: "chg-nao-existe",
          eventType: "charge_paid",
          occurredAt: amb.agora,
          correlationId: "corr",
          now: amb.agora,
        });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe("not_found");
      });
    });

    it("transição inválida é recusada: cobrança paga não volta", async () => {
      await comAmbiente(async (amb) => {
        const cobranca = await comCobranca(amb, "tr");
        await amb.repo.applyProviderEvent({
          provider: "mock",
          providerAccountId: "acct-1",
          externalEventId: "ev-p",
          externalChargeId: cobranca.externalChargeId,
          eventType: "charge_paid",
          occurredAt: maisDias(amb.agora, 2),
          correlationId: "corr",
          now: maisDias(amb.agora, 2),
        });

        const segundo = await amb.repo.applyProviderEvent({
          provider: "mock",
          providerAccountId: "acct-1",
          externalEventId: "ev-f",
          externalChargeId: cobranca.externalChargeId,
          eventType: "charge_failed",
          occurredAt: maisDias(amb.agora, 3),
          correlationId: "corr",
          now: maisDias(amb.agora, 3),
        });

        expect(segundo.ok).toBe(false);
        if (!segundo.ok) expect(segundo.error.code).toBe("invalid_state");
      });
    });

    // ── Isolamento ────────────────────────────────────────────────────────

    it("a trilha de A não traz nada de B", async () => {
      await comAmbiente(async (amb) => {
        await comCobranca(amb, "a");
        await comTrial(amb, amb.orgB);

        const ledgerA = await amb.repo.readLedger(amb.donoA, amb.orgA);
        expect(ledgerA.ok).toBe(true);
        if (ledgerA.ok) {
          expect(ledgerA.value.charges).toHaveLength(1);
          for (const c of ledgerA.value.charges) {
            expect(c.organizationId).toBe(amb.orgA);
          }
          for (const e of ledgerA.value.auditEvents) {
            expect(e.organizationId).toBe(amb.orgA);
          }
        }

        const ledgerB = await amb.repo.readLedger(amb.donoB, amb.orgB);
        expect(ledgerB.ok).toBe(true);
        if (ledgerB.ok) expect(ledgerB.value.charges).toHaveLength(0);
      });
    });

    it("identificador externo é único GLOBALMENTE, não por tenant", async () => {
      await comAmbiente(async (amb) => {
        await comCobranca(amb, "dup");
        await comTrial(amb, amb.orgB);

        await amb.repo.claimIdempotency({
          ...ctx(amb, amb.orgB),
          actorId: amb.donoB,
          scope: "command",
          provider: "mock",
          key: "ck-b",
          fingerprint: "fp-b",
          now: amb.agora,
        });

        // MESMO identificador externo, OUTRA organização: recusado.
        const colisao = await amb.repo.finalizeCheckout({
          ...ctx(amb, amb.orgB),
          actorId: amb.donoB,
          provider: "mock",
          providerAccountId: "acct-1",
          externalCustomerId: externoDe("cus", amb.orgB),
          // MESMO identificador de cobrança da organização A: é esta colisão,
          // e só ela, que o caso quer provar.
          externalChargeId: externoDe("chg-dup", amb.orgA),
          method: "pix",
          amountCents: 9_990,
          periodStart: amb.agora,
          periodEnd: maisDias(amb.agora, 30),
          idempotencyKey: "ck-b",
          fingerprint: "fp-b",
          now: amb.agora,
        });

        expect(colisao.ok).toBe(false);
        if (!colisao.ok) expect(colisao.error.code).toBe("conflict");
      });
    });

    // ── Cortesia e direito adquirido ──────────────────────────────────────

    it("cortesia é concedida, revogada append-only e revogação repetida é idempotente", async () => {
      await comAmbiente(async (amb) => {
        const c = await amb.repo.grantCourtesy(
          ctx(amb), "completo", amb.agora, maisDias(amb.agora, 30), "piloto"
        );
        expect(c.ok).toBe(true);
        if (!c.ok) return;

        const um = await amb.repo.revokeCourtesy(
          ctx(amb), c.value.id, maisDias(amb.agora, 5), "fim"
        );
        expect(um.ok && um.value.kind).toBe("revoked");

        const dois = await amb.repo.revokeCourtesy(
          ctx(amb), c.value.id, maisDias(amb.agora, 6), "de novo"
        );
        expect(dois.ok && dois.value.kind).toBe("already_revoked");

        // A concessão original permanece, agora com data de revogação.
        const estado = await amb.repo.readState(amb.donoA, amb.orgA);
        expect(estado.ok).toBe(true);
        if (estado.ok) {
          expect(estado.value.courtesies).toHaveLength(1);
          expect(estado.value.courtesies[0].revokedAt).not.toBeNull();
          expect(estado.value.courtesies[0].grantedBy).toBe(amb.donoA);
        }
      });
    });

    it("cortesia de outra organização não é revogável", async () => {
      await comAmbiente(async (amb) => {
        const c = await amb.repo.grantCourtesy(
          ctx(amb), "completo", amb.agora, maisDias(amb.agora, 30), "piloto"
        );
        expect(c.ok).toBe(true);
        if (!c.ok) return;

        const r = await amb.repo.revokeCourtesy(
          { actorId: amb.donoB, organizationId: amb.orgB, correlationId: "corr" },
          c.value.id,
          amb.agora,
          "alheia"
        );
        expect(r.ok).toBe(false);
      });
    });

    it("direito adquirido é por organização e idempotente", async () => {
      await comAmbiente(async (amb) => {
        const um = await amb.repo.saveGrandfathering(
          ctx(amb), maisDias(amb.agora, -365), amb.agora
        );
        expect(um.ok && um.value.kind).toBe("granted");

        const dois = await amb.repo.saveGrandfathering(
          ctx(amb), maisDias(amb.agora, -365), amb.agora
        );
        expect(dois.ok && dois.value.kind).toBe("already_granted");

        const estado = await amb.repo.readState(amb.donoA, amb.orgA);
        expect(estado.ok).toBe(true);
        if (estado.ok) {
          expect(estado.value.grandfathering?.organizationId).toBe(amb.orgA);
        }

        // E B não herda nada.
        const estadoB = await amb.repo.readState(amb.donoB, amb.orgB);
        expect(estadoB.ok).toBe(true);
        if (estadoB.ok) expect(estadoB.value.grandfathering).toBeNull();
      });
    });

    // ── Limpeza ───────────────────────────────────────────────────────────

    if (opcoes.conferirVazio) {
      it("nenhuma fixture sobreviveu à suíte", async () => {
        await opcoes.conferirVazio!();
      });
    }
  });
}
