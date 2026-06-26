"use strict";
// Тест зон: /api/zones/validate + /api/intarsia/apply-fragments (isSplitOp) + save/list round-trip
// node scripts/check_zones_api.js

const http = require("http");

function postJson(path, body) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      method: "POST", hostname: "127.0.0.1", port: 5600, path,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      timeout: 15000
    }, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.write(data); req.end();
  });
}

function getJson(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      method: "GET", hostname: "127.0.0.1", port: 5600, path,
      timeout: 15000
    }, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.end();
  });
}

let passed = 0, failed = 0;

function assert(name, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.error(`  ✗ ${name}${detail ? ": " + detail : ""}`);
    failed++;
  }
}

// ─── helpers ───────────────────────────────────────────────────────────────

const RECT_DETAIL   = [{ x:0,y:0},{ x:200,y:0},{ x:200,y:150},{ x:0,y:150}]; // 200×150
const ZONE_A        = [{ x:0,y:0},{ x:100,y:0},{ x:100,y:150},{ x:0,y:150}]; // левая половина
const ZONE_B        = [{ x:100,y:0},{ x:200,y:0},{ x:200,y:150},{ x:100,y:150}]; // правая
const ZONE_OVERLAP  = [{ x:80,y:0},{ x:180,y:0},{ x:180,y:150},{ x:80,y:150}]; // перекрывает A и B
const ZONE_OUTSIDE  = [{ x:150,y:0},{ x:250,y:0},{ x:250,y:150},{ x:150,y:150}]; // выходит за деталь

const DETAIL_DEF = { id: 1, name: "Деталь 1", points: RECT_DETAIL };

// ─── Suite 1: /api/zones/validate ──────────────────────────────────────────

async function suiteValidate() {
  console.log("\n[Suite 1] /api/zones/validate");

  // 1a. Happy path: две зоны без перекрытий, покрывают деталь
  {
    const r = await postJson("/api/zones/validate", {
      details: [DETAIL_DEF],
      zones: [
        { id: 1, detailId: 1, name: "A", points: ZONE_A },
        { id: 2, detailId: 1, name: "B", points: ZONE_B }
      ]
    });
    assert("happy-path ok:true", r.body && r.body.ok === true);
    assert("happy-path 0 overlaps", r.body && r.body.summary && r.body.summary.overlaps === 0);
    assert("happy-path uncoveredArea ≈ 0",
      r.body && r.body.summary && Number(r.body.summary.uncoveredAreaMm2) < 1.0,
      JSON.stringify(r.body && r.body.summary));
  }

  // 1b. Перекрытие зон
  {
    const r = await postJson("/api/zones/validate", {
      details: [DETAIL_DEF],
      zones: [
        { id: 1, detailId: 1, name: "A",       points: ZONE_A },
        { id: 3, detailId: 1, name: "Overlap",  points: ZONE_OVERLAP }
      ]
    });
    assert("overlap ok:true",    r.body && r.body.ok === true);
    assert("overlap detected",   r.body && r.body.summary && r.body.summary.overlaps > 0,
      JSON.stringify(r.body && r.body.summary));
    assert("overlap areaMm2 > 0",
      r.body && r.body.overlaps && r.body.overlaps.length > 0 &&
      Number(r.body.overlaps[0].areaMm2) > 0);
  }

  // 1c. Зона выходит за деталь → outsideAreaMm2 > 0
  {
    const r = await postJson("/api/zones/validate", {
      details: [DETAIL_DEF],
      zones: [{ id: 4, detailId: 1, name: "Outside", points: ZONE_OUTSIDE }]
    });
    assert("outside ok:true", r.body && r.body.ok === true);
    assert("outside outsideAreaMm2 > 0",
      r.body && r.body.zones && r.body.zones.length > 0 &&
      Number(r.body.zones[0].outsideAreaMm2) > 0,
      JSON.stringify(r.body && r.body.zones && r.body.zones[0]));
  }

  // 1d. Пустые zones → 0 зон в ответе
  {
    const r = await postJson("/api/zones/validate", { details: [DETAIL_DEF], zones: [] });
    assert("empty zones ok:true", r.body && r.body.ok === true);
    assert("empty zones count 0", r.body && r.body.summary && r.body.summary.zones === 0);
  }

  // 1e. Нет details → zones без outsideAreaMm2 (не ошибка)
  {
    const r = await postJson("/api/zones/validate", {
      details: [],
      zones: [{ id: 1, detailId: 1, name: "A", points: ZONE_A }]
    });
    assert("no-detail ok:true", r.body && r.body.ok === true);
  }

  // 1f. Неполный контур (2 точки) игнорируется
  {
    const r = await postJson("/api/zones/validate", {
      details: [DETAIL_DEF],
      zones: [{ id: 99, detailId: 1, name: "Bad", points: [{ x:0,y:0},{ x:1,y:0}] }]
    });
    assert("bad-contour ok:true", r.body && r.body.ok === true);
    assert("bad-contour zones count 0", r.body && r.body.summary && r.body.summary.zones === 0);
  }
}

