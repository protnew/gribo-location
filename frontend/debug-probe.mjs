import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5180';
const browser = await chromium.launch();
const page = await browser.newPage();

const logs = [];
page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', err => logs.push(`[PAGEERROR] ${err.message}`));
page.on('requestfailed', req => logs.push(`[REQFAIL] ${req.url()} ${req.failure()?.errorText}`));

await page.goto(BASE, { waitUntil: 'load' });
// wait a bit for module execution
await page.waitForTimeout(4000);

const probe = await page.evaluate(() => ({
  deviceId: typeof window.deviceId,
  deviceIdVal: window.deviceId,
  addMushroom: typeof window.addMushroom,
  S: typeof window.S,
  title: document.title,
}));

console.log('=== CONSOLE / ERRORS ===');
for (const l of logs) console.log(l);
console.log('\n=== PROBE ===');
console.log(JSON.stringify(probe, null, 2));

await browser.close();
