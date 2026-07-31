/**
 * Verificação estática do call graph — conversão de `tests/call-graph.test.ts`.
 *
 * ── POR QUE ESTE ARQUIVO ANALISA TEXTO-FONTE ──────────────────────────────
 *
 * A regra geral desta suíte é testar comportamento, não procurar texto no
 * código. Este arquivo é a exceção justificada: as invariantes aqui não são
 * observáveis em runtime.
 *
 * "Nenhum módulo `use client` importa service.ts" é uma propriedade do grafo
 * de módulos, não de uma execução. Se um componente cliente passasse a
 * importar a chave `service_role`, o vazamento aconteceria no bundle enviado
 * ao navegador — nenhum teste de runtime em Node observaria isso. A análise
 * estática é a única forma de verificação disponível.
 *
 * As 25 asserções do arquivo original foram preservadas.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src"
);

function readSource(relPath: string): string {
  const fullPath = path.join(SRC_ROOT, relPath);
  if (!fs.existsSync(fullPath)) throw new Error(`Arquivo não encontrado: ${fullPath}`);
  return fs.readFileSync(fullPath, "utf-8");
}

function findTsFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
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

/** Primeira linha significativa — ignora comentários e linhas em branco. */
function firstMeaningfulLine(content: string): string {
  return (
    content
      .split("\n")
      .find(
        (l) =>
          l.trim().length > 0 &&
          !l.trim().startsWith("//") &&
          !l.trim().startsWith("*") &&
          !l.trim().startsWith("/*")
      ) ?? ""
  ).trim();
}

