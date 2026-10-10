import { expect, test, type Page } from '@playwright/test';

const headingHtml = '<h2><strong>A bold heading</strong></h2><p>Body &amp; details</p>';
const headingText = 'A bold heading\nBody & details';
const input = (page: Page) => page.getByPlaceholder('Paste or type text here...');

async function writeClipboard(page: Page, data: Record<string, string>, image = false) {
  await page.evaluate(async ({ data, image }) => {
    const formats: Record<string, Blob> = Object.fromEntries(
      Object.entries(data).map(([type, text]) => [type, new Blob([text], { type })])
    );
    if (image) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      formats['image/png'] = await new Promise<Blob>((resolve) => {
        canvas.toBlob((blob) => resolve(blob!), 'image/png');
      });
    }
    await navigator.clipboard.write([new ClipboardItem(formats)]);
  }, { data, image });
}

type PendingClipboard = Clipboard & {
  pendingReads: number;
  finishRead: (index: number, html: string) => void;
};

async function delayClipboardReads(page: Page) {
  await page.evaluate(() => {
    const pending: ((html: string) => void)[] = [];
    Object.defineProperty(navigator, 'clipboard', { value: {
      readText: async () => '',
      read: async () => [{
        types: ['text/html'],
        getType: async () => ({ text: () => new Promise<string>((resolve) => pending.push(resolve)) }),
      }],
      get pendingReads() { return pending.length; },
      finishRead: (index: number, html: string) => pending[index](html),
    } });
  });
}

async function startClipboardRead(page: Page, count: number) {
  await page.getByTitle('Paste from clipboard').click();
  await expect.poll(() => page.evaluate(() => (navigator.clipboard as PendingClipboard).pendingReads)).toBe(count);
}

async function finishClipboardRead(page: Page, index: number, html: string) {
  await page.evaluate(({ index, html }) => {
    (navigator.clipboard as PendingClipboard).finishRead(index, html);
  }, { index, html });
  // Let the clipboard promise, React update, and any toast finish before checking the draft.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

test.beforeEach(async ({ page }) => {
  // Use a local API stub; never read or write a real room or storage bucket.
  await page.route('http://127.0.0.1:54321/**', (route) => route.fulfill({
    contentType: 'application/json',
    body: '[]',
  }));
  await page.routeWebSocket('ws://127.0.0.1:54321/**', () => {});
  await page.addInitScript(() => localStorage.setItem('clypsync-pin', '847291'));
  await page.goto('/');
  await expect(input(page)).toBeVisible();
});

test('preserves plain text exactly when both text and HTML are available', async ({ page }) => {
  const text = '  A bold heading\n\nBody & details\n  indented code <tag>\n';
  await writeClipboard(page, { 'text/plain': text, 'text/html': headingHtml });
  await input(page).focus();
  await page.keyboard.press('ControlOrMeta+V');
  await expect(input(page)).toHaveValue(text);
});

test('pastes HTML-only headings at the selection and submits plain text', async ({ page }) => {
  await input(page).fill('Before REPLACE after');
  await input(page).evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(7, 14));
  await writeClipboard(page, { 'text/html': headingHtml });
  await page.keyboard.press('ControlOrMeta+V');
  await expect(input(page)).toHaveValue(`Before ${headingText} after`);
  await page.keyboard.type('!');
  const expected = `Before ${headingText}! after`;
  await expect(input(page)).toHaveValue(expected);

  const request = page.waitForRequest((request) =>
    request.url().includes('/rest/v1/pastes') && request.method() === 'POST');
  await page.getByRole('button', { name: 'Send to Cloud' }).click();
  expect((await request).postDataJSON()).toMatchObject({ content: expected, type: 'text' });
  await expect(input(page)).toHaveValue('');
});

test('paste button reads HTML-only text', async ({ page }) => {
  await writeClipboard(page, { 'text/html': headingHtml });
  await page.getByTitle('Paste from clipboard').click();
  await expect(input(page)).toHaveValue(headingText);
});

test('a pending clipboard read cannot overwrite edits, even if the draft returns to its old value', async ({ page }) => {
  await input(page).fill('Original draft');
  await delayClipboardReads(page);
  await startClipboardRead(page, 1);
  await input(page).fill('Edited draft');
  await input(page).fill('Original draft');
  await finishClipboardRead(page, 0, headingHtml);
  await expect(input(page)).toHaveValue('Original draft');
  await expect(page.getByText('Pasted from clipboard')).toHaveCount(0);
});

test('a pending clipboard read cannot overwrite a newer keyboard paste', async ({ page }) => {
  await delayClipboardReads(page);
  await startClipboardRead(page, 1);
  await input(page).evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/html', '<strong>New keyboard paste</strong>');
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  await expect(input(page)).toHaveValue('New keyboard paste');
  await finishClipboardRead(page, 0, headingHtml);
  await expect(input(page)).toHaveValue('New keyboard paste');
});

test('the latest paste-button request wins when reads finish out of order', async ({ page }) => {
  await delayClipboardReads(page);
  await startClipboardRead(page, 1);
  await startClipboardRead(page, 2);
  await finishClipboardRead(page, 1, '<b>New clipboard</b>');
  await expect(input(page)).toHaveValue('New clipboard');
  await finishClipboardRead(page, 0, headingHtml);
  await expect(input(page)).toHaveValue('New clipboard');
});

