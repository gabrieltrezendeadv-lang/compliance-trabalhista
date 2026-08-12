-- =============================================================================
-- FIXTURES DO CONTRATO — organizações, membros e catálogo
-- =============================================================================
--
-- Uso:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/ci/seed-contract-fixtures.sql
--
-- ── POR QUE ISTO É SQL, E NÃO UMA RPC ───────────────────────────────────────
--
-- `organizations`, `profiles`, `auth.users` e `organization_members` não têm —
-- e não devem ter — RPC de billing. Criar uma função pública de escrita nessas
-- tabelas só para o teste abriria superfície que a aplicação não precisa, e a
-- allowlist de `public` existe justamente para impedir que isso aconteça sem
-- revisão.
--
-- Então as fixtures entram por psql, como proprietário, e SOMENTE contra a
-- stack descartável. `scripts/ci/teardown-contract-fixtures.sql` as remove e
-- confere que nada sobrou.
--
-- ── IDENTIFICADORES DETERMINÍSTICOS ─────────────────────────────────────────
--
-- Quarenta pares de organização, com UUID derivado do índice. O mesmo par tem
-- sempre o mesmo identificador: falha reproduzível, limpeza conferível, e
-- nenhum sorteio que faça o teste passar hoje e falhar amanhã.
-- =============================================================================

\set ON_ERROR_STOP on

DO $seed$
DECLARE
  i        integer;
  v_org_a  uuid;
  v_org_b  uuid;
  v_dono_a uuid;
  v_dono_b uuid;
  v_col_a  uuid;
  v_suf    text;
BEGIN
  -- 60 pares. Eram 40, e a 12C.1 acrescentou doze casos ao contrato — cada
  -- caso consome um par, e a suíte abortava com 'consumiu mais de 40'. A folga
  -- é deliberada: o próximo lote de casos não deve exigir mexer no seed.
  -- 80 pares, em duas faixas disjuntas: 0–59 para o contrato do repositório
  -- e 60–79 para o contrato da fachada. Faixa compartilhada permitiria que
  -- uma suíte alcançasse a fixture da outra sem que nada acusasse.
  FOR i IN 0..79 LOOP
    v_suf    := lpad(i::text, 8, '0');
    v_org_a  := ('0c07a000-0000-4000-8000-a001' || v_suf)::uuid;
    v_org_b  := ('0c07a000-0000-4000-8000-b001' || v_suf)::uuid;
    v_dono_a := ('0c07a000-0000-4000-8000-c001' || v_suf)::uuid;
    v_dono_b := ('0c07a000-0000-4000-8000-d001' || v_suf)::uuid;
    v_col_a  := ('0c07a000-0000-4000-8000-e001' || v_suf)::uuid;

    INSERT INTO auth.users (id, instance_id, aud, role, email)
    VALUES
      (v_dono_a, '00000000-0000-0000-0000-000000000000', 'authenticated',
       'authenticated', 'dono-a-' || v_suf || '@contrato.test'),
      (v_dono_b, '00000000-0000-0000-0000-000000000000', 'authenticated',
       'authenticated', 'dono-b-' || v_suf || '@contrato.test'),
      (v_col_a,  '00000000-0000-0000-0000-000000000000', 'authenticated',
       'authenticated', 'colab-a-' || v_suf || '@contrato.test')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.profiles (id, full_name, email)
    VALUES
      (v_dono_a, 'dono a ' || v_suf, 'dono-a-' || v_suf || '@contrato.test'),
      (v_dono_b, 'dono b ' || v_suf, 'dono-b-' || v_suf || '@contrato.test'),
      (v_col_a,  'colab a ' || v_suf, 'colab-a-' || v_suf || '@contrato.test')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.organizations (id, name, slug)
    VALUES
      (v_org_a, 'Contrato A ' || v_suf, 'contrato-a-' || v_suf),
      (v_org_b, 'Contrato B ' || v_suf, 'contrato-b-' || v_suf)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.organization_members (tenant_id, user_id, role, created_at)
    VALUES
      (v_org_a, v_dono_a, 'owner',        '2026-01-01T00:00:00Z'),
      (v_org_b, v_dono_b, 'owner',        '2026-01-01T00:00:00Z'),
      (v_org_a, v_col_a,  'collaborator', '2026-01-01T00:00:00Z')
    ON CONFLICT DO NOTHING;
  END LOOP;

  RAISE NOTICE 'contrato/seed OK: 80 pares de organização (0-59 repositório, 60-79 fachada)';
END
$seed$;

-- O catálogo precisa existir na versão que o contrato lê. A 12A já o semeia;
-- esta asserção falha alto se a versão mudar sem o contrato saber.
DO $catalogo$
DECLARE
  v_int integer;
BEGIN
  SELECT count(*) INTO v_int
    FROM billing.price_catalog
   WHERE catalog_version = '2026-07-30.1';
  IF v_int = 0 THEN
    RAISE EXCEPTION
      'contrato/seed: o catálogo 2026-07-30.1 não existe — o contrato leria vazio';
  END IF;
  RAISE NOTICE 'contrato/seed OK: catálogo 2026-07-30.1 com % linha(s)', v_int;
END
$catalogo$;
