import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const checks = [
  [
    "senha possui alternância visível",
    () => {
      const source = read("src/components/auth/password-input.tsx");
      assert.match(source, /EyeOff/);
      assert.match(source, /Mostrar senha/);
      assert.match(source, /Ocultar senha/);
    },
  ],
  [
    "navegação separa colaboradores de membros e não expõe assinatura",
    () => {
      const source = read("src/components/dashboard/sidebar-nav.tsx");
      assert.ok(source.includes("/dashboard/employees"));
      assert.ok(!source.includes("/dashboard/billing"));
    },
  ],
  [
    "campanha recebe segmentação da tela",
    () => {
      const form = read("src/components/campaigns/campaign-create-form.tsx");
      const action = read("src/lib/campaigns/actions.ts");
      assert.match(form, /target_establishment_id/);
      assert.match(form, /target_department_id/);
      assert.match(action, /computedTargetScope/);
    },
  ],
  [
    "riscos usam enums catalogados",
    () => {
      const source = read("src/lib/schemas/risk.ts");
      assert.match(source, /"critical"/);
      assert.match(source, /"moderate"/);
      assert.doesNotMatch(source, /"very_high"/);
      assert.match(source, /"urgent"/);
    },
  ],
  [
    "FIX-001 não referencia colunas inexistentes",
    () => {
      const source = read(
        "supabase/migrations/20260728150000_fix_001_evidence_reports.sql"
      );
      assert.match(source, /ac\.starts_at/);
      assert.match(source, /ac\.ends_at/);
      assert.doesNotMatch(source, /ac\.started_at/);
      assert.doesNotMatch(source, /ac\.total_invited/);
    },
  ],
  [
    "FIX-003 aplica pontuação reversa",
    () => {
      const source = read(
        "supabase/migrations/20260728151000_fix_003_reverse_scoring.sql"
      );
      const matches = source.match(/qi\.reverse_scored/g) ?? [];
      assert.ok(matches.length >= 6);
    },
  ],
  [
    "FIX-004 trava convite e valida payload",
    () => {
      const source = read(
        "supabase/migrations/20260728152000_fix_004_assessment_submission.sql"
      );
      assert.match(source, /FOR UPDATE/);
      assert.match(source, /duplicate_item/);
      assert.match(source, /missing_required_items/);
      assert.match(source, /expires_at/);
    },
  ],
  [
    "PRIV-001 separa convite da resposta e protege participação",
    () => {
      const migration = read(
        "supabase/migrations/20260728152500_priv_001_anonymous_assessments.sql"
      );
      const action = read("src/lib/assessments/actions.ts");
      assert.match(migration, /token_hash/);
      assert.match(migration, /submission_batch_id/);
      assert.match(migration, /invitation_id DROP NOT NULL/);
      assert.match(migration, /fn_assessment_participation_stats/);
      assert.match(migration, /below_threshold/);
      assert.doesNotMatch(
        migration,
        /fn_user_has_role\(ARRAY\['owner', 'admin', 'manager'\]\)/
      );
      const roleCasts =
        migration.match(/'owner'::public\.organization_role/g) ?? [];
      assert.equal(roleCasts.length, 4);
      assert.doesNotMatch(migration, /REVOKE ALL/);
      assert.match(action, /randomBytes\(32\)/);
      assert.match(action, /token_hash: tokenHash/);
      assert.match(action, /assessment_dispatches/);
      assert.doesNotMatch(action, /metadata:\s*\{[^}]*invitationId/s);
    },
  ],
  [
    "SEC-005 é etapa manual e não bloqueia migrations automáticas",
    () => {
      assert.equal(
        existsSync(
          new URL(
            "../supabase/migrations/20260728154000_sec_005_default_function_privileges.sql",
            import.meta.url
          )
        ),
        false
      );
      const manual = read(
        "supabase/manual/sec_005_default_function_privileges_dashboard.sql"
      );
      assert.match(manual, /ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin/);
      assert.match(manual, /ETAPA MANUAL NO DASHBOARD SQL EDITOR/);
    },
  ],
  [
    "limite de plano e precificação saíram da jornada",
    () => {
      const layout = read("src/app/(dashboard)/layout.tsx");
      const billing = read(
        "src/app/(dashboard)/dashboard/billing/page.tsx"
      );
      const migration = read(
        "supabase/migrations/20260728154500_sec_002_retire_plan_limit.sql"
      );
      assert.doesNotMatch(layout, /getSubscriptionWarning/);
      assert.ok(billing.includes('redirect("/dashboard")'));
      assert.match(migration, /REVOKE EXECUTE/);
      assert.doesNotMatch(migration, /GRANT EXECUTE/);
    },
  ],
  [
    "ciclos vencidos têm rotina server-only",
    () => {
      const route = read(
        "src/app/api/cron/close-assessment-cycles/route.ts"
      );
      const migration = read(
        "supabase/migrations/20260728155000_fix_005_close_expired_cycles.sql"
      );
      const rollback = read(
        "supabase/rollbacks/20260728155000_fix_005_close_expired_cycles_rollback.sql"
      );
      const config = read("vercel.json");
      assert.match(route, /CRON_SECRET/);
      assert.match(route, /createServiceClient/);
      assert.match(route, /fn_close_expired_assessment_cycles/);
      assert.match(migration, /auth\.role\(\)/);
      assert.match(
        rollback,
        /DROP FUNCTION IF EXISTS public\.fn_close_expired_assessment_cycles\(\)/
      );
      assert.match(config, /close-assessment-cycles/);
    },
  ],
];

let passed = 0;
for (const [name, check] of checks) {
  try {
    check();
    passed += 1;
    console.log(`[PASS] ${name}`);
  } catch (error) {
    console.error(`[FAIL] ${name}`);
    throw error;
  }
}

console.log(`Reconciliation guards: ${passed} passed, 0 failed`);
