/**
 * ENTITLEMENTS — recursos por plano e modo de acesso.
 *
 * Cobre os itens 8, 16, 17, 18 e 19 dos testes obrigatórios: recursos do
 * Essencial, recursos do Completo, Riscos e Denúncias bloqueados no Essencial,
 * armazenamento de 2 GB e 10 GB, e transição para modo leitura.
 */

import { describe, expect, it } from "vitest";

import {
  canWrite,
  isReadOnly,
  lockedFeatures,
  planFeatures,
  planIncludes,
  storageQuotaMib,
  supportSlaBusinessDays,
} from "@/lib/billing/plans/entitlements";
import type { FeatureKey, SubscriptionState } from "@/lib/billing/plans/model";

const ESSENCIAL: FeatureKey[] = [
  "establishments",
  "departments",
  "users",
  "documents",
  "evidence",
  "action_plans",
  "campaigns_manual",
  "reports_basic",
];

const EXCLUSIVOS_DO_COMPLETO: FeatureKey[] = [
  "risks",
  "complaints",
  "campaigns_automatic",
  "alerts",
  "reports_advanced",
  "history",
  "seal_hash",
  "priority_support",
];

describe("recursos do Essencial", () => {
  for (const recurso of ESSENCIAL) {
    it(`inclui ${recurso}`, () => {
      expect(planIncludes("essencial", recurso)).toBe(true);
    });
  }

  it("não inclui nada além dos oito declarados", () => {
    expect([...planFeatures("essencial")].sort()).toEqual([...ESSENCIAL].sort());
  });
});

describe("recursos do Completo", () => {
  it("inclui TUDO do Essencial", () => {
    for (const recurso of ESSENCIAL) {
      expect(planIncludes("completo", recurso)).toBe(true);
    }
  });

  for (const recurso of EXCLUSIVOS_DO_COMPLETO) {
    it(`inclui ${recurso}, exclusivo do Completo`, () => {
      expect(planIncludes("completo", recurso)).toBe(true);
    });
  }

  it("tem exatamente dezesseis recursos", () => {
    expect(planFeatures("completo")).toHaveLength(
      ESSENCIAL.length + EXCLUSIVOS_DO_COMPLETO.length
    );
  });
});

describe("Riscos e Denúncias são bloqueados no Essencial", () => {
  // São os dois módulos mais visíveis da diferença comercial entre os planos.
  // Um erro aqui entrega o produto inteiro pelo preço do plano de entrada.
  it("risks não pertence ao Essencial", () => {
    expect(planIncludes("essencial", "risks")).toBe(false);
  });

  it("complaints não pertence ao Essencial", () => {
    expect(planIncludes("essencial", "complaints")).toBe(false);
  });

  it("os oito exclusivos aparecem como bloqueados — é o cadeado da interface", () => {
    expect([...lockedFeatures("essencial")].sort()).toEqual(
      [...EXCLUSIVOS_DO_COMPLETO].sort()
    );
  });

  it("o Completo não tem nada bloqueado", () => {
    expect(lockedFeatures("completo")).toEqual([]);
  });
});

describe("armazenamento e suporte", () => {
  it("Essencial tem 2 GB", () => {
    expect(storageQuotaMib("essencial")).toBe(2 * 1024);
  });

  it("Completo tem 10 GB", () => {
    expect(storageQuotaMib("completo")).toBe(10 * 1024);
  });

  it("SLA: 2 dias úteis no Essencial, 1 no Completo", () => {
    expect(supportSlaBusinessDays("essencial")).toBe(2);
    expect(supportSlaBusinessDays("completo")).toBe(1);
  });
});

describe("modo de acesso", () => {
  const comEscrita: SubscriptionState[] = [
    "trialing",
    "active",
    // Os 7 dias de tolerância dão ACESSO NORMAL, não acesso degradado.
    "past_due_tolerance",
    // O cancelamento vale ao fim do período pago; até lá nada muda.
    "cancel_scheduled",
  ];

  const somenteLeitura: SubscriptionState[] = ["read_only", "terminated"];

  for (const estado of comEscrita) {
    it(`${estado} permite escrever`, () => {
      expect(canWrite(estado)).toBe(true);
      expect(isReadOnly(estado)).toBe(false);
    });
  }

  for (const estado of somenteLeitura) {
    it(`${estado} é somente leitura`, () => {
      expect(canWrite(estado)).toBe(false);
      expect(isReadOnly(estado)).toBe(true);
    });
  }

  it("um estado desconhecido cai em somente leitura", () => {
    // A lista é de PERMISSÃO. Um estado novo que alguém acrescente ao modelo e
    // esqueça de classificar não pode nascer liberado.
    expect(canWrite("estado_inventado" as SubscriptionState)).toBe(false);
  });
});
