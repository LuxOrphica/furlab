import { chromium } from 'playwright-core';

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://localhost:5173/furlab-ac/scan', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);
await page.locator('#fileInput').setInputFiles('F:/FURLAB/dev/furlab-access/ui-lab/assets/uploads/FL-SCR-001001_placed.png');
await page.waitForTimeout(1200);
const val = await page.locator('#fileNameText').innerText().catch(()=>'<none>');
const fcount = await page.locator('#fileInput').evaluate((el)=>el.files?.length||0);
const fname = await page.locator('#fileInput').evaluate((el)=>el.files?.[0]?.name||'');
console.log({val,fcount,fname});
await page.screenshot({ path:'tmp/after_set.png', fullPage:true });
await browser.close();
