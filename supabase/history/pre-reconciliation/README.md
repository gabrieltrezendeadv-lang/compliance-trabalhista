# Evidência histórica — os 13 arquivos anteriores à reconciliação

**Estes arquivos NÃO são migrations.** Esta pasta não é lida pelo Supabase CLI.
Nada aqui entra no histórico de `supabase_migrations.schema_migrations`.

Conteúdo **preservado byte a byte**, exatamente como estava em
`supabase/migrations/` antes da reconciliação da Fase 3. Movidos com `git mv`,
para que o histórico do Git registre continuidade em vez de exclusão seguida de
criação.

---

## Por que saíram de `supabase/migrations/`

O histórico do banco tem **36 versões aplicadas**. Estes 13 arquivos cobriam
**15** delas — e com prefixos de versão que **não existiam no histórico remoto**,
o que fazia o CLI considerar todos os 13 pendentes.

A Fase 2 recuperou as 36 versões canônicas a partir da coluna `statements` de
`supabase_migrations.schema_migrations`, com fidelidade provada por `md5_norm`
contra [`supabase/baseline/applied-migrations.tsv`](../../baseline/applied-migrations.tsv).
`supabase/migrations/` passou a conter essas 36 e só elas.

Descartar os 13 perderia informação: eles contêm comentários de intenção,
consultas de verificação e duas alterações locais que nunca chegaram ao banco.
Daí esta pasta.

---

## A aritmética 36 / 21 / 15 / 13

```
36 versões aplicadas no banco
−21 versões que não tinham nenhum arquivo correspondente
─────
 15 versões representadas por arquivo
```

São **15 versões cobertas por 13 arquivos** porque
`20260728152500_priv_001_anonymous_assessments.sql` — um arquivo só — foi
aplicado **fatiado em três versões**:

| fatia | versão aplicada | `name` no banco |
|---|---|---|
| 1 | `20260728191110` | `20260728152500_priv_001_anonymous_assessments_ddl` |
| 2 | `20260728191144` | `20260728152500_priv_001_anonymous_assessments_fns1` |
| 3 | `20260728191241` | `20260728152500_priv_001_anonymous_assessments_fns2_grants` |

`12 arquivos × 1 versão + 1 arquivo × 3 versões = 15 versões`, com 13 arquivos.

O alinhamento das três fatias foi confirmado por LCS sobre o texto normalizado,
na ordem `_ddl → _fns1 → _fns2_grants`: 101 hunks, dos quais **99 cosméticos**.

---

## Classes de reconciliação

| classe | significado |
|:-:|---|
| **A** | idêntico ao aplicado após normalização — `md5_norm` igual |
| **B** | diferença só de formatação ou comentário |
| **C** | diferença só em consulta de verificação, não aplicada |
| **D** | um arquivo consolidando mais de uma versão aplicada |
| **E** | diferença material de SQL |
| **F** | versão aplicada sem arquivo no repositório (não se aplica a esta pasta) |

---

## Matriz

`len` e `md5` referem-se ao SQL normalizado: blocos `/* */` removidos,
comentários `--` removidos, espaços colapsados, minúsculas, `trim`. Reproduzível
por [`tests/lib/normalize-sql.mjs`](../../../tests/lib/normalize-sql.mjs).