// ─── Suite 2: /api/intarsia/apply-fragments (isSplitOp) ────────────────────

async function suiteSplit() {
  console.log("\n[Suite 2] /api/intarsia/apply-fragments (isSplitOp)");

  const ZONE_200x150 = [{ x:0,y:0},{ x:200,y:0},{ x:200,y:150},{ x:0,y:150}];

  // 2a. Нормальный разрез — нижняя половина целиком (остаток = верхняя половина, один полигон)
  {
    const cut = [{ x:0,y:0},{ x:200,y:0},{ x:200,y:75},{ x:0,y:75}];
    const r = await postJson("/api/intarsia/apply-fragments", {
      zonePoints: ZONE_200x150, fragments: [{ points: cut }], isSplitOp: true
    });
    assert("split ok:true", r.body && r.body.ok === true, JSON.stringify(r.body));
    assert("split has subZones",    r.body && r.body.subZones    && r.body.subZones.length > 0);
    assert("split has remainderZones", r.body && r.body.remainderZones && r.body.remainderZones.length > 0);
    assert("split has splitOperationId", r.body && typeof r.body.splitOperationId === "string");
  }

  // 2b. Вырезающий контур выходит за зону → drawn_contour_outside_zone
  {
    const cutOutside = [{ x:150,y:0},{ x:250,y:0},{ x:250,y:150},{ x:150,y:150}];
    const r = await postJson("/api/intarsia/apply-fragments", {
      zonePoints: ZONE_200x150, fragments: [{ points: cutOutside }], isSplitOp: true
    });
    assert("outside-cut status 400", r.status === 400);
    assert("outside-cut error drawn_contour_outside_zone",
      r.body && r.body.error === "drawn_contour_outside_zone", JSON.stringify(r.body));
  }

  // 2c. Разрез угловым куском → остаток не может быть мультиполигоном
  //     (треугольник в одном углу → L-образный остаток → один полигон, должен пройти)
  {
    const corner = [{ x:0,y:0},{ x:80,y:0},{ x:0,y:80}];
    const r = await postJson("/api/intarsia/apply-fragments", {
      zonePoints: ZONE_200x150, fragments: [{ points: corner }], isSplitOp: true
    });
    assert("corner-cut ok:true", r.body && r.body.ok === true, JSON.stringify(r.body));
    assert("corner-cut remainder count 1",
      r.body && r.body.remainderZones && r.body.remainderZones.length === 1);
  }

  // 2d. Разрез по центру вертикально → создаст два не-связных остатка → split_would_create_multipolygon
  //     Вырезаем вертикальную полосу посередине
  {
    const vertStrip = [{ x:90,y:0},{ x:110,y:0},{ x:110,y:150},{ x:90,y:150}];
    const r = await postJson("/api/intarsia/apply-fragments", {
      zonePoints: ZONE_200x150, fragments: [{ points: vertStrip }], isSplitOp: true
    });
    assert("vert-strip status 400", r.status === 400);
    assert("vert-strip error split_would_create_multipolygon",
      r.body && r.body.error === "split_would_create_multipolygon", JSON.stringify(r.body));
  }

  // 2e. Отсутствие zonePoints → zone_required
  {
    const r = await postJson("/api/intarsia/apply-fragments", {
      zonePoints: [], fragments: [{ points: [{ x:0,y:0},{ x:1,y:0},{ x:0,y:1}] }], isSplitOp: true
    });
    assert("no-zone status 400", r.status === 400);
    assert("no-zone error zone_required", r.body && r.body.error === "zone_required");
  }

  // 2f. isSplitOp: false — те же данные что в 2d (вертикальная полоса), должен пройти без ошибки
  {
    const vertStrip = [{ x:90,y:0},{ x:110,y:0},{ x:110,y:150},{ x:90,y:150}];
    const r = await postJson("/api/intarsia/apply-fragments", {
      zonePoints: ZONE_200x150, fragments: [{ points: vertStrip }], isSplitOp: false
    });
    assert("non-split-multipolygon ok:true", r.body && r.body.ok === true, JSON.stringify(r.body));
  }
}

