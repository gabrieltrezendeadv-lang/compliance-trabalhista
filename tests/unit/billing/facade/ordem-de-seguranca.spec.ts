/**
 * A ORDEM DE SEGURANÇA DA FACHADA, MEDIDA — Etapa 12C.2
 *
 * As onze etapas de `executarComando` não são descritas aqui: são OBSERVADAS.
 * As dependências são fábricas instrumentadas, então "billing desligado não
 * consulta banco" vira uma contagem, e não uma afirmação de comentário.
 */

import { describe, expect, it } from "vitest";

import {
  aceitarTermos,
  agendarDowngrade,
  atualizarEmailFinanceiro,
  cancelarNoFimDoPeriodo,
  criarCheckout,
  escolherPlano,
  fazerUpgrade,
  iniciarTrial,
  lerAcesso,
  lerAssinatura,
  lerCatalogo,
  prepararIntencaoDeCheckout,
  registrarTrabalhadores,
} from "@/lib/billing/facade";
import { resolveBillingProvider } from "@/lib/billing/registry";
import { TERMS_VERSION } from "@/lib/billing/terms";

import { comIntencao, comTrial, montarBancada, ORG_B, ORG_FANTASMA } from "./harness";

/**
 * Intenção literal, no formato REAL que o servidor cunha.
 *
 * Usada onde o teste não exercita a preparação — a validação de forma é
 * `.strict()` + regex, e um valor de fantasia faria o teste passar aqui e o
 * caminho real reprovar.
 */
const INTENCAO_LITERAL = `ci_${"0".repeat(32)}`;

const TRIAL_VALIDO = {
  plan: "essencial" as const,
  period: "monthly" as const,
  workerCount: 10,
  cnpj: "00000000000191",
  termsVersion: TERMS_VERSION,
};

/** Todos os comandos, com uma entrada mínima válida para cada um. */
const COMANDOS = [
  ["lerCatalogo", lerCatalogo, {}],
  ["lerAssinatura", lerAssinatura, {}],
  ["lerAcesso", lerAcesso, {}],
  ["iniciarTrial", iniciarTrial, TRIAL_VALIDO],
  ["atualizarEmailFinanceiro", atualizarEmailFinanceiro, { billingEmail: "f@e.com.br" }],
  ["aceitarTermos", aceitarTermos, { termsVersion: TERMS_VERSION }],
  ["registrarTrabalhadores", registrarTrabalhadores, { workerCount: 12 }],
  ["escolherPlano", escolherPlano, { plan: "completo", period: "monthly" }],
  ["fazerUpgrade", fazerUpgrade, { plan: "completo" }],
  ["agendarDowngrade", agendarDowngrade, { plan: "essencial" }],
  ["cancelarNoFimDoPeriodo", cancelarNoFimDoPeriodo, {}],
  ["prepararIntencaoDeCheckout", prepararIntencaoDeCheckout, {}],
  [
    "criarCheckout",
    criarCheckout,
    {
      checkoutIntentId: INTENCAO_LITERAL,
      method: "pix",
      customerName: "Fulano",
      customerEmail: "f@e.com.br",
    },
  ],
] as const;

describe("etapa 1 — a flag vem antes de tudo", () => {
  for (const [nome, comando, entrada] of COMANDOS) {
    it(`${nome}: billing desligado não toca banco, provider nem autorização`, async () => {
      const b = montarBancada({ flagLigada: false });
      const r = await comando(entrada as never, b.deps);

      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("billing_disabled");

      // As três contagens em zero são o ponto: com a flag desligada a etapa
      // inteira não existe, e "não existe" não faz I/O nem resolve sessão.
      expect(b.vezesRepositorio()).toBe(0);
      expect(b.vezesProvider()).toBe(0);
      expect(b.vezesAutorizacao()).toBe(0);
    });
  }

  it("a mensagem de billing desligado não revela nada do estado interno", async () => {
    const b = montarBancada({ flagLigada: false });
    const r = await lerAssinatura({}, b.deps);
    if (!r.ok) {
      expect(r.error.message).not.toMatch(/flag|BILLING_ENABLED|env|process/i);
    }
  });
});

