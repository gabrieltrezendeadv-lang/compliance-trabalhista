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
  requireBillingMember,
  requireBillingMemberFor,
  requireBillingOwner,
  requireBillingOwnerFor,
  type BillingAuthResult,
} from "../authorization";
import { cunharIntencao } from "./intencao";

/**
 * Papel mínimo de um comando.
 *
 * Duas categorias, e só duas: o billing não precisa saber a diferença entre
 * colaborador e auditor — precisa saber se o ator pertence ao tenant e se
 * administra a assinatura.
 */
export type PapelMinimo = "member" | "owner";

export interface DependenciasDaFachada {
  /** A feature flag. Consultada ANTES de tudo, inclusive da sessão. */
  readonly flagLigada: () => boolean;
  /**
   * Resolve sessão, organização e papel NO SERVIDOR.
   *
   * Recebe o PAPEL MÍNIMO exigido pelo comando e o identificador que o cliente
   * afirmou. O identificador nunca autoriza: é comparado com o que o servidor
   * resolveu, e divergência é recusa.
   *
   * O papel mínimo é do COMANDO, não do chamador: quem decide se `lerAcesso`
   * aceita membro é a matriz da fachada, e ela chega aqui como argumento em vez
   * de ficar implícita na escolha de qual função de autorização importar.
   */
  readonly autorizar: (
    papelMinimo: PapelMinimo,
    organizationIdPedido?: string
  ) => Promise<BillingAuthResult>;
  /**
   * Cunha uma intenção de checkout.
   *
   * Fábrica injetada para que o teste controle a sequência e possa provar que
   * um retry NÃO cunha nada — a diferença entre "reusou a intenção" e "sorteou
   * outra igual por acaso" precisa ser observável.
   */
  readonly novaIntencao: () => string;
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
    autorizar: (papelMinimo, organizationIdPedido) => {
      // Quatro combinações, escritas por extenso. Um seletor esperto aqui
      // — objeto indexado, ternário aninhado — economizaria linhas e tornaria
      // a matriz de autorização difícil de LER, que é a única coisa que ela
      // precisa ser.
      if (papelMinimo === "owner") {
        return organizationIdPedido === undefined
          ? requireBillingOwner()
          : requireBillingOwnerFor(organizationIdPedido);
      }
      return organizationIdPedido === undefined
        ? requireBillingMember()
        : requireBillingMemberFor(organizationIdPedido);
    },
    novaIntencao: cunharIntencao,
    repositorio: () => new SupabaseBillingRepository(),
    provider: () => resolveBillingProvider(),
    clock: relogioDoSistema(),
    ids: idsDoSistema(),
    providerAccountId: CONTA_DO_PROVIDER,
  };
}