// ─── Suite 3: save / list / delete round-trip ───────────────────────────────

async function suitePersistence() {
  console.log("\n[Suite 3] /api/zones save+list+delete");
  const WS = `test_zones_${Date.now()}`;

  // 3a. Save two zones
  {
    const r = await postJson("/api/zones/save", {
      workspaceKey: WS,
      selectedZoneId: 1,
      zones: [
        { id: 1, detailId: 1, points: ZONE_A, originType: "base",  revision: 1, schemaVersion: 1, splitDepth: 0, splitOperationId: null, holes: [] },
        { id: 2, detailId: 1, points: ZONE_B, originType: "split", revision: 2, schemaVersion: 1, splitDepth: 1, splitOperationId: "sop_1", parentZoneId: 1, holes: [] }
      ]
    });
    assert("save ok:true", r.body && r.body.ok === true, JSON.stringify(r.body));
    assert("save returns 2 zones", r.body && r.body.zones && r.body.zones.length === 2);
  }

  // 3b. List — round-trip
  {
    const r = await getJson(`/api/zones?workspaceKey=${WS}`);
    assert("list ok:true", r.body && r.body.ok === true);
    assert("list count 2", r.body && Array.isArray(r.body.zones) && r.body.zones.length === 2);
    const z1 = r.body && r.body.zones && r.body.zones.find(z => Number(z.id) === 1);
    assert("list zone1 originType base", z1 && z1.originType === "base");
    const z2 = r.body && r.body.zones && r.body.zones.find(z => Number(z.id) === 2);
    assert("list zone2 revision 2", z2 && Number(z2.revision) === 2);
    assert("list zone2 splitDepth 1", z2 && Number(z2.splitDepth) === 1);
  }

  // 3c. Delete zone 2
  {
    const r = await postJson("/api/zones/delete", { workspaceKey: WS, zoneId: 2 });
    assert("delete ok:true", r.body && r.body.ok === true, JSON.stringify(r.body));
    assert("delete returns 1 zone", r.body && r.body.zones && r.body.zones.length === 1);
  }

  // 3d. List after delete
  {
    const r = await getJson(`/api/zones?workspaceKey=${WS}`);
    assert("list-after-delete count 1",
      r.body && Array.isArray(r.body.zones) && r.body.zones.length === 1);
    assert("list-after-delete zone1 survives",
      r.body && r.body.zones && Number(r.body.zones[0].id) === 1);
  }

  // 3e. Save с пустым workspaceKey → ошибка
  {
    const r = await postJson("/api/zones/save", { workspaceKey: "", zones: [] });
    assert("save-no-key status 4xx", r.status >= 400, `status=${r.status}`);
  }
}

// ─── Suite 4: §21.15 persistence со split-зонами + §21.16 revision ───────────

