#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = process.cwd();
const indexPath = path.join(root, "public", "index.html");

function fail(msg) {
  console.error(`i18n:check FAILED: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(indexPath)) {
  fail("public/index.html not found");
}

const html = fs.readFileSync(indexPath, "utf8");

const i18nRuScript = /<script\s+src=["']\/js\/core\/i18n-ru\.js["']\s*><\/script>/i;
const i18nHydrateScript = /<script\s+src=["']\/js\/core\/i18n-hydrate\.js["']\s*><\/script>/i;
const appScript = /<script\s+src=["']\/js\/app\.js["']\s*><\/script>/i;

if (!i18nRuScript.test(html)) fail("missing /js/core/i18n-ru.js script include");
if (!i18nHydrateScript.test(html)) fail("missing /js/core/i18n-hydrate.js script include");
if (!appScript.test(html)) fail("missing /js/app.js script include");

const i18nRuIndex = html.search(i18nRuScript);
const i18nHydrateIndex = html.search(i18nHydrateScript);
const appIndex = html.search(appScript);

if (!(i18nRuIndex < appIndex)) fail("i18n-ru.js must be loaded before app.js");
if (!(i18nHydrateIndex < appIndex)) fail("i18n-hydrate.js must be loaded before app.js");

const panelMatch = html.match(/<details\s+id=["']displaySettingsPanel["'][\s\S]*?<\/details>/i);
if (!panelMatch) fail("displaySettingsPanel not found");

const panelHtml = panelMatch[0];
const dataI18nCount = (panelHtml.match(/\sdata-i18n=/g) || []).length;
if (dataI18nCount < 10) {
  fail(`displaySettingsPanel must use data-i18n labels (found ${dataI18nCount}, expected >= 10)`);
}

console.log("i18n:check PASS");
