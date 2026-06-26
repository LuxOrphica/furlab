import { chromium } from 'playwright-core';

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto('http://localhost:5173/furlab-ac/scan', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(1200);
await page.locator('#fileInput').setInputFiles('F:/FURLAB/dev/furlab-access/ui-lab/assets/uploads/FL-SCR-001012_placed.png');
await page.getByRole('button', { name: /^Скан$/ }).first().click();
await page.waitForTimeout(8000);
const out = await page.locator('#output').innerText().catch(()=>'<no output>');
console.log(out);
await page.screenshot({ path:'ui-lab/line-direction-visualizer-react/tmp/iter_after_tune.png', fullPage:true });
await browser.close();
