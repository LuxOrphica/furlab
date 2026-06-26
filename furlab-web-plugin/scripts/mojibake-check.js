#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = process.cwd();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

function cp1251Byte(ch) {
  const code = ch.charCodeAt(0);
  if (code <= 0x7f) return code;
  if (code === 0x0401) return 0xa8;
  if (code === 0x0451) return 0xb8;
  if (code >= 0x0410 && code <= 0x044f) return code - 0x350;
  const map = new Map([
    [0x0402, 0x80], [0x0403, 0x81], [0x201a, 0x82], [0x0453, 0x83],
    [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87],
    [0x20ac, 0x88], [0x2030, 0x89], [0x0409, 0x8a], [0x2039, 0x8b],
    [0x040a, 0x8c], [0x040c, 0x8d], [0x040b, 0x8e], [0x040f, 0x8f],
    [0x0452, 0x90], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
    [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
    [0x2122, 0x99], [0x0459, 0x9a], [0x203a, 0x9b], [0x045a, 0x9c],
    [0x045c, 0x9d], [0x045b, 0x9e], [0x045f, 0x9f], [0x00a0, 0xa0],
    [0x040e, 0xa1], [0x045e, 0xa2], [0x0408, 0xa3], [0x00a4, 0xa4],
    [0x0490, 0xa5], [0x00a6, 0xa6], [0x00a7, 0xa7], [0x00a9, 0xa9],
    [0x0404, 0xaa], [0x00ab, 0xab], [0x00ac, 0xac], [0x00ad, 0xad],
    [0x00ae, 0xae], [0x0407, 0xaf], [0x00b0, 0xb0], [0x00b1, 0xb1],
    [0x0406, 0xb2], [0x0456, 0xb3], [0x0491, 0xb4], [0x00b5, 0xb5],
    [0x00b6, 0xb6], [0x00b7, 0xb7], [0x2116, 0xb9], [0x0454, 0xba],
    [0x00bb, 0xbb], [0x0458, 0xbc], [0x0405, 0xbd], [0x0455, 0xbe],
    [0x0457, 0xbf]
  ]);
  if (map.has(code)) return map.get(code);
  return -1;
}

function decodeUtf8FromCp1251(str) {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i += 1) {
    const b = cp1251Byte(str[i]);
    if (b < 0) return null;
    bytes[i] = b;
  }
  try {
    return textDecoder.decode(bytes);
  } catch (_) {
    return null;
  }
}

function decodeUtf8FromLatin1(str) {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i += 1) {
    const c = str.charCodeAt(i);
    if (c > 0xff) return null;
    bytes[i] = c;
  }
  try {
    return textDecoder.decode(bytes);
  } catch (_) {
    return null;
  }
}

function hasMarker(str) {
  return /(?:\u0420.|\u0421.|\u00D0.|\u00D1.|\u00C2.|\u00E2.)/.test(str);
}

function hasSuspiciousFragment(str) {
  return /(?:\u0420[\u00A0\u0400-\u040F\u0450-\u045F]|\u0421[\u00A0\u0400-\u040F\u0450-\u045F]|\u00D0[\u0080-\u00BF]|\u00D1[\u0080-\u00BF]|\u00C2[\u0080-\u00BF]|\u00E2[\u0080-\u00BF])/.test(str);
}

function score(str) {
  const bad = (str.match(/(?:\u0420.|\u0421.|\u00D0.|\u00D1.|\u00C2.|\u00E2.)/g) || []).length;
  const ru = (str.match(/[\u0410-\u042F\u0430-\u044F\u0401\u0451]/g) || []).length;
  return ru * 3 - bad * 4;
}

function normalizeCandidate(str) {
  if (!hasMarker(str)) return str;
  let best = str;
  let bestScore = score(str);
  let cur = str;
  for (let i = 0; i < 3; i += 1) {
    const candidates = [decodeUtf8FromCp1251(cur), decodeUtf8FromLatin1(cur)].filter(Boolean);
    let improved = false;
    for (const c of candidates) {
      const sc = score(c);
      if (sc > bestScore) {
        best = c;
        bestScore = sc;
        improved = true;
      }
    }
    if (!improved) break;
    cur = best;
  }
  return best;
}

function isTextFile(file) {
  return /\.(js|ts|tsx|jsx|json|html|css|md|txt|yml|yaml|svg)$/i.test(file);
}

function skipPath(rel) {
  if (!rel) return true;
  if (rel.startsWith(".git" + path.sep)) return true;
  if (rel.startsWith("node_modules" + path.sep)) return true;
  if (rel.startsWith("tmp" + path.sep)) return true;
  if (rel.startsWith("dist" + path.sep)) return true;
  if (rel.includes(".literal_fix_backup") || rel.includes(".mojibake_backup")) return true;
  if (rel === "src" + path.sep + "server.js") return true;
  return false;
}

function walk(dir, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full);
    if (skipPath(rel)) continue;
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!isTextFile(entry.name)) continue;
    out.push(full);
  }
}

function main() {
  const files = [];
  walk(root, files);
  const bad = [];
  for (const f of files) {
    let src = "";
    try {
      src = fs.readFileSync(f, "utf8");
    } catch (_) {
      continue;
    }
    const fixed = normalizeCandidate(src);
    const rel = path.relative(root, f);
    if (fixed !== src) bad.push({ file: rel, reason: "whole-file-normalization" });

    const lines = src.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line) continue;
      if (!hasMarker(line)) continue;
      if (!hasSuspiciousFragment(line)) continue;
      const preview = line.trim().slice(0, 120);
      bad.push({ file: rel, reason: `suspicious-fragment@${i + 1}`, preview });
      if (bad.length > 1000) break;
    }
  }

  if (bad.length) {
    console.error("mojibake:check FAILED");
    bad.slice(0, 200).forEach((row) => {
      if (row.preview) console.error(` - ${row.file} :: ${row.reason} :: ${row.preview}`);
      else console.error(` - ${row.file} :: ${row.reason}`);
    });
    if (bad.length > 200) console.error(` - ... and ${bad.length - 200} more`);
    process.exit(1);
  }

  console.log(`mojibake:check PASS. files_checked=${files.length}`);
}

main();