describe("etapas 3 a 6 — sessão, papel e tenant, resolvidos no servidor", () => {
  it("sem sessão: recusa antes de qualquer banco", async () => {
    const b = montarBancada({
      autorizacao: { ok: false, reason: "not_authenticated", message: "x" },
    });
    const r = await iniciarTrial(TRIAL_VALIDO, b.deps);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("unauthenticated");
    expect(b.vezesRepositorio()).toBe(0);
    expect(b.vezesProvider()).toBe(0);
  });

  it("membro comum: recusado, sem tocar banco", async () => {
    const b = montarBancada({
      autorizacao: { ok: false, reason: "not_owner", message: "x" },
    });
    const r = await iniciarTrial(TRIAL_VALIDO, b.deps);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("not_owner");
    expect(b.vezesRepositorio()).toBe(0);
  });

  it("owner: passa, e o banco é consultado uma única vez", async () => {
    const b = montarBancada();
    const r = await iniciarTrial(TRIAL_VALIDO, b.deps);

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.termsVersion).toBe(TERMS_VERSION);
    expect(b.vezesRepositorio()).toBe(1);
    // Nenhum comando de ciclo de vida fala com o provider.
    expect(b.vezesProvider()).toBe(0);
    expect(b.chamadasDoProvider()).toBe(0);
  });

  it("IDOR: organizationId alheio é COMPARADO, nunca obedecido", async () => {
    const b = montarBancada();
    const r = await iniciarTrial({ ...TRIAL_VALIDO, organizationId: ORG_B }, b.deps);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("not_owner");
    // O identificador afirmado CHEGOU à autorização — é lá que se compara.
    expect(b.tenantsAfirmados()).toEqual([ORG_B]);
    expect(b.vezesRepositorio()).toBe(0);
  });

  it("tenant alheio e inexistente são INDISTINGUÍVEIS", async () => {
    const alheio = montarBancada();
    const fantasma = montarBancada();

    const rAlheio = await lerAssinatura({ organizationId: ORG_B }, alheio.deps);
    const rFantasma = await lerAssinatura({ organizationId: ORG_FANTASMA }, fantasma.deps);

    expect(rAlheio.ok).toBe(false);
    expect(rFantasma.ok).toBe(false);
    if (!rAlheio.ok && !rFantasma.ok) {
      expect(rAlheio.error.code).toBe(rFantasma.error.code);
      expect(rAlheio.error.message).toBe(rFantasma.error.message);
    }
  });

  it("falha ao VERIFICAR permissão nunca vira permissão", async () => {
    const b = montarBancada({
      autorizacao: { ok: false, reason: "verification_failed", message: "x" },
    });
    const r = await lerAssinatura({}, b.deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("repository_unavailable");
    expect(b.vezesRepositorio()).toBe(0);
  });
});

