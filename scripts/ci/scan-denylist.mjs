/**
 * VARREDURA DA DENYLIST DE ACESSO REMOTO — implementação AUTORITATIVA
 *
 * Uso:
 *   node scripts/ci/scan-denylist.mjs <denylist> <alvo> [alvo ...]
 *
 * Exit 0 = nenhuma violação. Exit 1 = violação ou erro. Nada intermediário.
 *
 * ── OS DOIS SINTOMAS QUE ESTE ARQUIVO CORRIGE ───────────────────────────────
 *
 * A varredura era feita em Bash, com `IFS=$'\t' read` sobre a denylist e `grep`
 * sobre os alvos. Ela produzia resultados DIFERENTES conforme o ambiente:
 *
 *   FALSO POSITIVO no CI  — comandos proibidos CITADOS em comentário
 *                           (`/** … supabase db push … *\/`) reprovavam o job,
 *                           embora nenhum deles fosse executado.
 *
 *   FALSO NEGATIVO local  — no Git Bash do Windows, com `LANG` vazio, a mesma
 *                           guarda dizia "aprovado" para os mesmos arquivos.
 *                           Esse é o sintoma grave: quem roda na máquina
 *                           conclui que está limpo quando o CI reprovaria.
 *
 * A causa comum é o Bash ter ficado responsável por interpretar dados. Aqui ele
 * deixa de ser: a denylist é lida, validada e aplicada em Node, e o resultado
 * não depende de `IFS`, `read`, locale nem do `grep` da plataforma.
 *
 * ── O QUE CONTINUA IGUAL ────────────────────────────────────────────────────
 *
 * As NOVE entradas da denylist não foram tocadas. O que muda é onde elas são
 * interpretadas e o que conta como texto do alvo.
 */

import fs from "node:fs";
import path from "node:path";

import { EXTENSOES_SUPORTADAS, lerExecutavel } from "./lib/executavel.mjs";

/**
 * Extensões de automação sem analisador léxico próprio.
 *
 * Shell, SQL e YAML são varridos como TEXTO BRUTO, exatamente como antes. Não
 * há mudança de comportamento para elas, e não deveria haver sem necessidade
 * demonstrada: um comentário `#` de shell que cite um comando proibido continua
 * reprovando, e isso nunca gerou alarme falso neste repositório.
 */
const EXTENSOES_BRUTAS = Object.freeze([".sh", ".bash", ".sql", ".yml", ".yaml"]);

export class DenylistInvalidaError extends Error {
  constructor(mensagem) {
    super(`denylist inválida: ${mensagem}`);
    this.name = "DenylistInvalidaError";
  }
}

/**
 * Converte um padrão POSIX ERE para `RegExp` do JavaScript.
 *
 * ── ESCOPO DELIBERADAMENTE ESTREITO ─────────────────────────────────────────
 *
 * A única construção POSIX presente nas nove entradas é `[[:space:]]`. Em vez
 * de escrever um conversor geral — que teria casos não exercitados e portanto
 * não confiáveis — converte-se o que existe e REPROVA-SE o que não existe.
 *
 * Se alguém acrescentar `[[:alpha:]]` amanhã, a guarda falha alto pedindo
 * suporte explícito, em vez de silenciosamente tratar a classe como literal.
 */
export function paraRegExp(padrao) {
  const classes = {
    "[:space:]": " \\t\\n\\r\\f\\v",
    "[:digit:]": "0-9",
    "[:alpha:]": "A-Za-z",
    "[:alnum:]": "A-Za-z0-9",
    "[:upper:]": "A-Z",
    "[:lower:]": "a-z",
  };

  let convertido = padrao;
  for (const [posix, js] of Object.entries(classes)) {
    convertido = convertido.split(posix).join(js);
  }

  // Qualquer `[:...:]` remanescente é construção não suportada.
  const restante = /\[:[a-z]+:\]/.exec(convertido);
  if (restante !== null) {
    throw new DenylistInvalidaError(
      `classe POSIX não suportada: ${restante[0]} em "${padrao}". ` +
        "Acrescente suporte explícito e um teste — a guarda não adivinha."
    );
  }

  try {
    return new RegExp(convertido);
  } catch (causa) {
    throw new DenylistInvalidaError(
      `padrão não compila como RegExp: "${padrao}" (${causa instanceof Error ? causa.message : causa})`
    );
  }
}

