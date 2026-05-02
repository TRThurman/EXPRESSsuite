/**
 * Security verification tests (DESIGN §1.2.8 / POC criterion #8).
 *
 * Each test exercises one mitigation against an explicit malicious payload.
 *
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import DOMPurify from "dompurify";

const PURIFY_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: false },
  ALLOWED_TAGS: [
    "svg", "g", "rect", "path", "text", "tspan", "a", "image", "defs",
    "marker", "line", "circle", "ellipse", "polygon", "polyline", "title",
  ],
  ALLOWED_ATTR: [
    "x", "y", "width", "height", "cx", "cy", "r", "rx", "ry",
    "x1", "y1", "x2", "y2", "points", "d",
    "fill", "stroke", "stroke-width", "stroke-dasharray", "opacity",
    "transform", "viewBox", "xmlns", "xmlns:xlink", "preserveAspectRatio",
    "href", "xlink:href", "class", "id", "style",
    "font-family", "font-size", "text-anchor", "dominant-baseline",
  ],
  ALLOWED_URI_REGEXP: /^(#|data:image\/(gif|png|jpeg|jpg|svg\+xml);base64,|[0-9]+)$/,
  FORBID_TAGS: ["script", "foreignObject", "use", "iframe", "object", "embed"],
  FORBID_ATTR: ["onload", "onclick", "onerror", "onmouseover", "onmouseout", "onfocus", "onblur"],
};

describe("DOMPurify SVG sanitization", () => {
  test("strips inline <script> from SVG", () => {
    const evil = `<svg xmlns="http://www.w3.org/2000/svg">
      <script>alert(document.cookie)</script>
      <rect x="0" y="0" width="10" height="10" fill="red"/>
    </svg>`;
    const clean = DOMPurify.sanitize(evil, PURIFY_CONFIG);
    expect(clean).not.toMatch(/script/i);
    expect(clean).not.toMatch(/alert/);
    expect(clean).toMatch(/<rect/);
  });

  test("strips javascript: URL from <a href>", () => {
    const evil = `<svg xmlns="http://www.w3.org/2000/svg">
      <a href="javascript:alert(1)"><rect width="10" height="10"/></a>
    </svg>`;
    const clean = DOMPurify.sanitize(evil, PURIFY_CONFIG);
    expect(clean).not.toMatch(/javascript/i);
    expect(clean).not.toMatch(/alert/);
  });

  test("strips on* event handlers", () => {
    const evil = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect onclick="alert(1)" onload="alert(2)" width="10" height="10"/>
    </svg>`;
    const clean = DOMPurify.sanitize(evil, PURIFY_CONFIG);
    expect(clean).not.toMatch(/onclick/i);
    expect(clean).not.toMatch(/onload/i);
    expect(clean).not.toMatch(/alert/);
  });

  test("strips <foreignObject>", () => {
    const evil = `<svg xmlns="http://www.w3.org/2000/svg">
      <foreignObject><body><script>alert(1)</script></body></foreignObject>
    </svg>`;
    const clean = DOMPurify.sanitize(evil, PURIFY_CONFIG);
    expect(clean).not.toMatch(/foreignObject/i);
    expect(clean).not.toMatch(/script/i);
  });

  test("preserves valid integer href hot-spots", () => {
    const ok = `<svg xmlns="http://www.w3.org/2000/svg">
      <a href="42"><rect width="10" height="10"/></a>
    </svg>`;
    const clean = DOMPurify.sanitize(ok, PURIFY_CONFIG);
    expect(clean).toMatch(/href="42"/);
  });

  test("preserves base64-encoded image data URIs", () => {
    const ok = `<svg xmlns="http://www.w3.org/2000/svg">
      <image href="data:image/gif;base64,R0lGOD"/>
    </svg>`;
    const clean = DOMPurify.sanitize(ok, PURIFY_CONFIG);
    expect(clean).toMatch(/data:image\/gif;base64,R0lGOD/);
  });

  test("strips data:text/html (non-image data URI)", () => {
    const evil = `<svg xmlns="http://www.w3.org/2000/svg">
      <a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="><rect width="10" height="10"/></a>
    </svg>`;
    const clean = DOMPurify.sanitize(evil, PURIFY_CONFIG);
    expect(clean).not.toMatch(/data:text\/html/);
  });
});

/**
 * Asciidoctor's `safe-mode: secure` blocks `include::` and stops attribute reads
 * but does NOT strip `pass:[]` or `+++…+++` passthroughs. We rely on a defense-
 * in-depth pipeline: Asciidoctor → DOMPurify (HTML profile) → inject. These
 * tests verify the *combined* pipeline.
 */
