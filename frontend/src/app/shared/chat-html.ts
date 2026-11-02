/**
 * The last step before the chat shows a model's answer as HTML.
 *
 * The answer is built from text the model wrote after reading uploaded documents, so a document can steer what the model
 * writes. The markdown formatter turns that text into markup; this function then keeps only the tags the formatter makes
 * and the class names the chat's own styles define, and nothing else: no other tag, no `style`, no link, no event handler,
 * no `id`. Anything else becomes plain text. Angular's own sanitizer still runs after this, as a second line.
 */

const ALLOWED_TAGS = new Set(['DIV', 'SPAN', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'PRE', 'CODE', 'UL', 'OL', 'LI', 'P', 'STRONG', 'EM', 'BR', 'H3', 'H4', 'H5']);

/** Class names the formatter produces (`ai-…`, `chat-…`, `badge-…`, `quote-…` and the three window dots). */
const ALLOWED_CLASS = /^(?:ai|chat|badge|quote)-[a-z0-9-]+$|^d-(?:red|yellow|green)$/;

function clean(node: Node, out: Node, doc: Document): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      out.appendChild(doc.createTextNode(child.textContent ?? ''));
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      if (!ALLOWED_TAGS.has(el.tagName)) {
        // Not a tag the chat makes: keep what it says, not what it is.
        out.appendChild(doc.createTextNode(el.textContent ?? ''));
        continue;
      }
      const copy = doc.createElement(el.tagName.toLowerCase());
      const classes = (el.getAttribute('class') ?? '').split(/\s+/).filter((c) => ALLOWED_CLASS.test(c));
      if (classes.length > 0) copy.setAttribute('class', classes.join(' '));
      clean(el, copy, doc);
      out.appendChild(copy);
    }
  }
}

export function sanitizeChatHtml(html: string): string {
  if (!html) return '';
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const target = parsed.createElement('div');
  clean(parsed.body, target, parsed);
  return target.innerHTML;
}
