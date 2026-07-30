# Fase 4C — teste de reconstrução sequencial das 36 migrations

Registro do resultado da execução única do workflow
[`migration-rebuild-verify.yml`](../../.github/workflows/migration-rebuild-verify.yml).

**Pergunta testada:** as 36 migrations canônicas de [`../migrations/`](../migrations/),
aplicadas em sequência num banco vazio, reproduzem o snapshot desta pasta?

**Resposta:** a estrutura, **sim, com igualdade de hash**. As permissões, **não** —
e a divergência apontou uma lacuna de segurança preexistente no histórico já
aplicado.

Que os 36 arquivos sejam cópia fiel do SQL registrado no banco é uma afirmação
diferente, provada antes por `md5_norm` 36/36
([`applied-migrations.tsv`](applied-migrations.tsv)) e reconferida neste job
antes da aplicação. Fidelidade de arquivo não implica reprodutibilidade de
estado; é essa segunda afirmação que este teste mediu.

---

## 1. Execução

| | |
|---|---|
| URL | https://github.com/gabrieltrezendeadv-lang/compliance-trabalhista/actions/runs/30511794528 |
| SHA executado | `13df7d9e62d739902b6832be9126d6aded2d4cb0` |
| Base do SHA | `5cad5a1bc0320e8a33a3a7168721ce3ad3e40656` (+12/−0: gatilho de push e condição de ref, nada mais) |
| Conclusão do job | `failure` — **por desenho**, no passo `Veredito`, pela comparação de segurança. Todos os demais 29 passos passaram. |
| Execuções | **uma**, sem rerun |

O SHA executado não existe mais como branch: `test/migration-rebuild-verify-once`
foi criada para esta execução e excluída em seguida. A execução e seus artifacts
sobrevivem à exclusão.

### Ferramentas

| | |
|---|---|
| Runner | Ubuntu 24.04.4 LTS |
| Supabase CLI | 2.110.0 |
| `pg_dump` | **17.10** (Ubuntu 17.10-1.pgdg24.04+1) |
| `psql` | **17.10** (Ubuntu 17.10-1.pgdg24.04+1) |
| Servidor local | **PostgreSQL 17.6** |
| Node · Docker | v22.23.1 · 28.0.4 |

Cliente **e** servidor coincidiram com os que geraram [`schema.sql`](schema.sql)
— `pg_dump` 17.10 contra servidor 17.6. A fixação de versão eliminou a versão
do dump como fonte de ruído, e o piso de ruído vazio (§4) confirma que
eliminou.

### Plataforma da stack descartável

Objetos que as 36 migrations assumem existir e não criam, todos presentes:
`auth.uid`, `auth.role`, papéis `anon` / `authenticated` / `service_role`,
extensões `pgcrypto`, `uuid-ossp`, `pg_net`, `pg_stat_statements`,
`supabase_vault`, `plpgsql`.

---

## 2. Aplicação das 36 migrations

**36/36 aplicadas. Nenhuma falhou.** Nenhuma migration foi editada ou
contornada.

Aplicação por `supabase db reset --no-seed` contra a stack local, do zero — o
banco é recriado antes de aplicar. `aplicadas.txt` (lido do log do CLI) e
`esperadas.txt` (lido do diretório) são byte-idênticos,
`sha256:28acf270c08d66db413938ff2aeae899611111afe1c358c1c8f38ac4b83b199a`:
mesmo conjunto, mesma ordem.

A ordem lexicográfica dos nomes de arquivo é idêntica à ordem numérica das
versões, então a ordem de aplicação é inequívoca.

### Ledger local

`supabase_migrations.schema_migrations` do banco descartável, conferido por
[`scripts/ci/check-ledger.mjs`](../../scripts/ci/check-ledger.mjs) contra
`applied-migrations.tsv`:

> ✓ ledger confere: as 36 versões do histórico, sem ausência, sem duplicidade,
> sem versão adicional, em ordem crescente.

