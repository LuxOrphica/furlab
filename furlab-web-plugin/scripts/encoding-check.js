#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const FIX = process.argv.includes('--fix');

const TEXT_EXT = new Set([
  '.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx',
  '.json', '.html', '.css', '.md', '.txt',
  '.yml', '.yaml', '.svg', '.xml', '.csv',
  '.sql', '.ps1', '.sh', '.bat', '.cmd',
  '.env', '.gitignore', '.gitattributes', '.editorconfig'
]);

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'allure-results', 'tmp', 'allure-report']);
const SKIP_FILES = new Set(['package-lock.json']);
const SKIP_PREFIXES = [path.join('.husky', '_') + path.sep];

function isLikelyText(filePath) {
  const base = path.basename(filePath).toLowerCase();
  if (SKIP_FILES.has(base)) return false;
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXT.has(ext)) return true;
  if (base.startsWith('.env')) return true;
  if (base === 'dockerfile' || base === 'makefile') return true;
  return false;
}

function walk(dir, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, out);
      continue;
    }
    if (!e.isFile()) continue;
    const rel = path.relative(ROOT, full);
    if (SKIP_PREFIXES.some(p => rel.startsWith(p))) continue;
    if (isLikelyText(full)) out.push(full);
  }
}

function hasUtf8Bom(buf) {
  return buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
}

function decodeUtf8(buf) {
  try {
    const dec = new TextDecoder('utf-8', { fatal: true });
    return { ok: true, text: dec.decode(buf) };
  } catch (e) {
    return { ok: false, error: e };
  }
}

function normalize(text) {
  let s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  s = s.replace(/[ \t]+\n/g, '\n');
  if (!s.endsWith('\n')) s += '\n';
  return s;
}

function rel(p) { return path.relative(ROOT, p).replace(/\\/g, '/'); }

const files = [];
walk(ROOT, files);

let violations = 0;
let fixed = 0;

for (const file of files) {
  const raw = fs.readFileSync(file);
  const issues = [];
  let buf = raw;

  if (hasUtf8Bom(raw)) {
    issues.push('BOM');
    if (FIX) buf = raw.subarray(3);
  }

  const decoded = decodeUtf8(buf);
  if (!decoded.ok) {
    issues.push('INVALID_UTF8');
    console.error(`FAIL ${rel(file)} :: INVALID_UTF8`);
    violations += 1;
    continue;
  }

  const text = decoded.text;
  if (text.includes('\r')) issues.push('CRLF_OR_CR');
  if (!text.endsWith('\n')) issues.push('NO_FINAL_NEWLINE');

  if (issues.length === 0) continue;

  if (FIX) {
    const normalized = normalize(text);
    fs.writeFileSync(file, normalized, { encoding: 'utf8' });
    fixed += 1;
    console.log(`FIXED ${rel(file)} :: ${issues.join(',')}`);
  } else {
    console.error(`FAIL ${rel(file)} :: ${issues.join(',')}`);
    violations += 1;
  }
}

if (FIX) {
  console.log(`encoding:fix done. files_fixed=${fixed}`);
  process.exit(0);
}

if (violations > 0) {
  console.error(`encoding:check FAILED. violations=${violations}`);
  process.exit(1);
}

console.log(`encoding:check PASS. files_checked=${files.length}`);
