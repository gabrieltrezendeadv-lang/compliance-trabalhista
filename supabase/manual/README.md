# SQL manual do Supabase

Os arquivos desta pasta não fazem parte do fluxo automático de migrations.

## SEC-005

`sec_005_default_function_privileges_dashboard.sql` altera default privileges
pertencentes a `supabase_admin`. No Supabase gerenciado, a role `postgres`
utilizada pelo fluxo regular de migrations não possui autoridade para fazer
essa alteração.

Procedimento:

1. aplicar primeiro as migrations automáticas em staging;
2. abrir o SQL Editor da mesma branch/projeto;
3. executar `sec_005_default_function_privileges_dashboard.sql`;
4. conferir a consulta de verificação incluída no arquivo;
5. testar que uma função futura não concede `EXECUTE` a `PUBLIC`, `anon` ou
   `authenticated` sem `GRANT` explícito;
6. usar o arquivo `_rollback.sql` somente se for necessário restaurar o estado
   anterior catalogado.

Essa etapa não autoriza execução em produção sem a validação prévia em staging.
