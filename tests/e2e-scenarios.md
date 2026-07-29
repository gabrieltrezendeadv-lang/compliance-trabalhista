# E2E Test Scenarios — SEC-BLOCK1-CONSOLIDATION v1.2.1

> **Estado na Etapa 1 (29/07/2026):** os 10 cenários abaixo continuam sendo
> roteiro **manual**. Todos exigem banco com dados semeados e estão bloqueados
> pelo R1 — registrados em [`db/README-R1.md`](./db/README-R1.md) §4 como
> R1-E2E-01 a R1-E2E-07. Não foram convertidos em `test.skip`: representar
> funcionalidade bloqueada com testes ignorados mascararia a lacuna.
>
> O E2E **automatizado** que já roda sem banco nem credenciais está em
> [`e2e/public-routes.spec.ts`](./e2e/public-routes.spec.ts) — rotas públicas,
> ausência de sessão, erro controlado, cabeçalhos de segurança e
> acessibilidade básica.
>
> **Correção de rota:** o cenário E2E-01 abaixo aponta para
> `/denuncia/{tenant_slug}`. A rota real implementada é `/report/[slug]`
> (`src/app/(public)/report/[slug]/page.tsx`). O texto original foi preservado
> para não reescrever o histórico do documento.

## Prerequisites

- EXPAND migration applied (`fn_access_complaint_v2`, `fn_send_reporter_message_v2`, `fn_check_pin_rate_limit_v2` exist)
- Gateway deployed with `RATE_LIMIT_HMAC_SECRET` configured (≥32 chars)
- `SUPABASE_SERVICE_ROLE_KEY` configured as server-only env var
- At least one complaint exists with known protocol and PIN
- A complaint in "resolved" status exists for closed-complaint test

## Scenarios

### E2E-01: Denúncia anônima via formulário público

**Steps:**
1. Navigate to `/denuncia/{tenant_slug}`
2. Fill: subject, description, category, PIN (6+ digits)
3. Leave "anônimo" checked
4. Submit

**Expected:**
- Success message with protocol number displayed
- `fn_submit_complaint` called via anon client (NOT gateway)
- Complaint visible in admin dashboard
- PIN stored as bcrypt hash (not plaintext)

### E2E-02: Acesso à caixa segura com protocolo e PIN corretos

**Steps:**
1. Navigate to complaint tracker
2. Enter valid protocol + correct PIN
3. Submit

**Expected:**
- Complaint details displayed (status, category, severity, messages)
- Gateway called: `fn_access_complaint_v2` via service_role
- IP hash sent as `p_caller_ip_hash` parameter
- No rate limit triggered

### E2E-03: Acesso à caixa segura com PIN incorreto

**Steps:**
1. Navigate to complaint tracker
2. Enter valid protocol + wrong PIN
3. Submit

**Expected:**
- Error: "Protocolo ou PIN inválido"
- Same error message as nonexistent protocol (anti-enumeration)
- `fn_record_pin_failure` called (attempt logged with ip_hash)
- No internal error details exposed

### E2E-04: Acesso à caixa segura com protocolo inexistente

**Steps:**
1. Navigate to complaint tracker
2. Enter nonexistent protocol + any PIN
3. Submit

**Expected:**
- Error: "Protocolo ou PIN inválido"
- Same message as wrong PIN (anti-enumeration verified)
- Dummy bcrypt comparison executed (timing attack mitigation)

### E2E-05: Rate limit por protocolo (5 tentativas em 15 min)

**Steps:**
1. Navigate to complaint tracker
2. Submit 5+ wrong PINs for the same protocol within 15 minutes
3. Submit correct PIN

**Expected:**
- First 5 wrong attempts: "Protocolo ou PIN inválido"
- 6th attempt (even correct PIN): "Muitas tentativas. Tente novamente em alguns minutos."
- Rate limit resets after 15 minutes

### E2E-06: Rate limit por IP (20 tentativas distribuídas)

**Steps:**
1. From the same IP, submit wrong PINs for 20+ different protocols
2. Try a new protocol

**Expected:**
- After 20 failures from same IP: "Muitas tentativas. Tente novamente em alguns minutos."
- Different IPs are not affected (HMAC produces different hashes)

### E2E-07: Envio de mensagem pelo denunciante

**Steps:**
1. Access complaint tracker with correct protocol + PIN
2. Type a message in the message box
3. Submit

**Expected:**
- Message appears in conversation
- Gateway called: `fn_send_reporter_message_v2` via service_role
- Message visible to investigators in dashboard
- `sender_type = 'reporter'`

### E2E-08: Envio de mensagem em denúncia resolvida

**Steps:**
1. Access tracker for a complaint with status "resolved" or "dismissed"
2. Attempt to send a message

**Expected:**
- Error: "Esta denúncia foi encerrada e não aceita novas mensagens."
- Message NOT saved

### E2E-09: Validação de campos do gateway (injection attempt)

**Steps:**
1. Use browser DevTools / API client to send malformed payload:
   - Extra field: `{ protocol: "ABC", pin: "1234", tenant_id: "injected" }`
   - Non-numeric PIN: `{ protocol: "ABC", pin: "abcdef" }`
   - Protocol > 20 chars
   - Body > 10000 chars (for message endpoint)

**Expected:**
- All rejected with "Protocolo ou PIN inválido"
- No Supabase RPC called (Zod `.strict()` blocks before RPC)
- No internal error messages exposed

### E2E-10: HMAC secret ausente em produção

**Steps:**
1. Deploy to production WITHOUT `RATE_LIMIT_HMAC_SECRET`
2. Attempt to access complaint tracker

**Expected:**
- All access/message attempts return "Protocolo ou PIN inválido"
- Server log: `[gateway:access] cid=xxxx hmac_preflight=hmac_missing_production`
- NO RPC called (fail-closed behavior)
- System is secure but non-functional until secret is configured

## Verification Checklist

- [ ] All 10 scenarios documented
- [ ] Anti-enumeration consistent across E2E-03 and E2E-04
- [ ] Rate limit messages distinct from auth errors
- [ ] No PII in server logs (check container logs)
- [ ] Gateway correlation IDs present in error responses
- [ ] `fn_submit_complaint` flow unchanged (no gateway)
- [ ] Dashboard functions (getComplaints, getComplaintDetail) unaffected
- [ ] Cross-tenant isolation preserved (complaint only accessible to correct tenant)