36 versões, nomes conferidos um a um, 505 statements no total.

**Limite declarado:** a conferência é de `(version, name)`, não de hash de
`statements`. No histórico remoto cada versão guarda o arquivo inteiro em
`statements[1]` — é a isso que o `md5_norm` do manifesto se refere —, enquanto
o CLI, ao aplicar localmente, parte o arquivo em vários statements. Os dois
formatos não são comparáveis por hash sem uma remontagem que introduziria
suposição. A fidelidade do conteúdo dos 36 arquivos é provada por outro meio, no
mesmo job e antes da aplicação: `tests/verify-recovered-migrations.mjs`, 36/36.

---

## 3. Estrutura — aprovada por igualdade de hash

Os três dumps normalizados têm **o mesmo SHA-256**:

```
1f938ed09ed834290729697e4db5e3e02c045d06ccda9d187ec7c4287d1c3c0c  snapshot.norm.sql
1f938ed09ed834290729697e4db5e3e02c045d06ccda9d187ec7c4287d1c3c0c  rebuilt-schema.norm.sql
1f938ed09ed834290729697e4db5e3e02c045d06ccda9d187ec7c4287d1c3c0c  baseline-roundtrip.norm.sql
```

Identidade a três pontas — o snapshot versionado, o banco reconstruído pelas 36
migrations, e o banco restaurado a partir do snapshot — produzem dumps
byte-idênticos.

