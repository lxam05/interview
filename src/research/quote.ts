/**
 * The rule that keeps invented claims out: a claim is only stored if its
 * supporting quote really appears in the source document.
 *
 * Models copy text with small differences (curly quotes, dashes, collapsed
 * whitespace), so both sides are normalised before comparing. Anything beyond
 * that counts as "not in the document" and the claim is dropped.
 */
export function normaliseForQuote(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[  -​  　]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const MIN_QUOTE_CHARS = 12;

export function quoteAppearsIn(quote: string, document: string): boolean {
  const needle = normaliseForQuote(quote);
  if (needle.length < MIN_QUOTE_CHARS) return false;
  return normaliseForQuote(document).includes(needle);
}
