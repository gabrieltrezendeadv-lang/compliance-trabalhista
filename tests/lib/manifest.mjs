/**
 * PARSER DO MANIFESTO DE MIGRATIONS APLICADAS
 *
 * Lê `supabase/baseline/applied-migrations.tsv` — o TSV que registra, para cada
 * versão aplicada no banco, o `len_norm` e o `md5_norm` do SQL normalizado.
 *
 * Existe como módulo separado por um motivo concreto: o parser precisa ser
 * exercido por teste sem executar o verificador inteiro, que lê `process.argv`
 * e chama `process.exit`.
 *
 * ── POR QUE O TRIM POR CAMPO ────────────────────────────────────────────────
 *
 * O TSV é entregue com CRLF em checkout Windows. Sem tratamento, o último campo
 * de cada linha carrega um `\r`, e a comparação de `md5_norm` falha para TODAS
 * as linhas — com "esperado" e "obtido" visualmente idênticos na mensagem de
 * erro, o que torna o defeito especialmente difícil de diagnosticar.
 *
 * Há duas defesas, deliberadamente redundantes:
 *   1. `split(/\r?\n/)` — reconhece LF e CRLF como fim de linha;
 *   2. `.trim()` por campo — sobrevive a espaço/tab acidental e a CR isolado.
 *
 * `.gitattributes` declara `*.tsv text eol=lf`, o que ataca a causa. Ainda
 * assim o parser permanece robusto: um checkout antigo, um arquivo gerado por
 * outra ferramenta ou um `.gitattributes` removido não devem reintroduzir o
 * defeito. A regra de EOL e a robustez do parser resolvem problemas diferentes.
 */

const LINHA_CABECALHO = /^version\s*\t/;
const VERSAO = /^\d{14}$/;
const MD5 = /^[0-9a-f]{32}$/;

/**
 * Converte o texto do manifesto em registros validados.
 *
 * @param {string} texto conteúdo bruto do TSV
 * @returns {{version: string, name: string, len: number, md5: string}[]}
 * @throws {Error} se alguma linha de dados estiver malformada
 */
export function parseManifest(texto) {
  const linhas = texto
    .split(/\r?\n/)
    .map((l) => l.replace(/^﻿/, "")) // BOM de UTF-8, se houver
    .filter((l) => l.trim() !== "")
    .filter((l) => !l.trimStart().startsWith("#"))
    .filter((l) => !LINHA_CABECALHO.test(l));

  return linhas.map((linha) => {
    const campos = linha.split("\t").map((c) => c.trim());

    if (campos.length < 4) {
      throw new Error(
        `linha do manifesto com ${campos.length} campo(s), esperado 4: ${JSON.stringify(linha)}`
      );
    }

    const [version, name, lenTexto, md5] = campos;

    if (!VERSAO.test(version)) {
      throw new Error(`versão inválida no manifesto: ${JSON.stringify(version)}`);
    }
    if (name === "") {
      throw new Error(`nome vazio no manifesto para a versão ${version}`);
    }
    if (!/^\d+$/.test(lenTexto)) {
      throw new Error(
        `len_norm não numérico para ${version}: ${JSON.stringify(lenTexto)}`
      );
    }
    if (!MD5.test(md5)) {
      throw new Error(
        `md5_norm inválido para ${version}: ${JSON.stringify(md5)}`
      );
    }

    return { version, name, len: Number(lenTexto), md5 };
  });
}
