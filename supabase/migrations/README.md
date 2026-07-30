# Histórico canônico de migrations — reconciliado

**Reconciliado em:** 29/07/2026 (Fase 3)
**Conteúdo:** as **36 versões históricas** efetivamente aplicadas no banco, mais
as migrations **forward-only** criadas depois da reconciliação
**Estado anterior:** 13 arquivos com prefixos ausentes do histórico remoto — ver
[`supabase/history/pre-reconciliation/`](../history/pre-reconciliation/README.md)

---

## Duas populações, com regras diferentes

| | Históricas | Forward-only |
|---|---|---|
| Quantas | **36**, congeladas | as criadas após a reconciliação |
| Constam de `applied-migrations.tsv` | **sim** | **não**, e não devem |
| Aplicadas no banco remoto | sim | **não** |
| Conteúdo conferido por `md5_norm` | **sim, obrigatoriamente** | não há hash de referência |
| Faixa de versão permitida | as 36 exatas | **estritamente maior** que `20260728191324` |

`applied-migrations.tsv` registra **o que o banco remoto aplicou**. Acrescentar
ali uma migration só porque ela existe no repositório seria afirmar uma aplicação
que não ocorreu, e o `md5_norm` daquela linha viraria ficção. **MF-22** reprova
isso.

A separação é implementada em
[`tests/lib/migrations.mjs`](../../tests/lib/migrations.mjs) e exercida por
[`tests/migration-classification-guard.mjs`](../../tests/migration-classification-guard.mjs),
que reprova migration **intercalada** na faixa congelada — a condição que tornava
`db push` perigoso — além de versão duplicada, regressiva, ausente ou fora do
padrão de nome.

### Migrations forward-only nesta pasta

| Versão | Arquivo | O que faz |
|---|---|---|
| `20260730123613` | `20260730123613_revoke_public_webhook_execute.sql` | retira `EXECUTE` de `PUBLIC` em `fn_process_webhook_event`; corrige a lacuna achada na Fase 4C |
| `20260731094500` | `20260731094500_make_tenant_resolution_deterministic.sql` | **TG-12** — `fn_resolve_tenant_id` passa a ordenar por `created_at ASC, id ASC`; sem isso, o tenant de usuário com mais de uma membership era escolhido de forma não determinística, e as 31 policies e `fn_user_has_role` herdavam a indeterminação |

A `20260731094500` é a primeira forward-only que altera **estrutura** — o corpo
de uma função aparece no dump, ACL não. É por isso que a verificação de
reconstrução passou a ter duas âncoras; ver
[`supabase/baseline/README.md`](../baseline/README.md).

---

## O que esta pasta contém

Um arquivo por versão registrada em `supabase_migrations.schema_migrations`, com
o nome no formato `<version>_<name>.sql`, onde `version` e `name` são **os
valores gravados no banco**.

Cada arquivo reproduz o SQL de `statements[1]` da sua versão. A fidelidade é
verificável: `md5_norm` de cada arquivo confere com
[`supabase/baseline/applied-migrations.tsv`](../baseline/applied-migrations.tsv),
e a conferência das 36 é executada por
[`tests/verify-recovered-migrations.mjs`](../../tests/verify-recovered-migrations.mjs).

### Por que nove arquivos têm timestamp duplo

```
20260728191255_20260728153000_sec_006_table_privileges.sql
└─ version ──┘ └────────── name gravado no banco ─────────┘
```

O `name` registrado no banco para as nove últimas versões **já era um nome de
arquivo com timestamp**. Reproduzi-lo é proposital: o CLI deriva a versão dos 14
dígitos iniciais, e manter o `name` fiel faz com que um `supabase migration
fetch` futuro produza exatamente estes mesmos nomes. Renomear para "ficar bonito"
quebraria essa correspondência e reintroduziria divergência entre repositório e
banco.

### Envelopes transacionais

`20260728005535_sec_block1_expand.sql` e `20260728010455_sec_block1_contract.sql`
**não** têm `BEGIN;`/`COMMIT;`. Os arquivos anteriores tinham; o banco recebeu
esses comandos sem envelope. Esta pasta registra o que foi aplicado. Se
atomicidade for necessária numa reaplicação, o lugar disso é o runner, não o
arquivo histórico.

---

## O que mudou com a reconciliação

| | antes | depois |
|---|---:|---:|
| Versões aplicadas no banco | 36 | 36 |
| Arquivos `.sql` nesta pasta | 13 | **36** |
| Versões cobertas por arquivo | 15 | **36** |
| Versões sem arquivo | **21** | **0** |
| Prefixos locais ausentes do histórico remoto | **13** | **0** |