function hasClientDirective(content: string): boolean {
  return /^["']use client["'];?$/.test(firstMeaningfulLine(content));
}

const ALL_TS_FILES = findTsFiles(SRC_ROOT);

// ══════════════════════════════════════════════════════════════════════════
// Diretivas de fronteira
// ══════════════════════════════════════════════════════════════════════════

describe("diretivas de fronteira servidor/cliente", () => {
  it("CG-01: gateway.ts declara 'use server'", () => {
    expect(readSource("lib/complaints/gateway.ts")).toContain('"use server"');
  });

  it("CG-18: gateway.ts NÃO declara 'use client'", () => {
    expect(readSource("lib/complaints/gateway.ts")).not.toContain('"use client"');
  });

  it("CG-19: service.ts NÃO declara 'use client'", () => {
    expect(hasClientDirective(readSource("lib/supabase/service.ts"))).toBe(false);
  });

  it("CG-20: actions.ts declara 'use server'", () => {
    expect(readSource("lib/complaints/actions.ts")).toContain('"use server"');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Fronteira do service_role — a invariante mais crítica
// ══════════════════════════════════════════════════════════════════════════

describe("fronteira do service_role", () => {
  it("CG-12: nenhum módulo 'use client' importa service.ts", () => {
    const violations = ALL_TS_FILES.filter((filePath) => {
      const content = fs.readFileSync(filePath, "utf-8");
      return (
        hasClientDirective(content) &&
        (content.includes("supabase/service") ||
          content.includes("createServiceClient"))
      );
    }).map((f) => path.relative(SRC_ROOT, f));

    expect(violations).toEqual([]);
  });

  it("CG-13: service.ts é importado apenas por entrypoints de servidor auditados", () => {
    const allowed = new Set([
      "lib/complaints/gateway.ts",
      "lib/supabase/service.ts",
      "app/api/cron/close-assessment-cycles/route.ts",
      // Etapa 12B. O repositório de billing alcança o schema `billing`, que
      // não é exposto ao PostgREST e portanto só é legível com service_role.
      // A entrada é NOMINAL e o arquivo é `server-only`: importá-lo de um
      // componente cliente é erro de build. `tests/billing-orchestration-guard.mjs`
      // confere que ele continua sendo isso.
      "lib/billing/repositories/supabase.ts",
    ]);

    const unexpected = ALL_TS_FILES.filter((filePath) => {
      const content = fs.readFileSync(filePath, "utf-8");
      return (
        content.includes("supabase/service") ||
        content.includes("createServiceClient")
      );
    })
      .map((f) => path.relative(SRC_ROOT, f).split(path.sep).join("/"))
      .filter((rel) => !allowed.has(rel));

    expect(unexpected).toEqual([]);
  });

  it("CG-16: gateway.ts usa createServiceClient", () => {
    expect(readSource("lib/complaints/gateway.ts")).toContain("createServiceClient");
  });

  it("CG-15: actions.ts usa createClient e NÃO createServiceClient", () => {
    const content = readSource("lib/complaints/actions.ts");

    expect(content).toContain("createClient");
    expect(content).not.toContain("createServiceClient");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Delegação ao gateway
// ══════════════════════════════════════════════════════════════════════════

describe("delegação ao gateway", () => {
  it("CG-02: actions.ts importa gatewayAccessComplaint", () => {
    expect(readSource("lib/complaints/actions.ts")).toContain("gatewayAccessComplaint");
  });

  it("CG-03: actions.ts importa gatewaySendReporterMessage", () => {
    expect(readSource("lib/complaints/actions.ts")).toContain("gatewaySendReporterMessage");
  });

  it("CG-04: accessComplaint delega para gatewayAccessComplaint", () => {
    expect(readSource("lib/complaints/actions.ts")).toMatch(
      /export\s+async\s+function\s+accessComplaint[^{]*\{[\s\S]*?gatewayAccessComplaint/
    );
  });

  it("CG-05: sendReporterMessage delega para gatewaySendReporterMessage", () => {
    expect(readSource("lib/complaints/actions.ts")).toMatch(
      /export\s+async\s+function\s+sendReporterMessage[^{]*\{[\s\S]*?gatewaySendReporterMessage/
    );
  });

  it("CG-14: submitComplaint NÃO passa pelo gateway (fluxo público)", () => {
    const content = readSource("lib/complaints/actions.ts");
    const fnMatch = content.match(
      /export\s+async\s+function\s+submitComplaint[\s\S]*?\n\}/
    );

    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).not.toContain("gateway");
  });

  it("CG-23: complaint-tracker importa de actions, nunca do gateway", () => {
    const content = readSource("components/complaints/complaint-tracker.tsx");

    expect(content).toContain("@/lib/complaints/actions");
    expect(content).not.toContain("@/lib/complaints/gateway");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Assinaturas de RPC — nenhuma chamada legada sobrevivente
// ══════════════════════════════════════════════════════════════════════════

describe("assinaturas de RPC", () => {
  it("CG-08/09: gateway.ts referencia as funções _v2", () => {
    const content = readSource("lib/complaints/gateway.ts");

    expect(content).toContain("fn_access_complaint_v2");
    expect(content).toContain("fn_send_reporter_message_v2");
  });

  it("CG-10: gateway.ts não referencia fn_access_complaint sem _v2", () => {
    expect(readSource("lib/complaints/gateway.ts")).not.toMatch(
      /fn_access_complaint(?!_v2)/
    );
  });

  it("CG-11: gateway.ts não referencia fn_send_reporter_message sem _v2", () => {
    expect(readSource("lib/complaints/gateway.ts")).not.toMatch(
      /fn_send_reporter_message(?!_v2)/
    );
  });

  it("CG-06: actions.ts não chama fn_access_complaint diretamente", () => {
    expect(readSource("lib/complaints/actions.ts")).not.toMatch(
      /\.rpc\(\s*["']fn_access_complaint["']/
    );
  });

  it("CG-07: actions.ts não chama fn_send_reporter_message diretamente", () => {
    expect(readSource("lib/complaints/actions.ts")).not.toMatch(
      /\.rpc\(\s*["']fn_send_reporter_message["']/
    );
  });

  it("CG-21: nenhum arquivo usa a assinatura antiga de fn_access_complaint", () => {
    const violations = ALL_TS_FILES.filter((filePath) =>
      /\.rpc\(\s*["']fn_access_complaint["']\s*,\s*\{[^}]*\}/.test(
        fs.readFileSync(filePath, "utf-8")
      )
    ).map((f) => path.relative(SRC_ROOT, f));

    expect(violations).toEqual([]);
  });

  it("CG-22: nenhum arquivo usa a assinatura antiga de fn_send_reporter_message", () => {
    const violations = ALL_TS_FILES.filter((filePath) =>
      /\.rpc\(\s*["']fn_send_reporter_message["']\s*,/.test(
        fs.readFileSync(filePath, "utf-8")
      )
    ).map((f) => path.relative(SRC_ROOT, f));

    expect(violations).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Compatibilidade com Next.js 16
// ══════════════════════════════════════════════════════════════════════════

describe("compatibilidade com Next.js 16", () => {
  it("CG-17: gateway.ts usa await headers() (assíncrono)", () => {
    expect(readSource("lib/complaints/gateway.ts")).toContain("await headers()");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Higiene de logs e de erros
// ══════════════════════════════════════════════════════════════════════════

describe("higiene de logs e erros", () => {
  it("CG-24: nenhuma linha de log do gateway expõe protocolo, PIN, corpo ou IP", () => {
    const logLines = readSource("lib/complaints/gateway.ts")
      .split("\n")
      .filter(
        (l) =>
          l.includes("console.log") ||
          l.includes("console.error") ||
          l.includes("console.warn")
      );

    for (const line of logLines) {
      expect(line, `expõe protocolo: ${line.trim()}`).not.toContain("parsed.data.protocol");
      expect(line, `expõe PIN: ${line.trim()}`).not.toContain("parsed.data.pin");
      expect(line, `expõe corpo: ${line.trim()}`).not.toContain("parsed.data.body");
      if (!line.includes("hmac_preflight")) {
        expect(line, `pode expor hash de IP: ${line.trim()}`).not.toContain("ipHash");
      }
    }
  });

  it("CG-25: gateway.ts nunca devolve error.message do Supabase ao usuário", () => {
    const content = readSource("lib/complaints/gateway.ts");

    expect(content).not.toMatch(/error:\s*error\.message/);
    expect(content).not.toMatch(/error:\s*_?err\.message/);
  });
});
