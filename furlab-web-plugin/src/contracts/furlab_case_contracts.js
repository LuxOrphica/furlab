"use strict";

const invariant = require("tiny-invariant");
const { z } = require("zod");

const finiteNumber = z.number().finite();
const coerceFiniteNumber = z.coerce.number().finite();
const nonNegativeNumber = finiteNumber.min(0);
const layoutTypeSchema = z.enum([
  "longitudinal",
  "radial",
  "shifted",
  "transverse",
  "intarsia",
  "inventory_direct",
  "inventory_manual",
  "inventory_split_return",
  "inventory_nfp_sa",
  "inventory_tiling",
  "inventory_voronoi_sa",
  "voronoi_tiles",
]);

const pointSchema = z.object({
  x: finiteNumber,
  y: finiteNumber,
}).strict();

const apiPointSchema = z.object({
  x: coerceFiniteNumber,
  y: coerceFiniteNumber,
}).passthrough();

const pointListSchema = z.array(pointSchema).min(3);
const apiPointListSchema = z.array(apiPointSchema).min(3);
const optionalContourSchema = z.union([
  z.array(pointSchema).length(0),
  pointListSchema,
  z.null(),
]).optional();

const zoneSchema = z.object({
  id: z.union([z.string().min(1), z.number().finite()]),
  points: pointListSchema,
}).passthrough();

const apiZoneSchema = z.object({
  id: z.union([z.string().min(1), z.number().finite()]).optional(),
  points: apiPointListSchema,
}).passthrough();

const modeRequestSchema = z.object({
  layoutType: z.string().min(1),
  zone: zoneSchema,
  inputs: z.record(z.string(), z.unknown()).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  seed: finiteNumber,
}).passthrough();

const modePreviewApiRequestSchema = z.object({
  layoutType: layoutTypeSchema,
  zone: apiZoneSchema,
  inputs: z.record(z.string(), z.unknown()).optional().default({}),
  options: z.record(z.string(), z.unknown()).optional().default({}),
  seed: coerceFiniteNumber.nullish(),
}).passthrough();

const modeExpectSchema = z.object({
  httpStatus: z.number().int().min(100).max(599).optional(),
  ok: z.boolean().optional(),
  layoutType: z.string().min(1).optional(),
  resultStatusIn: z.array(z.string().min(1)).min(1).optional(),
  minRenderItems: z.number().int().min(0).optional(),
}).passthrough();

const modeCaseSchema = z.object({
  name: z.string().min(1),
  request: modeRequestSchema,
  expect: modeExpectSchema,
}).strict();

const splitReusePieceSchema = z.object({
  id: z.union([z.string().min(1), z.number().finite()]),
  areaMm2: nonNegativeNumber.optional(),
  points: pointListSchema,
}).passthrough();

const splitReuseCaseSchema = z.object({
  name: z.string().min(1),
  seed: finiteNumber,
  zone: zoneSchema,
  params: z.record(z.string(), z.unknown()).optional(),
  pieces: z.array(splitReusePieceSchema).min(1),
}).strict();

const baselineMetricSchema = z.object({
  coveragePercent: nonNegativeNumber.max(100),
  pieces: z.number().int().min(0),
  overlapAreaMm2: nonNegativeNumber,
  utilizationPct: nonNegativeNumber.max(100),
  timeMs: nonNegativeNumber,
}).strict();

const inventorySplitBaselineSchema = z.record(
  z.string().min(1),
  baselineMetricSchema
);

const renderItemSchema = z.object({
  id: z.string().min(1),
  contour: pointListSchema,
  closed: z.literal(true),
  renderIndex: finiteNumber,
  meta: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

const renderOutputSchema = z.object({
  renderOrderPolicy: z.string().min(1).optional(),
  stackOrderPolicy: z.string().min(1).optional(),
  solveOrder: z.array(z.string()).optional(),
  itemCount: z.number().int().min(0).optional(),
  items: z.array(renderItemSchema),
}).passthrough().superRefine((value, ctx) => {
  if (
    Object.prototype.hasOwnProperty.call(value, "itemCount") &&
    Number(value.itemCount) !== value.items.length
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["itemCount"],
      message: "must match render.items.length",
    });
  }
});

const fragmentSchema = z.object({
  id: z.union([z.string().min(1), z.number().finite()]),
  points: pointListSchema,
  areaMm2: nonNegativeNumber.optional(),
}).passthrough();

