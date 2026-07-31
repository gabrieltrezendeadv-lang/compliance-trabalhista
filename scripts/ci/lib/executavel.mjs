/**
 * CONTEÚDO EXECUTÁVEL DE UM ARQUIVO — comentários removidos por SCANNER LÉXICO
 *
 * ── POR QUE NÃO REGEX ───────────────────────────────────────────────────────
 *
 * Remover comentário com expressão regular erra em casos que aparecem todo dia:
 *
 *   const u = "https://exemplo.test/a";   // o `//` da URL não é comentário
 *   const s = "abre /* e fecha";          // `/*` dentro de string não abre bloco
 *   const r = /a\/\/b/;                   // regex literal contém `//`
 *   a/**\/b                               // comentário ENTRE tokens não pode colá-los
 *
 * Cada um desses ou apaga código de verdade, ou preserva o que deveria sumir.
 * Num varredor de segurança, os dois erros são graves: o primeiro esconde
 * comando proibido, o segundo produz alarme falso — e alarme falso repetido
 * ensina a ignorar a guarda.
 *
 * Por isso a tokenização é feita pelo scanner do TypeScript, que é o mesmo que
 * o compilador usa. Ele já sabe o que é comentário, string, template literal e
 * regex literal.
 *
 * ── PRESERVAÇÃO DE POSIÇÃO ──────────────────────────────────────────────────
 *
 * Cada comentário vira ESPAÇOS do mesmo comprimento, e as quebras de linha
 * internas são mantidas. Duas consequências deliberadas:
 *
 *   * o número da linha no diagnóstico continua sendo o do arquivo original —
 *     sem isso, a mensagem apontaria para um lugar que não existe;
 *   * tokens separados por comentário NÃO se encostam. `supabase/*x*\/db push`
 *     não pode virar `supabase db push`, senão o varredor passaria a inventar
 *     correspondências.
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/** Extensões que este módulo sabe analisar lexicalmente. */
export const EXTENSOES_SUPORTADAS = Object.freeze([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"]);

export class ExtensaoNaoSuportadaError extends Error {
  constructor(arquivo) {
    super(
      `extensão sem analisador léxico: ${arquivo}. ` +
        "A guarda reprova em vez de adivinhar — fail-closed."
    );
    this.name = "ExtensaoNaoSuportadaError";
  }
}

/**
 * Devolve o conteúdo com os comentários trocados por espaços.
 *
 * Lança em extensão não suportada. Quem chama decide se isso é reprovação —
 * e, na guarda, é.
 */
export function conteudoExecutavel(origem, extensao) {
  if (!EXTENSOES_SUPORTADAS.includes(extensao)) {
    throw new ExtensaoNaoSuportadaError(extensao);
  }

  // `setText` + `scan()` percorre os tokens. Comentários são "trivia", e o
  // scanner os expõe quando `skipTrivia` é falso.
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ false,
    // JSX não é relevante para os alvos da guarda, e ligá-lo mudaria a
    // interpretação de `<` — que aparece em comparações.
    ts.LanguageVariant.Standard,
    origem
  );

  const saida = Array.from(origem);
  let anterior = ts.SyntaxKind.Unknown;

  while (true) {
    const token = scanner.scan();
    if (token === ts.SyntaxKind.EndOfFileToken) break;

    // ── Regex literal ────────────────────────────────────────────────────
    //
    // `/` é ambíguo: divisão ou início de regex. O scanner decide pelo token
    // ANTERIOR, e é preciso pedir a reinterpretação explicitamente — senão
    // `/ab\/\/cd/` seria lido como divisão seguida de comentário de linha.
    let atual = token;
    if (
      (token === ts.SyntaxKind.SlashToken ||
        token === ts.SyntaxKind.SlashEqualsToken) &&
      podeIniciarRegex(anterior)
    ) {
      atual = scanner.reScanSlashToken();
    }

    if (
      atual === ts.SyntaxKind.SingleLineCommentTrivia ||
      atual === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      const inicio = scanner.getTokenStart();
      const fim = scanner.getTokenEnd();
      for (let i = inicio; i < fim; i += 1) {
        // Quebra de linha preservada: o número da linha do arquivo original
        // continua valendo no diagnóstico.
        if (saida[i] !== "\n" && saida[i] !== "\r") saida[i] = " ";
      }
    }

    if (
      atual !== ts.SyntaxKind.WhitespaceTrivia &&
      atual !== ts.SyntaxKind.NewLineTrivia &&
      atual !== ts.SyntaxKind.SingleLineCommentTrivia &&
      atual !== ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      anterior = atual;
    }
  }

  return saida.join("");
}

/**
 * O token anterior permite que uma barra inicie regex?
 *
 * Depois de identificador, literal, `)` ou `]`, a barra é DIVISÃO. Nos demais
 * casos pode abrir regex. A lista é conservadora: na dúvida, trata como regex,
 * porque interpretar regex como divisão faria o resto da linha virar
 * comentário — que é o erro perigoso.
 */
function podeIniciarRegex(anterior) {
  switch (anterior) {
    case ts.SyntaxKind.Identifier:
    case ts.SyntaxKind.NumericLiteral:
    case ts.SyntaxKind.BigIntLiteral:
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
    case ts.SyntaxKind.TemplateTail:
    case ts.SyntaxKind.RegularExpressionLiteral:
    case ts.SyntaxKind.CloseParenToken:
    case ts.SyntaxKind.CloseBracketToken:
    case ts.SyntaxKind.CloseBraceToken:
    case ts.SyntaxKind.ThisKeyword:
    case ts.SyntaxKind.TrueKeyword:
    case ts.SyntaxKind.FalseKeyword:
    case ts.SyntaxKind.NullKeyword:
    case ts.SyntaxKind.PlusPlusToken:
    case ts.SyntaxKind.MinusMinusToken:
      return false;
    default:
      return true;
  }
}

/**
 * Lê um arquivo e devolve o conteúdo executável.
 *
 * Erro de leitura e extensão desconhecida LANÇAM. A guarda que chama trata
 * qualquer exceção como reprovação — um arquivo que não se consegue analisar
 * não pode ser declarado limpo.
 */
export function lerExecutavel(arquivo) {
  const extensao = path.extname(arquivo).toLowerCase();
  const origem = fs.readFileSync(arquivo, "utf8");
  return conteudoExecutavel(origem, extensao);
}
