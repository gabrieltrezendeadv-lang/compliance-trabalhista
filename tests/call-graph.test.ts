/**
 * Call graph verification tests for SEC-BLOCK1-CONSOLIDATION v1.2.1
 *
 * Validates:
 *   - No direct RPC calls to old function signatures from TS source
 *   - No "use client" module imports service.ts
 *   - Gateway is consumed by actions.ts (not bypassed)
 *   - No old function signatures remain in new TypeScript code
 *   - service.ts is only imported by gateway.ts
 *   - submitComplaint stays on public flow (does not use gateway)
 *
 * Run: npx tsx tests/call-graph.test.ts
 *
 * v1.2.1 — SEC-BLOCK1-CONSOLIDATION
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================================
// Helpers
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC_ROOT = path.resolve(__dirname, "../src");

function readFile(relPath: string): string {
  const fullPath = path.join(SRC_ROOT, relPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${fullPath}`);
  }
  return fs.readFileSync(fullPath, "utf-8");
}

/**
 * Recursively find all .ts and .tsx files under a directory
 */
function findTsFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      results.push(...findTsFiles(fullPath));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

// ============================================================================
// Tests
// ============================================================================

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err: unknown) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[FAIL] ${name}: ${msg}`);
  }
}

// ── CG-01: gateway.ts exists and has "use server" ─────────────────────────

test("CG-01: gateway.ts exists and has 'use server' directive", () => {
  const content = readFile("lib/complaints/gateway.ts");
  assert.ok(content.includes('"use server"'), "Missing 'use server' directive");
});

// ── CG-02: actions.ts imports from gateway ─────────────────────────────────

test("CG-02: actions.ts imports gatewayAccessComplaint from gateway", () => {
  const content = readFile("lib/complaints/actions.ts");
  assert.ok(
    content.includes("gatewayAccessComplaint"),
    "actions.ts does not import gatewayAccessComplaint"
  );
  assert.ok(
    content.includes("from") && content.includes("gateway"),
    "actions.ts does not import from gateway module"
  );
});

test("CG-03: actions.ts imports gatewaySendReporterMessage from gateway", () => {
  const content = readFile("lib/complaints/actions.ts");
  assert.ok(
    content.includes("gatewaySendReporterMessage"),
    "actions.ts does not import gatewaySendReporterMessage"
  );
});

// ── CG-04: accessComplaint routes through gateway ──────────────────────────

test("CG-04: accessComplaint delegates to gatewayAccessComplaint", () => {
  const content = readFile("lib/complaints/actions.ts");
  // Should find: export async function accessComplaint(...) { return gatewayAccessComplaint(...) }
  const fnMatch = content.match(
    /export\s+async\s+function\s+accessComplaint[^{]*\{[\s\S]*?gatewayAccessComplaint/
  );
  assert.ok(fnMatch, "accessComplaint does not delegate to gatewayAccessComplaint");
});

// ── CG-05: sendReporterMessage routes through gateway ──────────────────────

test("CG-05: sendReporterMessage delegates to gatewaySendReporterMessage", () => {
  const content = readFile("lib/complaints/actions.ts");
  const fnMatch = content.match(
    /export\s+async\s+function\s+sendReporterMessage[^{]*\{[\s\S]*?gatewaySendReporterMessage/
  );
  assert.ok(fnMatch, "sendReporterMessage does not delegate to gatewaySendReporterMessage");
});

// ── CG-06: actions.ts does NOT call old RPC names ──────────────────────────

test("CG-06: actions.ts does not call fn_access_complaint directly", () => {
  const content = readFile("lib/complaints/actions.ts");
  // Should not find direct .rpc("fn_access_complaint"...) calls
  const directCall = content.match(/\.rpc\(\s*["']fn_access_complaint["']/);
  assert.equal(
    directCall,
    null,
    "actions.ts still has direct RPC call to fn_access_complaint"
  );
});

test("CG-07: actions.ts does not call fn_send_reporter_message directly", () => {
  const content = readFile("lib/complaints/actions.ts");
  const directCall = content.match(
    /\.rpc\(\s*["']fn_send_reporter_message["']/
  );
  assert.equal(
    directCall,
    null,
    "actions.ts still has direct RPC call to fn_send_reporter_message"
  );
});

// ── CG-08: gateway.ts calls v2 RPCs ───────────────────────────────────────

test("CG-08: gateway.ts calls fn_access_complaint_v2", () => {
  const content = readFile("lib/complaints/gateway.ts");
  assert.ok(
    content.includes("fn_access_complaint_v2"),
    "gateway.ts does not reference fn_access_complaint_v2"
  );
});

test("CG-09: gateway.ts calls fn_send_reporter_message_v2", () => {
  const content = readFile("lib/complaints/gateway.ts");
  assert.ok(
    content.includes("fn_send_reporter_message_v2"),
    "gateway.ts does not reference fn_send_reporter_message_v2"
  );
});

// ── CG-10: gateway.ts does NOT call old function names ─────────────────────

test("CG-10: gateway.ts does not call fn_access_complaint (without _v2)", () => {
  const content = readFile("lib/complaints/gateway.ts");
  // Check for the exact old name but not the _v2 version
  const oldCall = content.match(/fn_access_complaint(?!_v2)/);
  assert.equal(
    oldCall,
    null,
    "gateway.ts still references fn_access_complaint without _v2 suffix"
  );
});

test("CG-11: gateway.ts does not call fn_send_reporter_message (without _v2)", () => {
  const content = readFile("lib/complaints/gateway.ts");
  const oldCall = content.match(/fn_send_reporter_message(?!_v2)/);
  assert.equal(
    oldCall,
    null,
    "gateway.ts still references fn_send_reporter_message without _v2 suffix"
  );
});

// ── CG-12: service.ts is NOT imported by "use client" modules ──────────────

test("CG-12: No 'use client' module imports service.ts", () => {
  const allTsFiles = findTsFiles(SRC_ROOT);
  const violations: string[] = [];

  for (const filePath of allTsFiles) {
    const content = fs.readFileSync(filePath, "utf-8");
    // Check for "use client" as a DIRECTIVE (first meaningful line), not in comments
    const hasClientDirective = /^["']use client["'];?\s*$/m.test(
      content.split("\n").find((l) => l.trim().length > 0 && !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*")) ?? ""
    );
    if (
      hasClientDirective &&
      (content.includes("supabase/service") ||
        content.includes("createServiceClient"))
    ) {
      violations.push(path.relative(SRC_ROOT, filePath));
    }
  }

  assert.equal(
    violations.length,
    0,
    `Client modules importing service.ts: ${violations.join(", ")}`
  );
});

// ── CG-13: service.ts is only imported by gateway.ts ───────────────────────

test("CG-13: service.ts is imported only by gateway.ts (within complaints/)", () => {
  const allTsFiles = findTsFiles(SRC_ROOT);
  const importers: string[] = [];

  for (const filePath of allTsFiles) {
    const content = fs.readFileSync(filePath, "utf-8");
    const relPath = path.relative(SRC_ROOT, filePath);

    if (
      content.includes("supabase/service") ||
      content.includes("createServiceClient")
    ) {
      importers.push(relPath);
    }
  }

  // Only gateway.ts (and possibly service.ts itself) should reference it
  const unexpected = importers.filter(
    (f) =>
      !f.includes("gateway.ts") &&
      !f.includes("supabase/service.ts")
  );

  assert.equal(
    unexpected.length,
    0,
    `Unexpected importers of service.ts: ${unexpected.join(", ")}`
  );
});

// ── CG-14: submitComplaint does NOT use gateway ────────────────────────────

test("CG-14: submitComplaint does not route through gateway", () => {
  const content = readFile("lib/complaints/actions.ts");
  // Find submitComplaint function and check it doesn't call gateway functions
  const fnMatch = content.match(
    /export\s+async\s+function\s+submitComplaint[\s\S]*?\n\}/
  );
  assert.ok(fnMatch, "submitComplaint function not found");
  const fnBody = fnMatch![0];
  assert.ok(
    !fnBody.includes("gateway"),
    "submitComplaint should not reference gateway"
  );
});

// ── CG-15: submitComplaint uses anon/authenticated client ──────────────────

test("CG-15: submitComplaint uses createClient (not createServiceClient)", () => {
  const content = readFile("lib/complaints/actions.ts");
  // submitComplaint should use the standard createClient
  assert.ok(
    content.includes("createClient"),
    "actions.ts does not import createClient"
  );
  // And should NOT use createServiceClient
  assert.ok(
    !content.includes("createServiceClient"),
    "actions.ts should not import createServiceClient"
  );
});

// ── CG-16: gateway.ts uses createServiceClient ────────────────────────────

test("CG-16: gateway.ts uses createServiceClient", () => {
  const content = readFile("lib/complaints/gateway.ts");
  assert.ok(
    content.includes("createServiceClient"),
    "gateway.ts does not use createServiceClient"
  );
});

// ── CG-17: gateway.ts uses async headers() ─────────────────────────────────

test("CG-17: gateway.ts uses await headers() (async, Next.js 16)", () => {
  const content = readFile("lib/complaints/gateway.ts");
  assert.ok(
    content.includes("await headers()"),
    "gateway.ts does not use 'await headers()'"
  );
  // Should NOT have synchronous headers() call
  const syncMatch = content.match(/const\s+hdrs\s*=\s*headers\(\)/);
  assert.equal(
    syncMatch,
    null,
    "gateway.ts has synchronous headers() call"
  );
});

// ── CG-18: No "use client" in gateway or service ──────────────────────────

test("CG-18: gateway.ts does not have 'use client'", () => {
  const content = readFile("lib/complaints/gateway.ts");
  assert.ok(
    !content.includes('"use client"'),
    "gateway.ts must not be a client module"
  );
});

test("CG-19: service.ts does not have 'use client' directive", () => {
  const content = readFile("lib/supabase/service.ts");
  // Check the first non-comment, non-empty line for "use client" directive
  const firstMeaningfulLine = content
    .split("\n")
    .find(
      (l) =>
        l.trim().length > 0 &&
        !l.trim().startsWith("//") &&
        !l.trim().startsWith("*") &&
        !l.trim().startsWith("/*")
    );
  const hasClientDirective = /^["']use client["'];?\s*$/.test(
    (firstMeaningfulLine ?? "").trim()
  );
  assert.ok(
    !hasClientDirective,
    "service.ts must not have 'use client' directive"
  );
});

// ── CG-20: actions.ts has "use server" ─────────────────────────────────────

test("CG-20: actions.ts has 'use server' directive", () => {
  const content = readFile("lib/complaints/actions.ts");
  assert.ok(
    content.includes('"use server"'),
    "actions.ts missing 'use server' directive"
  );
});

// ── CG-21: No old 2-param signature in TS files ───────────────────────────

test("CG-21: No TS file calls fn_access_complaint with old 2-param signature", () => {
  const allTsFiles = findTsFiles(SRC_ROOT);
  const violations: string[] = [];

  for (const filePath of allTsFiles) {
    const content = fs.readFileSync(filePath, "utf-8");
    // Old signature: .rpc("fn_access_complaint", { p_protocol: ..., p_pin_hash: ... })
    // without p_caller_ip_hash
    if (
      content.match(
        /\.rpc\(\s*["']fn_access_complaint["']\s*,\s*\{[^}]*\}/
      )
    ) {
      violations.push(path.relative(SRC_ROOT, filePath));
    }
  }

  assert.equal(
    violations.length,
    0,
    `Files with old fn_access_complaint RPC calls: ${violations.join(", ")}`
  );
});

// ── CG-22: No old 3-param fn_send_reporter_message in TS files ────────────

test("CG-22: No TS file calls fn_send_reporter_message with old signature", () => {
  const allTsFiles = findTsFiles(SRC_ROOT);
  const violations: string[] = [];

  for (const filePath of allTsFiles) {
    const content = fs.readFileSync(filePath, "utf-8");
    // Old: .rpc("fn_send_reporter_message", ...) without _v2
    if (
      content.match(
        /\.rpc\(\s*["']fn_send_reporter_message["']\s*,/
      )
    ) {
      violations.push(path.relative(SRC_ROOT, filePath));
    }
  }

  assert.equal(
    violations.length,
    0,
    `Files with old fn_send_reporter_message RPC calls: ${violations.join(", ")}`
  );
});

// ── CG-23: complaint-tracker.tsx imports from actions (not gateway) ────────

test("CG-23: complaint-tracker imports from actions, not from gateway", () => {
  const trackerPath = path.join(
    SRC_ROOT,
    "components/complaints/complaint-tracker.tsx"
  );
  if (!fs.existsSync(trackerPath)) {
    // File may not exist in consolidation workspace — skip gracefully
    console.log("  (complaint-tracker.tsx not in workspace — skipped)");
    return;
  }
  const content = fs.readFileSync(trackerPath, "utf-8");
  assert.ok(
    content.includes("@/lib/complaints/actions"),
    "complaint-tracker should import from actions"
  );
  assert.ok(
    !content.includes("@/lib/complaints/gateway"),
    "complaint-tracker must NOT import directly from gateway"
  );
});

// ── CG-24: gateway.ts does not log PII ────────────────────────────────────

test("CG-24: gateway.ts does not log protocol, PIN, IP, or complaint content", () => {
  const content = readFile("lib/complaints/gateway.ts");
  const lines = content.split("\n");
  const logLines = lines.filter(
    (l) =>
      l.includes("console.log") ||
      l.includes("console.error") ||
      l.includes("console.warn")
  );

  for (const line of logLines) {
    // Should not interpolate protocol, pin, ip, or body values
    assert.ok(
      !line.includes("parsed.data.protocol"),
      `Log line exposes protocol: ${line.trim()}`
    );
    assert.ok(
      !line.includes("parsed.data.pin"),
      `Log line exposes PIN: ${line.trim()}`
    );
    assert.ok(
      !line.includes("parsed.data.body"),
      `Log line exposes body: ${line.trim()}`
    );
    assert.ok(
      !line.includes("ipHash") || line.includes("hmac_preflight"),
      `Log line may expose IP hash: ${line.trim()}`
    );
  }
});

// ── CG-25: gateway.ts error responses never include Supabase details ──────

test("CG-25: gateway.ts never returns error.message from Supabase", () => {
  const content = readFile("lib/complaints/gateway.ts");
  // Should not have: return { error: error.message } or error: err.message
  assert.ok(
    !content.match(/error:\s*error\.message/),
    "gateway.ts exposes error.message from Supabase"
  );
  assert.ok(
    !content.match(/error:\s*_?err\.message/),
    "gateway.ts exposes err.message from catch"
  );
});

// ── Summary ────────────────────────────────────────────────────────────────

console.log("");
console.log("══════════════════════════════════════════════════════════════");
console.log(` Call Graph Tests: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log("══════════════════════════════════════════════════════════════");

if (failed > 0) {
  process.exit(1);
}
