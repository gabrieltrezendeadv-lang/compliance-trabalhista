/**
 * A VERSÃO OFICIAL DOS TERMOS É DO SERVIDOR.
 *
 * ── A PROPRIEDADE QUE ESTE ARQUIVO PROTEGE ──────────────────────────────────
 *
 * O formulário da 12C.3 vai mandar de volta a versão que exibiu. Isso é
 * necessário — é como se detecta a tela aberta antes da publicação de termos
 * novos. Mas o que chega é AFIRMAÇÃO, e o que se persiste é a constante.
 *
 * Sem a comparação, bastaria mandar `termsVersion: "1900-01-01"` para registrar
 * aceite de um documento que nunca existiu.
 */

import { describe, expect, it } from "vitest";

import {
  ehVersaoVigente,
  exigirVersaoVigente,
  TERMS_VERSION,
  TermsVersionMismatchError,
} from "@/lib/billing/terms";

describe("versão dos termos", () => {
  it("a vigente tem formato de data — é o que o CHECK do banco exige", () => {
    // Não é enfeite: `AAAA-MM-DD` é o que faz a comparação lexical coincidir
    // com a cronológica, e é assim que o banco proíbe regredir de versão sem
    // precisar de tabela de versões publicadas.
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("aceita a vigente e devolve a OFICIAL, não a recebida", () => {
    expect(exigirVersaoVigente(TERMS_VERSION)).toBe(TERMS_VERSION);
    // Espaços nas pontas não invalidam — o que chega de formulário costuma
    // vir assim — mas o que sai é a constante.
    const devolvida = exigirVersaoVigente(`  ${TERMS_VERSION}  `);
    expect(devolvida).toBe(TERMS_VERSION);
    expect(devolvida).not.toBe(`  ${TERMS_VERSION}  `);
  });

  for (const [rotulo, valor] of [
    ["vazia", ""],
    ["só espaços", "   "],
    ["inventada", "termos-v1"],
    ["fora do formato", "10-08-2026"],
    ["mês sem zero", "2026-8-10"],
    ["antiga", "2025-01-01"],
    ["futura", "2099-12-31"],
    ["com sufixo", `${TERMS_VERSION} ok`],
  ] as const) {
    it(`recusa versão ${rotulo}`, () => {
      expect(() => exigirVersaoVigente(valor)).toThrow(TermsVersionMismatchError);
      expect(ehVersaoVigente(valor)).toBe(false);
    });
  }

  it("a recusa NÃO revela qual é a versão vigente", () => {
    // Quem está com a tela velha recarrega e recebe a nova; quem está sondando
    // não ganha nada. A versão recebida fica no erro para diagnóstico, a
    // esperada não.
    try {
      exigirVersaoVigente("2025-01-01");
      throw new Error("deveria ter recusado");
    } catch (erro) {
      expect(erro).toBeInstanceOf(TermsVersionMismatchError);
      expect((erro as Error).message).not.toContain(TERMS_VERSION);
      expect((erro as TermsVersionMismatchError).recebida).toBe("2025-01-01");
    }
  });
});