test('submitting a draft invalidates a pending clipboard read', async ({ page }) => {
  await input(page).fill('Send this draft');
  await delayClipboardReads(page);
  await startClipboardRead(page, 1);
  const request = page.waitForRequest((request) =>
    request.url().includes('/rest/v1/pastes') && request.method() === 'POST');
  await page.getByRole('button', { name: 'Send to Cloud' }).click();
  expect((await request).postDataJSON()).toMatchObject({ content: 'Send this draft', type: 'text' });
  await expect(input(page)).toHaveValue('');
  await finishClipboardRead(page, 0, headingHtml);
  await expect(input(page)).toHaveValue('');
});

for (const format of ['text/plain', 'text/html']) {
  test(`preserves image priority when the clipboard also contains ${format}`, async ({ page }) => {
    await writeClipboard(page, { [format]: format === 'text/plain' ? headingText : headingHtml }, true);
    const upload = page.waitForRequest((request) =>
      request.url().includes('/storage/v1/object/images/') && request.method() === 'POST');
    await input(page).focus();
    await page.keyboard.press('ControlOrMeta+V');
    await upload;
    await expect(input(page)).toHaveValue('');
  });
}

test('still uploads image-only clipboard content', async ({ page }) => {
  await writeClipboard(page, {}, true);
  const upload = page.waitForRequest((request) =>
    request.url().includes('/storage/v1/object/images/') && request.method() === 'POST');
  await input(page).focus();
  await page.keyboard.press('ControlOrMeta+V');
  await upload;
  await expect(input(page)).toHaveValue('');
});

test('HTML fallback keeps block boundaries, inline words, lists, and code', async ({ page }) => {
  await writeClipboard(page, { 'text/html':
    '<h1>Title</h1><p>Keep <strong>bold</strong> and <em>italic</em> words.<br>Next line</p>' +
    '<ul><li>First</li><li>Second</li></ul><pre>  const x = 1;\n  x++;</pre>',
  });
  await input(page).focus();
  await page.keyboard.press('ControlOrMeta+V');
  const text = await input(page).inputValue();
  expect(text).toContain('Title\n');
  expect(text).toContain('Keep bold and italic words.\nNext line');
  expect(text).toMatch(/First\n+Second/);
  expect(text).toContain('  const x = 1;\n  x++;');
});

for (const { name, html, text } of [
  {
    name: 'table cells and Unicode entities',
    html: '<h2>Résumé &#x1f600;</h2><table><tr><th>Name</th><th>Value</th></tr>' +
      '<tr><td>α</td><td>2 &lt; 3 &amp; 4 &gt; 1</td></tr></table>',
    text: 'Résumé 😀\nName\tValue\nα\t2 < 3 & 4 > 1',
  },
  {
    name: 'literal angle brackets',
    html: '<pre>&lt;script&gt;literal text&lt;/script&gt;\n  keep indentation</pre>',
    text: '<script>literal text</script>\n  keep indentation',
  },
  {
    name: 'incomplete and misnested formatting tags',
    html: '<h2><strong>Heading</h2><p>Body <em>words',
    text: 'Heading\nBody words',
  },
  {
    name: 'deeply nested markup',
    html: '<div>'.repeat(6000) + '<b>Nested heading</b>' + '</div>'.repeat(6000),
    text: 'Nested heading',
  },
]) {
  test(`HTML fallback preserves ${name}`, async ({ page }) => {
    // Bypass native clipboard normalization so the parser receives the original fixture.
    await input(page).evaluate((element, html) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/html', html);
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    }, html);
    await expect(input(page)).toHaveValue(text);
  });
}

test('HTML fallback never mounts pasted markup or includes scripts and styles', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('clipboard-resource.invalid')) requests.push(request.url());
  });
  // A synthetic paste keeps markup that the browser would otherwise sanitize on clipboard.read().
  await input(page).evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/html', '<style>.secret { color: red; }</style>' +
      '<script>window.clipboardScriptRan = true</script><h2><b>Safe heading</b></h2>' +
      '<img src="https://clipboard-resource.invalid/image.png" onerror="window.clipboardScriptRan = true">' +
      '<svg onload="window.clipboardScriptRan = true"></svg>' +
      '<iframe src="https://clipboard-resource.invalid/frame" srcdoc="&lt;script&gt;parent.clipboardScriptRan=true&lt;/script&gt;"></iframe>' +
      '<link rel="stylesheet" href="https://clipboard-resource.invalid/style.css">' +
      '<template><img src="https://clipboard-resource.invalid/nested.png" onerror="window.clipboardScriptRan=true"></template>');
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  await expect(input(page)).toHaveValue('Safe heading');
  expect(await page.evaluate(() => 'clipboardScriptRan' in window)).toBe(false);
  await expect(page.locator('img, iframe, template')).toHaveCount(0);
  expect(requests).toEqual([]);
});

test('paste button still works with readText alone', async ({ page }) => {
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: {
    readText: async () => 'Plain text only',
  } }));
  await page.getByTitle('Paste from clipboard').click();
  await expect(input(page)).toHaveValue('Plain text only');
});

test('empty clipboard and denied access leave the draft intact', async ({ page }) => {
  await input(page).fill('Keep this draft');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    readText: async () => '', read: async () => [],
  } }));
  await page.getByTitle('Paste from clipboard').click();
  await expect(page.getByText('Clipboard is empty')).toBeVisible();
  await expect(input(page)).toHaveValue('Keep this draft');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: {
    readText: async () => { throw new DOMException('Denied', 'NotAllowedError'); },
  } }));
  await page.getByTitle('Paste from clipboard').click();
  await expect(page.getByText('Could not access clipboard')).toBeVisible();
  await expect(input(page)).toHaveValue('Keep this draft');
});
