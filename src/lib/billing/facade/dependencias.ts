/**
 * DEPENDÊNCIAS DA FACHADA — injetadas, e PREGUIÇOSAS de propósito
 *
 * ── POR QUE FÁBRICAS, E NÃO INSTÂNCIAS ──────────────────────────────────────
 *
 * `repositorio` e `provider` são funções, não objetos prontos. A diferença é o
 * que torna a ordem de segurança OBSERVÁVEL: um teste pode afirmar "com a flag
 * desligada, `repositorio` nunca foi chamada" e "num comando de leitura,
 * `provider` nunca foi chamada". Com instâncias prontas, "não usou" seria
 * indistinguível de "usou e não fez nada", e a regra viraria comentário.
 *
 * É também o que impede efeito colateral na montagem: construir
 * `SupabaseBillingRepository` cedo demais exigiria a chave `service_role` num
 * caminho onde billing pode estar desligado.
 *
 * ── O RELÓGIO REAL MORA AQUI, E SÓ AQUI ─────────────────────────────────────
 *
 * `Clock` é uma porta justamente para que nenhum caso de uso leia o relógio do
 * processo. Alguém precisa lê-lo, e o lugar certo é a fronteira de composição —
 * este arquivo. É a única ocorrência de `new Date()` em todo o caminho de
 * billing, e ela existe para que todas as outras camadas possam não tê-la.
 */

import "server-only";

import { isBillingEnabled } from "../flag";
import type { Clock, IdGenerator } from "../core/ports";
import type { BillingProviderPort } from "../core/provider";
import type { BillingRepository } from "../core/repository";
import { resolveBillingProvider } from "../registry";
import { SupabaseBillingRepository } from "../repositories/supabase";
import {
  requireBillingOwner,
  requireBillingOwnerFor,
  type BillingAuthResult,
} from "../authorization";

export interface DependenciasDaFachada {
  /** A feature flag. Consultada ANTES de tudo, inclusive da sessão. */
  readonly flagLigada: () => boolean;
  /**
   * Resolve sessão, organização e papel NO SERVIDOR.
   *
   * Recebe o identificador que o cliente afirmou — e ele nunca autoriza: é
   * comparado com o que o servidor resolveu, e divergência é recusa.
   */
  readonly autorizar: (organizationIdPedido?: string) => Promise<BillingAuthResult>;
  /** Construído só quando a operação vai mesmo falar com o banco. */
  readonly repositorio: () => BillingRepository;
  /** Construído só quando a operação vai mesmo falar com o provider. */
  readonly provider: () => BillingProviderPort;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** Conta do provider. Entra na identidade global do recurso externo. */
  readonly providerAccountId: string;
}

/**
 * Relógio do sistema.
 *
 * ISO 8601 UTC, que é o que `Clock` promete e o que o repositório normaliza na
 * volta.
 */
export function relogioDoSistema(): Clock {
  return { now: () => new Date().toISOString() };
}

/**
 * Gerador de correlação do sistema.
 *
 * `sequentialIds` do domínio reinicia em 1 a cada instância, e em produção cada
 * requisição monta a sua — duas operações simultâneas receberiam `corr_000001`
 * e a trilha ficaria ambígua justamente quando há o que investigar. Correlação
 * precisa ser única, e a fronteira de composição é onde a unicidade pode vir do
 * ambiente.
 *
 * Continua sem valor de segurança: correlação não autoriza nada e é gravada em
 * claro na auditoria.
 */
export function idsDoSistema(): IdGenerator {
  return { next: (prefixo: string) => `${prefixo}_${crypto.randomUUID()}` };
}

/**
 * Conta do provider.
 *
 * Constante enquanto só existe o mock. Quando a 12D trouxer o Asaas, ela passa
 * a vir da configuração — e o nome já está isolado aqui para que isso seja uma
 * linha, e não uma caça.
 */
const CONTA_DO_PROVIDER = "conta-unica";

/**
 * Fiação de produção.
 *
 * Nada aqui é executado na importação: as duas fábricas só rodam quando o
 * comando decide que precisa delas.
 */
export function dependenciasDeProducao(): DependenciasDaFachada {
  return {
    flagLigada: isBillingEnabled,
    autorizar: (organizationIdPedido) =>
      organizationIdPedido === undefined
        ? requireBillingOwner()
        : requireBillingOwnerFor(organizationIdPedido),
    repositorio: () => new SupabaseBillingRepository(),
    provider: () => resolveBillingProvider(),
    clock: relogioDoSistema(),
    ids: idsDoSistema(),
    providerAccountId: CONTA_DO_PROVIDER,
  };
}