**Diff estrutural normalizado: vazio.**
`sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
(o hash do arquivo vazio).

### Diff estrutural bruto — o conteúdo integral

Antes de qualquer normalização, a diferença entre `schema.sql` e o dump do banco
reconstruído é apenas esta:

```diff
-\restrict A6Zhz5IJwJdToatIOqUQOAcnY9u6ElMSWBgmU7pj1Rb24IAQkoOzNDrjHQ20vQA
+\restrict 28e6DF4je6SBdTsBP9PtzEUacpcxjsepmcvbhIHWTOcN0LN9moxgiN6IepHtCcw
...
-\unrestrict A6Zhz5IJwJdToatIOqUQOAcnY9u6ElMSWBgmU7pj1Rb24IAQkoOzNDrjHQ20vQA
+\unrestrict 28e6DF4je6SBdTsBP9PtzEUacpcxjsepmcvbhIHWTOcN0LN9moxgiN6IepHtCcw
```

Duas linhas, contendo o token que o `pg_dump` gera **aleatoriamente em cada
execução** como proteção contra injeção na restauração. Nada mais. Os próprios
comentários de versão saíram idênticos, porque cliente e servidor coincidiram.

---

## 4. Piso de ruído — vazio

Terceira medida, e a que dá base empírica à normalização: o dump do banco
restaurado a partir de `schema.sql`, comparado com o próprio `schema.sql`. Toda
diferença aí seria, por construção, round-trip do `pg_dump` — não defeito de
migration.

**Vazio**, `sha256:e3b0c442…b855`.

Consequência: as regras de normalização não esconderam nada, porque não havia
ruído a esconder, e o diff estrutural do §3 pode ser lido literalmente. As cinco
regras (N1 a N5) estão declaradas em
[`scripts/ci/normalize-schema-dump.mjs`](../../scripts/ci/normalize-schema-dump.mjs)
e tabeladas em [`scripts/ci/README.md`](../../scripts/ci/README.md). Em cada um
dos três arquivos elas removeram exatamente 4 linhas — as duas diretivas
`\restrict`/`\unrestrict` e os dois comentários de versão —, impressas no log
do job uma a uma.

---

## 5. Inventário estrutural reproduzido

| Objeto | Snapshot | Reconstruído |
|---|--:|--:|
| Tabelas | 39 | 39 |
| Tipos | 25 | 25 |
| Funções | 50 | 50 |
| Índices | 73 | 73 |
| Policies | 78 | 78 |
| Triggers | 31 | 31 |
| `ENABLE ROW LEVEL SECURITY` | 39 | 39 |
| Constraints (`ADD CONSTRAINT`) | 143 | 143 |
| `GRANT` / `REVOKE` | 0 / 0 | 0 / 0 |

Os zeros da última linha não são falha: `schema.sql` foi gerado com
`--no-privileges`. É precisamente por isso que a metade de segurança exige
comparação própria (§6).

---

## 6. Segurança — comparação e divergências

`security.sql` **não é saída de ferramenta**: é arquivo redigido à mão, com
prosa e com DDL que reproduz o estado observado, e as consultas ad hoc que o
originaram não ficaram preservadas. A comparação, portanto, não é de texto.
[`scripts/ci/extract-security.sql`](../../scripts/ci/extract-security.sql) rodou
duas vezes no mesmo Postgres descartável — contra o banco reconstruído pelas 36
migrations e contra o banco restaurado de `schema.sql` + `security.sql` — e as
duas extrações foram comparadas. `security.sql` entrou como **insumo**,
exatamente como está versionado.

### Categorias sem nenhuma divergência

| Categoria | Resultado |
|---|---|
| Tabelas: RLS, `FORCE ROW LEVEL SECURITY`, proprietário | ✅ **39/39 idênticas** |
| Funções: `SECURITY DEFINER`, `search_path`, volatilidade, linguagem, proprietário | ✅ **50/50 idênticas** |
| Policies: comando, permissividade, papéis, `USING`, `WITH CHECK` | ✅ **78/78 idênticas** |

A contenção efetiva deste desenho é a RLS, e ela foi reproduzida com exatidão,
policy por policy, incluindo o texto das expressões.

### 6.1 Divergência MATERIAL — `fn_process_webhook_event` executável por `PUBLIC`

```
baseline (schema.sql + security.sql):     postgres | service_role
reconstruído pelas 36 migrations: PUBLIC | postgres | service_role
```

`public.fn_process_webhook_event(text, text, text, text, text, text, text, timestamp with time zone, jsonb)`
— **`SECURITY DEFINER`**, `search_path=""` — fica executável por **`PUBLIC`** num
banco reconstruído a partir das 36 migrations. `PUBLIC` inclui `anon`.

**Causa, documentada na própria migration.** `sec001`
(`20260726004007_sec001_revoke_public_execute_regrant.sql`) revoga das funções
**existentes** e delega o resto:

```sql
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
-- NOTE: ALTER DEFAULT PRIVILEGES skipped — requires superuser.
-- Each SEC migration includes its own explicit GRANT statements.
```

Das oito migrations que criam função depois dessa, **sete cumprem** a delegação
— todas contêm `REVOKE … FROM PUBLIC`.
`20260726004230_sec006_webhook_transactional_idempotent.sql` **não tem nenhum
`REVOKE`**: cria a função com nova assinatura (o 8º argumento passou de `text`
para `timestamptz`, o que a torna uma função nova) e emite apenas
`GRANT EXECUTE … TO service_role`.

Em produção o buraco não aparece porque o endurecimento de *default privileges*
(SEC-005) foi aplicado **manualmente pelo dashboard**, fora do histórico de
migrations — está em [`../manual/`](../manual/), e
`tests/reconciliation-guards.mjs` exige que não esteja em `../migrations/`.

**Sobre produção:** a ausência de exposição foi **constatada no baseline e nos
extratos de segurança usados neste teste** — a extração do banco restaurado de
`schema.sql` + `security.sql` mostra apenas `postgres` e `service_role`. Nenhuma
consulta ao banco de produção foi feita nesta fase.

**Classificação: material.** Não é ruído de dump nem diferença de ambiente. É
lacuna preexistente do histórico já aplicado, que o teste revelou. Exige
migration forward-only **em PR separado**.

### 6.2 Divergência de ACL de tabela

| | `anon` / `authenticated` / `service_role` |
|---|---|
| Baseline (o que `security.sql` aplica) | **7** privilégios nas 39 tabelas: `SELECT INSERT UPDATE DELETE TRUNCATE REFERENCES TRIGGER` |
| Reconstruído | **4**: `TRUNCATE REFERENCES TRIGGER MAINTAIN` — **sem DML** |

Totais: 1.131 linhas de ACL de tabela no baseline, 784 no reconstruído.

Nenhuma das 36 migrations concede DML de tabela, com **uma** exceção:
`20260728191241_…_priv_001_anonymous_assessments_fns2_grants.sql` gerencia
explicitamente `public.assessment_dispatches` —
`REVOKE … FROM PUBLIC, anon` seguido de `GRANT … TO authenticated` e
`… TO service_role`. É a única tabela com DML no banco reconstruído.

Em produção, os privilégios de tabela vieram dos *default privileges* da
plataforma hospedada, não de migration alguma. A stack local do CLI 2.110 tem
defaults diferentes (concede os 4 não-DML, não os 7).

**Classificação: diferença de ambiente — mas não cosmética.** O fato registrado
é que **as ACLs de tabela de produção não estão no repositório**. Reconstruir de
`../migrations/` numa plataforma diferente não reproduz os grants de tabela de
produção. Exige decisão explícita: ou tornar os grants parte do histórico
versionado, ou declarar formalmente que a contenção é a RLS e que os grants de
tabela são responsabilidade da plataforma. **Não tratada neste PR.**

Dois pontos correlatos que dependem dessa decisão:

- O `REVOKE` de `priv_001` lista sete privilégios e **não inclui `MAINTAIN`**
  (novo no PostgreSQL 17). No banco reconstruído, `anon` conserva `MAINTAIN` em
  `assessment_dispatches` — a única tabela onde a migration pretendia negar tudo
  a `anon`.
- `security.sql` emite `GRANT … ON ALL TABLES IN SCHEMA public TO anon,
  authenticated, service_role` e afirma em prosa que as 39 tabelas partilham uma
  única ACL. Se o `REVOKE` de `priv_001` estiver de fato em vigor em produção,
  `assessment_dispatches` diverge das outras 38 e o snapshot **achata** essa
  diferença, ficando mais permissivo do que o banco. Qual dos dois corresponde a
  produção **não é determinável** a partir dos artifacts deste teste. Fica
  registrado como questão aberta, a resolver quando houver autorização para
  leitura do catálogo remoto.

### 6.3 Categorias que ficaram NÃO COMPARÁVEIS

`default-acl` (75 linhas) e `schema-acl` (`pg_database_owner` / `PUBLIC` ×
`postgres`) divergiram por **limitação do procedimento de comparação**, não por
diferença atribuível às migrations.

A fase B do job restaura o baseline no **mesmo** banco descartável, e para isso
executa `DROP SCHEMA IF EXISTS public CASCADE`. Esse comando:

1. apaga as linhas de `pg_default_acl` referentes ao schema `public` — de modo
   que o lado baseline ficou sem nenhuma, enquanto o lado reconstruído conservou
   as 75 da stack local;
2. faz o `CREATE SCHEMA public` do dump recriar o schema com dono `postgres`
   (o papel da conexão, já que o dump usa `--no-owner`), em vez do
   `pg_database_owner` que o `initdb` estabelece.

Além disso, um `ALTER DEFAULT PRIVILEGES … REVOKE` que devolve o default ao
estado nativo **não grava linha** em `pg_default_acl` — remove a existente. O
efeito de SEC-005 é, por isso, inobservável por essa via.

**Consequência:** estas duas categorias **não foram comparadas** nesta execução.
Para compará-las, o baseline precisa ser restaurado num banco separado, não no
mesmo. Registrado como defeito do procedimento, a corrigir antes de qualquer
afirmação sobre *default privileges*.

### 6.4 Inconsistência do `security.sql` quanto a `MAINTAIN`

O comentário da seção 4 de `security.sql` documenta a ACL observada em produção
como `arwdDxtm` — oito privilégios, e o `m` final é `MAINTAIN`. O `GRANT` que o
arquivo emite lista **sete** e omite `MAINTAIN`:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
```

