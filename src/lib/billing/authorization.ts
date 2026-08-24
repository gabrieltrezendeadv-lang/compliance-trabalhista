/**
 * AUTORIZAÇÃO DE BILLING — dois papéis, ambos verificados no servidor
 *
 * Regra do modelo aprovado: **somente o proprietário contrata, altera ou
 * cancela**. Aqui é onde isso é decidido — nunca na interface.
 *
 * ── O QUE A REGRA APROVADA NÃO DIZ ──────────────────────────────────────────
 *
 * Ela não diz que somente o proprietário pode CONSULTAR o que a organização
 * tem direito de usar. Confundir as duas coisas barraria o colaborador de
 * módulos que a organização pagou — e o enforcement de entitlements, que a
 * 12C.3 vai aplicar, precisa de uma resposta para todo usuário do tenant.
 *
 * Por isso há duas famílias aqui, e elas são nominalmente distintas:
 *
 *   `requireBillingOwner*`   contratar, alterar, cancelar, ver o dossiê
 *                            comercial (CNPJ, contato financeiro, preço).
 *   `requireBillingMember*`  catálogo de preços e decisão de acesso. Nada que
 *                            devolvam identifica o contrato da organização.
 *
 * Nenhuma das duas afrouxa a comparação de tenant: membro de A não alcança B.
 *
 * ── TRÊS CAMADAS, E ELAS NÃO SÃO REDUNDANTES ────────────────────────────────
 *
 *   1. ESTRUTURAL — as tabelas novas vivem no schema `billing`, que não é
 *      exposto ao PostgREST. `anon` e `authenticated` não conseguem endereçá-las
 *      de forma alguma.
 *   2. RLS e grants — mesmo se o schema for exposto um dia, a política é negar.
 *   3. ESTA função — o servidor confere o papel antes de qualquer operação.
 *
 * A interface não conta como camada. Esconder um botão é apresentação.
 *
 * ── POR QUE O PAPEL É CONFERIDO EM CÓDIGO, E NÃO SÓ NO FILTRO ───────────────
 *
 * `.eq("role", "owner")` é enviado ao banco E o papel é conferido no objeto
 * devolvido. Parece redundante e não é: um filtro que deixasse de ser aplicado
 * — por refatoração, por RLS ausente, por um cliente falso em teste — passaria
 * despercebido se a decisão dependesse só dele. A conferência explícita
 * transforma "o banco filtrou" em "eu verifiquei".
 */

import { createClient } from "@/lib/supabase/server";

export type BillingAuthDenial =
  | "not_authenticated"
  | "no_organization"
  | "not_owner"
  | "verification_failed";

export interface BillingPrincipal {
  readonly userId: string;
  readonly organizationId: string;
  /**
   * O papel REAL, colapsado nas duas categorias que o billing distingue.
   *
   * Quem resolveu por `requireBillingOwner*` sempre traz `"owner"`; quem
   * resolveu por `requireBillingMember*` traz o papel que o banco devolveu,
   * que pode ser `"owner"` (o proprietário também é membro) ou `"member"`.
   */
  readonly role: "owner" | "member";
}

export type BillingAuthResult =
  | { readonly ok: true; readonly principal: BillingPrincipal }
  | { readonly ok: false; readonly reason: BillingAuthDenial; readonly message: string };

const MENSAGENS: Record<BillingAuthDenial, string> = {
  not_authenticated: "Sessão expirada. Faça login novamente.",
  no_organization: "Organização não encontrada.",
  not_owner:
    "Somente o proprietário da organização pode administrar a assinatura.",
  verification_failed:
    "Não foi possível verificar suas permissões. Tente novamente.",
};

function negar(reason: BillingAuthDenial): BillingAuthResult {
  return { ok: false, reason, message: MENSAGENS[reason] };
}

/**
 * Exige que o chamador seja proprietário da organização.
 *
 * FAIL-CLOSED sem exceção: ausência de sessão, ausência de membership, erro de
 * consulta e papel diferente de `owner` produzem, todos, negação. Não existe
 * ramo que devolva `ok: true` sem ter lido e conferido o papel.
 */
export async function requireBillingOwner(): Promise<BillingAuthResult> {
  // Exceção, timeout ou resposta malformada NEGAM. Sem este `try`, a promessa
  // rejeitaria e o chamador — que testa `if (!r.ok)` — nunca rodaria.
  try {
    const supabase = await createClient();

    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError) return negar("verification_failed");

    const user = auth?.user;
    if (!user) return negar("not_authenticated");

    const { data: membership, error } = await supabase
      .from("organization_members")
      .select("tenant_id, role")
      .eq("user_id", user.id)
      .eq("role", "owner")
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();

    // Erro de consulta NUNCA vira permissão. É o mesmo defeito que este PR
    // corrige em enforcePlanLimit; não pode reaparecer aqui.
    if (error) return negar("verification_failed");
    if (!membership) return negar("no_organization");

    // O filtro foi enviado; ainda assim o papel é conferido.
    if (membership.role !== "owner") return negar("not_owner");

    // Resposta malformada não é autorização.
    if (typeof membership.tenant_id !== "string" || membership.tenant_id === "") {
      return negar("verification_failed");
    }

    return {
      ok: true,
      principal: {
        userId: user.id,
        organizationId: membership.tenant_id,
        role: "owner",
      },
    };
  } catch {
    return negar("verification_failed");
  }
}

