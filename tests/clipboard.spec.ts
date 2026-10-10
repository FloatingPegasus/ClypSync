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
      '<img src="https://clipboard-resource.invalid/image.png" onerror="window.clipboardScriptRan = true">');
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  await expect(input(page)).toHaveValue('Safe heading');
  expect(await page.evaluate(() => 'clipboardScriptRan' in window)).toBe(false);
  await expect(page.locator('img')).toHaveCount(0);
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