async function suitePersistenceAndRevision() {
  console.log("\n[Suite 4] §21.15 persistence split + §21.16 revision increment");
  const WS = `test_split_rev_${Date.now()}`;

  const PART = [{ x:0,y:0 },{ x:300,y:0 },{ x:300,y:200 },{ x:0,y:200 }];
  const LEFT  = [{ x:0,y:0 },{ x:150,y:0 },{ x:150,y:200 },{ x:0,y:200 }];
  const RIGHT = [{ x:150,y:0 },{ x:300,y:0 },{ x:300,y:200 },{ x:150,y:200 }];
  const SOP   = "sop_test_1";

  // 4a. Сохранить split-зоны
  {
    const r = await postJson("/api/zones/save", {
      workspaceKey: WS,
      selectedZoneId: 10,
      zones: [
        { id: 10, detailId: 5, points: LEFT,  originType: "split", revision: 1,
          schemaVersion: 1, splitDepth: 1, splitOperationId: SOP, parentZoneId: 9, holes: [] },
        { id: 11, detailId: 5, points: RIGHT, originType: "split", revision: 1,
          schemaVersion: 1, splitDepth: 1, splitOperationId: SOP, parentZoneId: 9, holes: [] }
      ]
    });
    assert("§21.15 save split ok", r.body && r.body.ok === true, JSON.stringify(r.body));
    assert("§21.15 save returns 2 zones", r.body && r.body.zones && r.body.zones.length === 2);
  }

  // 4b. §21.15 — reload сохраняет состояние
  {
    const r = await getJson(`/api/zones?workspaceKey=${WS}`);
    assert("§21.15 reload ok", r.body && r.body.ok === true);
    assert("§21.15 reload count 2", r.body && r.body.zones && r.body.zones.length === 2);
    const z10 = r.body.zones.find(z => Number(z.id) === 10);
    assert("§21.15 zone10 originType split", z10 && z10.originType === "split");
    assert("§21.15 zone10 splitOperationId", z10 && z10.splitOperationId === SOP);
    assert("§21.15 zone10 parentZoneId", z10 && Number(z10.parentZoneId) === 9);
    const z11 = r.body.zones.find(z => Number(z.id) === 11);
    assert("§21.15 both share splitOperationId",
      z10 && z11 && z10.splitOperationId === z11.splitOperationId);
  }

  // 4c. §21.16 — изменить границу зоны → revision должен вырасти
  {
    const LEFT_MOVED = [{ x:0,y:0 },{ x:160,y:0 },{ x:160,y:200 },{ x:0,y:200 }];
    const r = await postJson("/api/zones/save", {
      workspaceKey: WS,
      selectedZoneId: 10,
      zones: [
        { id: 10, detailId: 5, points: LEFT_MOVED, originType: "split", revision: 2,
          schemaVersion: 1, splitDepth: 1, splitOperationId: SOP, parentZoneId: 9, holes: [] },
        { id: 11, detailId: 5, points: RIGHT,      originType: "split", revision: 1,
          schemaVersion: 1, splitDepth: 1, splitOperationId: SOP, parentZoneId: 9, holes: [] }
      ]
    });
    assert("§21.16 save revision ok", r.body && r.body.ok === true);
  }

  {
    const r = await getJson(`/api/zones?workspaceKey=${WS}`);
    const z10 = r.body && r.body.zones && r.body.zones.find(z => Number(z.id) === 10);
    assert("§21.16 revision persisted as 2", z10 && Number(z10.revision) === 2,
      JSON.stringify(z10 && z10.revision));
    const z11 = r.body && r.body.zones && r.body.zones.find(z => Number(z.id) === 11);
    assert("§21.16 untouched zone revision still 1", z11 && Number(z11.revision) === 1,
      JSON.stringify(z11 && z11.revision));
  }
}

// ─── Suite 5: §21.7–21.8 partition validate (server) ─────────────────────────