| arquivo nesta pasta | versão aplicada | classe | `len`/`md5` do aplicado | `len`/`md5` deste arquivo |
|---|---|:-:|---|---|
| `20260724130000_create_complaint_tables.sql` | `20260724121902` | **A** | 8776 · `68f7a76b0a4df9af3ae6d28fcd36da46` | 8776 · `68f7a76b0a4df9af3ae6d28fcd36da46` |
| `20260724150000_create_campaign_tables.sql` | `20260724122058` | **A** | 10154 · `b33ef68474bb4c5c62d6d022d272a751` | 10154 · `b33ef68474bb4c5c62d6d022d272a751` |
| `20260724160000_campaign_functions.sql` | `20260724122324` | **A** | 7242 · `a2b99eea6d665f0b7239e87a2a6bc54c` | 7242 · `a2b99eea6d665f0b7239e87a2a6bc54c` |
| `20260724140000_complaint_security_definer_functions.sql` | `20260724122001` | **B** | 12089 · `96a04f1cd59c77ada9921c7879484885` | 12111 · `4d7bea747c3a1a4e56e821eb3ceb20b2` |
| `20260727100000_sec_block1_expand.sql` | `20260728005535` | **E** | 26253 · `b0ac312f465e1a50faa71b9bbbe26212` | 26268 · `8a7498404119c34e20a21701a731ab58` |
| `20260727200000_sec_block1_contract.sql` | `20260728010455` | **E** + B | 7321 · `04b1564c6eec314407cf4f76adec455e` | 7360 · `ce3b83203bc9c27a09c27056e527c272` |
| `20260728150000_fix_001_evidence_reports.sql` | `20260728190937` | **C** + B | 5366 · `2c1eb0a04b549ee74192bb566a61a75f` | 5587 · `aa437ae186d9285845a0079a76a455af` |
| `20260728151000_fix_003_reverse_scoring.sql` | `20260728191019` | **E** + C + B | 8609 · `c08a005e26e23be3293216b3a82539a4` | 9005 · `e7ce7ffe901abe2786f67f447473649b` |
| `20260728152000_fix_004_assessment_submission.sql` | `20260728191046` | **C** + B | 4227 · `6775949b01618da5752d946790aad705` | 4449 · `15650c948180028c619d8fca51fbb224` |
| `20260728152500_priv_001_anonymous_assessments.sql` | `20260728191110` + `191144` + `191241` | **D** + E + C | 3430 · `d2ccfc6c31f667a10c987eac9325e9c2`<br>6294 · `f21b39794d148178cd244d46928febbb`<br>12617 · `94c66bad1875c0bb77f2f6c03a075477` | 22846 · `093c54c264b9ea25ce61ee369b448550` |
| `20260728153000_sec_006_table_privileges.sql` | `20260728191255` | **C** | 199 · `f22bcc325725287f9a2dc5c47f897033` | 466 · `1d8a265c0560c3a0ee425b595f354419` |
| `20260728154500_sec_002_retire_plan_limit.sql` | `20260728191311` | **C** | 215 · `0b6cb60abb0b4788dbd070c22966ea6e` | 414 · `ae048155f38d143c52269807d31e9d3a` |
| `20260728155000_fix_005_close_expired_cycles.sql` | `20260728191324` | **C** | 681 · `cdd6bfff6231250e196906b1c619d8c0` | 892 · `c08f7cda5bf82f0f90787b94de1ada2f` |

Método da classificação: comparação em dois níveis. O nível 1 é a normalização
acima. O nível 2 remove **todo** espaço e junta literais adjacentes — porque o
PostgreSQL concatena `'a ' 'b'` separados por whitespace com newline num único
literal. Diferença que desaparece no nível 2 é formatação. Somados os casos
divergentes: **141 hunks, 132 cosméticos, 9 substantivos**.

---

## As três diferenças materiais — todas inertes

### E-1 · Envelope `BEGIN;` / `COMMIT;` — `sec_block1_expand` e `sec_block1_contract`

Os arquivos desta pasta envolvem o corpo inteiro numa transação explícita. O
corpo é, fora isso, **byte a byte idêntico** ao aplicado: nenhum `CREATE`,
`DROP`, `GRANT` ou `REVOKE` difere. **Objetos afetados: nenhum.**

É diferença de atomicidade, não de esquema. O banco recebeu esses comandos sem
envelope; as versões canônicas reproduzem isso. Se atomicidade importar em
reaplicação futura, o lugar disso é o runner de migration, não o arquivo que
registra o que aconteceu.

### E-2 · `qs.dimension_code` em `fn_import_risks_from_cycle` — `fix_003`

```diff
  FOR v_dim IN
    SELECT qs.id AS section_id, qs.name AS section_name,
+          qs.dimension_code,
           count(DISTINCT ar.invitation_id) AS respondent_count, …
-   GROUP BY qs.id, qs.name
+   GROUP BY qs.id, qs.name, qs.dimension_code
```

