const BLOCK_ELEMENTS = 'address,article,aside,blockquote,dd,div,dl,dt,figcaption,figure,footer,' +
  'h1,h2,h3,h4,h5,h6,header,hr,li,main,nav,ol,p,pre,section,table,tr,ul';

export function htmlToPlainText(html: string): string {
  // Template content belongs to an inert document with no browsing context.
  // Never attach these nodes to the page: only the extracted string leaves this function.
  // https://html.spec.whatwg.org/multipage/scripting.html#appropriate-template-contents-owner-document
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll('script,style,title,template,noscript').forEach((node) => node.remove());

  let text = '';
  const lineBreak = () => {
    if (text && !text.endsWith('\n')) text += '\n';
  };
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent;
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.tagName === 'BR') {
      text += '\n';
      return;
    }
    const isBlock = node.matches(BLOCK_ELEMENTS);
    if (isBlock) lineBreak();
    node.childNodes.forEach(visit);
    if (isBlock) lineBreak();
    if (node.matches('td,th') && node.nextElementSibling) text += '\t';
  };
  template.content.childNodes.forEach(visit);
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