async function suitePartitionValidate() {
  console.log("\n[Suite 5] §21.7-21.8 partition validate via /api/zones/validate");

  const DETAIL = { id: 99, name: "D", points: [{ x:0,y:0 },{ x:200,y:0 },{ x:200,y:100 },{ x:0,y:100 }] };
  const LA = [{ x:0,y:0 },{ x:100,y:0 },{ x:100,y:100 },{ x:0,y:100 }];
  const LB = [{ x:100,y:0 },{ x:200,y:0 },{ x:200,y:100 },{ x:100,y:100 }];
  const LOVERLAP = [{ x:80,y:0 },{ x:180,y:0 },{ x:180,y:100 },{ x:80,y:100 }];

  // 5a. Partition valid — полное покрытие, нет перекрытий
  {
    const r = await postJson("/api/zones/validate", {
      details: [DETAIL],
      zones: [
        { id: 1, detailId: 99, name: "L", points: LA },
        { id: 2, detailId: 99, name: "R", points: LB }
      ]
    });
    assert("§21.3 partition-valid uncoveredArea≈0",
      r.body && Number(r.body.summary && r.body.summary.uncoveredAreaMm2) < 1,
      JSON.stringify(r.body && r.body.summary));
    assert("§21.3 partition-valid overlaps=0",
      r.body && r.body.summary && r.body.summary.overlaps === 0);
  }

  // 5b. Partition overlap — §21.8 зоны пересекаются
  {
    const r = await postJson("/api/zones/validate", {
      details: [DETAIL],
      zones: [
        { id: 1, detailId: 99, name: "L",       points: LA },
        { id: 3, detailId: 99, name: "Overlap",  points: LOVERLAP }
      ]
    });
    assert("§21.8 overlap detected", r.body && r.body.summary && r.body.summary.overlaps > 0,
      JSON.stringify(r.body && r.body.summary));
  }

  // 5c. Gap — зона не покрывает часть детали
  {
    const SMALL = [{ x:0,y:0 },{ x:50,y:0 },{ x:50,y:100 },{ x:0,y:100 }];
    const r = await postJson("/api/zones/validate", {
      details: [DETAIL],
      zones: [{ id: 1, detailId: 99, name: "Small", points: SMALL }]
    });
    assert("§21 gap uncoveredArea>0",
      r.body && Number(r.body.summary && r.body.summary.uncoveredAreaMm2) > 1,
      JSON.stringify(r.body && r.body.summary));
  }
}

// ─── Suite §22: /api/zones/promote-preview ───────────────────────────────────