Mudança local que **nunca chegou ao banco**: `pg_get_functiondef` da função viva
não contém `qs.dimension_code`.

Inerte por duas razões independentes:

1. **A coluna não é usada.** `v_dim.dimension_code` não aparece em nenhuma linha
   do corpo do loop.
2. **O agrupamento não muda.** `GROUP BY qs.id` já contém a chave primária de
   `questionnaire_sections`, da qual `dimension_code` é funcionalmente
   dependente.

Além disso, `fn_import_risks_from_cycle` foi **redefinida depois**, por
`20260728191241`. A definição viva usa `submission_batch_id`, não
`invitation_id` — o arquivo desta pasta é geração anterior.

### E-3 · Alias `1 AS sort_order` — `priv_001`, em `fn_assessment_participation_stats`

```diff
  FROM overall_counts oc
  UNION ALL
- SELECT 1, pg.item FROM protected_groups pg
+ SELECT 1 AS sort_order, pg.item FROM protected_groups pg
```

Também ausente da função viva. Inerte: em `UNION ALL`, os nomes das colunas de
saída vêm do primeiro braço, que já traz `0 AS sort_order`.

**Nenhuma migration forward-only foi criada para nenhuma das três.** Decisão
registrada na autorização da Fase 3B: as diferenças são inertes ou incompatíveis
com a finalidade de espelhar o histórico aplicado.

---

## As caudas de verificação

Sete destes arquivos terminavam com consultas `SELECT` de auditoria que **não
integram o SQL aplicado**. Em cada caso, o arquivo é prefixo-exato da versão
aplicada mais a cauda.

Foram extraídas para [`supabase/checks/`](../../checks/), verbatim, e continuam
presentes aqui — esta pasta preserva os arquivos originais sem alteração.

| arquivo | comandos na cauda | objeto inspecionado |
|---|:-:|---|
| `fix_001_evidence_reports` | 1 | `pg_proc` → `fn_generate_evidence_report` |
| `fix_003_reverse_scoring` | 1 | `pg_proc` → 3 funções de avaliação |
| `fix_004_assessment_submission` | 1 | `pg_proc` → `fn_submit_assessment` |
| `priv_001_anonymous_assessments` | 2 | contagens em `assessment_invitations` e `assessment_responses` |
| `sec_006_table_privileges` | 1 | `information_schema.role_table_grants` |
| `sec_002_retire_plan_limit` | 1 | `pg_proc` → `check_plan_limit` |
| `fix_005_close_expired_cycles` | 1 | `pg_proc` → `fn_close_expired_assessment_cycles` |

Todas verificadas como exclusivamente de leitura: nenhuma contém `INSERT`,
`UPDATE`, `DELETE`, `DROP`, `CREATE`, `ALTER`, `GRANT`, `REVOKE` ou `TRUNCATE`.

---

## Nota sobre os literais quebrados em `sec_block1_contract`

Oito ocorrências apareciam, num diff ingênuo, como se a mensagem de erro tivesse
mudado. Não mudou. O arquivo desta pasta quebra literais longos em duas linhas:

```sql
RAISE EXCEPTION 'CONTRACT ABORTED: fn_access_complaint_v2(text,text,text) nao encontrada. '
  'O EXPAND deve ser aplicado antes do CONTRACT.';
```

O PostgreSQL concatena literais separados por whitespace contendo newline. A
mensagem resultante é idêntica à da versão aplicada. Classificado como B.

---

## Itens correlatos

**Ausência de rollbacks.** As 36 versões aplicadas têm a coluna `rollback`
vazia. Risco independente desta reconciliação, registrado e **não** resolvido
com rollbacks retroativos inventados. Ver
[`docs/baseline/security-model.md`](../../../docs/baseline/security-model.md).

**`20260729000000_onboarding_tenant_guard`.** Existe apenas na branch
`feat/onboarding-tenant-guard` (`43582c3`), não foi aplicada no banco e não está
autorizada. Não entra em `supabase/migrations/`.
