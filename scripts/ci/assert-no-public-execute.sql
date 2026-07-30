-- =============================================================================
-- ASSERÇÃO GERAL — nenhuma rotina de `public` concede EXECUTE a PUBLIC
-- =============================================================================
--
-- Uso:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/checks/assert_no_public_execute.sql
--
-- Falha com EXCEPTION, listando todas as ocorrências. Somente leitura: consulta
-- pg_proc, pg_namespace e pg_authid. Não escreve, não lê dado de negócio.
--
-- ── POR QUE UMA ASSERÇÃO, E NÃO SÓ O REVOKE ─────────────────────────────────
--
-- `20260730123613_revoke_public_webhook_execute.sql` conserta UM caso.
-- A asserção cobre a CLASSE. A distinção importa porque a causa raiz é
-- estrutural: `sec001` registra que `ALTER DEFAULT PRIVILEGES` exige superusuário
-- e por isso delega a cada migration posterior o seu próprio REVOKE. Das oito
-- migrations que criam função depois dela, uma não cumpriu. Sem asserção, a nona
-- também pode não cumprir, e ninguém saberá até a próxima reconstrução.
--
-- ── SEM EXCEÇÃO NOMINAL ─────────────────────────────────────────────────────
--
-- Não há allowlist, não há nome de função citado, não há `WHERE proname <> ...`.
-- `fn_process_webhook_event` não é tratada de forma especial: se voltar a
-- conceder EXECUTE a PUBLIC, esta asserção reprova como reprovaria qualquer
-- outra. Uma asserção com exceção nominal protege o texto da exceção, não o
-- banco.
--
-- ── O PONTO SUTIL: proacl NULO ──────────────────────────────────────────────
--
-- `proacl` nulo NÃO significa "sem privilégios". Significa "privilégios default
-- do PostgreSQL", e o default para funções é
-- `{=X/owner, owner=X/owner}` — PUBLIC TEM EXECUTE.
--
-- Uma consulta que filtrasse `proacl IS NOT NULL` deixaria passar exatamente o
-- caso perigoso: a função recém-criada que ninguém tocou. Por isso
-- `COALESCE(proacl, acldefault('f', proowner))`, que materializa o default antes
-- de explodir a ACL.
--
-- ── COBERTURA ───────────────────────────────────────────────────────────────
--
-- Todas as rotinas executáveis de `public`, sem filtro de `prokind`: funções
-- (`f`), procedures (`p`), agregados (`a`) e window functions (`w`). O tipo é
-- reportado por extenso na mensagem de falha.
-- =============================================================================

DO $$
DECLARE
  r record;
  v_total integer := 0;
  v_rotinas integer;
  v_lista text := '';
BEGIN
  SELECT count(*) INTO v_rotinas
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public';

  FOR r IN
    SELECT n.nspname AS schema_nome,
           p.proname AS rotina,
           CASE p.prokind
             WHEN 'f' THEN 'function'
             WHEN 'p' THEN 'procedure'
             WHEN 'a' THEN 'aggregate'
             WHEN 'w' THEN 'window'
             ELSE 'desconhecido(' || p.prokind || ')'
           END AS tipo,
           pg_get_function_identity_arguments(p.oid) AS assinatura,
           COALESCE(p.proacl, acldefault('f', p.proowner))::text AS acl
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND EXISTS (
         SELECT 1
           FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
          WHERE a.grantee = 0
            AND a.privilege_type = 'EXECUTE'
       )
     ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)
  LOOP
    v_total := v_total + 1;
    v_lista := v_lista
      || format(E'\n  %s. %s.%s(%s)\n       tipo: %s\n       ACL : %s',
                v_total, r.schema_nome, r.rotina, r.assinatura, r.tipo, r.acl);
  END LOOP;

  IF v_total > 0 THEN
    RAISE EXCEPTION
      E'ASSERÇÃO REPROVADA — % de % rotina(s) de `public` concedem EXECUTE a PUBLIC:\n%\n\nPUBLIC inclui `anon`. Para rotina SECURITY DEFINER isso significa execução privilegiada por requisição sem sessão. Corrija com REVOKE EXECUTE ... FROM PUBLIC na migration que cria a rotina.',
      v_total, v_rotinas, v_lista;
  END IF;

  RAISE NOTICE 'OK: nenhuma das % rotinas de public concede EXECUTE a PUBLIC', v_rotinas;
END
$$;