describe("etapa 7 — validação depois da autorização, com schema fechado", () => {
  it("campo desconhecido é ERRO, e não campo ignorado", async () => {
    const b = montarBancada();
    const r = await iniciarTrial({ ...TRIAL_VALIDO, plano: "premium" }, b.deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_input");
    expect(b.vezesRepositorio()).toBe(0);
  });

  for (const [rotulo, entrada] of [
    ["CNPJ com letras", { ...TRIAL_VALIDO, cnpj: "0000000000019X" }],
    ["CNPJ curto", { ...TRIAL_VALIDO, cnpj: "123" }],
    ["worker count zero", { ...TRIAL_VALIDO, workerCount: 0 }],
    ["worker count fracionário", { ...TRIAL_VALIDO, workerCount: 10.5 }],
    ["plano inexistente", { ...TRIAL_VALIDO, plan: "premium" }],
    ["periodicidade inexistente", { ...TRIAL_VALIDO, period: "weekly" }],
    ["versão de termos malformada", { ...TRIAL_VALIDO, termsVersion: "v1" }],
  ] as const) {
    it(`${rotulo} é recusado antes do banco`, async () => {
      const b = montarBancada();
      const r = await iniciarTrial(entrada as never, b.deps);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("invalid_input");
      expect(b.vezesRepositorio()).toBe(0);
    });
  }

  it("entrada que não é objeto é recusada", async () => {
    const b = montarBancada();
    for (const lixo of [null, undefined, "texto", 42, []]) {
      const r = await lerAssinatura(lixo, b.deps);
      expect(r.ok).toBe(false);
    }
  });
});

describe("campos jamais confiados ao chamador", () => {
  const NO_PASSADO = "2020-01-01T00:00:00.000Z";

  it("instante, ator, origem e correlação enviados no corpo são RECUSADOS", async () => {
    const b = montarBancada();
    // `.strict()`: mandar qualquer um deles é erro, não campo ignorado. É mais
    // forte do que ignorar — quem tenta descobre que tentou.
    for (const extra of [
      { termsAcceptedAt: NO_PASSADO },
      { acceptedAt: NO_PASSADO },
      { now: NO_PASSADO },
      { actorId: "outro-usuario" },
      { origin: "admin" },
      { correlationId: "corr-escolhida" },
      { idempotencyKey: "chave-escolhida" },
      { amountCents: 1 },
      { tier: "t1_20" },
    ]) {
      const r = await iniciarTrial({ ...TRIAL_VALIDO, ...extra }, b.deps);
      expect(r.ok, `aceitou ${Object.keys(extra)[0]}`).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("invalid_input");
    }
    expect(b.vezesRepositorio()).toBe(0);
  });

  it("o instante persistido é o do relógio do servidor", async () => {
    const b = montarBancada();
    const r = await iniciarTrial(TRIAL_VALIDO, b.deps);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.termsAcceptedAt).toBe(b.relogio.now());
  });

  it("versão de termos divergente é recusada, e nada é gravado", async () => {
    const b = montarBancada();
    for (const versao of ["2020-01-01", "2099-12-31"]) {
      const r = await iniciarTrial({ ...TRIAL_VALIDO, termsVersion: versao }, b.deps);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("invalid_input");
    }
    const estado = await lerAssinatura({}, b.deps);
    expect(estado.ok).toBe(true);
    if (estado.ok) expect(estado.value.subscription).toBeNull();
  });

  it("a versão persistida é a constante oficial, não a recebida", async () => {
    const b = montarBancada();
    const r = await iniciarTrial({ ...TRIAL_VALIDO, termsVersion: `  ${TERMS_VERSION}  ` }, b.deps);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.termsVersion).toBe(TERMS_VERSION);
  });
});

describe("privacidade nas recusas", () => {
  it("e-mail inválido é recusado sem aparecer na mensagem", async () => {
    const b = montarBancada();
    await comTrial(b);
    const invalido = "nao-e-email";
    const r = await atualizarEmailFinanceiro({ billingEmail: invalido }, b.deps);

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("invalid_input");
      expect(r.error.message).not.toContain(invalido);
      expect(r.error.message).not.toContain("@");
    }
  });

  it("CNPJ recusado não aparece na mensagem técnica", async () => {
    const b = montarBancada();
    const cnpj = "99999999999999X";
    const r = await iniciarTrial({ ...TRIAL_VALIDO, cnpj }, b.deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).not.toContain(cnpj);
  });

  it("erro de repositório vira indisponibilidade, sem mensagem de driver", async () => {
    const b = montarBancada({ failAt: ["startTrial"] });
    const r = await iniciarTrial(TRIAL_VALIDO, b.deps);

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("repository_unavailable");
      expect(r.error.message).not.toMatch(/postgrest|PGRST|supabase|host|postgres:\/\//i);
    }
  });
});

