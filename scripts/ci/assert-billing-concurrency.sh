#!/usr/bin/env bash
# =============================================================================
# CORRIDA REAL — duas conexões independentes disputando a mesma chave
# =============================================================================
#
# Uso:
#   bash scripts/ci/assert-billing-concurrency.sh "$DB_URL"
#
# ── POR QUE ESTE ARQUIVO EXISTE ──────────────────────────────────────────────
#
# `assert-billing-orchestration.sql` roda numa sessão só. Um INSERT duplicado
# sequencial, ali, prova que a constraint existe — e nada além disso. A versão
# anterior daquele arquivo afirmava, no cabeçalho, provar "duas transações reais
# disputando a mesma chave". Não provava, e a revisão final pegou.
#
# Concorrência não se simula dentro de uma transação. Ou há duas conexões, ou
# não há teste.
#
# ── A BARREIRA ───────────────────────────────────────────────────────────────
#
# Duas conexões iniciadas "ao mesmo tempo" pelo shell não disputam nada: uma
# quase sempre termina antes de a outra abrir. Para que a disputa seja real, as
# duas precisam ser soltas no MESMO instante.
#
#   1. o árbitro toma um advisory lock EXCLUSIVO e o segura;
#   2. os dois disputantes pedem o MESMO lock em modo COMPARTILHADO e bloqueiam;
#   3. o árbitro solta; os dois acordam juntos e chamam a RPC.
#
# É a mesma técnica de um portão de largada, e usa só o que o PostgreSQL já tem.
#
# ── O QUE TEM DE ACONTECER ───────────────────────────────────────────────────
#
#   * exatamente UM `claimed`, e o outro NÃO `claimed`;
#   * o perdedor lê o registro do VENCEDOR (mesmo fingerprint → `in_progress`);
#   * uma única linha de idempotência para a chave;
#   * uma única cobrança, mesmo com os dois tentando finalizar;
#   * fingerprint divergente reprova, mesmo na corrida.
#
# As fixtures aqui são COMITADAS — precisam ser visíveis às duas conexões. A
# limpeza é explícita, e conferida no fim.
# =============================================================================

set -euo pipefail

DB_URL="${1:?uso: assert-billing-concurrency.sh <DB_URL>}"
PSQL="${PGBIN:+$PGBIN/}psql"

# Guarda de segurança: este script ESCREVE e comita. Nunca fora do descartável.
HOST=$(printf '%s' "$DB_URL" | sed -E 's#^[^@]*@([^:/]+).*#\1#')
case "$HOST" in
  localhost|127.0.0.1|::1) ;;
  *) echo "FALHA: corrida só roda contra banco local descartável (host=$HOST)"; exit 1 ;;
esac

Q() { "$PSQL" "$DB_URL" -v ON_ERROR_STOP=1 -At "$@"; }

ORG='0c0c0000-0000-4000-8000-000000000001'
DONO='0c0c0000-0000-4000-8000-000000000011'

limpar() {
  "$PSQL" "$DB_URL" -q -At >/dev/null 2>&1 <<SQL || true
DELETE FROM billing.provider_events       WHERE organization_id = '$ORG';
DELETE FROM billing.charges               WHERE organization_id = '$ORG';
DELETE FROM billing.idempotency_records   WHERE organization_id = '$ORG';
DELETE FROM billing.customers             WHERE organization_id = '$ORG';
DELETE FROM billing.audit_events          WHERE organization_id = '$ORG';
DELETE FROM billing.price_snapshots
 WHERE subscription_id IN (SELECT id FROM billing.subscriptions WHERE organization_id = '$ORG');
DELETE FROM billing.subscriptions         WHERE organization_id = '$ORG';
DELETE FROM public.organization_members   WHERE tenant_id = '$ORG';
DELETE FROM public.organizations          WHERE id = '$ORG';
DELETE FROM public.profiles               WHERE id = '$DONO';
DELETE FROM auth.users                    WHERE id = '$DONO';
SQL
}
trap limpar EXIT

