#!/usr/bin/env bash
#
# LIMPEZA DAS FIXTURES DO CONTRATO — WRAPPER COM RECUSA ANTES DA CONEXÃO
#
# Uso:
#   bash scripts/ci/teardown-contract-fixtures.sh
#
# Lê DB_URL do ambiente. PGBIN, se definida, aponta o diretório do psql.
#
# ── POR QUE UM WRAPPER, E POR QUE A RECUSA VEM ANTES ────────────────────────
#
# `teardown-contract-fixtures.sql` desliga os triggers de imutabilidade dentro
# da própria transação (`SET LOCAL session_replication_role = replica`). É a
# única operação do repositório que afrouxa uma proteção de billing, ainda que
# por uma transação e só para o proprietário.
#
# Uma operação com esse poder não pode descobrir o destino DEPOIS de conectar.
# Se a URL apontasse para fora da stack descartável, a conexão já teria sido
# aberta e as credenciais já teriam trafegado antes de qualquer verificação. Por
# isso o destino é decidido aqui, em texto, antes de o psql existir no processo.
#
# A recusa é fail-closed em três frentes:
#
#   DB_URL ausente ......... nada a limpar, sai 0 (a stack pode não ter subido)
#   destino não-loopback ... REPROVA, sem conectar
#   schema billing ausente . a 12B não foi aplicada, nada a limpar, sai 0
#
# O terceiro caso só é alcançado depois que o destino já foi provado loopback.

set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SQL="$RAIZ/scripts/ci/teardown-contract-fixtures.sql"
PSQL="${PGBIN:+$PGBIN/}psql"

# ── 1. Sem stack, nada a limpar ─────────────────────────────────────────────
if [ -z "${DB_URL:-}" ]; then
  echo "  → DB_URL ausente: a stack não subiu, nada a limpar"
  exit 0
fi

# ── 2. O DESTINO É DECIDIDO ANTES DE CONECTAR ───────────────────────────────
#
# O host é extraído da URI por substituição de texto. A URI NÃO é impressa em
# hipótese alguma — ela carrega a senha do Postgres local.
#
# A primeira alternativa do grupo cobre IPv6 entre colchetes: sem ela, `[^:/?]+`
# pararia no primeiro `:` e o host de `[::1]` viraria `[`, que não casa com
# nenhum destino conhecido — recusa correta pelo motivo errado.
host="$(printf '%s' "$DB_URL" | sed -E 's#^[a-z+]+://([^@/]*@)?(\[[^]]+\]|[^:/?]+).*#\2#')"

case "$host" in
  127.0.0.1|localhost|::1|'[::1]')
    echo "  ✓ destino da limpeza: $host (loopback)" ;;
  *)
    echo "  ✗ destino da limpeza NÃO é loopback: $host"
    echo ""
    echo "GUARDA REPROVADA: esta limpeza desliga triggers de imutabilidade por"
    echo "uma transação e só pode tocar a stack descartável. Nenhuma conexão"
    echo "foi aberta."
    exit 1 ;;
esac

# ── 3. Sem a 12B aplicada, não há o que limpar ──────────────────────────────
#
# Insistir produziria um erro derivado ("schema billing não existe") que
# esconderia a causa real da falha anterior.
existe="$("$PSQL" -X "$DB_URL" -At -c \
  "SELECT count(*) FROM pg_namespace WHERE nspname='billing';" 2>/dev/null || echo 0)"

if [ "$existe" != "1" ]; then
  echo "  → schema billing ausente: a 12B não chegou a ser aplicada, nada a limpar"
  exit 0
fi

# ── 4. Limpeza ──────────────────────────────────────────────────────────────
exec "$PSQL" -X "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL"
