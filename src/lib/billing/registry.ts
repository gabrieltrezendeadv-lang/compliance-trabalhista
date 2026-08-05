/**
 * SELEÇÃO DO PROVIDER DE COBRANÇA — POR SELETOR EXPLÍCITO
 *
 * `BILLING_PROVIDER` vale `mock` ou `asaas`. Não há terceiro valor, não há
 * padrão e não há queda para lado nenhum.
 *
 * ── O QUE ESTA VERSÃO CORRIGE ───────────────────────────────────────────────
 *
 * A anterior escolhia por PRESENÇA DE CHAVE: se `ASAAS_API_KEY` existisse no
 * ambiente, o Asaas real era selecionado. Criar um secret — operação rotineira,
 * feita por quem está configurando outra coisa — ligava cobrança real sem que
 * ninguém tivesse decidido ligar cobrança real. A intenção não estava escrita
 * em lugar nenhum; era inferida de um efeito colateral.
 *
 * Agora a intenção é o seletor, e a chave é só configuração. Ter a chave sem
 * `BILLING_PROVIDER=asaas` não seleciona nada; pedir `asaas` sem a chave
 * REPROVA em vez de cair no mock.
 *
 * ── FAIL-CLOSED NAS QUATRO DIREÇÕES ─────────────────────────────────────────
 *
 *   seletor ausente ....... BillingProviderNotConfiguredError
 *   seletor desconhecido .. BillingProviderNotConfiguredError, com o valor recebido
 *   mock em produção ...... MockProviderForbiddenInProductionError (do construtor)
 *   asaas incompleto ...... BillingProviderNotConfiguredError, sem citar o valor
 *
 * Nenhum caminho devolve um provider degradado. Quem não pode ser atendido não
 * recebe objeto — recebe exceção.
 *
 * ── POR QUE O `asaas` AINDA NÃO DEVOLVE ADAPTADOR ───────────────────────────
 *
 * A 12B trocou o contrato de provider por `BillingProviderPort`, que é o que a
 * jornada inteira usa. O adaptador do Asaas em `providers/asaas.ts` implementa
 * o contrato ANTIGO (`types.ts`) e não foi portado — portá-lo é a Etapa 12D,
 * junto do sandbox.
 *
 * Então `asaas` valida a configuração por inteiro e, só depois, recusa com
 * `BillingProviderNotImplementedError`. A ordem importa: validar antes de
 * recusar faz a mensagem dizer o que falta configurar, em vez de esconder a
 * configuração incompleta atrás de "não implementado". E recusar de forma
 * TIPADA é o oposto de devolver um adaptador que talvez funcione.
 */

import { sequentialIds } from "./core/ports";
import type { BillingProviderPort } from "./core/provider";
import { BillingProviderMock } from "./providers/mock/deterministic";

/** Os únicos valores aceitos. Fechado de propósito. */
export const PROVIDERS_DE_COBRANCA = Object.freeze(["mock", "asaas"] as const);

export type NomeDeProviderDeCobranca = (typeof PROVIDERS_DE_COBRANCA)[number];

/** Variável que declara a INTENÇÃO. A chave do Asaas é configuração, não intenção. */
export const SELETOR_DE_PROVIDER = "BILLING_PROVIDER";

export class BillingProviderNotConfiguredError extends Error {
  constructor(motivo: string) {
    super(`Provider de cobrança não configurado: ${motivo}`);
    this.name = "BillingProviderNotConfiguredError";
  }
}

export class BillingProviderNotImplementedError extends Error {
  constructor(qual: string) {
    super(
      `Provider "${qual}" ainda não implementa o contrato da 12B. ` +
        "O adaptador é a Etapa 12D, junto do sandbox."
    );
    this.name = "BillingProviderNotImplementedError";
  }
}

/** Ambiente injetável: o teste não precisa mexer no `process.env` do processo. */
export interface AmbienteDeProvider {
  readonly BILLING_PROVIDER?: string;
  readonly NODE_ENV?: string;
  readonly VERCEL_ENV?: string;
  readonly ASAAS_API_KEY?: string;
  readonly ASAAS_ENVIRONMENT?: string;
  readonly ASAAS_WEBHOOK_TOKEN?: string;
}

