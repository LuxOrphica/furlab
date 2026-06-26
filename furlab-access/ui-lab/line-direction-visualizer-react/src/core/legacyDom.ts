export type LegacyDebugFlag = "contour" | "lineMask" | "edgeDistance" | "bbox" | "controlPoints" | "napArrow" | "mmGrid";
export type LegacySelectKind = "material" | "storage" | "quality";
export type LegacyAction =
  | "pickScan"
  | "pickScanV1"
  | "pickScanV2"
  | "pickScanV3"
  | "contourEditToggle"
  | "contourDraftReset"
  | "contourDraftApply"
  | "clear"
  | "save"
  | "saveTraining"
  | "zoomIn"
  | "zoomOut";

type LegacyBridge = {
  setMode?: (mode: "auto" | "manual") => void;
  setUploadChecked?: (checked: boolean) => void;
  setDebugFlag?: (flag: LegacyDebugFlag, checked: boolean) => void;
  setZoom?: (zoom: number) => void;
  setManualInventoryTag?: (value: string) => void;
  setSelectValue?: (kind: LegacySelectKind, value: string) => void;
  setNote?: (value: string) => void;
  clickAction?: (action: LegacyAction) => void;
  refreshView?: () => void;
  notifyState?: () => void;
};

export function getLegacyBridge(): LegacyBridge | null {
  const w = window as Window & { __ldvBridge?: LegacyBridge };
  return w.__ldvBridge || null;
}

export function triggerLegacyAction(action: LegacyAction) {
  getLegacyBridge()?.clickAction?.(action);
}

export function setLegacyMode(next: "auto" | "manual") {
  getLegacyBridge()?.setMode?.(next);
}

export function setLegacyUploadChecked(checked: boolean) {
  getLegacyBridge()?.setUploadChecked?.(checked);
}

export function setLegacyDebugFlag(flag: LegacyDebugFlag, checked: boolean) {
  getLegacyBridge()?.setDebugFlag?.(flag, checked);
}

export function setLegacySelectValue(kind: LegacySelectKind, value: string) {
  getLegacyBridge()?.setSelectValue?.(kind, value);
}

export function setLegacyZoom(next: number) {
  const safe = Math.max(1, Math.min(300, Math.round(next)));
  getLegacyBridge()?.setZoom?.(safe);
}

export function setLegacyNote(value: string) {
  getLegacyBridge()?.setNote?.(String(value || ""));
}

export function setLegacyManualInventoryTag(value: string) {
  getLegacyBridge()?.setManualInventoryTag?.(String(value || ""));
}

export function refreshLegacyView() {
  getLegacyBridge()?.refreshView?.();
}
