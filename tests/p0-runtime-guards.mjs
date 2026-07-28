import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (file) => fs.readFileSync(path.join(root, file), "utf8")

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`[PASS] ${name}`)
  } catch (error) {
    failed += 1
    console.error(`[FAIL] ${name}: ${error.message}`)
  }
}

test("P0-01: complaint actions delegate protected access to gateway", () => {
  const source = read("src/lib/complaints/actions.ts")
  assert.match(source, /gatewayAccessComplaint/)
  assert.match(source, /gatewaySendReporterMessage/)
  assert.doesNotMatch(source, /\.rpc\(\s*["']fn_access_complaint["']/)
  assert.doesNotMatch(source, /\.rpc\(\s*["']fn_send_reporter_message["']/)
})

test("P0-02: complaint submission sends validated raw PIN to the DB hasher", () => {
  const actions = read("src/lib/complaints/actions.ts")
  const schema = read("src/lib/schemas/complaint.ts")
  assert.match(actions, /p_pin_hash:\s*pin/)
  assert.doesNotMatch(actions, /hashPin/)
  assert.doesNotMatch(actions, /complaint-pin-salt/)
  assert.match(schema, /submitComplaintSchema[\s\S]*?\.strict\(\)/)
})

test("P0-03: provider webhooks bypass session redirect", () => {
  const source = read("src/lib/supabase/proxy.ts")
  assert.match(source, /\/api\/webhooks/)
})

test("P0-04: billing registry never falls back to mock in production", () => {
  const source = read("src/lib/billing/registry.ts")
  assert.match(source, /BillingNotConfiguredError/)
  assert.match(source, /ALLOW_MOCK_BILLING_PROVIDER/)
  assert.match(source, /not-configured/)
  assert.doesNotMatch(
    source,
    /if\s*\(\s*!?apiKey\s*\)\s*return\s+getMockBillingProvider/
  )
})

test("P0-05: billing checkout handles missing provider before PII leaves app", () => {
  const source = read("src/lib/billing/actions.ts")
  const guard = source.indexOf("provider = resolveBillingProvider()")
  const customer = source.indexOf("provider.createCustomer")
  assert.ok(guard >= 0 && customer > guard)
  assert.match(source, /Cobrança não configurada/)
})

test("P0-06: billing webhook requires provider and token", () => {
  const source = read("src/app/api/webhooks/billing/route.ts")
  assert.match(source, /BillingNotConfiguredError/)
  assert.match(source, /ALLOW_INSECURE_BILLING_WEBHOOKS/)
  assert.match(source, /if\s*\(!secret\s*&&\s*!insecureDevWebhookAllowed\)/)
  assert.match(source, /status:\s*503/)
})

test("P0-07: mock billing logs no customer PII", () => {
  const source = read("src/lib/billing/providers/mock-billing.ts")
  assert.doesNotMatch(source, /request\.name/)
  assert.doesNotMatch(source, /request\.cpfCnpj/)
})

console.log("")
console.log(`P0 runtime guards: ${passed} passed, ${failed} failed`)

if (failed > 0) process.exit(1)