async function suitePromotePreview() {
  console.log("\n[Suite §22] /api/zones/promote-preview (PromoteFragmentsToZones)");

  // Parent zone: 200×150 rectangle
  const PARENT = { id: 10, points: RECT_DETAIL };
  // Fragment covers left half (same as ZONE_A)
  const FRAG_A = { id: 1, label: "Фрагмент 1", points: ZONE_A };
  // Remainder = right half (ZONE_B)
  const REMAINDER = { outer: ZONE_B, holes: [] };

  // §22.1 Happy path: fragment + remainder cover parent without gap/overlap
  {
    const r = await postJson("/api/zones/promote-preview", {
      parentZone: PARENT,
      fragments: [FRAG_A],
      remainingArea: REMAINDER,
      detailId: 1
    });
    assert("§22.1 ok:true", r.body && r.body.ok === true, JSON.stringify(r.body && r.body.error));
    assert("§22.1 partitionValid", r.body && r.body.partitionValid === true,
      JSON.stringify(r.body && r.body.partitionIssues));
    assert("§22.1 promotedZones = 2", r.body && Array.isArray(r.body.promotedZones) && r.body.promotedZones.length === 2,
      `got ${r.body && r.body.promotedZones && r.body.promotedZones.length}`);
    assert("§22.1 fragmentZones = 1", r.body && r.body.counts && r.body.counts.fragmentZones === 1,
      JSON.stringify(r.body && r.body.counts));
    assert("§22.1 remainderZones = 1", r.body && r.body.counts && r.body.counts.remainderZones === 1);

    const pz = r.body && r.body.promotedZones || [];
    const fragZone = pz.find(z => z.sourceFragmentId != null);
    const remZone  = pz.find(z => z.sourceFragmentId == null);

    assert("§22.1 fragZone originType=promoted",
      fragZone && fragZone.originType === "promoted");
    assert("§22.1 fragZone promoteOperationId set",
      fragZone && typeof fragZone.promoteOperationId === "string" && fragZone.promoteOperationId.length > 0);
    assert("§22.1 fragZone sourceLayoutRunId set",
      fragZone && typeof fragZone.sourceLayoutRunId === "string" && fragZone.sourceLayoutRunId.length > 0);
    assert("§22.1 fragZone sourceFragmentId = 1",
      fragZone && Number(fragZone.sourceFragmentId) === 1);
    assert("§22.1 fragZone parentZoneId = 10",
      fragZone && Number(fragZone.parentZoneId) === 10);

    assert("§22.1 remZone originType=promoted",
      remZone && remZone.originType === "promoted");
    assert("§22.1 remZone sourceFragmentId = null",
      remZone && remZone.sourceFragmentId == null);
    assert("§22.1 remZone promoteOperationId matches fragZone",
      remZone && fragZone && remZone.promoteOperationId === fragZone.promoteOperationId);
  }

  // §22.2 Fragment + remainder with hole: remainder has a hole = fragment boundary
  // Simulate: parent 200×150, fragment = left half, remainder = right half with left-half as hole
  {
    const remWithHole = { outer: RECT_DETAIL, holes: [ZONE_A] }; // full zone minus left half
    const r = await postJson("/api/zones/promote-preview", {
      parentZone: PARENT,
      fragments: [FRAG_A],
      remainingArea: remWithHole,
      detailId: 1
    });
    assert("§22.2 ok:true", r.body && r.body.ok === true);
    const pz = r.body && r.body.promotedZones || [];
    const remZone = pz.find(z => z.sourceFragmentId == null);
    assert("§22.2 remZone has holes", remZone && Array.isArray(remZone.holes) && remZone.holes.length === 1);
    assert("§22.2 holeBoundaryLinks created",
      r.body && r.body.counts && r.body.counts.holeBoundaryLinks >= 1,
      JSON.stringify(r.body && r.body.counts));
    if (remZone && remZone.holeBoundaryLinks && remZone.holeBoundaryLinks[0]) {
      const hbl = remZone.holeBoundaryLinks[0];
      assert("§22.2 hbl holeId set", typeof hbl.holeId === "string" && hbl.holeId.length > 0);
      assert("§22.2 hbl adjacentZoneId set", Number(hbl.adjacentZoneId) > 0);
      assert("§22.2 hbl adjacentBoundary=outer", hbl.adjacentBoundary === "outer");
      assert("§22.2 hbl holeIndex = 0", hbl.holeIndex === 0);
    }
  }

  // §22.3 Fragment only, no remainder (100% coverage by fragments)
  {
    // Two fragments covering the full 200×150 zone
    const r = await postJson("/api/zones/promote-preview", {
      parentZone: PARENT,
      fragments: [{ id: 1, points: ZONE_A }, { id: 2, points: ZONE_B }],
      remainingArea: null,
      detailId: 1
    });
    assert("§22.3 ok:true", r.body && r.body.ok === true);
    assert("§22.3 partitionValid (2 fragments cover parent)", r.body && r.body.partitionValid === true,
      JSON.stringify(r.body && r.body.partitionIssues));
    assert("§22.3 promotedZones = 2", r.body && Array.isArray(r.body.promotedZones) && r.body.promotedZones.length === 2);
    assert("§22.3 no remainderZones", r.body && r.body.counts && r.body.counts.remainderZones === 0);
  }

  // §22.4 Partition gap → partitionValid=false
  {
    // Fragment covers only top quarter, no remainder → gap exists
    const QUARTER = [{ x:0,y:0},{ x:100,y:0},{ x:100,y:75},{ x:0,y:75}];
    const r = await postJson("/api/zones/promote-preview", {
      parentZone: PARENT,
      fragments: [{ id: 1, points: QUARTER }],
      remainingArea: null,
      detailId: 1
    });
    assert("§22.4 ok:true", r.body && r.body.ok === true);
    assert("§22.4 partitionValid=false (gap)", r.body && r.body.partitionValid === false,
      JSON.stringify(r.body && r.body.partitionIssues));
    assert("§22.4 gap issue present",
      r.body && Array.isArray(r.body.partitionIssues) &&
      r.body.partitionIssues.some(i => i.code === "zone_partition_gap"));
  }

  // §22.6 Persistence round-trip: promoted zones survive save → reload with all fields intact
  {
    const PROMOTE_KEY = "test_promote_persistence_" + Date.now();
    const PROMOTED_FRAG = {
      id: 201,
      detailId: 1,
      name: "Фрагмент 1",
      originType: "promoted",
      parentZoneId: 100,
      parentZoneSnapshot: null,
      splitOperationId: null,
      splitDepth: 0,
      revision: 1,
      schemaVersion: 1,
      promoteOperationId: "promote-100-abc123",
      sourceLayoutRunId: "lr-zone-100",
      sourceFragmentId: 1,
      points: ZONE_A,
      holes: [],
      holeBoundaryLinks: []
    };
    const PROMOTED_REMAINDER = {
      id: 202,
      detailId: 1,
      name: "Остаток",
      originType: "promoted",
      parentZoneId: 100,
      parentZoneSnapshot: null,
      splitOperationId: null,
      splitDepth: 0,
      revision: 1,
      schemaVersion: 1,
      promoteOperationId: "promote-100-abc123",
      sourceLayoutRunId: "lr-zone-100",
      sourceFragmentId: null,
      points: RECT_DETAIL,
      holes: [ZONE_A],
      holeBoundaryLinks: [
        {
          remainderZoneId: 202,
          holeIndex: 0,
          holeId: "h-202-0",
          adjacentZoneId: 201,
          adjacentBoundary: "outer",
          promoteOperationId: "promote-100-abc123",
          sourceLayoutRunId: "lr-zone-100",
          sourceFragmentId: 1
        }
      ]
    };

    // Save
    const saveRes = await postJson("/api/zones/save", {
      workspaceKey: PROMOTE_KEY,
      selectedZoneId: 201,
      zones: [PROMOTED_FRAG, PROMOTED_REMAINDER]
    });
    assert("§22.6 save ok", saveRes.body && saveRes.body.ok === true, JSON.stringify(saveRes.body && saveRes.body.error));

    // Reload
    const listRes = await postJson("/api/zones/save", {
      workspaceKey: PROMOTE_KEY,
      selectedZoneId: null,
      zones: [PROMOTED_FRAG, PROMOTED_REMAINDER]
    });
    // Use GET to read back
    const getRes = await getJson("/api/zones?workspaceKey=" + PROMOTE_KEY);
    assert("§22.6 reload ok", getRes.body && getRes.body.ok === true);
    const reloadedZones = getRes.body && Array.isArray(getRes.body.zones) ? getRes.body.zones : [];
    assert("§22.6 reload count = 2", reloadedZones.length === 2, `got ${reloadedZones.length}`);

    const rFrag = reloadedZones.find(z => Number(z.id) === 201);
    const rRem  = reloadedZones.find(z => Number(z.id) === 202);

    // Fragment zone fields
    assert("§22.6 frag originType=promoted", rFrag && rFrag.originType === "promoted");
    assert("§22.6 frag promoteOperationId", rFrag && rFrag.promoteOperationId === "promote-100-abc123");
    assert("§22.6 frag sourceLayoutRunId",  rFrag && rFrag.sourceLayoutRunId === "lr-zone-100");
    assert("§22.6 frag sourceFragmentId=1", rFrag && Number(rFrag.sourceFragmentId) === 1);
    assert("§22.6 frag parentZoneId=100",   rFrag && Number(rFrag.parentZoneId) === 100);

    // Remainder zone fields
    assert("§22.6 rem originType=promoted", rRem && rRem.originType === "promoted");
    assert("§22.6 rem promoteOperationId",  rRem && rRem.promoteOperationId === "promote-100-abc123");
    assert("§22.6 rem sourceFragmentId=null", rRem && rRem.sourceFragmentId == null);
    assert("§22.6 rem holes present",       rRem && Array.isArray(rRem.holes) && rRem.holes.length === 1);
    assert("§22.6 rem holeBoundaryLinks present",
      rRem && Array.isArray(rRem.holeBoundaryLinks) && rRem.holeBoundaryLinks.length === 1);
    if (rRem && rRem.holeBoundaryLinks && rRem.holeBoundaryLinks[0]) {
      const hbl = rRem.holeBoundaryLinks[0];
      assert("§22.6 hbl holeId survives reload",   hbl.holeId === "h-202-0");
      assert("§22.6 hbl adjacentZoneId survives",  Number(hbl.adjacentZoneId) === 201);
      assert("§22.6 hbl holeIndex survives",        hbl.holeIndex === 0);
    }

    // Partition still valid after reload
    const valRes = await postJson("/api/zones/validate", {
      details: [DETAIL_DEF],
      zones: [
        { id: 201, detailId: 1, name: "Фрагмент 1", points: ZONE_A },
        { id: 202, detailId: 1, name: "Остаток",     points: ZONE_B }
      ]
    });
    assert("§22.6 partition valid after reload",
      valRes.body && valRes.body.summary && Number(valRes.body.summary.uncoveredAreaMm2) < 1.0 &&
      valRes.body.summary.overlaps === 0,
      JSON.stringify(valRes.body && valRes.body.summary));

    // Cleanup
    await postJson("/api/zones/delete", { workspaceKey: PROMOTE_KEY });
  }

  // §22.5 Intarsia API → promote-preview: full pipeline
  // Call /api/intarsia/apply-fragments → use result in promote-preview → verify partitionValid
  {
    const ZONE_HALF = [{ x:0,y:0},{ x:100,y:0},{ x:100,y:150},{ x:0,y:150}];
    const FRAG = [{ x:0,y:0},{ x:80,y:0},{ x:80,y:150},{ x:0,y:150}]; // clip to 80-wide strip

    const intarsiaRes = await postJson("/api/intarsia/apply-fragments", {
      zonePoints: ZONE_HALF,
      fragments: [{ points: FRAG }]
    });
    assert("§22.5 intarsia API ok", intarsiaRes.body && intarsiaRes.body.ok === true);

    const subZones = intarsiaRes.body && intarsiaRes.body.subZones || [];
    const remainderZones = intarsiaRes.body && intarsiaRes.body.remainderZones || [];
    const fragPoints = subZones[0] && subZones[0].points || [];
    const remPoints = remainderZones[0] && remainderZones[0].points || [];

    assert("§22.5 intarsia produced fragment", fragPoints.length >= 3);

    if (fragPoints.length >= 3) {
      const remArea = remPoints.length >= 3 ? { outer: remPoints, holes: [] } : null;
      const r = await postJson("/api/zones/promote-preview", {
        parentZone: { id: 20, points: ZONE_HALF },
        fragments: [{ id: 1, points: fragPoints }],
        remainingArea: remArea,
        detailId: 1
      });
      assert("§22.5 promote-preview ok", r.body && r.body.ok === true);
      assert("§22.5 partitionValid after intarsia", r.body && r.body.partitionValid === true,
        JSON.stringify(r.body && r.body.partitionIssues));
      assert("§22.5 at least 1 promoted zone", r.body && Array.isArray(r.body.promotedZones) && r.body.promotedZones.length >= 1);
    }
  }
}

// ─── Run all ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== check_zones_api.js ===");
  try {
    await suiteValidate();
    await suiteSplit();
    await suitePersistence();
    await suitePersistenceAndRevision();
    await suitePartitionValidate();
    await suitePromotePreview();
  } catch (e) {
    console.error("FATAL:", e.message || e);
    process.exit(2);
  }
  console.log(`\n=== Итог: ${passed} ✓  ${failed} ✗ ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