Confirmado na extração: no banco restaurado do baseline, `anon`,
`authenticated` e `service_role` têm 7 privilégios por tabela e **zero**
ocorrências de `MAINTAIN`; só `postgres`, como proprietário, tem as 8.

O arquivo é, nesse ponto, ligeiramente infiel ao que ele próprio descreve. Não
afeta as conclusões deste teste. Registrado, não corrigido — `security.sql` não
foi alterado nesta fase.

---

## 7. Prova de ausência de acesso remoto

Guardas de [`scripts/ci/assert-local-only.sh`](../../scripts/ci/assert-local-only.sh),
em quatro momentos do job, todas aprovadas:

| Verificação | Resultado |
|---|---|
| Denylist sobre o workflow e os scripts executados | ✅ 9 padrões, zero ocorrências |
| Variáveis de credencial no ambiente | ✅ nenhuma definida |
| Token de acesso do CLI em disco | ✅ ausente no início **e** ao final |
| Vínculo a projeto remoto (`supabase/.temp/project-ref`) | ✅ ausente no início, após o `init` e ao final |
| `project_id` do `config.toml` gerado | ✅ `"compliance-trabalhista"` — nome do diretório local, não ref remoto |
| Host da conexão | ✅ **`127.0.0.1`**, porta `54322` |
| Portas em escuta ao final | 54321 / 54322 / 54324 (stack local), 53 (resolver do sistema), 22 (SSH) |
| Uso de secret | ✅ o workflow não referencia `secrets.` em lugar algum |
| Arquivos versionados alterados em tempo de execução | ✅ nenhuma entrada do teste alterada |

