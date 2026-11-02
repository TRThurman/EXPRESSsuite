/* `<<express:tag,label>>` cross-references in description remarks.
 * No vscode imports — shared by the description webview controller and the host.
 */

/** Asciidoctor renders `<<express:tag,label>>` as `<a href="#express:tag">label</a>`. */
export const EXPRESS_XREF_HREF_PREFIX = "#express:";

/**
 * The tag path (`schema.declaration`) behind such an anchor, or undefined for
 * any other href. The host validates the characters before acting on it.
 */
export function expressTagFromHref(href: string | null | undefined): string | undefined {
  if (!href || !href.startsWith(EXPRESS_XREF_HREF_PREFIX)) return undefined;
  let tag = href.slice(EXPRESS_XREF_HREF_PREFIX.length);
  try {
    tag = decodeURIComponent(tag);
  } catch {
    return undefined;
  }
  tag = tag.trim();
  return tag.length > 0 ? tag : undefined;
}