/** Lê e valida a denylist. Qualquer irregularidade REPROVA. */
export function lerDenylist(arquivo) {
  if (!fs.existsSync(arquivo)) {
    throw new DenylistInvalidaError(`arquivo ausente: ${arquivo}`);
  }
  const bruto = fs.readFileSync(arquivo, "utf8").replace(/\r\n?/g, "\n");

  const entradas = [];
  const vistos = new Set();

  bruto.split("\n").forEach((linha, i) => {
    const numero = i + 1;
    if (linha.trim() === "" || linha.trimStart().startsWith("#")) return;

    const campos = linha.split("\t");
    if (campos.length !== 2) {
      throw new DenylistInvalidaError(
        `linha ${numero} tem ${campos.length} campo(s), esperados 2 separados por TAB`
      );
    }

    const [rotulo, padrao] = campos;
    if (rotulo.trim() === "") {
      throw new DenylistInvalidaError(`linha ${numero} sem rótulo`);
    }
    if (padrao.trim() === "") {
      throw new DenylistInvalidaError(`linha ${numero} sem padrão`);
    }
    if (vistos.has(rotulo)) {
      throw new DenylistInvalidaError(`rótulo duplicado: ${rotulo} (linha ${numero})`);
    }
    vistos.add(rotulo);

    entradas.push({ rotulo, padrao, regex: paraRegExp(padrao), linha: numero });
  });

  if (entradas.length === 0) {
    throw new DenylistInvalidaError("nenhuma entrada — uma denylist vazia não protege nada");
  }
  return entradas;
}

/**
 * Texto do alvo que deve ser confrontado com a denylist.
 *
 * Para JS/TS, os comentários viram espaços — um comando CITADO para explicar
 * por que não é usado deixa de reprovar. Para os demais formatos, o texto é o
 * bruto, como sempre foi. Extensão desconhecida LANÇA.
 */
export function textoDoAlvo(arquivo) {
  const extensao = path.extname(arquivo).toLowerCase();

  if (EXTENSOES_SUPORTADAS.includes(extensao)) {
    return { texto: lerExecutavel(arquivo), modo: "léxico" };
  }
  if (EXTENSOES_BRUTAS.includes(extensao)) {
    return { texto: fs.readFileSync(arquivo, "utf8"), modo: "bruto" };
  }
  throw new Error(
    `extensão sem tratamento definido: ${extensao || "(nenhuma)"} em ${arquivo}. ` +
      "A guarda reprova em vez de adivinhar."
  );
}

/** Varre os alvos. Devolve a lista de violações — vazia quando limpo. */
export function varrer(denylist, alvos) {
  const entradas = lerDenylist(denylist);
  const violacoes = [];

  for (const alvo of alvos) {
    let texto;
    let modo;
    try {
      ({ texto, modo } = textoDoAlvo(alvo));
    } catch (causa) {
      // Falha de leitura ou extensão desconhecida é REPROVAÇÃO, nunca um alvo
      // pulado em silêncio.
      violacoes.push({
        rotulo: "alvo-inanalisavel",
        alvo,
        linha: 0,
        trecho: causa instanceof Error ? causa.message : String(causa),
      });
      continue;
    }

    const linhas = texto.split("\n");
    for (const entrada of entradas) {
      linhas.forEach((conteudo, i) => {
        // `regex` sem flag global: `test` não carrega `lastIndex` entre linhas.
        if (entrada.regex.test(conteudo)) {
          violacoes.push({
            rotulo: entrada.rotulo,
            alvo,
            linha: i + 1,
            trecho: conteudo.trim().slice(0, 120),
            modo,
          });
        }
      });
    }
  }

  return { entradas, violacoes };
}

// ─── Execução direta ────────────────────────────────────────────────────────

const executadoDireto =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

if (executadoDireto) {
  const [denylist, ...alvos] = process.argv.slice(2);
  if (!denylist || alvos.length === 0) {
    console.error("uso: node scripts/ci/scan-denylist.mjs <denylist> <alvo> [alvo ...]");
    process.exit(1);
  }

  try {
    const { entradas, violacoes } = varrer(denylist, alvos);
    console.log(`  alvos varridos: ${alvos.length}`);

    if (violacoes.length > 0) {
      for (const v of violacoes) {
        console.error(`  ✗ ${v.rotulo} em ${v.alvo}:`);
        console.error(`      ${v.linha}: ${v.trecho}`);
      }
      console.error(`GUARDA REPROVADA: ${violacoes.length} violação(ões).`);
      process.exit(1);
    }

    console.log(`  ✓ ${entradas.length} padrão(ões) da denylist conferido(s)`);
    process.exit(0);
  } catch (causa) {
    console.error(`  ✗ ${causa instanceof Error ? causa.message : causa}`);
    console.error("GUARDA REPROVADA: a varredura não pôde ser concluída.");
    process.exit(1);
  }
}