function doProcesso(): AmbienteDeProvider {
  return {
    BILLING_PROVIDER: process.env.BILLING_PROVIDER,
    NODE_ENV: process.env.NODE_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
    ASAAS_API_KEY: process.env.ASAAS_API_KEY,
    ASAAS_ENVIRONMENT: process.env.ASAAS_ENVIRONMENT,
    ASAAS_WEBHOOK_TOKEN: process.env.ASAAS_WEBHOOK_TOKEN,
  };
}

/**
 * O seletor, validado. Nunca devolve valor inventado.
 *
 * String vazia e espaço em branco contam como AUSENTE: uma variável declarada
 * vazia é um acidente de configuração, não uma escolha.
 */
export function seletorDeProvider(env: AmbienteDeProvider = doProcesso()): NomeDeProviderDeCobranca {
  const bruto = (env.BILLING_PROVIDER ?? "").trim();

  if (bruto === "") {
    throw new BillingProviderNotConfiguredError(
      `${SELETOR_DE_PROVIDER} não está definida. ` +
        `Valores aceitos: ${PROVIDERS_DE_COBRANCA.join(", ")}. ` +
        "Ausência NUNCA seleciona um provider."
    );
  }

  if (!(PROVIDERS_DE_COBRANCA as readonly string[]).includes(bruto)) {
    throw new BillingProviderNotConfiguredError(
      `${SELETOR_DE_PROVIDER}="${bruto}" não é um valor conhecido. ` +
        `Valores aceitos: ${PROVIDERS_DE_COBRANCA.join(", ")}.`
    );
  }

  return bruto as NomeDeProviderDeCobranca;
}

/**
 * Configuração do Asaas, conferida por inteiro.
 *
 * A mensagem nomeia as variáveis que FALTAM e nunca reproduz o valor de
 * nenhuma delas — um erro que ecoasse a chave a publicaria no log.
 */
function exigirConfiguracaoDoAsaas(env: AmbienteDeProvider): void {
  const faltando: string[] = [];

  if ((env.ASAAS_API_KEY ?? "").trim() === "") faltando.push("ASAAS_API_KEY");
  if ((env.ASAAS_WEBHOOK_TOKEN ?? "").trim() === "") faltando.push("ASAAS_WEBHOOK_TOKEN");

  const ambiente = (env.ASAAS_ENVIRONMENT ?? "").trim();
  if (ambiente === "") {
    faltando.push("ASAAS_ENVIRONMENT");
  } else if (ambiente !== "sandbox" && ambiente !== "production") {
    throw new BillingProviderNotConfiguredError(
      'ASAAS_ENVIRONMENT precisa ser "sandbox" ou "production".'
    );
  }

  if (faltando.length > 0) {
    throw new BillingProviderNotConfiguredError(
      `faltam variáveis do Asaas: ${faltando.join(", ")}.`
    );
  }
}

/**
 * Resolve o provider declarado.
 *
 * Não recebe `BILLING_ENABLED` e não o consulta: quem decide se billing está
 * ligado é o chamador, ANTES de pedir provider. Misturar as duas decisões aqui
 * faria a flag desligada parecer "provider não configurado", e os dois casos
 * precisam de diagnósticos diferentes.
 */
export function resolveBillingProvider(
  env: AmbienteDeProvider = doProcesso()
): BillingProviderPort {
  const escolhido = seletorDeProvider(env);

  if (escolhido === "mock") {
    // O construtor do mock aborta em NODE_ENV=production e em
    // VERCEL_ENV=production. A recusa é dele, não daqui: duplicar a condição
    // criaria dois lugares para errar.
    return new BillingProviderMock({
      ids: sequentialIds(),
      env: { NODE_ENV: env.NODE_ENV, VERCEL_ENV: env.VERCEL_ENV },
    });
  }

  exigirConfiguracaoDoAsaas(env);
  throw new BillingProviderNotImplementedError("asaas");
}

/**
 * Nome do provider ATIVO, para diagnóstico.
 *
 * Devolve `null` quando não há seleção válida. Não inventa "not-configured"
 * como se fosse um provider: a ausência é ausência.
 */
export function nomeDoProviderAtivo(env: AmbienteDeProvider = doProcesso()): NomeDeProviderDeCobranca | null {
  try {
    return seletorDeProvider(env);
  } catch {
    return null;
  }
}