echo "== preparando fixtures (comitadas: as duas conexões precisam enxergá-las) =="
limpar
Q >/dev/null <<SQL
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES ('$DONO', '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', 'dono@corrida.test')
ON CONFLICT (id) DO NOTHING;
-- auth.users tem trigger que ja cria o perfil. O INSERT abaixo cobre o caso
-- de a trigger nao existir no descartavel. Sem crase: heredoc nao-quotado.
INSERT INTO public.profiles (id, full_name, email)
VALUES ('$DONO', 'dono corrida', 'dono@corrida.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.organizations (id, name, slug)
VALUES ('$ORG', 'Fixture corrida', 'fixture-corrida');
INSERT INTO public.organization_members (tenant_id, user_id, role, created_at)
VALUES ('$ORG', '$DONO', 'owner', '2026-01-01T00:00:00Z');
SELECT public.fn_billing_start_trial(
  '$DONO', '$ORG', 'essencial', 't1_20', 'monthly', 10, '00000000000191',
  '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-08-08T00:00:00Z',
  9990, '2026-07-30.1', 'corr-race');
SQL

# ── Disputante ──────────────────────────────────────────────────────────────
# Bloqueia na barreira, acorda, reivindica. Imprime só o veredito.
disputante() {
  local rotulo="$1" fingerprint="$2" saida="$3"
  "$PSQL" "$DB_URL" -v ON_ERROR_STOP=1 -At > "$saida" 2>&1 <<SQL
BEGIN;
SELECT pg_advisory_xact_lock_shared(918273);
SELECT public.fn_billing_claim_idempotency(
  '$DONO', '$ORG', 'command', 'mock', 'race-1',
  '$fingerprint', 'corr-$rotulo', now())->>'outcome';
COMMIT;
SQL
}

echo
echo "== CORRIDA 1: mesmo fingerprint, dois disputantes =="
# O árbitro segura o portão por 2s.
"$PSQL" "$DB_URL" -v ON_ERROR_STOP=1 -At -c \
  "BEGIN; SELECT pg_advisory_xact_lock(918273); SELECT pg_sleep(2); COMMIT;" >/dev/null &
ARBITRO=$!
sleep 0.4   # tempo para o árbitro pegar o lock

disputante A fp-igual /tmp/corrida-a.txt &
PA=$!
disputante B fp-igual /tmp/corrida-b.txt &
PB=$!

wait "$ARBITRO" "$PA" "$PB"

# O desfecho, e nao o tag de status: `-At` ainda imprime BEGIN/COMMIT, e
# `tail -1` devolvia "COMMIT". O conjunto de desfechos e fechado, entao
# extrai-se por ele.
desfecho() { grep -oE '^(claimed|in_progress|completed|fingerprint_conflict)$' "$1" | head -1; }
A=$(desfecho /tmp/corrida-a.txt)
B=$(desfecho /tmp/corrida-b.txt)
echo "  disputante A: $A"
echo "  disputante B: $B"

CLAIMS=0
[ "$A" = "claimed" ] && CLAIMS=$((CLAIMS + 1))
[ "$B" = "claimed" ] && CLAIMS=$((CLAIMS + 1))

if [ "$CLAIMS" -ne 1 ]; then
  echo "FALHA: esperado exatamente 1 vencedor, houve $CLAIMS"
  echo "       (0 significa que ninguém reivindicou; 2 significa que a chave"
  echo "        foi reivindicada duas vezes — efeito duplicado)"
  exit 1
fi

# O perdedor tem de ter LIDO o vencedor, não recebido erro.
PERDEDOR=$([ "$A" = "claimed" ] && echo "$B" || echo "$A")
if [ "$PERDEDOR" != "in_progress" ]; then
  echo "FALHA: o perdedor devolveu '$PERDEDOR'; deveria ler o vencedor e dizer in_progress"
  exit 1
fi

LINHAS=$(Q -c "SELECT count(*) FROM billing.idempotency_records WHERE key='race-1';")
if [ "$LINHAS" != "1" ]; then
  echo "FALHA: a chave disputada tem $LINHAS linha(s); deveria ter exatamente 1"
  exit 1
fi
echo "  confere: 1 vencedor, perdedor leu o vencedor, 1 linha de idempotência"

echo
echo "== CORRIDA 2: fingerprints DIVERGENTES na mesma chave =="
Q -c "DELETE FROM billing.idempotency_records WHERE key='race-2';" >/dev/null

"$PSQL" "$DB_URL" -v ON_ERROR_STOP=1 -At -c \
  "BEGIN; SELECT pg_advisory_xact_lock(918274); SELECT pg_sleep(2); COMMIT;" >/dev/null &
ARBITRO2=$!
sleep 0.4

for par in "C:fp-um" "D:fp-dois"; do
  rot="${par%%:*}"; fp="${par##*:}"
  "$PSQL" "$DB_URL" -v ON_ERROR_STOP=1 -At > "/tmp/corrida-$rot.txt" 2>&1 <<SQL &
BEGIN;
SELECT pg_advisory_xact_lock_shared(918274);
SELECT public.fn_billing_claim_idempotency(
  '$DONO', '$ORG', 'command', 'mock', 'race-2',
  '$fp', 'corr-$rot', now())->>'outcome';
COMMIT;
SQL
done
wait

C=$(desfecho /tmp/corrida-C.txt); D=$(desfecho /tmp/corrida-D.txt)
echo "  disputante C: $C"
echo "  disputante D: $D"

# Um reivindica; o outro, com pedido diferente, tem de receber conflito — e
# NUNCA o resultado do primeiro.
if ! { [ "$C" = "claimed" ] && [ "$D" = "fingerprint_conflict" ]; } &&
   ! { [ "$D" = "claimed" ] && [ "$C" = "fingerprint_conflict" ]; }; then
  echo "FALHA: esperado um 'claimed' e um 'fingerprint_conflict'; houve '$C' e '$D'"
  exit 1
fi
echo "  confere: pedido divergente na mesma chave foi recusado"

echo
echo "== CORRIDA 3: dois finalize concorrentes, uma cobrança só =="
VENCEDOR_FP=fp-igual
"$PSQL" "$DB_URL" -v ON_ERROR_STOP=1 -At -c \
  "BEGIN; SELECT pg_advisory_xact_lock(918275); SELECT pg_sleep(2); COMMIT;" >/dev/null &
ARBITRO3=$!
sleep 0.4

for rot in E F; do
  "$PSQL" "$DB_URL" -At > "/tmp/corrida-$rot.txt" 2>&1 <<SQL &
BEGIN;
SELECT pg_advisory_xact_lock_shared(918275);
SELECT public.fn_billing_finalize_checkout(
  '$DONO', '$ORG', 'mock', 'acct-1', 'cus-1', 'chg-race',
  'pix', 9990, '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z',
  'race-1', '$VENCEDOR_FP', 'corr-$rot', now())->>'outcome';
COMMIT;
SQL
done
wait

echo "  finalize E: $(desfecho /tmp/corrida-E.txt)"
echo "  finalize F: $(desfecho /tmp/corrida-F.txt)"

COBRANCAS=$(Q -c "SELECT count(*) FROM billing.charges WHERE organization_id='$ORG';")
if [ "$COBRANCAS" != "1" ]; then
  echo "FALHA: $COBRANCAS cobrança(s) criadas; a idempotência deveria garantir exatamente 1"
  exit 1
fi

SNAPS=$(Q -c "SELECT count(*) FROM billing.price_snapshots ps
                JOIN billing.subscriptions s ON s.id = ps.subscription_id
               WHERE s.organization_id='$ORG';")
if [ "$SNAPS" != "1" ]; then
  echo "FALHA: $SNAPS snapshot(s); o trial cria um e o checkout não cria outro"
  exit 1
fi
echo "  confere: 1 cobrança e 1 snapshot, apesar de dois finalize simultâneos"

echo
echo "== CORRIDA 4: dois takeover de uma lease VENCIDA =="
#
# A corrida 1 disputa uma chave INEXISTENTE, e quem resolve é o UNIQUE do
# INSERT. Esta disputa é outra: a linha já existe, está `in_progress`, e a lease
# venceu. Quem resolve agora é o `FOR UPDATE` — os dois disputantes serializam
# ali, o primeiro grava `started_at = p_now` e sai com `claimed`, e o segundo,
# ao adquirir o lock, relê a linha JÁ atualizada, encontra lease válida e sai
# com `in_progress`.
#
# Sem a comparação temporal os dois sairiam `claimed`, e o efeito aconteceria
# duas vezes. Sem o `FOR UPDATE` os dois leriam a versão antiga — mesmo
# desfecho ruim, por outro caminho.
Q -c "DELETE FROM billing.idempotency_records WHERE key='race-lease';" >/dev/null

# Reserva plantada com `started_at` bem no passado: a lease de 5 minutos já
# venceu com folga quando os disputantes chegarem com `now()`.
Q -c "SELECT public.fn_billing_claim_idempotency(
        '$DONO', '$ORG', 'command', 'mock', 'race-lease',
        'fp-lease', 'corr-plantio', now() - interval '1 hour');" >/dev/null

ESTADO=$(Q -c "SELECT status FROM billing.idempotency_records WHERE key='race-lease';")
if [ "$ESTADO" != "in_progress" ]; then
  echo "FALHA: a reserva plantada está '$ESTADO'; deveria estar in_progress"
  exit 1
fi

"$PSQL" "$DB_URL" -v ON_ERROR_STOP=1 -At -c \
  "BEGIN; SELECT pg_advisory_xact_lock(918276); SELECT pg_sleep(2); COMMIT;" >/dev/null &
ARBITRO4=$!
sleep 0.4

for rot in G H; do
  "$PSQL" "$DB_URL" -At > "/tmp/corrida-$rot.txt" 2>&1 <<SQL &
BEGIN;
SELECT pg_advisory_xact_lock_shared(918276);
SELECT public.fn_billing_claim_idempotency(
  '$DONO', '$ORG', 'command', 'mock', 'race-lease',
  'fp-lease', 'corr-$rot', now())->>'outcome';
COMMIT;
SQL
done
wait

G=$(desfecho /tmp/corrida-G.txt)
H=$(desfecho /tmp/corrida-H.txt)
echo "  takeover G: $G"
echo "  takeover H: $H"

TOMADAS=0
[ "$G" = "claimed" ] && TOMADAS=$((TOMADAS + 1))
[ "$H" = "claimed" ] && TOMADAS=$((TOMADAS + 1))

if [ "$TOMADAS" -ne 1 ]; then
  echo "FALHA: esperado exatamente 1 takeover, houve $TOMADAS"
  echo "       (2 significa que a reserva foi retomada duas vezes — o efeito"
  echo "        aconteceria em duplicidade, que é o que a lease impede)"
  exit 1
fi

PERDEDOR4=$([ "$G" = "claimed" ] && echo "$H" || echo "$G")
if [ "$PERDEDOR4" != "in_progress" ]; then
  echo "FALHA: o perdedor do takeover devolveu '$PERDEDOR4'; deveria ler a lease"
  echo "       recém-renovada e dizer in_progress"
  exit 1
fi

LINHAS4=$(Q -c "SELECT count(*) FROM billing.idempotency_records WHERE key='race-lease';")
if [ "$LINHAS4" != "1" ]; then
  echo "FALHA: o takeover disputado deixou $LINHAS4 linha(s); deveria ser 1"
  exit 1
fi

# O `started_at` tem de ter avançado: é a marca do takeover.
RENOVADA=$(Q -c "SELECT (started_at > now() - interval '5 minutes')::text
                   FROM billing.idempotency_records WHERE key='race-lease';")
if [ "$RENOVADA" != "true" ]; then
  echo "FALHA: started_at não foi renovado pelo takeover"
  exit 1
fi
echo "  confere: 1 takeover, perdedor leu a lease renovada, 1 linha, started_at avançado"

echo
echo "corrida real conferida — barreira por advisory lock, duas conexões independentes"
