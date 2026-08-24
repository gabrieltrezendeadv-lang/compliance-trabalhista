/**
 * CASOS DE USO DE CONSULTA — Etapa 12C.2
 *
 * ── POR QUE ISTO EXISTE, SE O REPOSITÓRIO JÁ TEM OS MÉTODOS ─────────────────
 *
 * A fachada chamava `repo.readCatalog` e `repo.readState` DIRETAMENTE. Duas
 * consequências, e nenhuma boa:
 *
 *   1. a regra "um comando da fachada → um caso de uso" valia para nove dos
 *      doze comandos, e uma regra que vale para nove de doze não é uma regra;
 *   2. a autorização desses dois caminhos ficava só na fachada. O caso de uso
 *      é onde toda a família de comandos declara sua exigência de papel, e
 *      deixar dois de fora significava dois lugares para revisar em vez de um.
 *
 * Com os casos de uso aqui, a exigência de papel de TODA operação de billing
 * está no primeiro `assert…` de cada função deste diretório — e a guarda pode
 * cobrar isso nominalmente.
 *
 * ── A LINHA QUE SEPARA MEMBRO DE PROPRIETÁRIO ───────────────────────────────
 *
 * Não é "leitura versus escrita": é O QUE A RESPOSTA CARREGA.
 *
 *   `readCatalogUseCase`   tabela de preços públicos da versão vigente. Não diz
 *                          nada sobre o contrato desta organização. MEMBRO.
 *
 *   `readSubscriptionState` traz `StoredSubscription` inteiro — CNPJ, contato
 *                          financeiro, preço praticado, faixa, identificador
 *                          externo. É o dossiê comercial. PROPRIETÁRIO.
 *
 * A decisão de acesso (`resolveBillingAccess`, em `access.ts`) LÊ o mesmo
 * estado, mas devolve apenas direitos — e por isso é de membro. A diferença
 * está na saída, não na fonte.
 */

import type { Result } from "../core/errors";
import type { BillingState, CatalogPrice } from "../core/repository";
import { CATALOG_VERSION } from "../plans/catalog";
import {
  assertTenantMember,
  assertTenantOwner,
  type ComandoBase,
  type UseCaseEnv,
} from "./shared";

/**
 * Catálogo de preços da versão vigente.
 *
 * A versão é a constante do SERVIDOR e não entra por parâmetro: aceitar uma
 * versão do chamador permitiria montar uma tela com preço antigo e depois
 * cobrar a diferença de quem confiou nela.
 */
export async function readCatalogUseCase(
  env: UseCaseEnv,
  input: ComandoBase
): Promise<Result<readonly CatalogPrice[]>> {
  const negado = assertTenantMember<readonly CatalogPrice[]>(env.auth, input.requestedOrganizationId);
  if (negado) return negado;

  return env.repo.readCatalog(env.auth.userId, env.auth.organizationId, CATALOG_VERSION);
}

/**
 * Estado completo da assinatura, cortesias e direito adquirido.
 *
 * PROPRIETÁRIO: a resposta carrega dado financeiro restrito. Quem precisa
 * apenas saber o que pode fazer usa `resolveBillingAccess`, que é de membro.
 */
export async function readSubscriptionState(
  env: UseCaseEnv,
  input: ComandoBase
): Promise<Result<BillingState>> {
  const negado = assertTenantOwner<BillingState>(env.auth, input.requestedOrganizationId);
  if (negado) return negado;

  return env.repo.readState(env.auth.userId, env.auth.organizationId);
}
