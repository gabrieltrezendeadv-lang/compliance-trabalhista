/**
 * MEMBRO × PROPRIETÁRIO — a matriz de papéis, medida nos DOIS sentidos
 *
 * ── O DEFEITO QUE ESTE ARQUIVO FECHA ────────────────────────────────────────
 *
 * A fachada exigia `owner` nos doze comandos, incluindo `lerAcesso`. A decisão
 * comercial aprovada diz que somente o proprietário CONTRATA, ALTERA ou
 * CANCELA — ela não diz que somente ele pode saber o que a organização tem
 * direito de usar. Com a porta fechada, o colaborador de uma organização que
 * paga o Completo seria barrado dos módulos pagos, ou a 12C.3 resolveria
 * entitlements por fora desta camada.
 *
 * ── POR QUE "NOS DOIS SENTIDOS" NÃO É RETÓRICA ──────────────────────────────
 *
 * Uma ampliação de autorização é a mudança mais fácil de fazer errado: basta
 * trocar um tipo e tudo compila. Por isso cada comando é medido DUAS vezes:
 *
 *   * o que membro PODE fazer, membro faz — senão a ampliação foi só de tipo;
 *   * o que membro NÃO pode fazer, membro não faz — senão a ampliação vazou.
 *
 * Um arquivo que só provasse a primeira metade aprovaria uma fachada que
 * liberou tudo; um que só provasse a segunda aprovaria a fachada travada que
 * estamos consertando.
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
  COMANDOS_DA_FACHADA,
} from "@/lib/billing/facade";
import { TERMS_VERSION } from "@/lib/billing/terms";

import { comTrial, montarBancada, ORG_A, ORG_B, ORG_FANTASMA } from "./harness";

const INTENCAO = `ci_${"0".repeat(32)}`;

/** Comandos que MEMBRO comum pode executar. Fechada e curta de propósito. */
const DE_MEMBRO = [
  ["lerCatalogo", lerCatalogo, {}],
  ["lerAcesso", lerAcesso, {}],
] as const;

/** Tudo o mais. Membro tem de ser recusado em cada um. */
const DE_PROPRIETARIO = [
  ["lerAssinatura", lerAssinatura, {}],
  [
    "iniciarTrial",
    iniciarTrial,
    {
      plan: "essencial",
      period: "monthly",
      workerCount: 10,
      cnpj: "00000000000191",
      termsVersion: TERMS_VERSION,
    },
  ],
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
      checkoutIntentId: INTENCAO,
      method: "pix",
      customerName: "Fulano",
      customerEmail: "f@e.com.br",
    },
  ],
] as const;

describe("a matriz declarada é a matriz aplicada", () => {
  it("os dois conjuntos deste arquivo cobrem exatamente os treze comandos", () => {
    const declarados = Object.keys(COMANDOS_DA_FACHADA).sort();
    const exercitados = [...DE_MEMBRO, ...DE_PROPRIETARIO].map(([n]) => n).sort();
    expect(exercitados).toEqual(declarados);
  });

  it("cada comando é exercitado sob o papel que a matriz declara", () => {
    for (const [nome] of DE_MEMBRO) {
      expect(COMANDOS_DA_FACHADA[nome], `${nome} deveria ser de membro`).toBe("member");
    }
    for (const [nome] of DE_PROPRIETARIO) {
      expect(COMANDOS_DA_FACHADA[nome], `${nome} deveria ser de proprietário`).toBe("owner");
    }
  });

  it("a fachada pede à autorização exatamente o papel da matriz", async () => {
    for (const [nome, comando, entrada] of [...DE_MEMBRO, ...DE_PROPRIETARIO]) {
      const b = montarBancada();
      await comando(entrada as never, b.deps);
      expect(b.papeisExigidos(), `${nome} pediu papel errado`).toEqual([
        COMANDOS_DA_FACHADA[nome],
      ]);
    }
  });
});

describe("o que MEMBRO pode fazer, membro faz", () => {
  for (const [nome, comando, entrada] of DE_MEMBRO) {
    it(`${nome}: membro comum do tenant é atendido`, async () => {
      const b = montarBancada({ comoMembro: true });
      const r = await comando(entrada as never, b.deps);

      expect(r.ok, `${nome} recusou um membro legítimo`).toBe(true);
    });
  }

  it("lerAcesso do membro responde sobre a assinatura que o dono contratou", async () => {
    // O trial é criado pelo DONO; o membro consulta depois. É o caso real: o
    // colaborador precisa saber o que pode usar, e quem contratou foi outro.
    const dono = montarBancada();
    await comTrial(dono);

    const r = await lerAcesso({}, { ...dono.deps, ...membroDe(dono) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.reason).toBe("trial_em_curso");
      expect(r.value.features.length).toBeGreaterThan(0);
    }
  });
});