/**
 * MEMBERSHIP NO TENANT PEDIDO — consultada diretamente, sem padrão nenhum
 *
 * ── O DEFEITO QUE ESTA FUNÇÃO CORRIGE ───────────────────────────────────────
 *
 * As variantes `…For` faziam isto:
 *
 *     const r = await requireBillingOwner();   // resolve a PRIMEIRA membership
 *     if (pedido !== r.principal.organizationId) return negar(...);
 *
 * Isso não pergunta "o usuário pertence ao tenant pedido?". Pergunta "o tenant
 * pedido é justamente o primeiro que eu resolvi?" — e as duas perguntas só
 * coincidem para quem tem uma organização só.
 *
 * Cenário reproduzível, e legítimo:
 *
 *   1. o usuário é owner de A e membro de B;
 *   2. B é o tenant ativo;
 *   3. o wrapper chama `requireBillingMemberFor(B)`;
 *   4. `requireBillingMember()` devolve A, porque A é a primeira;
 *   5. a comparação recusa B — um membro legítimo, barrado.
 *
 * O mesmo vale para quem é owner de duas organizações e administra a segunda.
 * Não era "risco de coerência": era recusa de acesso legítimo, e o número de
 * usuários multi-organização só cresce.
 *
 * ── COMO ESTA VERSÃO PERGUNTA ───────────────────────────────────────────────
 *
 * A consulta filtra por `user_id` E por `tenant_id = <pedido>` ao mesmo tempo.
 * O identificador do cliente NÃO autoriza — ele apenas RESTRINGE a consulta, e
 * o que autoriza é a linha devolvida pelo banco, conferida de novo aqui: tenant
 * igual ao pedido e papel esperado.
 *
 * Ausência de linha é `not_owner`, e não "organização não encontrada": tenant
 * alheio, tenant inexistente e tenant sem membership produzem a MESMA recusa,
 * com a MESMA mensagem. Distingui-los entregaria "esta organização existe" a
 * quem varre identificadores.
 *
 * FAIL-CLOSED sem exceção: erro de consulta, resposta malformada, sessão
 * ausente e exceção NEGAM.
 */
async function membershipNoTenant(
  requestedOrganizationId: string,
  exigirOwner: boolean
): Promise<BillingAuthResult> {
  // Entrada vazia ou de tipo inesperado é recusa, não "usa o do servidor".
  if (
    typeof requestedOrganizationId !== "string" ||
    requestedOrganizationId.trim() === ""
  ) {
    return negar("no_organization");
  }

  try {
    const supabase = await createClient();

    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError) return negar("verification_failed");

    const user = auth?.user;
    if (!user) return negar("not_authenticated");

    // O `tenant_id` entra como FILTRO, junto do usuário. É esta consulta —
    // e não uma comparação posterior — que responde "ele pertence a ESTE
    // tenant?".
    let consulta = supabase
      .from("organization_members")
      .select("tenant_id, role")
      .eq("user_id", user.id)
      .eq("tenant_id", requestedOrganizationId)
      .is("deleted_at", null);

    // O filtro de papel é ENVIADO ao banco, e conferido no objeto abaixo. Ver
    // o cabeçalho: um filtro que deixasse de ser aplicado passaria despercebido
    // se a decisão dependesse só dele.
    if (exigirOwner) consulta = consulta.eq("role", "owner");

    const { data: membership, error } = await consulta
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();

    // Erro de consulta NUNCA vira permissão.
    if (error) return negar("verification_failed");
    if (!membership) return negar("not_owner");

    // Resposta malformada não é autorização.
    if (typeof membership.tenant_id !== "string" || membership.tenant_id === "") {
      return negar("verification_failed");
    }

    // O filtro foi enviado; ainda assim o tenant devolvido é CONFERIDO. É o que
    // separa "o banco filtrou" de "eu verifiquei".
    if (membership.tenant_id !== requestedOrganizationId) return negar("not_owner");

    // Papel ausente ou inesperado NÃO vira `owner`: o padrão é o menor
    // privilégio.
    const role = membership.role === "owner" ? ("owner" as const) : ("member" as const);
    if (exigirOwner && role !== "owner") return negar("not_owner");

    return {
      ok: true,
      principal: { userId: user.id, organizationId: membership.tenant_id, role },
    };
  } catch {
    return negar("verification_failed");
  }
}

