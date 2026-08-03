#!/usr/bin/env bash
#
# GUARDA — O TESTE DE RECONSTRUÇÃO RODA EXCLUSIVAMENTE CONTRA A STACK LOCAL
#
# Reprova o job antes de qualquer operação de banco se o caminho de execução
# tiver adquirido capacidade de alcançar o projeto Supabase de produção.
#
# Quatro seções, invocadas em momentos distintos do workflow:
#
#   pre     antes de instalar qualquer ferramenta — varre o texto da automação
#           contra scripts/ci/remote-access-denylist.txt e exige que as
#           variáveis de credencial estejam ausentes do ambiente.
#   config  depois de `supabase init` — audita o config.toml gerado.
#   dburl   depois de `supabase start` — exige que DB_URL seja loopback.
#   post    ao final — reconfirma ausência de sessão autenticada e de vínculo.
#
# Este arquivo NOMEIA as variáveis de credencial (SUPABASE_ACCESS_TOKEN,
# SUPABASE_DB_PASSWORD) porque precisa testá-las. Já os literais de comando que
# a guarda de congelamento reprova em automação não aparecem aqui em lugar
# algum — nem em comentário: vêm da denylist em .txt. Ver o cabeçalho daquele
# arquivo.
#
# A varredura NÃO abre exceção para linha de comentário, de propósito. A guarda
# de congelamento abre (ela ignora linhas iniciadas por `#`); aqui o alvo é bem
# menor — cinco arquivos — e manter a regra sem exceção elimina o comentário
# como esconderijo. O preço é este: descrever os literais proibidos exige
# perífrase. É preço barato.

set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DENYLIST="$RAIZ/scripts/ci/remote-access-denylist.txt"
WORKFLOW="$RAIZ/.github/workflows/migration-rebuild-verify.yml"

falhas=0

reprovar() {
  echo "  ✗ $1"
  falhas=$((falhas + 1))
}

aprovar() {
  echo "  ✓ $1"
}

