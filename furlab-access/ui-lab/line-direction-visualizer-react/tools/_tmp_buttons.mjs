import { chromium } from 'playwright-core';
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
await page.goto('http://localhost:5173/furlab-ac/scan', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(1200);
const buttons = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map((b,i)=>({i,text:(b.textContent||'').trim(),id:b.id,cls:b.className})).slice(0,80));
console.log(JSON.stringify(buttons,null,2));
await browser.close();