O workflow não usa `supabase db push`, `migration up`, `migration repair` nem
`migration fetch` — as quatro proibições de
`tests/migration-freeze-guard.mjs` seguem intactas, sem exceção nominal, e as 22
asserções da guarda rodaram como preflight dentro do próprio job.

---

## 8. Artifact

| | |
|---|---|
| Nome | `migration-rebuild-evidence` |
| Digest | `sha256:fa83f6b0d852cf7d68b491ecfd5c1ba491d7fae31f0917e28ba51eb1d0729f7c` |
| Tamanho | 172.898 bytes · 20 arquivos |
| Criado | 2026-07-30T03:42:35Z |
| **Expira** | **2026-08-29T03:42:35Z** |

> ⚠️ **O artifact expira em 29/08/2026.** Depois disso, as evidências brutas
> deixam de ser recuperáveis pela interface do GitHub. Este relatório e os
> hashes abaixo permanecem versionados; os arquivos, não. Quem precisar dos
> dumps e dos diffs originais deve baixá-los antes dessa data.

Hashes dos 20 arquivos, conforme `sha256.txt` do próprio artifact:

```
28acf270c08d66db413938ff2aeae899611111afe1c358c1c8f38ac4b83b199a  aplicadas.txt
1f938ed09ed834290729697e4db5e3e02c045d06ccda9d187ec7c4287d1c3c0c  baseline-roundtrip.norm.sql
cf546911492e1da0292563042c492ce86ce53fc9b13732dae7cb698ee65e0a85  baseline-roundtrip.sql
bbe6bd9bbddbcfc6cabdb2366dfc7ee7c0ce81ddcda288917299791ece35ce17  baseline-security.txt
a73e91cf9d486890064f8dcc01fc309c26c3b71279ca8d163b4005a35ffef08f  diff-estrutural-bruto.diff
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  diff-estrutural-normalizado.diff
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  diff-piso-de-ruido.diff
41501408a15151e1cbcc105ba196c8f718ddc5a0af6ec2e9f496590f68f52bc0  diff-seguranca.diff
28acf270c08d66db413938ff2aeae899611111afe1c358c1c8f38ac4b83b199a  esperadas.txt
3a9bd8484070cd1086ea438ce2d7a0492da4a2529cf8e967913339c4546ab168  ledger.tsv
0c4648f99efdda324ab784d4a92ad73e918a0533fd5bbe654df60a4270692fbc  ledger.txt
adbb55147c4bdd96eb5dba8c432242afc4000995a7af4432e1c2adc1b3e0b142  plataforma.txt
1f938ed09ed834290729697e4db5e3e02c045d06ccda9d187ec7c4287d1c3c0c  rebuilt-schema.norm.sql
d7f4518c9635f64858b02dd33d1c384ffa707225daf3061394bbe075dc30195c  rebuilt-schema.sql
46d1c5e9784158ecf3583767a97bdbdcd2181e4138f90cf6a7b0f4c0f28b674a  rebuilt-security.txt
0d0a939e4d8bc9a85a08afbee1fff41d010ee11a65e189bb134529a329c2b15c  reset.log
1f938ed09ed834290729697e4db5e3e02c045d06ccda9d187ec7c4287d1c3c0c  snapshot.norm.sql
ce3b4db690c39bf0d9ea112a1f183516504dbea1fc1c1af02164e014c201eff5  start.log
e52f9f8ea80b56b396543b235e668357dae3eb57e84e9035999dd4a5820cee09  versoes.txt
```

