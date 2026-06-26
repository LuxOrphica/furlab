#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const target = path.join(process.cwd(), "public", "js", "app.js");
const backupDir = path.join(process.cwd(), "tmp", "encoding_backups");
const backup = path.join(backupDir, "app.js.mojibake_backup");

function cp1251Byte(ch) {
  const code = ch.charCodeAt(0);
  if (code <= 0x7f) return code;
  if (code === 0x0401) return 0xa8; // Ё
  if (code === 0x0451) return 0xb8; // ё
  if (code >= 0x0410 && code <= 0x044f) return code - 0x350; // А..я
  // Common cp1251 punctuation that appears in mojibake runs.
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
  return map.has(code) ? map.get(code) : -1;
}

function decodeViaCp1251(str) {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i += 1) {
    const b = cp1251Byte(str[i]);
    if (b < 0) return null;
    bytes[i] = b;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (_) {
    return null;
  }
}

function decodeViaLatin1(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i += 1) {
    const c = str.charCodeAt(i);
    if (c > 0xff) return null;
    bytes.push(c);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch (_) {
    return null;
  }
}

function mojibakeScore(str) {
  if (!str) return -9999;
  const bad = (str.match(/(?:Р.|С.|Ð.|Ñ.|Â.|â.)/g) || []).length;
  const ru = (str.match(/[А-Яа-яЁё]/g) || []).length;
  return ru * 3 - bad * 4;
}

function maybeFixChunk(chunk) {
  const hasMarker = /(?:Р.|С.|Ð.|Ñ.|Â.|â.)/.test(chunk);
  if (!hasMarker) return chunk;
  const c1 = decodeViaCp1251(chunk);
  const c2 = decodeViaLatin1(chunk);
  const cand = [chunk, c1, c2].filter(Boolean);
  let best = chunk;
  let bestScore = mojibakeScore(chunk);
  for (const s of cand) {
    const score = mojibakeScore(s);
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

function main() {
  if (!fs.existsSync(target)) {
    console.error(`missing target: ${target}`);
    process.exit(1);
  }
  const input = fs.readFileSync(target, "utf8");
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  if (!fs.existsSync(backup)) {
    fs.writeFileSync(backup, input, "utf8");
  }

  // Replace suspicious mojibake chunks while keeping code structure intact.
  const out = input.replace(/[^\n\r"'`]{2,}/g, (m) => maybeFixChunk(m));
  fs.writeFileSync(target, out, "utf8");
  console.log("mojibake_fix_done", target);
}

main();