describe("etapa 9 — o provider só é resolvido por quem precisa", () => {
  it("nenhuma leitura nem comando de ciclo de vida pede o provider", async () => {
    for (const [nome, comando, entrada] of COMANDOS) {
      if (nome === "criarCheckout") continue;
      const b = montarBancada();
      await comando(entrada as never, b.deps);
      expect(b.vezesProvider(), `${nome} pediu o provider`).toBe(0);
    }
  });

  it("o checkout resolve UM provider, e nenhuma PII chega a ele antes disso", async () => {
    const b = montarBancada();
    await comTrial(b);
    const intencao = await comIntencao(b);
    const r = await criarCheckout(
      {
        checkoutIntentId: intencao,
        method: "pix",
        customerName: "Fulano de Tal",
        customerEmail: "f@e.com.br",
      },
      b.deps
    );
    expect(r.ok).toBe(true);
    expect(b.vezesProvider()).toBe(1);
  });

  it("provider RECUSADO: a PII não chega a ele, porque ele nem existe", async () => {
    // A propriedade correta, e a que o comentário da fachada agora afirma: a
    // entrada PODE ser validada antes — validar é o que impede pedido
    // malformado de circular. O que não pode é PII ser ENVIADA a um provider
    // ainda não resolvido. Com a fábrica falhando, `chamadasDoProvider` é a
    // medida disso.
    const b = montarBancada({ providerFalha: new Error("nao configurado") });
    await comTrial(b);
    const intencao = await comIntencao(b);
    const r = await criarCheckout(
      {
        checkoutIntentId: intencao,
        method: "pix",
        customerName: "Fulano de Tal",
        customerEmail: "pii@empresa.com.br",
      },
      b.deps
    );
    expect(r.ok).toBe(false);
    expect(b.chamadasDoProvider()).toBe(0);
  });

  it("provider não configurado vira `misconfigured`, sem detalhe", async () => {
    const b = montarBancada({ providerFalha: new Error("BILLING_PROVIDER ausente") });
    await comTrial(b);
    const r = await criarCheckout(
      {
        checkoutIntentId: INTENCAO_LITERAL,
        method: "pix",
        customerName: "Fulano",
        customerEmail: "f@e.com.br",
      },
      b.deps
    );

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("misconfigured");
      expect(r.error.message).not.toContain("BILLING_PROVIDER");
    }
    // E o provider não chegou a ser chamado.
    expect(b.chamadasDoProvider()).toBe(0);
  });

  it("o registry REAL recusa mock em produção, e a fachada traduz", async () => {
    // Composição de verdade: a fábrica é o registry, com ambiente de produção.
    const b = montarBancada();
    await comTrial(b);
    const deps = {
      ...b.deps,
      provider: () =>
        resolveBillingProvider({
          BILLING_PROVIDER: "mock",
          NODE_ENV: "production",
          VERCEL_ENV: "production",
        }),
    };
    const r = await criarCheckout(
      {
        checkoutIntentId: INTENCAO_LITERAL,
        method: "pix",
        customerName: "Fulano",
        customerEmail: "f@e.com.br",
      },
      deps
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("misconfigured");
  });

  it("o registry REAL recusa Asaas não implementado, e a fachada traduz", async () => {
    const b = montarBancada();
    await comTrial(b);
    const deps = {
      ...b.deps,
      provider: () =>
        resolveBillingProvider({
          BILLING_PROVIDER: "asaas",
          ASAAS_API_KEY: "$aact_x",
          ASAAS_ENVIRONMENT: "sandbox",
          ASAAS_WEBHOOK_TOKEN: "t",
          NODE_ENV: "test",
        }),
    };
    const r = await criarCheckout(
      {
        checkoutIntentId: INTENCAO_LITERAL,
        method: "pix",
        customerName: "Fulano",
        customerEmail: "f@e.com.br",
      },
      deps
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("misconfigured");
  });
});
