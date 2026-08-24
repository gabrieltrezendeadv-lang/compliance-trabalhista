/**
 * O DIGEST DE IDENTIDADE FINANCEIRA — largura e injetividade
 *
 * Dois defeitos concretos da versão anterior, cada um com um teste que falharia
 * se ele voltasse:
 *
 *   LARGURA       FNV-1a de 32 bits decidia se dois pedidos de cobrança eram o
 *                 mesmo. Colisão ali recusa checkout legítimo.
 *
 *   AMBIGUIDADE   a canonicalização unia `chave=valor` por `&`, então
 *                 `{a: "x&b=y"}` e `{a: "x", b: "y"}` produziam a MESMA string.
 *                 Nenhum campo do billing tem `&` hoje — mas "hoje" não é uma
 *                 propriedade, e um nome de pagador bastaria.
 */

import { describe, expect, it } from "vitest";

import { canonicalizar, digest, GERACAO_DE_DIGEST } from "@/lib/billing/core/digest";

describe("largura", () => {
  it("é SHA-256: 64 hex, com tipo e geração no prefixo", () => {
    const d = digest("fp", { a: "1" });
    expect(d).toMatch(/^fp1_[0-9a-f]{64}$/);
    expect(GERACAO_DE_DIGEST).toBe("1");
  });

  it("tipos diferentes NÃO colidem sobre os mesmos campos", () => {
    const campos = { op: "checkout", org: "org-a", intent: "ci_1" };
    expect(digest("fp", campos)).not.toBe(digest("idem", campos));
  });
});

describe("injetividade da canonicalização", () => {
  it("separadores dentro do valor não podem forjar outro conjunto de campos", () => {
    // O caso exato que a forma antiga confundia.
    const a = canonicalizar({ a: "x&b=y" });
    const b = canonicalizar({ a: "x", b: "y" });
    expect(a).not.toBe(b);
    expect(digest("fp", { a: "x&b=y" })).not.toBe(digest("fp", { a: "x", b: "y" }));
  });

  it("nome de campo com separador também não forja", () => {
    expect(digest("fp", { "a;1": "b" })).not.toBe(digest("fp", { a: "1", 1: "b" }));
  });

  it("ponto-e-vírgula e dois-pontos no valor são inertes", () => {
    expect(digest("fp", { nome: "Fulano; 3:x" })).not.toBe(digest("fp", { nome: "Fulano", "3": "x" }));
  });
});

describe("determinismo", () => {
  it("a ordem de escrita dos campos não altera o digest", () => {
    expect(digest("fp", { b: 2, a: 1 })).toBe(digest("fp", { a: 1, b: 2 }));
  });

  it("número e string equivalentes produzem o mesmo digest", () => {
    // Deliberado: `amountCents: 9990` e `"9990"` são o mesmo valor comercial, e
    // um reenvio que serializasse diferente não pode virar conflito falso.
    expect(digest("fp", { v: 9990 })).toBe(digest("fp", { v: "9990" }));
  });

  it("o mesmo pedido produz o mesmo digest entre chamadas", () => {
    const campos = { op: "checkout", org: "org-a", intent: `ci_${"0".repeat(32)}` };
    expect(digest("idem", campos)).toBe(digest("idem", campos));
  });
});
