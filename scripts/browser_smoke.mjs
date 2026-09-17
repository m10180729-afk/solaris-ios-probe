// Optional developer-only test: requires Playwright + its Chromium browser.
// Does not replace a Windows/iPad test. Only localhost traffic is generated.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)('playwright');

const receiverDir = fileURLToPath(new URL('../receiver/', import.meta.url));
const python = process.env.SOLARIS_PYTHON || 'python3';
const fixture = 'from receiver import Receiver; import secrets; s=Receiver(("127.0.0.1",0),secrets.token_hex(32)); print("http://127.0.0.1:"+str(s.server_port),flush=True); print(s.token,flush=True); s.serve_forever()';
const server = spawn(python, ['-u', '-c', fixture], { cwd: receiverDir, stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
try {
  const [origin, token] = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Receiver start timed out')), 5000);
    server.once('error', error => { clearTimeout(timeout); reject(error); });
    server.once('exit', code => { clearTimeout(timeout); reject(new Error('Receiver exited: '+code)); });
    server.stdout.on('data', chunk => {
      output += chunk.toString();
      const lines = output.trim().split('\n');
      if (lines.length >= 2) { clearTimeout(timeout); resolve(lines); }
    });
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.locator('#token').fill('wrong');
  await page.locator('#connect').click();
  assert.match(await page.locator('#status').innerText(), /64자리/);
  await page.locator('#token').fill(token);
  await page.locator('#connect').click();
  const jpeg = readFileSync(new URL('../ios/App/Resources/SolarisMark.jpeg', import.meta.url));
  const response = await fetch(origin+'/frame', {
    method: 'POST', body: jpeg,
    headers: { 'X-Solaris-Token': token, 'Content-Type': 'image/jpeg',
      'X-Solaris-Session': '12345678-abcd-1234-abcd-123456789012',
      'X-Source-Size': '775x775', 'X-Preview-Size': '775x775', 'X-Capture-FPS': '5' }
  });
  assert.equal(response.status, 200);
  await page.waitForFunction(() => {
    const image = document.getElementById('screen');
    return !image.hidden && image.complete && image.naturalWidth > 0;
  }, null, { timeout: 5000 });
  assert.equal(await page.locator('#source').innerText(), '775x775');
  if (process.env.SOLARIS_QA_SCREENSHOT) {
    await page.screenshot({ path: process.env.SOLARIS_QA_SCREENSHOT, fullPage: true });
  }
  await page.waitForFunction(() => document.getElementById('screen').hidden, null, { timeout: 6000 });
  await page.locator('#disconnect').click();
  assert.match(await page.locator('#status').innerText(), /보기 중지/);
  assert.deepEqual(errors, []);
  console.log('PASS: real JPEG decoding, viewer auth input, stats display, stale image clearing, disconnect, no page errors (Linux Chromium only)');
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
