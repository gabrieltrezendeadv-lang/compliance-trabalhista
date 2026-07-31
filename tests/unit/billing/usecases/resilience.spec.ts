/**
 * STATE MACHINE: claim → provider → finalize | fail
 *
 * ── ESTES TESTES MEDEM, NÃO DESCREVEM ───────────────────────────────────────
 *
 * A tabela de cenários é verificada pela CONTAGEM de chamadas ao provider, não
 * por inspeção de estado interno. "O provider não deveria ser chamado" é uma
 * afirmação verificável, e é assim que ela é verificada.
 *
 * A garantia sob teste não é "exatamente-uma-vez" — isso não existe entre dois
 * sistemas com commits independentes. É: efeitos idempotentes, estado
 * recuperável, e processamento efetivamente único sob a chave declarada.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { createCheckout, applyProviderEvent } from "@/lib/billing/usecases/payments";
import { startTrial } from "@/lib/billing/usecases/subscription";
import {
  montarBancada,
  ORG_A,
  COLAB_A,
  type Bancada,
} from "./harness";

const CHAVE = "ck-1";

async function comAssinatura(opcoes: Parameters<typeof montarBancada>[0] = {}) {
  const b = montarBancada(opcoes);
  const r = await startTrial(b.env, {
    plan: "essencial",
    period: "monthly",
    workerCount: 10,
    cnpj: "00000000000191",
  });
  expect(r.ok).toBe(true);
  return b;
}

function checkout(b: Bancada, chave = CHAVE) {
  return createCheckout(b.env, {
    method: "pix",
    idempotencyKey: chave,
    customerName: "Fixture",
    customerEmail: "fixture@teste.local",
  });
}

describe("tabela de cenários — chamadas ao provider", () => {
  it("autorização negada: 0 chamadas, nenhum efeito", async () => {
    const b = await comAssinatura();
    // O colaborador não administra assinatura. A recusa precisa acontecer
    // ANTES do provider — senão haveria efeito externo de quem não podia pedir.
    const bColab = montarBancada({ actorId: COLAB_A, organizationId: ORG_A });
    const r = await checkout(bColab);

    expect(r.ok).toBe(false);
    expect(bColab.chamadasDoProvider()).toBe(0);
    expect(await b.cobrancas()).toHaveLength(0);
  });

  it("fingerprint conflitante: 0 chamadas", async () => {
    const b = await comAssinatura();
    const primeiro = await checkout(b);
    expect(primeiro.ok).toBe(true);
    const antes = b.chamadasDoProvider();

    // Mesma chave, MÉTODO diferente → outro pedido. Nunca devolve o resultado
    // do primeiro, e nunca chama o provider.
    const segundo = await createCheckout(b.env, {
      method: "credit_card",
      idempotencyKey: CHAVE,
      customerName: "Fixture",
      customerEmail: "fixture@teste.local",
    });

    expect(segundo.ok).toBe(false);
    if (!segundo.ok) expect(segundo.error.code).toBe("conflict");
    expect(b.chamadasDoProvider()).toBe(antes);
  });

  it("operação concluída (replay): 0 chamadas, mesma cobrança", async () => {
    const b = await comAssinatura();
    const primeiro = await checkout(b);
    expect(primeiro.ok).toBe(true);
    const antes = b.chamadasDoProvider();

    const replay = await checkout(b);
    expect(replay.ok).toBe(true);
    if (replay.ok && primeiro.ok) {
      expect(replay.value.replay).toBe(true);
      expect(replay.value.charge.id).toBe(primeiro.value.charge.id);
    }
    expect(b.chamadasDoProvider()).toBe(antes);
    expect(await b.cobrancas()).toHaveLength(1);
  });

  it("lease válida: 0 chamadas — takeover recusado", async () => {
    // `finalizeCheckout` indisponível deixa a reserva `in_progress`.
    const b = await comAssinatura({ leaseMs: 60_000 });
    b.repo.definirFalhas(["finalizeCheckout"]);
    const primeiro = await checkout(b);
    expect(primeiro.ok).toBe(false);
    const antes = b.chamadasDoProvider();

    b.repo.definirFalhas([]);
    // Ainda dentro da lease: outro processamento pode estar em curso.
    b.relogio.avancarMs(30_000);
    const segundo = await checkout(b);

    expect(segundo.ok).toBe(false);
    if (!segundo.ok) expect(segundo.error.code).toBe("conflict");
    expect(b.chamadasDoProvider()).toBe(antes);
  });

  it("primeira tentativa aceita: 1 chamada, 1 cobrança, 1 snapshot", async () => {
    const b = await comAssinatura();
    const snapshotsAntes = await b.snapshots();

    const r = await checkout(b);
    expect(r.ok).toBe(true);
    expect(b.chamadasDoProvider()).toBe(1);
    expect(await b.cobrancas()).toHaveLength(1);
    // O checkout NÃO cria snapshot: preço é congelado na mudança de plano.
    expect(await b.snapshots()).toBe(snapshotsAntes);
  });

  it("provider recusando: 1 chamada, nenhuma cobrança", async () => {
    const b = await comAssinatura({ scenarios: ["unavailable_before_persist"] });
    const r = await checkout(b);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("provider_unavailable");
    expect(b.chamadasDoProvider()).toBe(1);
    expect(await b.cobrancas()).toHaveLength(0);
  });

  it("retry depois da recusa: mais 1 chamada, MESMA chave, 1 cobrança", async () => {
    const b = await comAssinatura({
      leaseMs: 60_000,
      scenarios: ["unavailable_before_persist"],
    });
    const primeiro = await checkout(b);
    expect(primeiro.ok).toBe(false);
    expect(b.chamadasDoProvider()).toBe(1);

    // "Indisponível" NÃO diz se o recurso foi criado: do lado de cá, uma
    // conexão que cai antes do commit do provider é idêntica a uma que cai
    // depois. Por isso a reserva fica `in_progress`, e não `failed` — e a
    // retomada espera a lease em vez de arriscar uma segunda cobrança.
    const cedo = await checkout(b);
    expect(cedo.ok).toBe(false);
    expect(b.chamadasDoProvider()).toBe(1);

    b.relogio.avancarMs(61_000);
    const segundo = await checkout(b);
    expect(segundo.ok).toBe(true);
    expect(b.chamadasDoProvider()).toBe(2);
    expect(b.chamadasComChave(CHAVE)).toBe(2);
    expect(await b.cobrancas()).toHaveLength(1);
  });

  it("finalize falhando: 1 chamada, recurso externo existe, banco sem cobrança", async () => {
    const b = await comAssinatura();
    b.repo.definirFalhas(["finalizeCheckout"]);

    const r = await checkout(b);
    expect(r.ok).toBe(false);
    expect(b.chamadasDoProvider()).toBe(1);
    expect(await b.cobrancas()).toHaveLength(0);
  });

  it("retry após expirar a lease: mais 1 chamada, MESMO recurso externo, 1 cobrança", async () => {
    const b = await comAssinatura({ leaseMs: 60_000, scenarios: ["unavailable_after_persist"] });

    // Primeira tentativa: o provider CRIOU e falhou ao responder.
    const primeiro = await checkout(b);
    expect(primeiro.ok).toBe(false);
    expect(b.chamadasDoProvider()).toBe(1);
    const externoPrimeiro = b.provider.chamadasDeCobranca[0];

    // Dentro da lease, a retomada é recusada sem tocar no provider.
    const durante = await checkout(b);
    expect(durante.ok).toBe(false);
    expect(b.chamadasDoProvider()).toBe(1);

    // Vencida a lease, a retomada acontece — com a MESMA chave.
    b.relogio.avancarMs(61_000);
    const depois = await checkout(b);

    expect(depois.ok).toBe(true);
    expect(b.chamadasDoProvider()).toBe(2);
    expect(b.chamadasComChave(CHAVE)).toBe(2);
    expect(b.provider.chamadasDeCobranca[1].idempotencyKey).toBe(
      externoPrimeiro.idempotencyKey
    );
    expect(b.provider.chamadasDeCobranca[1].fingerprint).toBe(externoPrimeiro.fingerprint);

    // E o recurso externo é o MESMO: uma única cobrança lógica.
    const cobrancas = await b.cobrancas();
    expect(cobrancas).toHaveLength(1);
    if (depois.ok) {
      expect(depois.value.charge.externalChargeId).toBe(cobrancas[0].externalChargeId);
    }
  });

  it("replay depois do finalize: 0 chamadas", async () => {
    const b = await comAssinatura();
    await checkout(b);
    const antes = b.chamadasDoProvider();

    await checkout(b);
    await checkout(b);

    expect(b.chamadasDoProvider()).toBe(antes);
    expect(await b.cobrancas()).toHaveLength(1);
  });

  it("chamadas concorrentes: um efeito externo lógico", async () => {
    const b = await comAssinatura();

    // Duas chamadas disparadas juntas. A reserva é indivisível, então uma
    // vence e a outra é recusada — nunca duas cobranças.
    const [um, dois] = await Promise.all([checkout(b), checkout(b)]);

    const vitoriosos = [um, dois].filter((r) => r.ok).length;
    expect(vitoriosos).toBe(1);
    expect(await b.cobrancas()).toHaveLength(1);
    expect(b.chamadasComChave(CHAVE)).toBe(1);
  });
});

describe("conteúdo do que chega ao provider", () => {
  it("chave, fingerprint e valor conferem com o pedido", async () => {
    const b = await comAssinatura();
    await checkout(b);

    const ultima = b.ultimaChamada();
    expect(ultima).not.toBeNull();
    expect(ultima?.idempotencyKey).toBe(CHAVE);
    expect(ultima?.amountCents).toBe(9_990);
    expect(ultima?.fingerprint).toMatch(/^fp_[0-9a-f]{8}$/);
  });

  it("o fingerprint muda quando o pedido muda", async () => {
    const b = await comAssinatura();
    await checkout(b, "ck-a");
    const primeiro = b.ultimaChamada()?.fingerprint;

    await createCheckout(b.env, {
      method: "credit_card",
      idempotencyKey: "ck-b",
      customerName: "Fixture",
      customerEmail: "fixture@teste.local",
    });
    const segundo = b.ultimaChamada()?.fingerprint;

    expect(primeiro).toBeDefined();
    expect(segundo).toBeDefined();
    expect(primeiro).not.toBe(segundo);
  });
});

describe("estados da reserva", () => {
  it("`failed` só em recusa DETERMINÍSTICA — retomada imediata", async () => {
    // Valor inválido é rejeitado pelo provider sem criar nada, e sem ambiguidade
    // alguma. Aí sim a reserva vai a `failed`, e a retomada é IMEDIATA — sem
    // esperar lease. É o contraste com o caso ambíguo do teste anterior.
    const b = await comAssinatura({ leaseMs: 3_600_000 });

    // `misconfigured` do mock em ambiente proibido não serve aqui; o caminho
    // determinístico disponível é a recusa por entrada inválida, provocada por
    // um pedido de valor zero — que o catálogo não produz. Em vez de forjar
    // isso, exercita-se a propriedade equivalente: uma reserva marcada `failed`
    // é retomável na hora.
    const reserva = {
      actorId: b.env.auth.userId,
      organizationId: b.env.auth.organizationId,
      correlationId: b.env.correlationId,
      scope: "command" as const,
      provider: b.env.provider.name,
      key: "ck-det",
      fingerprint: "fp-det",
      now: b.relogio.now(),
    };
    const claim = await b.repo.claimIdempotency(reserva);
    expect(claim.ok && claim.value.kind).toBe("claimed");

    const marcado = await b.repo.failIdempotency(reserva, "invalid_input");
    expect(marcado.ok && marcado.value.kind).toBe("failed");

    // Sem avançar o relógio: `failed` é retomável na hora.
    const retomada = await b.repo.claimIdempotency(reserva);
    expect(retomada.ok && retomada.value.kind).toBe("claimed");
  });

  it("fail repetido é idempotente", async () => {
    const b = await comAssinatura();
    const reserva = {
      actorId: b.env.auth.userId,
      organizationId: b.env.auth.organizationId,
      correlationId: b.env.correlationId,
      scope: "command" as const,
      provider: b.env.provider.name,
      key: "ck-fail2",
      fingerprint: "fp-x",
      now: b.relogio.now(),
    };
    await b.repo.claimIdempotency(reserva);

    const um = await b.repo.failIdempotency(reserva, "provider_timeout");
    const dois = await b.repo.failIdempotency(reserva, "provider_timeout");

    expect(um.ok && um.value.kind).toBe("failed");
    expect(dois.ok && dois.value.kind).toBe("failed");
  });

  it("falha do finalize mantém `in_progress` — retomada só após a lease", async () => {
    const b = await comAssinatura({ leaseMs: 60_000 });
    b.repo.definirFalhas(["finalizeCheckout"]);
    await checkout(b);
    b.repo.definirFalhas([]);

    // Ainda `in_progress`: recusa.
    const cedo = await checkout(b);
    expect(cedo.ok).toBe(false);
    if (!cedo.ok) expect(cedo.error.code).toBe("conflict");

    // Depois da lease: retomada.
    b.relogio.avancarMs(61_000);
    const tarde = await checkout(b);
    expect(tarde.ok).toBe(true);
  });

  it("fingerprint divergente nunca reutiliza o resultado gravado", async () => {
    const b = await comAssinatura();
    const primeiro = await checkout(b);
    expect(primeiro.ok).toBe(true);

    const outro = await createCheckout(b.env, {
      method: "credit_card",
      idempotencyKey: CHAVE,
      customerName: "Fixture",
      customerEmail: "fixture@teste.local",
    });

    expect(outro.ok).toBe(false);
    // E não devolveu a cobrança do primeiro disfarçada de sucesso.
    if (outro.ok) throw new Error("conflito virou sucesso");
  });
});

describe("eventos do provider", () => {
  async function comCobranca() {
    const b = await comAssinatura();
    const c = await checkout(b);
    if (!c.ok) throw new Error("checkout falhou na preparação");
    return { b, externo: c.value.charge.externalChargeId };
  }

  it("evento duplicado não duplica efeito", async () => {
    const { b, externo } = await comCobranca();

    const primeiro = await applyProviderEvent(b.env, {
      externalEventId: "ev-1",
      externalChargeId: externo,
      eventType: "charge_paid",
      occurredAt: "2026-08-05T00:00:00.000Z",
    });
    expect(primeiro.ok).toBe(true);
    if (primeiro.ok) expect(primeiro.value.kind).toBe("applied");

    const repetido = await applyProviderEvent(b.env, {
      externalEventId: "ev-1",
      externalChargeId: externo,
      eventType: "charge_paid",
      occurredAt: "2026-08-05T00:00:00.000Z",
    });
    expect(repetido.ok).toBe(true);
    if (repetido.ok) expect(repetido.value.kind).toBe("duplicate");

    const cobrancas = await b.cobrancas();
    expect(cobrancas).toHaveLength(1);
    expect(cobrancas[0].status).toBe("paid");
  });

  it("evento anterior ao período da cobrança é recusado", async () => {
    const { b, externo } = await comCobranca();

    const r = await applyProviderEvent(b.env, {
      externalEventId: "ev-antigo",
      externalChargeId: externo,
      eventType: "charge_paid",
      occurredAt: "2026-07-01T00:00:00.000Z",
    });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.kind).toBe("out_of_order");
    const cobrancas = await b.cobrancas();
    expect(cobrancas[0].status).toBe("pending");
  });

  it("cobrança desconhecida não é aplicada a tenant nenhum", async () => {
    const { b } = await comCobranca();

    const r = await applyProviderEvent(b.env, {
      externalEventId: "ev-x",
      externalChargeId: "chg-inexistente",
      eventType: "charge_paid",
      occurredAt: "2026-08-05T00:00:00.000Z",
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("not_found");
  });

  it("transição inválida é recusada: cobrança paga não volta a falhar", async () => {
    const { b, externo } = await comCobranca();

    await applyProviderEvent(b.env, {
      externalEventId: "ev-pago",
      externalChargeId: externo,
      eventType: "charge_paid",
      occurredAt: "2026-08-05T00:00:00.000Z",
    });

    const segundo = await applyProviderEvent(b.env, {
      externalEventId: "ev-falha",
      externalChargeId: externo,
      eventType: "charge_failed",
      occurredAt: "2026-08-06T00:00:00.000Z",
    });

    expect(segundo.ok).toBe(false);
    if (!segundo.ok) expect(segundo.error.code).toBe("invalid_state");
    const cobrancas = await b.cobrancas();
    expect(cobrancas[0].status).toBe("paid");
  });
});

describe("falhas do repositório nunca viram autorização", () => {
  let bancada: Bancada;

  beforeEach(async () => {
    bancada = await comAssinatura();
  });

  it("leitura indisponível reprova o checkout", async () => {
    bancada.repo.definirFalhas(["readState"]);
    const r = await checkout(bancada);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("repository_unavailable");
    expect(bancada.chamadasDoProvider()).toBe(0);
  });

  it("claim indisponível reprova antes do provider", async () => {
    bancada.repo.definirFalhas(["claimIdempotency"]);
    const r = await checkout(bancada);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("repository_unavailable");
    expect(bancada.chamadasDoProvider()).toBe(0);
  });
});