describe("o que MEMBRO não pode fazer, membro não faz", () => {
  for (const [nome, comando, entrada] of DE_PROPRIETARIO) {
    it(`${nome}: membro comum é recusado`, async () => {
      const b = montarBancada({ comoMembro: true });
      const r = await comando(entrada as never, b.deps);

      expect(r.ok, `${nome} atendeu um membro comum`).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("not_owner");
    });

    it(`${nome}: a recusa do membro acontece ANTES do repositório`, async () => {
      const b = montarBancada({ comoMembro: true });
      await comando(entrada as never, b.deps);

      // Nada de billing foi lido nem escrito. Se a recusa dependesse de o
      // banco reclamar, um dado teria sido tocado antes da decisão.
      expect(b.vezesRepositorio(), `${nome} tocou o repositório`).toBe(0);
      expect(b.vezesProvider(), `${nome} construiu provider`).toBe(0);
    });
  }
});

describe("o membro nunca recebe dado restrito ao proprietário", () => {
  it("a decisão de acesso não carrega CNPJ, contato financeiro nem preço", async () => {
    const dono = montarBancada();
    await comTrial(dono);

    const r = await lerAcesso({}, { ...dono.deps, ...membroDe(dono) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Varredura do objeto INTEIRO, e não de campos escolhidos a dedo: um campo
    // novo em `AccessDecision` que trouxesse dado restrito precisa reprovar
    // aqui sem que ninguém se lembre de atualizar o teste.
    const serializado = JSON.stringify(r.value);
    for (const proibido of ["00000000000191", "financeiro@empresa.com.br", "cnpj", "billingEmail"]) {
      expect(serializado).not.toContain(proibido);
    }
  });

  it("o catálogo traz preço de TABELA, e não o praticado pela organização", async () => {
    const b = montarBancada({ comoMembro: true });
    const r = await lerCatalogo({}, b.deps);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Toda linha é do catálogo publicado, com a versão vigente.
    for (const linha of r.value) {
      expect(linha.catalogVersion).toBe("2026-07-30.1");
    }
    expect(JSON.stringify(r.value)).not.toContain("cnpj");
  });

  it("o dossiê comercial continua fechado ao membro", async () => {
    const dono = montarBancada();
    await comTrial(dono);

    const r = await lerAssinatura({}, { ...dono.deps, ...membroDe(dono) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("not_owner");
  });
});

describe("a ampliação não afrouxou a comparação de tenant", () => {
  it("membro de A não alcança B, nem em comando de membro", async () => {
    const b = montarBancada({ comoMembro: true });
    const r = await lerAcesso({ organizationId: ORG_B }, b.deps);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("not_owner");
    expect(b.vezesRepositorio()).toBe(0);
  });

  it("tenant alheio e tenant inexistente continuam indistinguíveis", async () => {
    const alheio = montarBancada({ comoMembro: true });
    const fantasma = montarBancada({ comoMembro: true });

    const rA = await lerAcesso({ organizationId: ORG_B }, alheio.deps);
    const rF = await lerAcesso({ organizationId: ORG_FANTASMA }, fantasma.deps);

    expect(rA.ok).toBe(false);
    expect(rF.ok).toBe(false);
    if (!rA.ok && !rF.ok) {
      expect(rA.error.code).toBe(rF.error.code);
      expect(rA.error.message).toBe(rF.error.message);
    }
  });

  it("o próprio tenant afirmado corretamente passa", async () => {
    const b = montarBancada({ comoMembro: true });
    const r = await lerAcesso({ organizationId: ORG_A }, b.deps);
    expect(r.ok).toBe(true);
  });
});

/** Troca a autorização de uma bancada por MEMBRO, preservando o repositório. */
function membroDe(b: ReturnType<typeof montarBancada>) {
  return {
    autorizar: async (papelMinimo: "member" | "owner") => {
      if (papelMinimo === "owner") {
        return { ok: false, reason: "not_owner", message: "recusado" } as const;
      }
      return {
        ok: true,
        principal: { userId: "user-colab-a", organizationId: ORG_A, role: "member" },
      } as const;
    },
    repositorio: b.deps.repositorio,
  };
}