const HTML_PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    "div", "p", "span", "a", "strong", "em", "code", "pre", "kbd", "mark",
    "ul", "ol", "li", "dl", "dt", "dd", "blockquote", "br", "hr",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption",
    "img", "figure", "figcaption",
    "math", "mi", "mo", "mn", "ms", "mtext", "mrow", "msup", "msub", "msubsup",
    "mfrac", "mroot", "msqrt", "munder", "mover", "munderover", "mstyle",
    "mspace", "mtable", "mtr", "mtd", "mlabeledtr", "merror", "mphantom",
    "mfenced", "menclose", "mpadded", "maction", "semantics", "annotation",
  ],
  ALLOWED_ATTR: [
    "href", "title", "alt", "src", "class", "id", "lang",
    "rowspan", "colspan", "scope",
    // MathML
    "display", "displaystyle", "mathvariant", "mathcolor", "mathbackground",
    "fontfamily", "fontstyle", "fontweight", "fontsize",
    "linethickness", "form", "fence", "separator", "lspace", "rspace",
    "stretchy", "symmetric", "maxsize", "minsize", "largeop", "movablelimits",
    "accent", "accentunder", "frame", "framespacing", "rowalign", "columnalign",
    "xmlns",
  ],
  ALLOWED_URI_REGEXP: /^(https?:|mailto:|#|command:vscode\.open|command:express\.)/,
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button"],
  FORBID_ATTR: [
    "onload", "onclick", "onerror", "onmouseover", "onmouseout", "onfocus",
    "onblur", "oninput", "onchange", "onsubmit", "style",
  ],
};

describe("Asciidoctor → DOMPurify pipeline", async () => {
  const Asciidoctor = (await import("@asciidoctor/core")).default;
  const ad = Asciidoctor();
  const sanitize = (text: string): string =>
    DOMPurify.sanitize(String(ad.convert(text, { safe: "secure" })), HTML_PURIFY_CONFIG);

  test("strips +++<script>+++ block passthrough", () => {
    const evil = `Some prose.

+++<script>alert(document.cookie)</script>+++

More prose.`;
    const html = sanitize(evil);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/alert\(/);
  });

  test("strips pass:[…] inline raw HTML", () => {
    const html = sanitize(`inline pass:[<script>alert(1)</script>] payload`);
    expect(html).not.toMatch(/<script/i);
  });

  test("strips on* event handlers from Asciidoctor passthrough", () => {
    const html = sanitize(`pass:[<a href="x" onclick="evil()">click</a>]`);
    expect(html).not.toMatch(/onclick/i);
    expect(html).not.toMatch(/evil/);
  });

  test("disables include:: in secure mode (inert in source layer)", () => {
    const html = sanitize(`include::/etc/passwd[]`);
    expect(html).not.toMatch(/root:x:0:0/);
  });

  test("preserves benign markup", () => {
    const html = sanitize(`**bold** and _italic_ and \`code\`.`);
    expect(html).toMatch(/<strong>bold<\/strong>/);
    expect(html).toMatch(/<em>italic<\/em>/);
    expect(html).toMatch(/<code>code<\/code>/);
  });

  test("preserves MathML <math> elements (for stem:[] output)", () => {
    const ok = `<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi><mo>=</mo><mn>1</mn></math>`;
    const clean = DOMPurify.sanitize(ok, HTML_PURIFY_CONFIG);
    expect(clean).toMatch(/<math/);
    expect(clean).toMatch(/<mi>x<\/mi>/);
  });

  test("strips javascript: URLs from xrefs", () => {
    const html = sanitize(`link:javascript:alert(1)[bad]`);
    expect(html).not.toMatch(/javascript:/);
  });

  test("preserves command: URLs only for vscode.open and express.* (not arbitrary commands)", () => {
    const ok = `<a href="command:vscode.open?%5B%22file.exp%22%5D">link</a>`;
    const cleanOk = DOMPurify.sanitize(ok, HTML_PURIFY_CONFIG);
    expect(cleanOk).toMatch(/command:vscode\.open/);

    const evil = `<a href="command:workbench.action.terminal.sendSequence?abc">x</a>`;
    const cleanEvil = DOMPurify.sanitize(evil, HTML_PURIFY_CONFIG);
    expect(cleanEvil).not.toMatch(/sendSequence/);
  });
});
