/**
 * ARMADILHA DE REDE — nenhum teste pode sair da máquina
 *
 * Carregado por `setupFiles` do projeto `unit`. Substitui `fetch`,
 * `XMLHttpRequest` e `WebSocket` por versões que LANÇAM.
 *
 * ── POR QUE ISTO EXISTE ─────────────────────────────────────────────────────
 *
 * A Etapa 12B afirma "nenhuma chamada ao Asaas" e "sem rede". Uma afirmação
 * dessas não se sustenta por revisão: basta um `fetch` esquecido num provider
 * para que o teste passe a depender da internet — e, pior, para que uma
 * requisição financeira real saia de um runner de CI.
 *
 * Com a armadilha, a tentativa vira FALHA DE TESTE, com o URL no erro. O teste
 * que precisar de rede tem de dizê-lo explicitamente, e não existe teste assim
 * nesta etapa.
 *
 * ── LIMITE DECLARADO ────────────────────────────────────────────────────────
 *
 * Cobre as APIs de alto nível. Um módulo que importasse `node:http` ou
 * `node:net` diretamente escaparia daqui — por isso
 * `tests/billing-orchestration-guard.mjs` proíbe, por análise estática, que
 * qualquer arquivo de `src/lib/billing` importe módulo de rede do Node.
 * As duas defesas cobrem caminhos diferentes.
 */

export class NetworkAccessInTestError extends Error {
  constructor(api: string, alvo: string) {
    super(
      `Acesso de rede proibido em teste: ${api} → ${alvo}. ` +
        "A Etapa 12B roda exclusivamente com provider mock, sem rede."
    );
    this.name = "NetworkAccessInTestError";
  }
}

function descrever(alvo: unknown): string {
  if (typeof alvo === "string") return alvo;
  if (alvo && typeof alvo === "object" && "url" in alvo) {
    return String((alvo as { url: unknown }).url);
  }
  return String(alvo);
}

const g = globalThis as unknown as Record<string, unknown>;

g.fetch = (alvo: unknown) => {
  throw new NetworkAccessInTestError("fetch", descrever(alvo));
};

g.XMLHttpRequest = class {
  open(_metodo: string, alvo: string) {
    throw new NetworkAccessInTestError("XMLHttpRequest", alvo);
  }
};

g.WebSocket = class {
  constructor(alvo: string) {
    throw new NetworkAccessInTestError("WebSocket", alvo);
  }
};