# ── pre ─────────────────────────────────────────────────────────────────────
#
# Escopo da varredura: o workflow e os scripts que ele executa. Deliberadamente
# NÃO é o repositório inteiro — o ref do projeto aparece em prosa de
# documentação e na guarda de congelamento, e reprovar isso seria alarme falso.
# O que importa aqui é o caminho de execução.
secao_pre() {
  echo "== Guarda pre: texto da automação e ambiente =="

  [ -f "$DENYLIST" ] || { echo "  ✗ denylist ausente: $DENYLIST"; exit 1; }
  [ -f "$WORKFLOW" ] || { echo "  ✗ workflow ausente: $WORKFLOW"; exit 1; }

  # ── A VARREDURA É DO NODE, NÃO DO BASH ────────────────────────────────────
  #
  # Esta seção interpretava a denylist com `IFS=$'	' read` e aplicava os
  # padrões com `grep`. O resultado DEPENDIA do ambiente: no Git Bash do
  # Windows, com `LANG` vazio, aprovava arquivos que o CI do Linux reprovava —
  # um falso negativo, que é o pior dos dois erros possíveis numa guarda.
  #
  # O Bash passa a ser wrapper: monta a lista de alvos e propaga o exit code.
  # Quem lê a denylist, valida o formato, converte os padrões e decide é
  # `scan-denylist.mjs`, cujo resultado não depende de locale.
  local alvos=("$WORKFLOW")
  for f in "$RAIZ"/scripts/ci/*.sh "$RAIZ"/scripts/ci/*.mjs "$RAIZ"/scripts/ci/*.sql            "$RAIZ"/scripts/ci/lib/*.mjs; do
    [ -e "$f" ] && alvos+=("$f")
  done

  if node "$RAIZ/scripts/ci/scan-denylist.mjs" "$DENYLIST" "${alvos[@]}"; then
    aprovar "denylist conferida pelo varredor léxico"
  else
    reprovar "varredura da denylist reprovou"
  fi

  # Credenciais: ausentes do ambiente. Vazia conta como ausente.
  for var in SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD SUPABASE_DB_URL \
             SUPABASE_DB_URL_DUMP SUPABASE_PROJECT_ID SUPABASE_PROJECT_REF \
             PGPASSWORD PGSERVICEFILE; do
    if [ -n "${!var:-}" ]; then
      reprovar "$var está definida no ambiente do job"
    fi
  done
  aprovar "nenhuma variável de credencial definida"

  # Sessão autenticada do CLI: o token de acesso é gravado em disco por
  # `supabase login`. Sua ausência prova que o CLI não tem como falar com a
  # API do Supabase em nome de conta alguma.
  for caminho in "$HOME/.supabase/access-token" \
                 "${XDG_CONFIG_HOME:-$HOME/.config}/supabase/access-token"; do
    if [ -f "$caminho" ]; then
      reprovar "token de acesso do CLI presente em $caminho"
    fi
  done
  aprovar "nenhum token de acesso do CLI em disco"

  # Vínculo a projeto remoto: gravado em supabase/.temp/project-ref.
  if [ -e "$RAIZ/supabase/.temp/project-ref" ]; then
    reprovar "supabase/.temp/project-ref existe — há vínculo a projeto remoto"
  else
    aprovar "nenhum vínculo a projeto remoto (supabase/.temp/project-ref ausente)"
  fi

  encerrar
}

# ── config ──────────────────────────────────────────────────────────────────
#
# `supabase init` sempre escreve `project_id` no config.toml. Esse campo é o
# NOME LOCAL do projeto — usado para rotular os contêineres Docker —, não um
# ref de projeto remoto. Reprová-lo por si reprovaria todo uso legítimo do CLI
# local. A verificação precisa, portanto, é outra: o project_id tem de ser o
# nome do diretório do repositório, e o vínculo remoto de verdade
# (supabase/.temp/project-ref) tem de continuar ausente.
secao_config() {
  echo "== Guarda config: config.toml gerado =="
  local cfg="$RAIZ/supabase/config.toml"
  [ -f "$cfg" ] || { echo "  ✗ config.toml não foi gerado"; exit 1; }

  local esperado
  esperado="$(basename "$RAIZ")"
  local declarado
  declarado="$(grep -m1 -E '^[[:space:]]*project_id[[:space:]]*=' "$cfg" \
    | sed -E 's/.*=[[:space:]]*"?([^"]*)"?[[:space:]]*$/\1/')"

  if [ "$declarado" = "$esperado" ]; then
    aprovar "project_id = \"$declarado\" (nome do diretório local, não ref remoto)"
  else
    reprovar "project_id = \"$declarado\", esperado \"$esperado\""
  fi

  # A denylist inteira vale para o config.toml, menos nada: aqui project_id já
  # foi tratado acima e os demais padrões não têm uso legítimo.
  while IFS=$'\t' read -r rotulo padrao; do
    case "$rotulo" in ''|'#'*) continue ;; esac
    [ -z "${padrao:-}" ] && continue
    if grep -nE -- "$padrao" "$cfg" >/dev/null 2>&1; then
      reprovar "$rotulo no config.toml:"
      grep -nE -- "$padrao" "$cfg" | sed 's/^/      /'
    fi
  done < "$DENYLIST"
  aprovar "config.toml livre dos padrões da denylist"

  if [ -e "$RAIZ/supabase/.temp/project-ref" ]; then
    reprovar "supabase/.temp/project-ref apareceu depois do init"
  else
    aprovar "nenhum vínculo remoto após o init"
  fi

  encerrar
}

# ── dburl ───────────────────────────────────────────────────────────────────
secao_dburl() {
  echo "== Guarda dburl: destino da conexão =="
  [ -n "${DB_URL:-}" ] || { echo "  ✗ DB_URL não está definida"; exit 1; }

  # Extrai o host sem imprimir a URI (ela carrega a senha do Postgres local).
  local host
  host="$(printf '%s' "$DB_URL" | sed -E 's#^[a-z]+://([^@/]*@)?([^:/?]+).*#\2#')"
  local porta
  porta="$(printf '%s' "$DB_URL" | sed -nE 's#^[a-z]+://([^@/]*@)?[^:/?]+:([0-9]+).*#\2#p')"

  case "$host" in
    127.0.0.1|localhost|::1|0.0.0.0)
      aprovar "host da conexão: $host (loopback), porta ${porta:-padrão}" ;;
    *)
      reprovar "host da conexão NÃO é loopback: $host" ;;
  esac

  encerrar
}

# ── post ────────────────────────────────────────────────────────────────────
secao_post() {
  echo "== Guarda post: nenhuma credencial ou vínculo surgiu durante o job =="

  for caminho in "$HOME/.supabase/access-token" \
                 "${XDG_CONFIG_HOME:-$HOME/.config}/supabase/access-token"; do
    if [ -f "$caminho" ]; then
      reprovar "token de acesso do CLI apareceu em $caminho"
    fi
  done
  aprovar "nenhum token de acesso do CLI em disco"

  if [ -e "$RAIZ/supabase/.temp/project-ref" ]; then
    reprovar "supabase/.temp/project-ref apareceu durante o job"
  else
    aprovar "nenhum vínculo a projeto remoto ao final"
  fi

  # Os contêineres da stack local escutam em loopback. Registrado como
  # evidência do destino das conexões abertas pelo job.
  echo "  portas em escuta (loopback esperado):"
  ss -ltn 2>/dev/null | sed 's/^/      /' || echo "      (ss indisponível)"

  encerrar
}

encerrar() {
  if [ "$falhas" -gt 0 ]; then
    echo ""
    echo "GUARDA REPROVADA: $falhas violação(ões)."
    exit 1
  fi
  echo "  → seção aprovada"
}

case "${1:-}" in
  pre) secao_pre ;;
  config) secao_config ;;
  dburl) secao_dburl ;;
  post) secao_post ;;
  *) echo "uso: $0 {pre|config|dburl|post}"; exit 2 ;;
esac
