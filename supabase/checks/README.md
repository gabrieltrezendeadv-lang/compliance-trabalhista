# Consultas de verificação — leitura apenas

## O que é isto

Sete arquivos `.sql` contendo **exclusivamente comandos `SELECT`**. Servem para
inspecionar o estado do banco depois de uma migration: assinatura de função,
`prosecdef`, `proconfig`, `proacl`, privilégios de tabela e contagens de
consistência.

## Por que existem em pasta separada

Estas consultas estavam **anexadas ao fim de sete dos treze arquivos** que
ocupavam `supabase/migrations/` antes da reconciliação da Fase 3. Elas **nunca
foram aplicadas no banco** — a comparação com o SQL efetivamente registrado em
`supabase_migrations.schema_migrations` mostrou que cada um daqueles arquivos
era prefixo-exato da versão aplicada **mais** esta cauda de verificação.

Quando `supabase/migrations/` passou a espelhar o histórico aplicado, as caudas
não tinham como permanecer lá: um arquivo de migration deve conter o que foi
aplicado, e nada além. Mas descartá-las perderia trabalho de auditoria legítimo.
Daí esta pasta.

## Garantias

- **Somente leitura.** Nenhum arquivo contém `INSERT`, `UPDATE`, `DELETE`,
  `DROP`, `CREATE`, `ALTER`, `GRANT`, `REVOKE` ou `TRUNCATE`. Verificado por
  `tests/migration-freeze-guard.mjs` (MF-17).
- **Não são migrations.** Esta pasta não é lida pelo Supabase CLI. Nada aqui
  entra no histórico de `schema_migrations`.
- **Cópia fiel.** O SQL foi transposto **verbatim** dos arquivos de origem, sem
  reformatação e sem acréscimo. Nenhuma consulta nova foi introduzida.

## Origem de cada arquivo

| arquivo | origem (agora em `supabase/history/pre-reconciliation/`) | versão aplicada correspondente |
|---|---|---|
| `fix_001_evidence_reports.sql` | `20260728150000_fix_001_evidence_reports.sql` | `20260728190937` |
| `fix_003_reverse_scoring.sql` | `20260728151000_fix_003_reverse_scoring.sql` | `20260728191019` |
| `fix_004_assessment_submission.sql` | `20260728152000_fix_004_assessment_submission.sql` | `20260728191046` |
| `priv_001_anonymous_assessments.sql` | `20260728152500_priv_001_anonymous_assessments.sql` | `20260728191110` + `20260728191144` + `20260728191241` |
| `sec_006_table_privileges.sql` | `20260728153000_sec_006_table_privileges.sql` | `20260728191255` |
| `sec_002_retire_plan_limit.sql` | `20260728154500_sec_002_retire_plan_limit.sql` | `20260728191311` |
| `fix_005_close_expired_cycles.sql` | `20260728155000_fix_005_close_expired_cycles.sql` | `20260728191324` |

## Como usar

Contra uma stack **local descartável**, jamais contra o projeto remoto sem
autorização própria:

```bash
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2-)" -f supabase/checks/<arquivo>.sql
```

Ver [`supabase/migrations/README.md`](../migrations/README.md) para o estado do
histórico e [`supabase/history/pre-reconciliation/README.md`](../history/pre-reconciliation/README.md)
para a matriz completa de reconciliação.
