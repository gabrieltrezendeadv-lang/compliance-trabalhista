-- =============================================================================
-- VERIFICAÇÃO INDEPENDENTE — 20260730123613_revoke_public_webhook_execute
-- =============================================================================
--
-- Roda DEPOIS da aplicação, contra o banco de produção, e é INDEPENDENTE das
-- pós-condições embutidas na própria migration. A diferença importa: as
-- pós-condições da migration rodam dentro da transação que a aplica e foram
-- escritas pela mesma pessoa, no mesmo momento e com as mesmas suposições. Se a
-- suposição estiver errada, elas erram junto — foi literalmente o que aconteceu
-- na Fase 5A (`'literal' || "char"` ambíguo) e na TG-12C (`\b` como fronteira de
-- palavra). Esta verificação é o segundo par de olhos.
--
-- ── SOMENTE LEITURA, E SOMENTE CATÁLOGO ─────────────────────────────────────
--
-- Tudo dentro de `BEGIN TRANSACTION READ ONLY` encerrado por `ROLLBACK`.
-- Nenhuma tabela de negócio é consultada. Nenhuma fixture é criada — testes de
-- comportamento com dados fabricados NÃO rodam em produção, e é por isso que
-- `assert-tenant-resolution.sql` fica restrito ao banco descartável do
-- migration-rebuild-verify.
--
-- O que se verifica aqui é o EFEITO da migration no catálogo: nada além disso
-- pode ser afirmado a partir de produção sem tocar em dado real.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

DO $verif$
DECLARE
  v_oid        oid;
  v_publico    integer;
  v_service    integer;
  v_secdef     boolean;
  v_assinatura text;
BEGIN
  SELECT p.oid, p.prosecdef, pg_get_function_identity_arguments(p.oid)
    INTO v_oid, v_secdef, v_assinatura
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'fn_process_webhook_event';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'VERIF 20260730123613: fn_process_webhook_event não existe em public';
  END IF;

  -- 1. O efeito pretendido: PUBLIC não detém mais EXECUTE.
  --
  -- COALESCE com acldefault é obrigatório: proacl NULO significa privilégios
  -- DEFAULT, e o default de função INCLUI EXECUTE para PUBLIC. Ler apenas
  -- proacl não nulo daria "aprovado" justamente no caso exposto.
  SELECT count(*) FILTER (WHERE a.grantee = 0),
         count(*) FILTER (WHERE pg_get_userbyid(a.grantee) = 'service_role')
    INTO v_publico, v_service
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
   WHERE p.oid = v_oid
     AND a.privilege_type = 'EXECUTE';

  IF v_publico > 0 THEN
    RAISE EXCEPTION 'VERIF 20260730123613: PUBLIC AINDA detém EXECUTE em fn_process_webhook_event(%)', v_assinatura;
  END IF;

  -- 2. O que NÃO podia mudar: service_role continua podendo executar.
  --    Uma revogação que derrubasse o consumidor legítimo seria uma correção
  --    pior que o defeito.
  IF v_service = 0 THEN
    RAISE EXCEPTION 'VERIF 20260730123613: service_role PERDEU EXECUTE — a revogação foi ampla demais';
  END IF;

  -- 3. A função continua SECURITY DEFINER (a migration não deveria tocar nisso).
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'VERIF 20260730123613: SECURITY DEFINER foi perdido';
  END IF;

  RAISE NOTICE 'VERIF 20260730123613 OK: PUBLIC sem EXECUTE, service_role com EXECUTE, SECURITY DEFINER preservado (assinatura: %)', v_assinatura;
END
$verif$;

-- 4. Asserção geral, sem allowlist: se a aplicação tiver deixado QUALQUER outra
--    rotina de public executável por PUBLIC, isto reprova. Não olha por nome.
DO $geral$
DECLARE
  v_expostas integer;
  v_total    integer;
  v_lista    text;
BEGIN
  SELECT count(*) INTO v_total
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public';

  SELECT count(*), string_agg(DISTINCT p.proname, ', ')
    INTO v_expostas, v_lista
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
   WHERE n.nspname = 'public'
     AND a.privilege_type = 'EXECUTE'
     AND a.grantee = 0;

  IF v_expostas > 0 THEN
    RAISE EXCEPTION 'VERIF 20260730123613: % rotina(s) de public concedem EXECUTE a PUBLIC: %', v_expostas, v_lista;
  END IF;

  RAISE NOTICE 'VERIF 20260730123613 OK: nenhuma das % rotinas de public concede EXECUTE a PUBLIC', v_total;
END
$geral$;

ROLLBACK;
