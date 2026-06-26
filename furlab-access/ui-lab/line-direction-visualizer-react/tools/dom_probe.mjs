import { chromium } from 'playwright-core';

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage();
await page.goto('http://localhost:5173/furlab-ac/scan', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
const files = await page.$$eval('input[type="file"]', els => els.map(e => ({id:e.id,name:e.getAttribute('name'),cls:e.className,accept:e.getAttribute('accept')})));
console.log('files=', JSON.stringify(files,null,2));
const btns = await page.$$eval('button', els => els.map(e => ({t:(e.textContent||'').trim(), id:e.id, cls:e.className})).filter(x => x.t));
console.log('buttons=', JSON.stringify(btns.slice(0,40),null,2));
await browser.close();
