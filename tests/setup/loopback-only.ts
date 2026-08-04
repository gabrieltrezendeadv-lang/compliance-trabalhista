/**
 * REDE PERMITIDA SOMENTE EM LOOPBACK
 *
 * ── POR QUE ESTE ARQUIVO EXISTE, E NÃO O `no-network` ───────────────────────
 *
 * A suíte unitária proíbe TODA rede (`tests/setup/no-network.ts`): um `fetch`
 * ali é sempre defeito. A suíte de contrato precisa de rede, porque exercita o
 * repositório real contra o PostgREST — mas exclusivamente contra a stack
 * descartável local.
 *
 * Trocar "nenhuma rede" por "rede liberada" seria perder a garantia. Este
 * arquivo é o meio-termo estrito: `localhost`, `127.0.0.1` e `::1`, e nada
 * mais. Qualquer outro destino ABORTA ANTES da conexão, com o alvo na
 * mensagem.
 *
 * É o que impede que uma variável de ambiente mal preenchida — ou um copiar e
 * colar de URL de produção — faça a suíte de teste falar com o Supabase
 * hospedado.
 */

const PERMITIDOS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export class DestinoNaoPermitidoError extends Error {
  constructor(alvo: string) {
    super(
      `Rede bloqueada no contrato: ${alvo}. ` +
        "Somente loopback (localhost, 127.0.0.1, ::1) é permitido. " +
        "Nenhum teste deste repositório fala com banco remoto."
    );
    this.name = "DestinoNaoPermitidoError";
  }
}

function alvoDe(entrada: unknown): string {
  if (typeof entrada === "string") return entrada;
  if (entrada instanceof URL) return entrada.toString();
  if (entrada instanceof Request) return entrada.url;
  return String(entrada);
}

function ehLoopback(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // URL relativa não sai da máquina.
    return true;
  }
  return PERMITIDOS.has(parsed.hostname);
}

const original = globalThis.fetch;

globalThis.fetch = ((entrada: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const alvo = alvoDe(entrada);
  if (!ehLoopback(alvo)) throw new DestinoNaoPermitidoError(alvo);
  return original(entrada, init);
}) as typeof fetch;

// WebSocket e XHR continuam totalmente proibidos: o repositório não os usa, e
// liberá-los ampliaria a superfície sem necessidade.
class WebSocketBloqueado {
  constructor(url: string) {
    throw new DestinoNaoPermitidoError(`WebSocket ${url}`);
  }
}
Reflect.set(globalThis, "WebSocket", WebSocketBloqueado);
