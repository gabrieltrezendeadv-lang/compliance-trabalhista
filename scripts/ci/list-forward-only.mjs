/**
 * Lista os nomes de arquivo das migrations forward-only, uma por linha.
 *
 * Usado pelo workflow de reconstrução para separar as duas âncoras:
 * as 36 históricas sozinhas, e depois o conjunto completo.
 *
 * Sem argumentos lê supabase/migrations. Sai com 1 se a classificação tiver
 * qualquer problema — o workflow não deve prosseguir com o diretório em estado
 * duvidoso.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseManifest } from "../../tests/lib/manifest.mjs";
import { classificarMigrations } from "../../tests/lib/migrations.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dir = process.argv[2] ?? path.join(raiz, "supabase/migrations");

const versoes = parseManifest(
  fs.readFileSync(path.join(raiz, "supabase/baseline/applied-migrations.tsv"), "utf8")
).map((r) => r.version);

const c = classificarMigrations(dir, versoes);

if (c.problemas.length > 0) {
  for (const p of c.problemas) console.error(`problema: ${p}`);
  process.exit(1);
}

for (const f of c.forwardOnly) console.log(f.arquivo);