/**
 * Exige que o chamador seja proprietário DA ORGANIZAÇÃO INFORMADA.
 *
 * ── POR QUE ESTA FUNÇÃO EXISTE, SE JÁ HÁ `requireBillingOwner` ──────────────
 *
 * Porque a jornada recebe `organizationId` de formulário, de rota ou de corpo
 * de requisição — e esse é o formato clássico do IDOR: o servidor autoriza "é
 * owner de alguma coisa", depois OPERA sobre o identificador que o cliente
 * mandou. O proprietário do tenant A administraria a assinatura do tenant B sem
 * nunca sair da própria sessão.
 *
 * A regra não admite exceção: o identificador do cliente **nunca autoriza**.
 * Aqui ele restringe a consulta, e quem autoriza é a membership devolvida.
 */
export async function requireBillingOwnerFor(
  requestedOrganizationId: string
): Promise<BillingAuthResult> {
  return membershipNoTenant(requestedOrganizationId, true);
}


// ─── Membro do tenant ───────────────────────────────────────────────────────

/**
 * Exige que o chamador seja MEMBRO ativo de alguma organização.
 *
 * ── O QUE MUDA EM RELAÇÃO A `requireBillingOwner` ───────────────────────────
 *
 * Só uma coisa: o filtro `.eq("role", "owner")` sai. Todo o resto — o
 * `try/catch` que faz exceção virar negação, a checagem de sessão, a conferência
 * do `tenant_id` devolvido, a ordenação determinística — permanece idêntico,
 * porque nenhuma dessas propriedades tem a ver com papel.
 *
 * O papel devolvido é o REAL: `"owner"` quando o membership é de proprietário,
 * `"member"` em qualquer outro caso. Quem recebe este principal ainda não pode
 * escrever nada — `assertTenantOwner` é quem decide isso, e ele olha este campo.
 *
 * FAIL-CLOSED igual: ausência de sessão, ausência de membership, erro de
 * consulta e resposta malformada NEGAM.
 *
 * ── ATENÇÃO PARA A 12C.3: SEMPRE INFORME A ORGANIZAÇÃO ──────────────────────
 *
 * Esta variante SEM argumento escolhe a PRIMEIRA membership do usuário, e
 * `requireBillingOwner` escolhe a primeira em que ele é proprietário. Para quem
 * pertence a uma organização só, dá no mesmo. Para quem pertence a várias, as
 * duas podem resolver organizações DIFERENTES — e `lerAcesso` responderia sobre
 * uma enquanto `lerAssinatura` responde sobre outra.
 *
 * Nenhuma das duas é insegura: ambas resolvem no servidor. Mas nenhuma das duas
 * sabe qual tenant o usuário está OLHANDO, e adivinhar não é resolver.
 *
 * Os wrappers da 12C.3 devem passar o `organizationId` do tenant ativo, o que
 * roteia para as variantes `…For` — e desde a correção destas, informar a
 * organização de fato elimina a ambiguidade: elas consultam a membership NAQUELE
 * tenant em vez de resolver um padrão e comparar depois.
 *
 * Unificar a resolução de tenant do produto inteiro continua sendo decisão maior
 * do que esta etapa — `src/lib/tenant-guard.ts` é onde ela terá de acontecer.
 */
export async function requireBillingMember(): Promise<BillingAuthResult> {
  try {
    const supabase = await createClient();

    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError) return negar("verification_failed");

    const user = auth?.user;
    if (!user) return negar("not_authenticated");

    const { data: membership, error } = await supabase
      .from("organization_members")
      .select("tenant_id, role")
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) return negar("verification_failed");
    if (!membership) return negar("no_organization");

    if (typeof membership.tenant_id !== "string" || membership.tenant_id === "") {
      return negar("verification_failed");
    }

    // Papel ausente ou de tipo inesperado NÃO vira `owner`. O padrão seguro é
    // o menor privilégio, e aqui ele é `member`.
    const role = membership.role === "owner" ? ("owner" as const) : ("member" as const);

    return {
      ok: true,
      principal: { userId: user.id, organizationId: membership.tenant_id, role },
    };
  } catch {
    return negar("verification_failed");
  }
}

/**
 * Exige que o chamador seja membro DA ORGANIZAÇÃO INFORMADA.
 *
 * Mesma regra anti-IDOR da variante de proprietário, e a mesma consulta direta
 * — só o papel exigido muda. O papel devolvido é o REAL: `"owner"` quando a
 * membership é de proprietário, `"member"` em qualquer outro caso.
 *
 * A recusa é `not_owner` também aqui — não porque falte papel, mas porque
 * `not_owner` é o texto único com que esta camada responde "não é seu".
 */
export async function requireBillingMemberFor(
  requestedOrganizationId: string
): Promise<BillingAuthResult> {
  return membershipNoTenant(requestedOrganizationId, false);
}
