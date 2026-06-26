import { chromium } from 'playwright-core';
import path from 'node:path';
const files=['FL-SCR-001000_placed.png','FL-SCR-001012_placed.png','FL-SCR-001024_placed.png'];
const base='F:/FURLAB/dev/furlab-access/ui-lab/assets/uploads';
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto('http://localhost:5173/furlab-ac/scan', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(1000);
for (const f of files){
  await page.locator('#fileInput').setInputFiles(path.join(base,f));
  await page.getByRole('button', { name: /^Скан$/ }).first().click();
  await page.waitForTimeout(6500);
  const out=await page.locator('#output').innerText().catch(()=> '');
  const src=(out.split('\n').find(s=>s.includes('Источник линии:'))||'Источник линии: n/a');
  const auto=(out.split('\n').find(s=>s.includes('Авто:'))||'Авто: n/a');
  console.log(f, '|', auto,'|',src);
}
await browser.close();
