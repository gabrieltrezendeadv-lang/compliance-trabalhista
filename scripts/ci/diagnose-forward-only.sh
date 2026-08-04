#!/usr/bin/env bash
# =============================================================================
# ENSAIO DIAGNÓSTICO DAS FORWARD-ONLY — psql, uma transação, ROLLBACK obrigatório
# =============================================================================
#
# Uso:
#   bash scripts/ci/diagnose-forward-only.sh "$DB_URL" <arquivo.sql> [arquivo.sql ...]
#
# ── POR QUE ESTE PASSO EXISTE ────────────────────────────────────────────────
#
# O `supabase start` aplica as migrations, mas o wrapper `effect/sql` do CLI
# NÃO expõe a mensagem do `RAISE EXCEPTION`: ele imprime apenas
# "At statement: N" e despeja o texto do statement. Uma pós-condição que falha
# fica indiagnosticável — foi exatamente o que aconteceu com `pc_assinaturas`,
# e três execuções não revelaram a causa.
#
# `psql` imprime MESSAGE, DETAIL, HINT e CONTEXT. Este ensaio existe para
# obter essa informação, e só para isso.
#
# ── O QUE ELE NÃO É ──────────────────────────────────────────────────────────
#
# NÃO substitui a aplicação pelo CLI. Termina obrigatoriamente em ROLLBACK e
# não deixa nada aplicado. A prova autoritativa continua sendo: o CLI aplica, o
# ledger confere, os verificadores independentes passam e o dump bate com a
# âncora. Este passo roda ANTES, e só informa.
#
# ── SEGURANÇA ────────────────────────────────────────────────────────────────
#
# Somente loopback. Nenhuma credencial é impressa: a URL nunca vai ao log, e a
# saída passa por sanitização antes de ser exibida.
# =============================================================================

set -uo pipefail

DB_URL="${1:?uso: diagnose-forward-only.sh <DB_URL> <arquivo.sql> [...]}"
shift
[ "$#" -gt 0 ] || { echo "FALHA: nenhuma migration informada"; exit 2; }

PSQL="${PGBIN:+$PGBIN/}psql"

# ── Guarda de destino ───────────────────────────────────────────────────────
HOST=$(printf '%s' "$DB_URL" | sed -E 's#^[^@]*@([^:/]+).*#\1#')
case "$HOST" in
  localhost|127.0.0.1|::1) ;;
  *) echo "FALHA: o ensaio só roda contra a stack descartável local (host recebido não é loopback)"; exit 1 ;;
esac

# ── Recusa migrations com controle próprio de transação ─────────────────────
#
# Um `COMMIT` no meio quebraria a garantia de ROLLBACK e deixaria efeito
# aplicado. Um `BEGIN` aninhado mudaria a semântica. Nos dois casos o ensaio
# deixa de ser seguro, e por isso ele se recusa a rodar.
#
# ── O QUE ESTA CHECAGEM NÃO PODE FAZER ──────────────────────────────────────
#
# `BEGIN` e `END` são também delimitadores de bloco PL/pgSQL, e aparecem às
# dezenas dentro de `DO $$ … $$` e de corpos de função. A primeira versão desta
# guarda casava `END;` indentado e reprovava a própria 12B — foi o ensaio que
# denunciou o defeito, o que é exatamente o serviço que ele existe para prestar.
#
# Controle de transação no NÍVEL DA MIGRATION fica na coluna 1; código dentro de
# bloco é sempre indentado. A âncora `^` é o que separa os dois casos, e `END`
# sai da lista porque não há forma textual de distingui-lo do fim de bloco.
for arquivo in "$@"; do
  [ -f "$arquivo" ] || { echo "FALHA: $arquivo não existe"; exit 1; }
  if grep -nEi '^(BEGIN|COMMIT|ROLLBACK|START[[:space:]]+TRANSACTION)[[:space:]]*;' "$arquivo"; then
    echo "FALHA: $arquivo tem controle próprio de transação — o ensaio não pode garantir o ROLLBACK"
    exit 1
  fi
done

echo "== migrations do ensaio, na ordem =="
printf '  %s\n' "$@"

# ── Monta o roteiro: tudo numa transação, ROLLBACK ao final ─────────────────
ROTEIRO=$(mktemp)
SAIDA=$(mktemp)
trap 'rm -f "$ROTEIRO" "$SAIDA"' EXIT

{
  echo "\\set ON_ERROR_STOP on"
  # `verbose` traz MESSAGE, DETAIL, HINT e CONTEXT — que é o que falta no CLI.
  echo "\\set VERBOSITY verbose"
  echo "\\timing off"
  # `notice` deixa os RAISE NOTICE das pós-condições aparecerem.
  echo "SET client_min_messages TO notice;"
  echo "BEGIN;"
  for arquivo in "$@"; do
    echo "\\echo '>>> aplicando ${arquivo}'"
    echo "\\i ${arquivo}"
  done
  # ROLLBACK explícito no caminho feliz. No caminho de erro, `ON_ERROR_STOP`
  # encerra a sessão e o PostgreSQL desfaz a transação aberta — nos dois casos
  # nada permanece.
  echo "ROLLBACK;"
  echo "\\echo '>>> ROLLBACK executado'"
} > "$ROTEIRO"

# `-X` ignora ~/.psqlrc: nenhuma configuração de máquina influencia o ensaio.
set +e
"$PSQL" -X "$DB_URL" -v ON_ERROR_STOP=1 -f "$ROTEIRO" > "$SAIDA" 2>&1
CODIGO=$?
set -e

# ── Sanitização ─────────────────────────────────────────────────────────────
# Remove qualquer coisa com cara de credencial antes de imprimir.
sed -E \
  -e 's#postgres(ql)?://[^[:space:]]*#postgres://«omitido»#g' \
  -e 's#(password|senha)[[:space:]]*=[[:space:]]*[^[:space:]]*#\1=«omitido»#Ig' \
  -e 's#eyJ[A-Za-z0-9_.-]{20,}#«token omitido»#g' \
  "$SAIDA"

echo
echo "== conferência do rollback =="
NADA=$("$PSQL" -X "$DB_URL" -v ON_ERROR_STOP=1 -At -c \
  "SELECT count(*) FROM pg_namespace WHERE nspname = 'billing';")
if [ "$NADA" != "0" ]; then
  echo "FALHA: o schema billing sobreviveu ao ensaio — o ROLLBACK não valeu"
  exit 1
fi
RPCS=$("$PSQL" -X "$DB_URL" -v ON_ERROR_STOP=1 -At -c \
  "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'fn\\_billing\\_%';")
if [ "$RPCS" != "0" ]; then
  echo "FALHA: $RPCS RPC(s) sobreviveram ao ensaio — o ROLLBACK não valeu"
  exit 1
fi
echo "confere: nada permaneceu (billing=0 schemas, fn_billing_*=0 funções)"

if [ "$CODIGO" -ne 0 ]; then
  echo
  echo "== ensaio REPROVOU (exit $CODIGO) — a mensagem do PostgreSQL está acima =="
  exit "$CODIGO"
fi

echo "ensaio aprovado: as migrations aplicam limpo, e nada permaneceu"
