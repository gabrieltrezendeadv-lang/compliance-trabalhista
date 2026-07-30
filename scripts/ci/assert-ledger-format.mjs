/**
 * VALIDAÇÃO ESTRITA DO ARQUIVO DE LEDGER LIDO DO BANCO
 *
 * Uso:
 *   node scripts/ci/assert-ledger-format.mjs <bruto> <destino>
 *
 * Lê o arquivo bruto produzido pelo psql, exige que TODA linha esteja no
 * formato `<14 dígitos>|<nome>`, e só então grava o destino. Qualquer linha
 * fora do formato reprova com diagnóstico — não é escondida.
 *
 * ── POR QUE ISTO EXISTE ─────────────────────────────────────────────────────
 *
 * A terceira falha da estreia da rota. O passo lia o ledger assim:
 *
 *   psql -A -t -F '|' -c "BEGIN TRANSACTION READ ONLY; SELECT ...; ROLLBACK;"
 *
 * e redirecionava o stdout para o arquivo. O psql imprime o TAG DE STATUS de
 * cada comando: o arquivo recebeu `BEGIN`, as 36 linhas reais e `ROLLBACK` —
 * 38 linhas. O `check-ledger.mjs` leu as 38 como registros.
 *
 * O detalhe que torna o defeito grave, e não apenas ruidoso: `BEGIN` e
 * `ROLLBACK` ordenam DEPOIS de qualquer versão numérica (`'B' > '2'`), então a
 * classificação as tomou por **forward-only** — e o log da execução real diz
 * exatamente isso: "forward-only ... 2". A reprovação veio da ordenação, por
 * acidente. Se os tags tivessem ordenado antes, a rota teria seguido adiante
 * com o ledger corrompido.
 *
 * Daí a regra desta validação ser lista de PERMITIDOS, e não lista de
 * proibidos: filtrar `BEGIN` e `ROLLBACK` por nome resolveria este caso e
 * deixaria a porta aberta para o próximo tag — `SET`, `NOTICE`, um aviso do
 * servidor, uma linha de continuação. O que não bate com o formato reprova.
 */

import fs from "node:fs";

const [bruto, destino] = process.argv.slice(2);

if (!bruto || !destino) {
  console.error("uso: node scripts/ci/assert-ledger-format.mjs <bruto> <destino>");
  process.exit(2);
}

if (!fs.existsSync(bruto)) {
  console.error(`FALHA: arquivo bruto inexistente: ${bruto}`);
  process.exit(1);
}

// `<14 dígitos>|<nome não vazio>`. O nome não pode conter `|`: o separador é
// justamente ele, e um nome com `|` significaria que a saída do psql não é
// mais decomponível sem ambiguidade.
const LINHA = /^(\d{14})\|([^|]+)$/;

const conteudo = fs.readFileSync(bruto, "utf8");
const linhas = conteudo.split(/\r?\n/);

const problemas = [];
const registros = [];

linhas.forEach((linha, i) => {
  const n = i + 1;
  // Linha vazia só é tolerada no fim do arquivo (o \n final).
  if (linha === "") {
    if (i !== linhas.length - 1) problemas.push(`linha ${n}: vazia no meio do arquivo`);
    return;
  }
  const m = linha.match(LINHA);
  if (!m) {
    // O diagnóstico mostra a linha: ela vem do catálogo de migrations, não de
    // dado de negócio, e sem vê-la o operador não tem como agir.
    problemas.push(`linha ${n}: fora do formato <14 dígitos>|<nome>: ${JSON.stringify(linha)}`);
    return;
  }
  registros.push({ version: m[1], name: m[2], linha: n });
});

if (registros.length === 0) {
  problemas.push("nenhum registro válido — o ledger não pode estar vazio");
}

// Ordem estritamente crescente e sem duplicidade. O SELECT já traz ORDER BY;
// conferir aqui é o que transforma a promessa em verificação.
for (let i = 1; i < registros.length; i += 1) {
  const anterior = registros[i - 1];
  const atual = registros[i];
  if (atual.version === anterior.version) {
    problemas.push(`versão duplicada ${atual.version} (linhas ${anterior.linha} e ${atual.linha})`);
  } else if (atual.version < anterior.version) {
    problemas.push(
      `fora de ordem: ${atual.version} (linha ${atual.linha}) vem depois de ` +
        `${anterior.version} (linha ${anterior.linha})`
    );
  }
}

if (problemas.length > 0) {
  console.error("LEDGER LIDO DO BANCO — FORMATO REPROVADO");
  console.error("");
  for (const p of problemas) console.error(`  ✗ ${p}`);
  console.error("");
  console.error("  Nenhuma linha foi descartada em silêncio: o arquivo tem de conter");
  console.error("  exclusivamente registros <14 dígitos>|<nome>. Se o psql passou a");
  console.error("  emitir tag de status, aviso ou cabeçalho, corrija a LEITURA —");
  console.error("  filtrar a saída esconderia a próxima surpresa.");
  process.exit(1);
}

fs.writeFileSync(destino, registros.map((r) => `${r.version}|${r.name}`).join("\n") + "\n", "utf8");

console.log(`ledger lido: ${registros.length} registro(s), todos no formato esperado`);
console.log(`  primeira ... ${registros[0].version}|${registros[0].name}`);
console.log(`  última ..... ${registros.at(-1).version}|${registros.at(-1).name}`);
console.log(`  destino .... ${destino}`);
