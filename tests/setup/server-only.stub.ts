/**
 * Stub para o pacote `server-only`.
 *
 * `src/lib/supabase/service.ts` importa `server-only`, que lança em qualquer
 * contexto fora do servidor Next.js. Sob Vitest esse import quebraria a
 * resolução do módulo — foi exatamente o obstáculo que levou os testes
 * antigos a reimplementar a lógica de produção em vez de importá-la.
 *
 * Aliasar `server-only` para este módulo vazio resolve o problema sem alterar
 * uma linha de `src/`. A garantia real de que `service.ts` não vaza para o
 * cliente continua sendo dada por `tests/static/call-graph.spec.ts`, que
 * verifica estaticamente que nenhum módulo "use client" o importa.
 */
export {};
