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

test("P0-04: billing provider is chosen by explicit selector, never by key presence", () => {
  // A versão anterior desta asserção cobrava `ALLOW_MOCK_BILLING_PROVIDER` e a
  // ausência de um fallback específico. O registry foi reescrito na 12C.0: a
  // seleção passou a ser por `BILLING_PROVIDER`, e a chave do Asaas voltou a
  // ser configuração, não intenção. A propriedade cobrada é a mesma — nunca
  // cair em provider por efeito colateral —, agora na forma nova.
  const source = read("src/lib/billing/registry.ts")
  assert.match(source, /BillingProviderNotConfiguredError/)
  assert.match(source, /BILLING_PROVIDER/)
  // Nenhuma decisão de seleção pode nascer da presença da chave.
  assert.doesNotMatch(source, /if\s*\(\s*!?\s*(env\.)?ASAAS_API_KEY\s*\)\s*return/)
  assert.doesNotMatch(source, /ALLOW_MOCK_BILLING_PROVIDER/)
})

// P0-05 e P0-06 cobriam `src/lib/billing/actions.ts` e
// `src/app/api/webhooks/billing/route.ts`, aposentados na 12C.0. Elas NÃO
// foram descartadas: viraram asserções de AUSÊNCIA em
// `tests/billing-legacy-retirement-guard.mjs`, que reprova se qualquer um dos
// dois caminhos reaparecer — o que é mais forte do que cobrar a forma correta
// de um arquivo que não deveria existir.

test("P0-07: mock billing logs no customer PII", () => {
  const source = read("src/lib/billing/providers/mock-billing.ts")
  assert.doesNotMatch(source, /request\.name/)
  assert.doesNotMatch(source, /request\.cpfCnpj/)
})

console.log("")
console.log(`P0 runtime guards: ${passed} passed, ${failed} failed`)

if (failed > 0) process.exit(1)
