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

import { fixedClock, sequentialIds } from "@/lib/billing/core/ports";
import type {
  BillingRepository,
  ComandoContexto,
} from "@/lib/billing/core/repository";
import { BillingProviderMock } from "@/lib/billing/providers/mock/deterministic";
import { createCheckout } from "@/lib/billing/usecases/payments";
import type { UseCaseEnv } from "@/lib/billing/usecases/shared";

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
        billingEmail: null,
        termsVersion: "2026-08-10",
        termsAcceptedAt: amb.agora,
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
          billingEmail: null,
          termsVersion: "2026-08-10",
          termsAcceptedAt: amb.agora,
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

    // ── LEASE ─────────────────────────────────────────────────────────────
    //
    // ── POR QUE ESTE BLOCO EXISTE ─────────────────────────────────────────
    //
    // A lease existia no dublê e NÃO existia no SQL: `fn_billing_claim_
    // idempotency` devolvia `in_progress` sem olhar `started_at`, de modo que
    // uma reserva abandonada travava a chave para sempre contra o banco real.
    // As duas variantes passavam 23/23 porque nenhuma expectativa daqui
    // exercitava a propriedade. Uma divergência que o contrato não cobra é uma
    // divergência que o contrato não impede.
    //
    // O relógio é EXPLÍCITO: `now` é entrada de `claimIdempotency` nas duas
    // implementações, e por isso os cinco minutos passam sem espera real —
    // inclusive contra o PostgREST.
    //
    // Os cinco minutos são reafirmados aqui, não importados. Um teste que
    // importasse a constante passaria mesmo se a política mudasse.
    const LEASE_MS = 5 * 60_000;

    function emT(amb: AmbienteDeContrato, ms: number): string {
      return new Date(Date.parse(amb.agora) + ms).toISOString();
    }

    it("1-2: claim inicial reserva; nova tentativa antes de 5min é recusada", async () => {
      await comAmbiente(async (amb) => {
        await comTrial(amb);
        const inicial = await amb.repo.claimIdempotency(reserva(amb, "lease-1", "fp"));
        expect(inicial.ok && inicial.value.kind).toBe("claimed");

        const cedo = await amb.repo.claimIdempotency(
          reserva(amb, "lease-1", "fp", emT(amb, 60_000))
        );
        expect(cedo.ok && cedo.value.kind).toBe("in_progress");
      });
    });

    it("3: em T+4m59s a lease ainda vale — `in_progress`", async () => {
      await comAmbiente(async (amb) => {
        await comTrial(amb);
        await amb.repo.claimIdempotency(reserva(amb, "lease-2", "fp"));

        const quase = await amb.repo.claimIdempotency(
          reserva(amb, "lease-2", "fp", emT(amb, LEASE_MS - 1_000))
        );
        expect(quase.ok && quase.value.kind).toBe("in_progress");
      });
    });

    it("4: em T+5m EXATOS a lease já venceu — `claimed`", async () => {
      // A borda é `now >= startedAt + 5min`. No limite exato a lease venceu.
      // Se alguma das duas implementações usasse `>`, este caso separaria.
      await comAmbiente(async (amb) => {
        await comTrial(amb);
        await amb.repo.claimIdempotency(reserva(amb, "lease-3", "fp"));

        const limite = await amb.repo.claimIdempotency(
          reserva(amb, "lease-3", "fp", emT(amb, LEASE_MS))
        );
        expect(limite.ok && limite.value.kind).toBe("claimed");
      });
    });

    it("5: depois de 5min a lease venceu — `claimed`", async () => {
      await comAmbiente(async (amb) => {
        await comTrial(amb);
        await amb.repo.claimIdempotency(reserva(amb, "lease-4", "fp"));

        const depois = await amb.repo.claimIdempotency(
          reserva(amb, "lease-4", "fp", emT(amb, LEASE_MS + 60_000))
        );
        expect(depois.ok && depois.value.kind).toBe("claimed");
      });
    });

    it("6-7: fingerprint diferente conflita ANTES e DEPOIS de expirar", async () => {
      // Expirar a lease libera a retomada do MESMO pedido. Nunca de outro:
      // devolver a reserva a um pedido diferente faria o primeiro sumir.
      await comAmbiente(async (amb) => {
        await comTrial(amb);
        await amb.repo.claimIdempotency(reserva(amb, "lease-5", "fp-original"));

        const antes = await amb.repo.claimIdempotency(
          reserva(amb, "lease-5", "fp-OUTRO", emT(amb, 60_000))
        );
        expect(antes.ok && antes.value.kind).toBe("fingerprint_conflict");

        const depois = await amb.repo.claimIdempotency(
          reserva(amb, "lease-5", "fp-OUTRO", emT(amb, LEASE_MS + 60_000))
        );
        expect(depois.ok && depois.value.kind).toBe("fingerprint_conflict");
      });
    });

    it("8: `completed` nunca é retomado, por mais que a lease tenha vencido", async () => {
      await comAmbiente(async (amb) => {
        await comTrial(amb);
        await amb.repo.claimIdempotency(reserva(amb, "lease-6", "fp"));

        const fin = await amb.repo.finalizeCheckout({
          ...ctx(amb),
          provider: "mock",
          providerAccountId: "acct-1",
          externalCustomerId: externoDe("cus-lease", amb.orgA),
          externalChargeId: externoDe("chg-lease", amb.orgA),
          method: "pix",
          amountCents: 9_990,
          periodStart: amb.agora,
          periodEnd: maisDias(amb.agora, 30),
          idempotencyKey: "lease-6",
          fingerprint: "fp",
          now: amb.agora,
        });
        expect(fin.ok).toBe(true);

        const muitoDepois = await amb.repo.claimIdempotency(
          reserva(amb, "lease-6", "fp", emT(amb, LEASE_MS * 10))
        );
        expect(muitoDepois.ok && muitoDepois.value.kind).toBe("completed");
      });
    });

    it("9: `failed` é retomável NO MESMO INSTANTE, sem esperar a lease", async () => {
      await comAmbiente(async (amb) => {
        await comTrial(amb);
        const r = reserva(amb, "lease-7", "fp");
        await amb.repo.claimIdempotency(r);
        await amb.repo.failIdempotency(r, "provider_declined");

        const imediata = await amb.repo.claimIdempotency(r);
        expect(imediata.ok && imediata.value.kind).toBe("claimed");
      });
    });

    it("10: o takeover reinicia `started_at` — a nova lease conta do zero", async () => {
      // `started_at` não é observável pela interface, então a prova é
      // comportamental: depois do takeover em T+5m, uma tentativa em
      // T+9m59s tem de ser recusada. Ela está 4m59s DEPOIS do takeover, mas
      // 9m59s depois do claim original — se `started_at` não tivesse sido
      // atualizado, esta chamada devolveria `claimed`.
      await comAmbiente(async (amb) => {
        await comTrial(amb);
        await amb.repo.claimIdempotency(reserva(amb, "lease-8", "fp"));

        const takeover = await amb.repo.claimIdempotency(
          reserva(amb, "lease-8", "fp", emT(amb, LEASE_MS))
        );
        expect(takeover.ok && takeover.value.kind).toBe("claimed");

        const dentroDaNova = await amb.repo.claimIdempotency(
          reserva(amb, "lease-8", "fp", emT(amb, LEASE_MS * 2 - 1_000))
        );
        expect(dentroDaNova.ok && dentroDaNova.value.kind).toBe("in_progress");

        const foraDaNova = await amb.repo.claimIdempotency(
          reserva(amb, "lease-8", "fp", emT(amb, LEASE_MS * 2))
        );
        expect(foraDaNova.ok && foraDaNova.value.kind).toBe("claimed");
      });
    });

    it("11: duas retomadas concorrentes após expirar — UM vencedor", async () => {
      await comAmbiente(async (amb) => {
        await comTrial(amb);
        await amb.repo.claimIdempotency(reserva(amb, "lease-9", "fp"));

        const quando = emT(amb, LEASE_MS);
        const [a, b] = await Promise.all([
          amb.repo.claimIdempotency(reserva(amb, "lease-9", "fp", quando)),
          amb.repo.claimIdempotency(reserva(amb, "lease-9", "fp", quando)),
        ]);

        expect(a.ok && b.ok).toBe(true);
        const desfechos = [
          a.ok ? a.value.kind : "erro",
          b.ok ? b.value.kind : "erro",
        ].sort();
        expect(desfechos).toEqual(["claimed", "in_progress"]);
      });
    });

    it("12-14: takeover chama o provider de novo, MESMO recurso, UMA cobrança", async () => {
      // Aqui o caso de uso inteiro roda contra o repositório da variante. É a
      // única parte do contrato que envolve o provider, e ela existe porque as
      // três garantias que importam depois de um takeover — o provider é
      // chamado de novo, com a mesma chave e fingerprint; o mock devolve o
      // MESMO recurso externo; e nada disso vira uma segunda cobrança lógica —
      // não são observáveis só pelo repositório.
      await comAmbiente(async (amb) => {
        await comTrial(amb);

        // `unavailable_after_persist`: o provider CRIA o recurso externo e
        // falha ao responder. É o erro ambíguo — de cá, uma conexão que cai
        // depois do commit do provider é idêntica a uma que cai antes —, e por
        // isso a reserva fica `in_progress` em vez de `failed`. É exatamente o
        // estado que a lease governa, e o cenário é do MOCK: independe de qual
        // repositório está por baixo.
        const provider = new BillingProviderMock({
          ids: sequentialIds(),
          scenarios: ["unavailable_after_persist"],
          env: { NODE_ENV: "test", VERCEL_ENV: "development" },
        });

        function ambiente(instante: string): UseCaseEnv {
          return {
            clock: fixedClock(instante),
            ids: sequentialIds(),
            repo: amb.repo,
            provider,
            auth: { userId: amb.donoA, organizationId: amb.orgA, role: "owner" },
            providerAccountId: externoDe("acct-lease", amb.orgA),
            correlationId: "corr-lease",
          };
        }

        const pedido = {
          method: "pix" as const,
          idempotencyKey: "lease-uc",
          customerName: "Contrato Lease",
          customerEmail: "lease@contrato.test",
        };

        // 1ª tentativa: o provider criou e não respondeu. Reserva fica presa.
        const presa = await createCheckout(ambiente(amb.agora), pedido);
        expect(presa.ok).toBe(false);
        expect(provider.chamadasDeCobranca).toHaveLength(1);

        // Dentro da lease, o checkout é recusado e o provider NÃO é tocado de
        // novo. Sem isso, a repetição criaria a segunda cobrança.
        const cedo = await createCheckout(ambiente(emT(amb, 60_000)), pedido);
        expect(cedo.ok).toBe(false);
        expect(provider.chamadasDeCobranca).toHaveLength(1);

        // 12. Vencida a lease, a retomada acontece e o provider é chamado de
        //     novo — com a MESMA chave e o MESMO fingerprint.
        const retomado = await createCheckout(ambiente(emT(amb, LEASE_MS)), pedido);
        expect(retomado.ok).toBe(true);
        expect(provider.chamadasDeCobranca).toHaveLength(2);

        const chamadas = provider.chamadasDeCobranca;
        expect(chamadas.every((c) => c.idempotencyKey === chamadas[0].idempotencyKey)).toBe(true);
        expect(chamadas.every((c) => c.fingerprint === chamadas[0].fingerprint)).toBe(true);

        const ledger = await amb.repo.readLedger(amb.donoA, amb.orgA);
        expect(ledger.ok).toBe(true);
        if (!ledger.ok) throw new Error("readLedger falhou depois do takeover");

        // O mock devolve o MESMO recurso externo para chave+fingerprint iguais,
        // e nada disso virou uma segunda cobrança lógica.
        const externos = new Set(ledger.value.charges.map((c) => c.externalChargeId));
        expect(externos.size).toBe(1);
        expect(ledger.value.charges).toHaveLength(1);
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

    // ── Metadados contratuais — Etapa 12C.1 ───────────────────────────────
    //
    // Nove casos, e o ponto de todos é a PARIDADE: o dublê refaz as regras do
    // banco (par completo, formato da versão, e-mail vazio virando nulo,
    // regressão proibida, máscara na trilha), e um dublê que refaz regra é um
    // dublê que pode refazê-la ERRADO. Estes casos rodam contra as duas
    // implementações; divergência reprova de um lado só, e é assim que se
    // descobre.

    describe("metadados contratuais", () => {
      it("trial COM contato financeiro persiste o endereço e mascara a trilha", async () => {
        await comAmbiente(async (amb) => {
          const r = await amb.repo.startTrial({
            ...ctx(amb),
            plan: "essencial",
            tier: "t1_20",
            period: "monthly",
            workerCount: 10,
            cnpj: "00000000000191",
            periodStart: amb.agora,
            periodEnd: maisDias(amb.agora, 30),
            trialEndsAt: maisDias(amb.agora, 7),
            amountCents: 9900,
            catalogVersion: amb.catalogVersion,
            billingEmail: "financeiro@empresa.com.br",
            termsVersion: "2026-08-10",
            termsAcceptedAt: amb.agora,
          });
          expect(r.ok).toBe(true);
          if (!r.ok) return;
          expect(r.value.billingEmail).toBe("financeiro@empresa.com.br");
          expect(r.value.termsVersion).toBe("2026-08-10");
          expect(r.value.termsAcceptedAt).toBe(amb.agora);

          const ledger = await amb.repo.readLedger(amb.donoA, amb.orgA);
          expect(ledger.ok).toBe(true);
          if (!ledger.ok) return;

          // O ACEITE É EVENTO PRÓPRIO, com versão e instante.
          const aceite = ledger.value.auditEvents.filter(
            (e) => e.subject === "terms_acceptance"
          );
          expect(aceite).toHaveLength(1);
          expect(aceite[0]!.actorId).toBe(amb.donoA);
          expect(aceite[0]!.organizationId).toBe(amb.orgA);
          expect(aceite[0]!.newValue?.termsVersion).toBe("2026-08-10");
          expect(aceite[0]!.correlationId).toBe("corr-contrato");

          // E O ENDEREÇO NÃO ENTRA NA TRILHA. `audit_events` é append-only:
          // gravar o e-mail inteiro criaria histórico imutável de dado pessoal.
          const serializada = JSON.stringify(ledger.value.auditEvents);
          expect(serializada).not.toContain("financeiro@empresa.com.br");
          expect(serializada).toContain("f***@empresa.com.br");
        });
      });

      it("trial SEM contato financeiro é válido, e não gera evento de contato", async () => {
        await comAmbiente(async (amb) => {
          await comTrial(amb);
          const estado = await amb.repo.readState(amb.donoA, amb.orgA);
          expect(estado.ok).toBe(true);
          if (!estado.ok) return;
          expect(estado.value.subscription?.billingEmail).toBeNull();
          // O aceite, porém, é obrigatório — e está lá.
          expect(estado.value.subscription?.termsVersion).toBe("2026-08-10");
          expect(estado.value.subscription?.termsAcceptedAt).not.toBeNull();

          const ledger = await amb.repo.readLedger(amb.donoA, amb.orgA);
          expect(ledger.ok).toBe(true);
          if (!ledger.ok) return;
          expect(
            ledger.value.auditEvents.filter((e) => e.subject === "billing_email")
          ).toHaveLength(0);
        });
      });

      for (const [rotulo, versao] of [
        ["ausente", ""],
        ["só com espaços", "   "],
        ["inventada", "termos-v1"],
        ["fora do formato de data", "10-08-2026"],
      ] as const) {
        it(`trial com versão de termos ${rotulo} é RECUSADO`, async () => {
          await comAmbiente(async (amb) => {
            const r = await amb.repo.startTrial({
              ...ctx(amb),
              plan: "essencial",
              tier: "t1_20",
              period: "monthly",
              workerCount: 10,
              cnpj: "00000000000191",
              periodStart: amb.agora,
              periodEnd: maisDias(amb.agora, 30),
              trialEndsAt: maisDias(amb.agora, 7),
              amountCents: 9900,
              catalogVersion: amb.catalogVersion,
              billingEmail: null,
              termsVersion: versao,
              termsAcceptedAt: amb.agora,
            });
            expect(r.ok).toBe(false);
            if (!r.ok) expect(r.error.code).toBe("invalid_input");

            // E NADA FOI GRAVADO. Recusa que deixa assinatura para trás é
            // pior do que aceitação: fica um trial sem aceite nenhum.
            const estado = await amb.repo.readState(amb.donoA, amb.orgA);
            expect(estado.ok).toBe(true);
            if (estado.ok) expect(estado.value.subscription).toBeNull();
          });
        });
      }

      it("aceite de versão POSTERIOR atualiza versão e instante, e audita", async () => {
        await comAmbiente(async (amb) => {
          await comTrial(amb);
          const depois = maisDias(amb.agora, 90);

          const r = await amb.repo.acceptTerms(ctx(amb), "2026-11-01", depois);
          expect(r.ok).toBe(true);
          if (!r.ok) return;
          expect(r.value.termsVersion).toBe("2026-11-01");
          expect(r.value.termsAcceptedAt).toBe(depois);

          const ledger = await amb.repo.readLedger(amb.donoA, amb.orgA);
          expect(ledger.ok).toBe(true);
          if (!ledger.ok) return;
          const aceites = ledger.value.auditEvents.filter(
            (e) => e.subject === "terms_acceptance"
          );
          // Dois: o do trial e o novo. A trilha é append-only, e o primeiro
          // continua lá — é a prova de que a versão anterior foi aceita.
          expect(aceites).toHaveLength(2);
          const novo = aceites[1]!;
          expect(novo.previousValue?.termsVersion).toBe("2026-08-10");
          expect(novo.newValue?.termsVersion).toBe("2026-11-01");
        });
      });

      it("repetir o MESMO aceite é idempotente e preserva o instante original", async () => {
        await comAmbiente(async (amb) => {
          await comTrial(amb);
          const original = await amb.repo.readState(amb.donoA, amb.orgA);
          expect(original.ok).toBe(true);
          if (!original.ok) return;
          const instante = original.value.subscription!.termsAcceptedAt;

          const r = await amb.repo.acceptTerms(
            ctx(amb),
            "2026-08-10",
            maisDias(amb.agora, 30)
          );
          expect(r.ok).toBe(true);
          if (!r.ok) return;
          // O INSTANTE NÃO MUDA. Ele é a prova de quando a pessoa aceitou;
          // sobrescrevê-lo por um reenvio apagaria a data que interessa.
          expect(r.value.termsAcceptedAt).toBe(instante);

          const ledger = await amb.repo.readLedger(amb.donoA, amb.orgA);
          expect(ledger.ok).toBe(true);
          if (!ledger.ok) return;
          expect(
            ledger.value.auditEvents.filter((e) => e.subject === "terms_acceptance")
          ).toHaveLength(1);
        });
      });

      it("aceitar versão ANTERIOR à já aceita é recusado", async () => {
        await comAmbiente(async (amb) => {
          await comTrial(amb);
          const r = await amb.repo.acceptTerms(
            ctx(amb),
            "2025-01-01",
            maisDias(amb.agora, 1)
          );
          expect(r.ok).toBe(false);
          if (!r.ok) expect(r.error.code).toBe("invalid_input");

          const estado = await amb.repo.readState(amb.donoA, amb.orgA);
          expect(estado.ok).toBe(true);
          if (estado.ok) {
            expect(estado.value.subscription?.termsVersion).toBe("2026-08-10");
          }
        });
      });

      it("o dono troca o contato financeiro, e a trilha guarda só a máscara", async () => {
        await comAmbiente(async (amb) => {
          await comTrial(amb);
          const r = await amb.repo.updateBillingEmail(
            ctx(amb),
            "  contas@acme.com.br  ",
            maisDias(amb.agora, 2)
          );
          expect(r.ok).toBe(true);
          // Espaços nas pontas são removidos ANTES de gravar.
          if (r.ok) expect(r.value.billingEmail).toBe("contas@acme.com.br");

          // E limpar é possível: vazio significa "sem contato", não erro.
          const limpo = await amb.repo.updateBillingEmail(
            ctx(amb),
            "   ",
            maisDias(amb.agora, 3)
          );
          expect(limpo.ok).toBe(true);
          if (limpo.ok) expect(limpo.value.billingEmail).toBeNull();

          const ledger = await amb.repo.readLedger(amb.donoA, amb.orgA);
          expect(ledger.ok).toBe(true);
          if (!ledger.ok) return;
          const contatos = ledger.value.auditEvents.filter(
            (e) => e.subject === "billing_email"
          );
          expect(contatos).toHaveLength(2);
          expect(contatos[0]!.newValue?.mask).toBe("c***@acme.com.br");
          expect(contatos[1]!.previousValue?.mask).toBe("c***@acme.com.br");
          expect(contatos[1]!.newValue?.mask).toBeNull();
          expect(JSON.stringify(contatos)).not.toContain("contas@acme.com.br");
        });
      });

      it("repetir o MESMO contato não gera evento novo", async () => {
        await comAmbiente(async (amb) => {
          await comTrial(amb);
          await amb.repo.updateBillingEmail(ctx(amb), "contas@acme.com.br", amb.agora);
          await amb.repo.updateBillingEmail(
            ctx(amb),
            "contas@acme.com.br",
            maisDias(amb.agora, 1)
          );

          const ledger = await amb.repo.readLedger(amb.donoA, amb.orgA);
          expect(ledger.ok).toBe(true);
          if (!ledger.ok) return;
          expect(
            ledger.value.auditEvents.filter((e) => e.subject === "billing_email")
          ).toHaveLength(1);
        });
      });

      it("membro comum NÃO troca contato nem aceita termos", async () => {
        await comAmbiente(async (amb) => {
          await comTrial(amb);
          const comoColaborador = {
            actorId: amb.colaboradorA,
            organizationId: amb.orgA,
            correlationId: "corr-contrato",
          };

          const email = await amb.repo.updateBillingEmail(
            comoColaborador,
            "colaborador@acme.com.br",
            amb.agora
          );
          expect(email.ok).toBe(false);
          if (!email.ok) expect(email.error.code).toBe("not_owner");

          const termos = await amb.repo.acceptTerms(
            comoColaborador,
            "2026-11-01",
            amb.agora
          );
          expect(termos.ok).toBe(false);
          if (!termos.ok) expect(termos.error.code).toBe("not_owner");

          // E nada mudou.
          const estado = await amb.repo.readState(amb.donoA, amb.orgA);
          expect(estado.ok).toBe(true);
          if (estado.ok) {
            expect(estado.value.subscription?.billingEmail).toBeNull();
            expect(estado.value.subscription?.termsVersion).toBe("2026-08-10");
          }
        });
      });

      it("organização ALHEIA e INEXISTENTE recebem a MESMA recusa", async () => {
        await comAmbiente(async (amb) => {
          await comTrial(amb);
          await comTrial(amb, amb.orgB);

          const alheia = await amb.repo.updateBillingEmail(
            { actorId: amb.donoA, organizationId: amb.orgB, correlationId: "c" },
            "invasor@acme.com.br",
            amb.agora
          );
          const inexistente = await amb.repo.updateBillingEmail(
            { actorId: amb.donoA, organizationId: amb.orgFantasma, correlationId: "c" },
            "invasor@acme.com.br",
            amb.agora
          );

          expect(alheia.ok).toBe(false);
          expect(inexistente.ok).toBe(false);
          if (!alheia.ok && !inexistente.ok) {
            // MESMO código E mesma mensagem: distingui-las entregaria "esta
            // organização existe" a quem varre identificadores.
            expect(alheia.error.code).toBe(inexistente.error.code);
            expect(alheia.error.message).toBe(inexistente.error.message);
          }

          // E o mesmo para o aceite.
          const aceiteAlheio = await amb.repo.acceptTerms(
            { actorId: amb.donoA, organizationId: amb.orgB, correlationId: "c" },
            "2026-11-01",
            amb.agora
          );
          const aceiteFantasma = await amb.repo.acceptTerms(
            { actorId: amb.donoA, organizationId: amb.orgFantasma, correlationId: "c" },
            "2026-11-01",
            amb.agora
          );
          expect(aceiteAlheio.ok).toBe(false);
          expect(aceiteFantasma.ok).toBe(false);
          if (!aceiteAlheio.ok && !aceiteFantasma.ok) {
            expect(aceiteAlheio.error.code).toBe(aceiteFantasma.error.code);
            expect(aceiteAlheio.error.message).toBe(aceiteFantasma.error.message);
          }

          // B continua com o contato dele — nulo — e com o aceite dele.
          const estadoB = await amb.repo.readState(amb.donoB, amb.orgB);
          expect(estadoB.ok).toBe(true);
          if (estadoB.ok) {
            expect(estadoB.value.subscription?.billingEmail).toBeNull();
          }
        });
      });

      it("contato malformado é recusado SEM reproduzir o endereço na mensagem", async () => {
        await comAmbiente(async (amb) => {
          await comTrial(amb);
          const r = await amb.repo.updateBillingEmail(
            ctx(amb),
            "nao-e-um-email",
            amb.agora
          );
          expect(r.ok).toBe(false);
          if (!r.ok) {
            expect(r.error.code).toBe("invalid_input");
            expect(r.error.message).not.toContain("nao-e-um-email");
          }

          const estado = await amb.repo.readState(amb.donoA, amb.orgA);
          expect(estado.ok).toBe(true);
          if (estado.ok) expect(estado.value.subscription?.billingEmail).toBeNull();
        });
      });

      it("sem assinatura, contato e aceite respondem que não há registro", async () => {
        await comAmbiente(async (amb) => {
          const email = await amb.repo.updateBillingEmail(
            ctx(amb),
            "contas@acme.com.br",
            amb.agora
          );
          expect(email.ok).toBe(false);
          if (!email.ok) expect(email.error.code).toBe("not_found");

          const termos = await amb.repo.acceptTerms(ctx(amb), "2026-11-01", amb.agora);
          expect(termos.ok).toBe(false);
          if (!termos.ok) expect(termos.error.code).toBe("not_found");
        });
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
