import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const base = 'F:/FURLAB/dev/furlab-access/ui-lab/assets/uploads';
const files = fs.readdirSync(base)
  .filter((n) => /^FL-SCR-0010\d\d_placed\.png$/i.test(n))
  .sort()
  .slice(0, 8);

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto('http://localhost:5173/furlab-ac/scan', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(1200);

for (const f of files) {
  await page.locator('#fileInput').setInputFiles(path.join(base, f));
  await page.getByRole('button', { name: /^Скан$/ }).first().click();
  await page.waitForTimeout(5500);
  const out = await page.locator('#output').innerText().catch(() => '');
  const line = out.split('\n').find((s) => s.includes('Источник линии:')) || 'Источник линии: n/a';
  const auto = out.split('\n').find((s) => s.includes('Авто:')) || 'Авто: n/a';
  const seg = out.split('\n').find((s) => s.includes('Segmentation time:')) || 'Segmentation time: n/a';
  console.log(`${f} | ${auto} | ${line} | ${seg}`);
}

await browser.close();