A interseção entre prefixos locais e versões remotas era **vazia**; agora é
**total**. Era essa divergência que fazia o CLI considerar 13 migrations
pendentes e motivou o congelamento da Fase 1.

---

## Regras em vigor

**Continuam proibidos** — e verificados por
[`tests/migration-freeze-guard.mjs`](../../tests/migration-freeze-guard.mjs),
executado por `npm run verify`, cujo check `Verify` é obrigatório na `main`:

- `supabase db push`
- `supabase migration repair`
- `supabase migration up`
- `supabase migration fetch` (a exceção nominal da Fase 2 foi removida)
- `supabase link` e qualquer uso de `--linked`
- `supabase db reset` **contra o projeto remoto**

A reconciliação **não** é motivo para relaxar essas proibições. Ela remove a
divergência que existia; não estabelece que aplicar migration automaticamente
passou a ser seguro. Qualquer aplicação futura exige autorização própria.

**Permitido:**

- `supabase db reset` contra a stack **local descartável** — é o que
  [`baseline-verify.yml`](../../.github/workflows/baseline-verify.yml) faz, com
  `DB_URL` vindo de `supabase status`, nunca do projeto remoto
- leitura: `supabase migration list`, consultas a catálogos, `pg_dump --schema-only`

### Trava sobre o conjunto de arquivos

Três asserções, com propósitos distintos:

- **MF-08** — lista literal dos 36 nomes esperados. Pega remoção e renomeação.
- **MF-18** — todo prefixo de arquivo desta pasta existe em
  `applied-migrations.tsv`. Verifica a **propriedade**, não uma lista: pega
  arquivo novo com versão inventada, que é exatamente o que criava o risco de
  `db push`.
- **MF-19** — cada uma das 36 versões do manifesto tem **exatamente um** arquivo.
  Pega ausência e duplicidade.

MF-18 e MF-19 reduzem o risco de reintrodução, mas **não o eliminam**: são
verificações de texto e de nome de arquivo, executadas em CI. Alguém pode alterar
manifesto e arquivos na mesma mudança, ou aplicar migration por fora do
repositório — foi assim, aliás, que as 36 originais entraram. O guard torna a
reintrodução detectável e ruidosa; não a torna impossível.

---

## Como reconstruir schema hoje

Para ambiente descartável, o caminho validado continua sendo o snapshot
estrutural, não a reexecução das 36:

```bash
psql "$DB_URL" -f supabase/baseline/schema.sql
psql "$DB_URL" -f supabase/baseline/security.sql
psql "$DB_URL" -f supabase/baseline/verify.sql
```

Ver [`supabase/baseline/README.md`](../baseline/README.md).

**Provado na Fase 4C, para a estrutura.** Aplicar as 36 em sequência num banco
vazio produz um dump normalizado com o **mesmo SHA-256** do snapshot —
`1f938ed09ed834290729697e4db5e3e02c045d06ccda9d187ec7c4287d1c3c0c` —, com diff
estrutural vazio e piso de ruído vazio. Ver
[`supabase/baseline/PHASE-4C-REBUILD-REPORT.md`](../baseline/PHASE-4C-REBUILD-REPORT.md).

**Não provado para as permissões.** A mesma execução mostrou que as ACLs de
tabela e os *default privileges* de produção não estão no repositório, e revelou
que `fn_process_webhook_event` ficava executável por `PUBLIC` numa reconstrução
limpa — corrigido pela migration forward-only `20260730123613`. As demais
divergências de ACL seguem abertas e exigem decisão própria.

---

## Pastas correlatas

| pasta | conteúdo |
|---|---|
| [`../history/pre-reconciliation/`](../history/pre-reconciliation/README.md) | os 13 arquivos anteriores, preservados byte a byte, com a matriz completa de reconciliação |
| [`../checks/`](../checks/README.md) | as consultas `SELECT` de verificação que estavam anexadas a sete daqueles arquivos e nunca foram aplicadas |
| [`../baseline/`](../baseline/README.md) | snapshot estrutural restaurável e o manifesto `applied-migrations.tsv` |
| [`../manual/`](../manual/) | etapas que exigem execução manual no dashboard, como SEC-005 |

---

## Itens correlatos, tratados à parte

**Ausência de rollbacks.** As 36 versões aplicadas têm a coluna `rollback`
**vazia**. Não existe rollback registrado para nenhuma alteração já em produção.
É risco independente desta reconciliação e **não** será resolvido com rollbacks
retroativos inventados — apenas registrado. Ver
[`docs/baseline/security-model.md`](../../docs/baseline/security-model.md).

**`20260729000000_onboarding_tenant_guard`.** Existe apenas na branch
`feat/onboarding-tenant-guard` (`43582c3`), **não** foi aplicada no banco e
**não** está autorizada. Não entra nesta pasta.