const optionalFiniteNumberSchema = z.union([finiteNumber, z.null()]).optional();
const placementSchema = z.object({
  placementId: z.union([z.string().min(1), z.number().finite()]).optional(),
  fragmentId: z.union([z.string().min(1), z.number().finite()]).optional(),
  scrapPieceId: z.union([z.string().min(1), z.number().finite(), z.null()]).optional(),
  inventoryTag: z.union([z.string().min(1), z.number().finite(), z.null()]).optional(),
  status: z.string().min(1),
  alignedContour: optionalContourSchema,
  alignedCoreContour: optionalContourSchema,
  inZoneContour: optionalContourSchema,
  inZoneCoreContour: optionalContourSchema,
  fragmentContour: optionalContourSchema,
  usedVisibleContour: optionalContourSchema,
  fragmentAreaMm2: optionalFiniteNumberSchema,
  scrapAreaMm2: optionalFiniteNumberSchema,
  usedVisibleAreaMm2: optionalFiniteNumberSchema,
  inZoneAreaMm2: optionalFiniteNumberSchema,
  inZoneCoreAreaMm2: optionalFiniteNumberSchema,
  solveOrder: optionalFiniteNumberSchema,
  solveIndex: optionalFiniteNumberSchema,
  renderIndex: optionalFiniteNumberSchema,
}).passthrough().superRefine((value, ctx) => {
  const identity = String(
    value.placementId ||
    value.fragmentId ||
    value.scrapPieceId ||
    value.inventoryTag ||
    ""
  ).trim();
  if (!identity) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["identity"],
      message: "is required",
    });
  }
  if (String(value.status || "") === "matched") {
    const contour = value.alignedContour;
    if (!Array.isArray(contour) || contour.length < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["alignedContour"],
        message: "must contain at least 3 points for matched placements",
      });
    }
  }
});

const placementListSchema = z.array(placementSchema).superRefine((placements, ctx) => {
  const ids = new Set();
  for (let i = 0; i < placements.length; i++) {
    const id = String(
      placements[i].placementId ||
      placements[i].fragmentId ||
      placements[i].scrapPieceId ||
      placements[i].inventoryTag ||
      ""
    ).trim();
    if (!id) continue;
    if (ids.has(id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [i, "identity"],
        message: "must be unique",
      });
    }
    ids.add(id);
  }
});

const modePreviewResponseSchema = z.object({
  ok: z.boolean(),
  layoutType: layoutTypeSchema,
  modeVersion: z.string().min(1).optional(),
  resultStatus: z.string().min(1),
  warnings: z.array(z.string()).optional(),
  failedReason: z.union([z.string(), z.null()]).optional(),
  stats: z.record(z.string(), z.unknown()).optional(),
  render: renderOutputSchema,
  fragments: z.array(fragmentSchema).optional(),
  placements: placementListSchema.optional(),
  diagnostics: z.union([z.record(z.string(), z.unknown()), z.null()]).optional(),
  debug: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

function formatZodIssues(issues) {
  return issues
    .map((issue) => {
      const loc = issue.path.length ? issue.path.join(".") : "<root>";
      return `${loc}: ${issue.message}`;
    })
    .join("; ");
}

function assertValidJsonContract(schema, value, label) {
  const result = schema.safeParse(value);
  invariant(
    result.success,
    `${label || "JSON contract"} failed validation: ${
      result.success ? "" : formatZodIssues(result.error.issues)
    }`
  );
  return result.data;
}

function parseModePreviewApiRequest(value) {
  const result = modePreviewApiRequestSchema.safeParse(value);
  if (!result.success) {
    return {
      ok: false,
      error: formatZodIssues(result.error.issues),
      issues: result.error.issues,
    };
  }
  const parsed = result.data;
  const rawHoles = Array.isArray(parsed.zone.holes) ? parsed.zone.holes : [];
  const zoneHoles = rawHoles
    .filter((h) => Array.isArray(h) && h.length >= 3)
    .map((h) => h.map((p) => ({ x: Number(p && p.x), y: Number(p && p.y) })));
  return {
    ok: true,
    value: {
      layoutType: parsed.layoutType,
      zoneId: parsed.zone.id,
      zonePoints: parsed.zone.points.map((p) => ({ x: p.x, y: p.y })),
      zoneHoles,
      inputs: parsed.inputs || {},
      options: parsed.options || {},
      seed: parsed.seed == null ? null : parsed.seed,
    },
  };
}

module.exports = {
  layoutTypeSchema,
  pointSchema,
  apiPointSchema,
  pointListSchema,
  apiPointListSchema,
  renderItemSchema,
  renderOutputSchema,
  fragmentSchema,
  placementSchema,
  placementListSchema,
  modePreviewResponseSchema,
  zoneSchema,
  apiZoneSchema,
  modeRequestSchema,
  modePreviewApiRequestSchema,
  modeExpectSchema,
  modeCaseSchema,
  splitReuseCaseSchema,
  inventorySplitBaselineSchema,
  assertValidJsonContract,
  parseModePreviewApiRequest,
};
