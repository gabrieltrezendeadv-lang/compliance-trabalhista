#!/usr/bin/env bash
#
# LEITURA SOMENTE-LEITURA DO LEDGER DE MIGRATIONS
#
# Uso:
#   bash scripts/ci/read-remote-ledger.sh <arquivo-destino>
#
# Implementação ÚNICA, usada pelos passos ANTES e DEPOIS da rota de aplicação.
# Duas cópias do mesmo comando divergem — foi assim que o defeito da estreia
# existiu em dois lugares ao mesmo tempo.
#
# ── COMO A LEITURA É SOMENTE LEITURA ────────────────────────────────────────
#
# `PGOPTIONS=-c default_transaction_read_only=on` liga o modo somente leitura
# na SESSÃO. Vale para tudo o que a sessão fizer, inclusive statements que
# alguém acrescentasse depois — é mais abrangente que um `BEGIN TRANSACTION
# READ ONLY` explícito, que só cobre o bloco que envolve.
#
# E, ao contrário do bloco explícito, não faz o psql imprimir tag de status.
# Era daí que vinham as linhas `BEGIN` e `ROLLBACK` no arquivo: elas não eram
# ruído do servidor, eram o psql relatando o resultado de cada comando. Um
# único SELECT com `-A -t` emite apenas as tuplas.
#
# ── FLAGS, E POR QUE CADA UMA ───────────────────────────────────────────────
#
#   -X                 ignora ~/.psqlrc — o arquivo de outra pessoa poderia
#                      ligar \timing, mudar o formato ou imprimir um banner
#   -q                 sem mensagens informativas
#   -v ON_ERROR_STOP=1 erro de SQL derruba o comando em vez de seguir
#   -A                 saída não alinhada (sem colunas preenchidas)
#   -t                 só as tuplas: sem cabeçalho, sem rodapé de contagem
#   -F '|'             separador exigido pelo check-ledger
#   -P pager=off       nada de paginador, mesmo se herdado do ambiente
#
# A conexão vem das variáveis PG* do ambiente. Nada de credencial em argv.
#
# ── VALIDAÇÃO ───────────────────────────────────────────────────────────────
#
# A saída bruta NÃO vira o arquivo final. Ela passa por
# `assert-ledger-format.mjs`, que exige que toda linha seja
# `<14 dígitos>|<nome>` e reprova com diagnóstico caso contrário. Falha
# fechada: destino só é escrito se tudo estiver conforme.

set -euo pipefail

DESTINO="${1:-}"
if [ -z "$DESTINO" ]; then
  echo "uso: bash scripts/ci/read-remote-ledger.sh <arquivo-destino>" >&2
  exit 2
fi

PSQL="${PGBIN:+$PGBIN/}psql"
BRUTO="$(mktemp)"
trap 'rm -f "$BRUTO"' EXIT

PGOPTIONS='-c default_transaction_read_only=on' \
"$PSQL" -X -q -v ON_ERROR_STOP=1 -A -t -F '|' -P pager=off \
  -c "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;" \
  > "$BRUTO"

echo "linhas brutas lidas do banco: $(wc -l < "$BRUTO")"

node scripts/ci/assert-ledger-format.mjs "$BRUTO" "$DESTINO"
