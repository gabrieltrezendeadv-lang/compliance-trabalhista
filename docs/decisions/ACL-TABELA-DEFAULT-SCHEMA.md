# Decisão — `tabela-acl`, `default-acl` e `schema-acl`

**Data:** 2026-07-30 · **Fase:** 6B.1 · **Situação:** decidido, sem correção nesta fase

**Decisão em uma linha:** as três categorias permanecem **divergentes e documentadas**. Nenhuma correção de ACL é feita agora, e nenhuma delas bloqueia a rota de aplicação.

---

## Do que se trata

O `migration-rebuild-verify` compara a extração de catálogo do banco reconstruído com a do banco restaurado do baseline, em sete categorias. Quatro fecham em zero e **bloqueiam**: `tabela (RLS/force/dono)`, `funcao (secdef/search_path)`, `funcao-acl` e `policy`. Três não fecham:

| Categoria | Linhas | Natureza |
|---|---:|---|
| `tabela-acl` | 581 | ambiente |
| `default-acl` | 75 | não comparável |
| `schema-acl` | 4 | não comparável |

Números da execução [`30556763063`](https://github.com/gabrieltrezendeadv-lang/compliance-trabalhista/actions/runs/30556763063), idênticos aos da Fase 4C — a divergência é estável, não crescente.

## Por que cada uma diverge

**`tabela-acl` (581) — diferença de ambiente, não defeito.** `supabase/baseline/schema.sql` foi gerado com `--no-privileges`; os `GRANT` de tabela vivem em `security.sql`, que é escrito à mão e concede em bloco (`GRANT ... ON ALL TABLES`). O banco de produção tem grants que o repositório não registra, e `security.sql` achata casos que as migrations diferenciam — por exemplo `assessment_dispatches`, de onde `priv_001` revogou privilégios de `anon`. Comparar as duas coisas é comparar duas fontes que nunca foram a mesma.

**`default-acl` (75) e `schema-acl` (4) — não comparáveis pelo procedimento atual.** A fase de restauração do baseline executa `DROP SCHEMA public CASCADE`, e isso apaga as linhas de `pg_default_acl` associadas. O lado restaurado não tem como exibir o que foi destruído antes de ser lido. **Não é um resultado sobre o banco: é um resultado sobre o método.** Enquanto o procedimento não mudar, o número não significa nada, nem para mais nem para menos.

## Por que não corrigir agora

1. **Corrigir `tabela-acl` exige decidir a fonte da verdade** — se o repositório passa a declarar os grants de tabela por migration, ou se `security.sql` deixa de ser bloco e passa a ser tabela a tabela. É uma mudança de modelo, com risco de revogar em produção um privilégio que a aplicação usa. Não é trabalho de uma fase que está construindo a rota de aplicação.

2. **Corrigir `default-acl`/`schema-acl` começa por consertar a medição**, não o banco: restaurar o baseline num banco **separado**, sem `DROP SCHEMA`, e só então comparar. Antes disso, qualquer "correção" estaria mirando um artefato do procedimento.

3. **Nenhuma delas é a exposição que importava.** A que importava — `EXECUTE` para `PUBLIC` em rotina `SECURITY DEFINER` — está fechada por `20260730123613`, coberta por asserção sem allowlist, e a partir desta fase é **verificação obrigatória do `Verify`**.

## O que fica valendo

- As três categorias continuam **exibidas** no veredito e no artefato `diff-seguranca-categorias.txt`. Não são silenciadas, filtradas nem removidas do diff.
- Elas **não bloqueiam** o veredito, e essa classificação é explícita no workflow — não é omissão.
- As quatro categorias bloqueantes **continuam exigindo zero**. Nenhuma foi movida para o lado não bloqueante para fazer o teste passar.

## Como sair daqui

Ordem sugerida, cada item em fase própria:

1. **Consertar a medição de `default-acl`/`schema-acl`:** restaurar o baseline num banco distinto do reconstruído, eliminando o `DROP SCHEMA` do caminho de leitura. Só depois disso o número vira informação.
2. **Decidir a fonte da verdade dos grants de tabela.** Recomendação: migrations declaram, `security.sql` deixa de conceder em bloco. Exige inventário do que produção concede hoje — leitura remota, agregada e somente leitura.
3. **Reclassificar `tabela-acl` como bloqueante** somente depois de (2), quando os dois lados passarem a ter a mesma fonte.

Enquanto (1) e (2) não acontecerem, reclassificar qualquer uma delas como bloqueante só produziria um CI vermelho permanente — que é a forma mais eficaz de ensinar uma equipe a ignorar o CI.

## Referências

- `supabase/baseline/PHASE-4C-REBUILD-REPORT.md` §6.2 (`tabela-acl`) e §6.3 (`default-acl`, `schema-acl`)
- `.github/workflows/migration-rebuild-verify.yml` — passo *Diff — segurança (extração × extração), por categoria*
- `scripts/ci/extract-security.sql` — as sete categorias
- `scripts/ci/assert-no-public-execute.sql` — a asserção que passou a ser obrigatória
