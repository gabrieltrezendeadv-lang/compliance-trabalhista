/**
 * Cliente Supabase falso — simples, programável e observador.
 *
 * ── DECISÃO DE DESENHO, DELIBERADA ────────────────────────────────────────
 *
 * Este fake **NÃO** aplica RLS e **NÃO** filtra registros por `tenant_id` em
 * nome do código de produção. Ele devolve exatamente a resposta programada,
 * independentemente dos filtros que recebeu, e registra tudo o que foi
 * chamado.
 *
 * O motivo é central para a validade de toda a suíte: se o fake filtrasse
 * automaticamente os dados do tenant B para um usuário do tenant A, um teste
 * cross-tenant passaria mesmo com o código de produção vulnerável — bastaria
 * o código esquecer o `.eq("tenant_id", ...)` para o fake "consertar" a falha
 * silenciosamente. O teste estaria medindo o fake, não o produto.
 *
 * Por isso a asserção correta nunca é "o dado do tenant B não veio", e sim
 * "o código de produção **enviou** o filtro de tenant" e "o código **não**
 * chamou a RPC quando a autorização falhou".
 *
 * ── LIMITE DE VALIDADE ────────────────────────────────────────────────────
 *
 * Testes construídos sobre este fake cobrem **autorização da camada de
 * aplicação**. Eles NÃO comprovam: RLS, USING, WITH CHECK, ACL, PUBLIC,
 * SECURITY DEFINER, nem isolamento efetivo no PostgreSQL.
 *
 * Essas garantias exigem um banco real e permanecem bloqueadas pelo R1.
 * Ver tests/db/README-R1.md.
 */

// ─── Registro de chamadas ─────────────────────────────────────────────────

export interface FilterCall {
  method: string;
  args: unknown[];
}

export interface FromCall {
  table: string;
  columns?: string;
  filters: FilterCall[];
  /** Operação terminal: select, insert, update, delete. */
  operation: string;
  /** Payload de escrita, quando houver. */
  payload?: unknown;
}

export interface RpcCall {
  fn: string;
  params: Record<string, unknown> | undefined;
}

export interface FakeCallLog {
  rpc: RpcCall[];
  from: FromCall[];
  authGetUser: number;
}

// ─── Programação de respostas ─────────────────────────────────────────────

export interface FakeResponse {
  data: unknown;
  error: { message: string; code?: string } | null;
}

export interface FakeSupabaseOptions {
  /** Usuário devolvido por auth.getUser(). `null` = sem sessão. */
  user?: { id: string; email: string } | null;
  /** Erro de auth, quando se quer simular sessão inválida. */
  authError?: { message: string } | null;
  /** Respostas por nome de RPC. */
  rpc?: Record<string, FakeResponse>;
  /** Respostas por nome de tabela. */
  from?: Record<string, FakeResponse>;
}

const EMPTY: FakeResponse = { data: null, error: null };

/**
 * Cria um cliente falso com a superfície do supabase-js efetivamente usada
 * pelo código de produção deste repositório.
 */
export function createFakeSupabase(options: FakeSupabaseOptions = {}) {
  const calls: FakeCallLog = { rpc: [], from: [], authGetUser: 0 };

  function makeQuery(table: string) {
    const record: FromCall = {
      table,
      filters: [],
      operation: "select",
    };
    calls.from.push(record);

    const programmed = options.from?.[table] ?? EMPTY;

    // O builder devolve `this` em todos os métodos encadeáveis e registra a
    // chamada. Nenhum filtro é efetivamente aplicado — ver cabeçalho.
    const builder: Record<string, unknown> = {};

    const chainable = [
      "eq",
      "neq",
      "in",
      "is",
      "not",
      "gt",
      "gte",
      "lt",
      "lte",
      "like",
      "ilike",
      "or",
      "filter",
      "match",
      "order",
      "limit",
      "range",
      "returns",
    ];

    for (const method of chainable) {
      builder[method] = (...args: unknown[]) => {
        record.filters.push({ method, args });
        return builder;
      };
    }

    builder.select = (columns?: string) => {
      record.columns = columns;
      return builder;
    };

    builder.insert = (payload: unknown) => {
      record.operation = "insert";
      record.payload = payload;
      return builder;
    };

    builder.update = (payload: unknown) => {
      record.operation = "update";
      record.payload = payload;
      return builder;
    };

    builder.delete = () => {
      record.operation = "delete";
      return builder;
    };

    builder.upsert = (payload: unknown) => {
      record.operation = "upsert";
      record.payload = payload;
      return builder;
    };

    // Terminais
    builder.single = async () => programmed;
    builder.maybeSingle = async () => programmed;
    builder.then = (
      resolve: (value: FakeResponse) => unknown,
      reject?: (reason: unknown) => unknown
    ) => Promise.resolve(programmed).then(resolve, reject);

    return builder;
  }

  const client = {
    auth: {
      getUser: async () => {
        calls.authGetUser += 1;
        return {
          data: { user: options.user ?? null },
          error: options.authError ?? null,
        };
      },
    },

    from: (table: string) => makeQuery(table),

    rpc: async (fn: string, params?: Record<string, unknown>) => {
      calls.rpc.push({ fn, params });
      return options.rpc?.[fn] ?? EMPTY;
    },
  };

  return { client, calls };
}

// ─── Auxiliares de asserção ───────────────────────────────────────────────

/** Retorna true se alguma consulta à tabela enviou `.eq(column, value)`. */
export function sentFilter(
  calls: FakeCallLog,
  table: string,
  column: string,
  value: unknown
): boolean {
  return calls.from
    .filter((c) => c.table === table)
    .some((c) =>
      c.filters.some(
        (f) => f.method === "eq" && f.args[0] === column && f.args[1] === value
      )
    );
}

/** Nomes das RPCs chamadas, na ordem. */
export function rpcNames(calls: FakeCallLog): string[] {
  return calls.rpc.map((c) => c.fn);
}

/** Operações de escrita registradas (insert/update/delete/upsert). */
export function writeOperations(calls: FakeCallLog): FromCall[] {
  return calls.from.filter((c) =>
    ["insert", "update", "delete", "upsert"].includes(c.operation)
  );
}
