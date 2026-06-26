// Extracted from app.js (engineering style preset)
(function (global) {
  const ENGINEERING_STYLES = {
    pattern: {
      stroke: "rgba(88,94,102,0.58)",
      strokeWidth: 0.95,
      selectedStroke: "rgba(24,28,34,0.92)",
      selectedStrokeWidth: 1.35
    },
    zones: {
      stroke: "rgba(40,106,196,0.88)",
      strokeWidth: 1.2,
      fill: "rgba(40,106,196,0.06)",
      selectedStroke: "rgba(23,80,163,0.98)",
      selectedStrokeWidth: 1.6,
      selectedFill: "rgba(40,106,196,0.12)",
      activeEditStroke: "rgba(9,71,145,1)",
      activeEditStrokeWidth: 1.9,
      activeEditFill: "rgba(40,106,196,0.20)"
    },
    selection: { stroke: "#1B1B1B", strokeWidth: 1.5, pointFill: "#1B1B1B" },
    guides: {
      stroke: "rgba(169,174,177,0.40)",
      strokeWidth: 0.75,
      minorStroke: "rgba(169,174,177,0.22)",
      majorStroke: "rgba(169,174,177,0.42)",
      minorWidth: 0.75,
      majorWidth: 1.0
    },
    fragments: {
      stroke: "#0076D6",
      strokeWidth: 1.25,
      fill: "rgba(0,118,214,0.08)",
      selectedStroke: "#0050A0",
      selectedStrokeWidth: 1.5,
      selectedFill: "rgba(0,118,214,0.18)"
    },
    seams: { stroke: "#005EA2", strokeWidth: 1.5, dash: [10, 4, 2, 4] },
    allowances: { stroke: "rgba(189,87,39,0.9)", strokeWidth: 1.2, fill: "rgba(0,0,0,0)", dash: [6, 3] },
    inventoryContours: {
      stroke: "rgba(189,87,39,0.85)",
      strokeWidth: 1.0,
      fill: "rgba(189,87,39,0.06)",
      selectedStroke: "#914734",
      selectedStrokeWidth: 1.4,
      selectedFill: "rgba(189,87,39,0.12)"
    },
    usedPart: { stroke: "#914734", strokeWidth: 1.25, fill: "rgba(145,71,52,0.10)", selectedStrokeWidth: 1.6 },
    splitLeftovers: { stroke: "rgba(247,188,162,0.85)", strokeWidth: 1.0, dash: [4, 4], fill: "rgba(247,188,162,0.10)" },
    coverageHoles: { stroke: "#C05600", strokeWidth: 1.25, fill: "rgba(255,190,46,0.22)" },
    visibleArea: { stroke: "#FFBE2E", strokeWidth: 1.0, fill: "rgba(255,190,46,0.12)" },
    intersections: { stroke: "#D54309", strokeWidth: 1.5, fill: "rgba(213,67,9,0.18)" },
    napArrow: { stroke: "#5a5a5a", fill: "#5a5a5a", strokeWidth: 1.5 },
    smartCloseBridge: { stroke: "#ef4444", strokeWidth: 2, dash: [6, 4] },
    manualActivePiece: { stroke: "#6B7280", strokeWidth: 2, dash: [8, 5], fill: "rgba(107,114,128,0.10)" },
    manualGainOk: { stroke: "#0a7d2e", strokeWidth: 2, fill: "rgba(10,125,46,0.14)" },
    manualGainTiny: { stroke: "#b42318", strokeWidth: 2, fill: "rgba(180,35,24,0.12)" },
    fragmentOverlay: { stroke: "#6a6a6a", strokeWidth: 2, dash: [5, 4], fill: "rgba(120,120,120,0.15)" }
  };

  global.FurLabStyles = Object.assign({}, global.FurLabStyles || {}, { ENGINEERING_STYLES });
})(window);