`sha256.txt` não consta da própria lista porque é gerado no mesmo comando.

---

## 9. Veredito

| Metade | Estado |
|---|---|
| **Estrutural** | ✅ **APROVADA** — igualdade de hash, diff vazio, piso de ruído vazio |
| **Segurança / ACLs** | ❌ **NÃO APROVADA** — uma divergência material, uma de ambiente a decidir, duas categorias não comparáveis |

O `public` é reconstruível a partir das 36 migrations do repositório, e a
equivalência estrutural deixou de depender exclusivamente do snapshot. A
reprodução integral de permissões, não.

### Encaminhamentos, cada um em trabalho próprio

1. **`fn_process_webhook_event`** — migration forward-only com o `REVOKE`
   ausente. Em produção é no-op, porque lá o privilégio já não existe; fecha o
   buraco em todo ambiente reconstruído. Acompanhada, de preferência, de uma
   asserção que exija que **nenhuma** função de `public` tenha `EXECUTE` para
   `PUBLIC`: uma asserção pega a classe inteira, um `REVOKE` pega um caso.
2. **ACLs de tabela e *default privileges*** — decisão explícita, conforme §6.2.
3. **Procedimento de comparação de `default-acl` e `schema-acl`** — restaurar o
   baseline em banco separado, conforme §6.3.
4. **`security.sql`: `MAINTAIN` e o achatamento de `assessment_dispatches`** —
   §6.4 e §6.2.

### O que este teste não prova

- **Não prova ausência de deriva no banco de produção.** Prova que as 36
  reproduzem o snapshot de 29/07/2026. Se o banco mudou depois, o snapshot está
  defasado e o teste não vê isso.
- **Cobre apenas o schema `public`.** `auth`, `storage`, `vault`, `extensions` e
  `graphql` são da plataforma e ficaram fora, como já ficavam do snapshot.
- **Diff vazio é igualdade textual do dump após regras declaradas**, não prova
  de equivalência semântica. É forte; não é total.
- **A stack local não é o Supabase hospedado** — foi exatamente essa diferença
  que expôs §6.2.

### Pendências independentes, que este teste não endereça

Seguem abertas e registradas: ausência de `rollback` para as 36 versões
aplicadas; **TG-12** (`fn_resolve_tenant_id` com `LIMIT 1` sem `ORDER BY`,
afetando 31 policies em 15 tabelas); assimetria de grant de
`fn_import_risks_from_cycle`; e o vínculo Vercel → banco, nunca confirmado.
