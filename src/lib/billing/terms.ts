/**
 * VERSÃO OFICIAL DOS TERMOS — fonte única, do lado do servidor
 *
 * ── POR QUE UMA CONSTANTE, E NÃO UMA TABELA ─────────────────────────────────
 *
 * O que identifica o documento aceito é a VERSÃO. O conteúdo dos termos é
 * publicado fora do banco — um documento versionado, imutável, com URL própria.
 * Guardar o texto a cada aceite faria de cada assinatura uma cópia de algo que
 * já é público e já é imutável, e criaria a pergunta de qual cópia vale.
 *
 * Uma tabela de versões publicadas seria a alternativa, e foi descartada por
 * ora: ela só passaria a valer a pena quando houvesse mais de um documento
 * vigente ao mesmo tempo (por região, por tipo de contrato), que não é o caso.
 * Enquanto for um documento por vez, a constante é a fonte mais simples que
 * ainda é única.
 *
 * ── O CLIENTE NÃO ESCOLHE A VERSÃO ──────────────────────────────────────────
 *
 * O formulário da 12C.3 vai exibir uma versão e mandá-la de volta. Isso é
 * NECESSÁRIO — é como se detecta que a pessoa aceitou uma tela velha, aberta
 * antes de a versão nova entrar no ar. Mas o que ela manda é uma AFIRMAÇÃO a
 * conferir, nunca a escolha efetiva: `exigirVersaoVigente` compara com esta
 * constante e recusa qualquer divergência, antiga ou inventada.
 *
 * Sem essa comparação, bastaria mandar `termsVersion: "1900-01-01"` para
 * registrar aceite de um documento que nunca existiu.
 *
 * ── O BANCO NÃO CONHECE ESTA CONSTANTE, E É PROPOSITAL ──────────────────────
 *
 * `20260810120000_billing_contract_metadata.sql` valida FORMA (par completo,
 * formato `AAAA-MM-DD`, sem regressão de versão) e não identidade. Fixar a
 * versão vigente no banco exigiria uma migration a cada publicação de termos —
 * e a 12C.1 existe justamente para que um aceite novo não precise de DDL.
 *
 * A divisão é: o banco garante que nada malformado, vazio, desemparelhado ou
 * retroativo se persiste, mesmo que esta camada esteja inteira errada; esta
 * camada garante que a versão persistida é a vigente.
 */

/**
 * Versão vigente. Formato `AAAA-MM-DD`, que é a data de publicação do
 * documento — e é o formato que o CHECK do banco exige, porque é o que faz a
 * comparação lexical coincidir com a cronológica.
 *
 * Publicar termos novos é trocar ESTE valor, e só ele.
 */
export const TERMS_VERSION = "2026-08-10";

/** Formato aceito, o mesmo do CHECK `subscriptions_termos_versao_valida`. */
const FORMATO_DE_VERSAO = /^\d{4}-\d{2}-\d{2}$/;

export class TermsVersionMismatchError extends Error {
  constructor(readonly recebida: string) {
    super("a versão dos termos aceita não é a vigente");
    this.name = "TermsVersionMismatchError";
  }
}

/**
 * Confere a versão que o cliente afirma ter aceitado contra a vigente.
 *
 * Devolve a versão OFICIAL, nunca a recebida — para que nenhum caminho a
 * jusante possa persistir o que chegou do cliente por descuido.
 */
export function exigirVersaoVigente(recebida: string): string {
  const limpa = recebida.trim();
  if (limpa === "" || !FORMATO_DE_VERSAO.test(limpa) || limpa !== TERMS_VERSION) {
    throw new TermsVersionMismatchError(recebida);
  }
  return TERMS_VERSION;
}

/** `true` somente para a versão vigente. Sem efeito colateral. */
export function ehVersaoVigente(recebida: string): boolean {
  return recebida.trim() === TERMS_VERSION;
}
