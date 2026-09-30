import type { CustomPatternMatcherFunc, TokenType, TokenVocabulary } from "chevrotain";
import { DefaultTokenBuilder, GrammarAST, isTokenTypeArray } from "langium";
import type { Grammar } from "langium";
import type { TokenBuilderOptions } from "langium";

const LPAREN = 0x28; // (
const STAR = 0x2a; // *
const RPAREN = 0x29; // )

const ML_COMMENT = "ML_COMMENT";

/**
 * Matches an EXPRESS remark, honouring nesting.
 *
 * ISO 10303-11:2004 clause 145 defines embedded_remark recursively:
 *
 *     embedded_remark = '(*' [ remark_tag ] { ... | embedded_remark } '*)' .
 *
 * so `(* a (* b *) c *)` is a single remark. A regular expression cannot express
 * this, and the non-nesting pattern this replaces ended the outer remark at the
 * inner `*)`, handing the rest of the commented-out text to the parser as code.
 *
 * One forward scan, no regular expressions and no backtracking, so the cost is
 * linear in the length of the remark. This runs on every keystroke.
 *
 * Where the nesting does not balance, the scan falls back to the previous
 * behaviour — close at the first `*)`, or fail to match when there is none — so a
 * file that is malformed under nesting semantics lexes exactly as it does today.
 * This change can therefore only lengthen a remark that genuinely nests, and
 * never alters anything else.
 */
export const matchNestedRemark: CustomPatternMatcherFunc = (text, offset) => {
  if (text.charCodeAt(offset) !== LPAREN || text.charCodeAt(offset + 1) !== STAR) return null;

  const length = text.length;
  let depth = 1;
  let i = offset + 2;
  while (i < length) {
    const c = text.charCodeAt(i);
    if (c === LPAREN && text.charCodeAt(i + 1) === STAR) {
      depth++;
      i += 2;
    } else if (c === STAR && text.charCodeAt(i + 1) === RPAREN) {
      depth--;
      i += 2;
      if (depth === 0) return [text.substring(offset, i)] as unknown as RegExpExecArray;
    } else {
      i++;
    }
  }

  const firstClose = text.indexOf("*)", offset + 2);
  if (firstClose >= 0) return [text.substring(offset, firstClose + 2)] as unknown as RegExpExecArray;
  return null;
};

/**
 * Gives ML_COMMENT a nesting-aware pattern.
 *
 * The ordering override is required, not cosmetic. DefaultTokenBuilder emits
 * keywords before terminals and relies on findLongerAlt to let a terminal beat an
 * earlier keyword — but that test reads `PATTERN.source`, which a function pattern
 * does not have. Without reordering, the `(` keyword would consume the opening of
 * every remark. ML_COMMENT only ever matches text beginning `(*`, so placing it
 * first cannot shadow another token.
 */
export class ExpressP11TokenBuilder extends DefaultTokenBuilder {
  protected override buildTerminalToken(terminal: GrammarAST.TerminalRule): TokenType {
    const token = super.buildTerminalToken(terminal);
    if (terminal.name === ML_COMMENT) {
      token.PATTERN = matchNestedRemark;
      token.LINE_BREAKS = true;
      token.START_CHARS_HINT = ["("]; // keeps chevrotain's first-character dispatch
    }
    return token;
  }

  override buildTokens(grammar: Grammar, options?: TokenBuilderOptions): TokenVocabulary {
    const tokens = super.buildTokens(grammar, options);
    if (isTokenTypeArray(tokens)) {
      const index = tokens.findIndex((token) => token.name === ML_COMMENT);
      if (index > 0) tokens.unshift(...tokens.splice(index, 1));
    }
    return tokens;
  }
}
