import { chromium } from 'playwright-core';
import fs from 'fs';

const out = process.argv[2] || 'tmp/screen.png';
const url = process.argv[3] || 'http://localhost:5173/furlab-ac/scan';

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(out);
