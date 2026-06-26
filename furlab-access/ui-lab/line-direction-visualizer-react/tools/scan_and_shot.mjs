import { chromium } from 'playwright-core';

const url = 'http://localhost:5173/furlab-ac/scan';
const filePath = 'F:/FURLAB/dev/furlab-access/ui-lab/assets/uploads/FL-SCR-001001_placed.png';
const outPath = 'ui-lab/line-direction-visualizer-react/tmp/iter_file001_before.png';

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(1000);

const input = page.locator('#fileInput');
await input.setInputFiles(filePath);

const scanBtn = page.getByRole('button', { name: /^Скан$/ }).first();
await scanBtn.click();

await page.waitForTimeout(12000);
await page.screenshot({ path: outPath, fullPage: true });

await browser.close();
console.log(outPath);
