import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const base = 'F:/FURLAB/dev/furlab-access/ui-lab/assets/uploads';
const files = fs.readdirSync(base).filter(n => /^FL-SCR-[0-9]{6}.*\.png$/i.test(n)).sort((a,b)=>a.localeCompare(b,'en'));
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto('http://localhost:5173/furlab-ac/scan', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(1200);
const out=[];
for (const f of files) {
  await page.locator('#fileInput').setInputFiles(path.join(base,f));
  const btn = page.locator('.scan-upload-actions .toolbar-btn').nth(1);
  if (await btn.count()) await btn.click();
  else await page.locator('.toolbar-btn').nth(1).click();
  await page.waitForTimeout(6200);
  const row = await page.evaluate(() => {
    const s = window.__ldvLastState || {};
    const ld = s.lineDetection || {};
    const cm = s.contourMetrics || {};
    const ms = s.modelStats || {};
    const rs = s.lineRejectStats || {};
    const lmi = s.lineMaskInfo || {};
    return {
      status: ld.status || 'not_found',
      source: ld.source || '-',
      conf: Number.isFinite(ld.confidence) ? ld.confidence : null,
      autoMs: Number.isFinite(rs.autoMs) ? rs.autoMs : null,
      autoTrace: rs.autoTrace || '',
      area: Number(cm.areaPx ?? ms.area ?? 0),
      bboxW: Number(cm.bboxWidthPx ?? ms.bboxW ?? 0),
      bboxH: Number(cm.bboxHeightPx ?? ms.bboxH ?? 0),
      candidates: Number(lmi.candidates ?? 0),
      lineMode: String(lmi.mode || '-')
    };
  });
  out.push({ file: f, ...row });
}
await browser.close();
for (const r of out) {
  console.log(`${r.file}\tstatus=${r.status}\tautoMs=${r.autoMs}\tarea=${r.area}\tbbox=${r.bboxW}x${r.bboxH}\tcand=${r.candidates}\tmode=${r.lineMode}\tsource=${r.source}`);
}
const match = out.find(r => r.area === 811870 && r.bboxW === 1360 && r.bboxH === 912);
if (match) {
  console.log('MATCH_FILE=' + match.file);
  console.log('MATCH_TRACE=' + match.autoTrace);
}
