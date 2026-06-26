#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const target = process.argv[2] || path.join(process.cwd(), "public", "js", "app.js");
const backupDir = path.join(process.cwd(), "tmp", "encoding_backups");
const backup = path.join(backupDir, `${path.basename(target)}.literal_fix_backup`);

function cp1251Byte(ch) {
  const code = ch.charCodeAt(0);
  if (code <= 0x7f) return code;
  if (code <= 0xff) return code;
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
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
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
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (_) {
    return null;
  }
}

function hasMojibakeMarker(str) {
  return /(?:\u0420.|\u0421.|\u00D0.|\u00D1.|\u00C2.|\u00E2.)/.test(str);
}

function hasSuspiciousFragment(str) {
  return /(?:\u0420[\u00A0\u0400-\u040F\u0450-\u045F]|\u0421[\u00A0\u0400-\u040F\u0450-\u045F]|\u00D0[\u0080-\u00BF]|\u00D1[\u0080-\u00BF]|\u00C2[\u0080-\u00BF]|\u00E2[\u0080-\u00BF])/.test(str);
}

function scoreText(str) {
  const bad = (str.match(/(?:\u0420.|\u0421.|\u00D0.|\u00D1.|\u00C2.|\u00E2.)/g) || []).length;
  const suspicious = (str.match(/(?:\u0420[\u00A0\u0400-\u040F\u0450-\u045F]|\u0421[\u00A0\u0400-\u040F\u0450-\u045F]|\u00D0[\u0080-\u00BF]|\u00D1[\u0080-\u00BF]|\u00C2[\u0080-\u00BF]|\u00E2[\u0080-\u00BF])/g) || []).length;
  const ru = (str.match(/[\u0410-\u042F\u0430-\u044F\u0401\u0451]/g) || []).length;
  return ru * 3 - bad * 4 - suspicious * 10;
}

function maybeFix(str) {
  if (!str || !hasMojibakeMarker(str)) return str;
  let best = str;
  let bestScore = scoreText(str);
  let cur = str;
  for (let pass = 0; pass < 4; pass += 1) {
    const candidates = [decodeUtf8FromCp1251(cur), decodeUtf8FromLatin1(cur)].filter(Boolean);
    let improved = false;
    for (const c of candidates) {
      const s = scoreText(c);
      if (s > bestScore || (hasSuspiciousFragment(best) && !hasSuspiciousFragment(c))) {
        best = c;
        bestScore = s;
        improved = true;
      }
    }
    if (!improved) break;
    cur = best;
  }
  return best;
}

function escapeForQuote(str, quote) {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(new RegExp(quote === '"' ? '"' : "'", "g"), quote === '"' ? '\\"' : "\\'");
}

function escapeForTemplate(str) {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");
}

function consumeQuoted(input, i, quote) {
  const start = i;
  i += 1;
  let raw = "";
  while (i < input.length) {
    const ch = input[i];
    if (ch === "\\") {
      if (i + 1 < input.length) {
        raw += ch + input[i + 1];
        i += 2;
        continue;
      }
      raw += ch;
      i += 1;
      continue;
    }
    if (ch === quote) {
      i += 1;
      const fixed = maybeFix(raw);
      if (fixed === raw) return { text: input.slice(start, i), next: i, changed: false };
      return { text: `${quote}${escapeForQuote(fixed, quote)}${quote}`, next: i, changed: true };
    }
    raw += ch;
    i += 1;
  }
  return { text: input.slice(start), next: input.length, changed: false };
}

function consumeTemplate(input, i) {
  let out = "`";
  let changed = false;
  i += 1;
  let segment = "";
  while (i < input.length) {
    const ch = input[i];
    if (ch === "\\") {
      if (i + 1 < input.length) {
        segment += ch + input[i + 1];
        i += 2;
        continue;
      }
      segment += ch;
      i += 1;
      continue;
    }
    if (ch === "`") {
      const fixedSeg = maybeFix(segment);
      if (fixedSeg !== segment) changed = true;
      out += escapeForTemplate(fixedSeg) + "`";
      i += 1;
      return { text: out, next: i, changed };
    }
    if (ch === "$" && i + 1 < input.length && input[i + 1] === "{") {
      const fixedSeg = maybeFix(segment);
      if (fixedSeg !== segment) changed = true;
      out += escapeForTemplate(fixedSeg);
      segment = "";
      out += "${";
      i += 2;
      let depth = 1;
      while (i < input.length && depth > 0) {
        const c = input[i];
        if (c === "'" || c === '"') {
          const q = consumeQuoted(input, i, c);
          out += q.text;
          i = q.next;
          continue;
        }
        if (c === "`") {
          const t = consumeTemplate(input, i);
          out += t.text;
          i = t.next;
          changed = changed || t.changed;
          continue;
        }
        if (c === "/" && i + 1 < input.length && input[i + 1] === "/") {
          const j = input.indexOf("\n", i + 2);
          if (j < 0) {
            out += input.slice(i);
            i = input.length;
            break;
          }
          out += input.slice(i, j);
          i = j;
          continue;
        }
        if (c === "/" && i + 1 < input.length && input[i + 1] === "*") {
          const j = input.indexOf("*/", i + 2);
          if (j < 0) {
            out += input.slice(i);
            i = input.length;
            break;
          }
          out += input.slice(i, j + 2);
          i = j + 2;
          continue;
        }
        out += c;
        if (c === "{") depth += 1;
        else if (c === "}") depth -= 1;
        i += 1;
      }
      continue;
    }
    segment += ch;
    i += 1;
  }
  return { text: out + segment, next: input.length, changed };
}

function transform(input) {
  let i = 0;
  let out = "";
  let changed = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === "'" || ch === '"') {
      const q = consumeQuoted(input, i, ch);
      out += q.text;
      i = q.next;
      if (q.changed) changed += 1;
      continue;
    }
    if (ch === "`") {
      const t = consumeTemplate(input, i);
      out += t.text;
      i = t.next;
      if (t.changed) changed += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return { out, changed };
}

function main() {
  if (!fs.existsSync(target)) {
    console.error(`missing file: ${target}`);
    process.exit(1);
  }
  const input = fs.readFileSync(target, "utf8");
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, input, "utf8");
  const { out, changed } = transform(input);
  fs.writeFileSync(target, out, "utf8");
  console.log(`literal_fix_done changed=${changed} file=${target}`);
}

main();
