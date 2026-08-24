/**
 * DIGEST DE IDENTIDADE FINANCEIRA — SHA-256, com versão no prefixo
 *
 * ── POR QUE FNV-1a DE 32 BITS NÃO SERVE AQUI ────────────────────────────────
 *
 * A 12C.2 usava FNV-1a de 32 bits para o fingerprint do pedido e para a chave
 * de idempotência. Trinta e dois bits são 4.294.967.296 valores: pelo paradoxo
 * do aniversário, algumas dezenas de milhares de identidades já colidem com
 * probabilidade apreciável, e a consequência de uma colisão AQUI não é um
 * cache errado — é `fingerprint_conflict` num fluxo de cobrança, ou pior, dois
 * pedidos distintos considerados o mesmo.
 *
 * Identidade financeira não pode depender de um espaço que cabe num inteiro.
 * SHA-256 dá 256 bits, e o custo — alguns microssegundos por checkout — é
 * irrelevante diante do que se está decidindo.
 *
 * ── O PREFIXO DE VERSÃO NÃO É ENFEITE ───────────────────────────────────────
 *
 * Todo digest sai como `<versão>_<hex>`. Sem ele, trocar o algoritmo ou a
 * canonicalização produziria silenciosamente digests diferentes para o mesmo
 * pedido, e a única evidência seria um conflito inexplicado meses depois. Com
 * ele, a diferença é LEGÍVEL na linha do banco: `fp1_…` e `fp2_…` são
 * visivelmente de gerações distintas, e uma futura migração de formato pode
 * decidir o que fazer com cada uma em vez de adivinhar.
 *
 * ── CANONICALIZAÇÃO INJETIVA, E POR QUE A ANTERIOR NÃO ERA ──────────────────
 *
 * A forma antiga era `chave=valor` unida por `&`. Ela é AMBÍGUA: os campos
 * `{a: "x&b=y"}` e `{a: "x", b: "y"}` produzem a mesma string, e portanto o
 * mesmo digest. Nenhum campo do billing contém `&` hoje — mas "hoje" não é uma
 * propriedade, e um nome de pagador com `&` bastaria.
 *
 * Aqui cada nome e cada valor vão PREFIXADOS PELO PRÓPRIO COMPRIMENTO. Com o
 * comprimento à frente, nenhuma sequência de campos pode ser confundida com
 * outra: a decodificação é única, logo a codificação é injetiva.
 */

import { createHash } from "node:crypto";

/**
 * Geração do formato de digest.
 *
 * Mudou o algoritmo ou a canonicalização? Este número muda junto, e os digests
 * antigos continuam identificáveis.
 */
export const GERACAO_DE_DIGEST = "1";

/**
 * Serializa campos de forma injetiva.
 *
 * Ordem lexicográfica das chaves para que a ordem de escrita do objeto não
 * altere o resultado — dois pontos do código montando os mesmos campos em
 * ordens diferentes precisam produzir o mesmo digest.
 */
export function canonicalizar(campos: Readonly<Record<string, string | number>>): string {
  return Object.keys(campos)
    .sort()
    .map((k) => {
      const v = String(campos[k]);
      return `${k.length}:${k}=${v.length}:${v}`;
    })
    .join(";");
}

/**
 * Digest SHA-256 dos campos, com prefixo de tipo e geração.
 *
 * `tipo` separa espaços que nunca devem se cruzar: um fingerprint e uma chave
 * de idempotência derivados dos mesmos campos são valores DIFERENTES, porque
 * respondem perguntas diferentes.
 */
export function digest(tipo: string, campos: Readonly<Record<string, string | number>>): string {
  const hex = createHash("sha256")
    .update(`${tipo}|${GERACAO_DE_DIGEST}|${canonicalizar(campos)}`, "utf8")
    .digest("hex");
  return `${tipo}${GERACAO_DE_DIGEST}_${hex}`;
}
