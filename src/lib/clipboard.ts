import { defaultTreeAdapter, parseFragment, type DefaultTreeAdapterTypes } from 'parse5';

const BLOCK_ELEMENTS = new Set(('address,article,aside,blockquote,dd,div,dl,dt,figcaption,figure,footer,' +
  'h1,h2,h3,h4,h5,h6,header,hr,li,main,nav,ol,p,pre,section,table,tr,ul').split(','));
const IGNORED_ELEMENTS = new Set(['script', 'style', 'title', 'template', 'noscript']);

export function htmlToPlainText(html: string): string {
  // Parse into plain data, never browser DOM nodes or an HTML injection sink.
  const fragment = parseFragment(html);

  let text = '';
  const lineBreak = () => {
    if (text && !text.endsWith('\n')) text += '\n';
  };
  // Use an explicit stack so deeply nested clipboard HTML cannot exhaust the call stack.
  const pending: (DefaultTreeAdapterTypes.ChildNode | '\n' | '\t')[] = [];
  const enqueueChildren = (children: DefaultTreeAdapterTypes.ChildNode[]) => {
    let hasNextElement = false;
    for (let index = children.length - 1; index >= 0; index--) {
      const child = children[index];
      if (defaultTreeAdapter.isElementNode(child)) {
        if ((child.tagName === 'td' || child.tagName === 'th') && hasNextElement) pending.push('\t');
        hasNextElement = true;
      }
      pending.push(child);
    }
  };
  enqueueChildren(fragment.childNodes);
  while (pending.length) {
    const node = pending.pop()!;
    if (node === '\n') {
      lineBreak();
    } else if (node === '\t') {
      text += '\t';
    } else if (defaultTreeAdapter.isTextNode(node)) {
      text += node.value;
    } else if (defaultTreeAdapter.isElementNode(node) && !IGNORED_ELEMENTS.has(node.tagName)) {
      if (node.tagName === 'br') {
        text += '\n';
        continue;
      }
      if (BLOCK_ELEMENTS.has(node.tagName)) {
        lineBreak();
        pending.push('\n');
      }
      enqueueChildren(node.childNodes);
    }
  }
  return text.replace(/^\n+|\n+$/g, '');
}

export async function readClipboardText(): Promise<string> {
  try {
    const text = await navigator.clipboard.readText();
    if (text) return text;
  } catch (error) {
    // Some browsers report unavailable plain text instead of returning an empty string.
    if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error;
  }

  if (typeof navigator.clipboard.read !== 'function') return '';
  for (const item of await navigator.clipboard.read()) {
    if (item.types.includes('text/html')) {
      const html = await item.getType('text/html');
      const text = htmlToPlainText(await html.text());
      if (text) return text;
    }
  }
  return '';
}
