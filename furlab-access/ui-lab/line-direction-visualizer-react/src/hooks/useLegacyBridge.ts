import { useEffect, useRef } from "react";
import type { Dispatch } from "react";
import { startLegacyCore } from "../legacy/bootstrap";
import { ApiClient, normalizeDictRows } from "../core/api";
import { getLegacyBridge } from "../core/legacyDom";
import type { Mode, UiAction } from "../core/uiState";

type UseLegacyBridgeArgs = {
  dispatch: Dispatch<UiAction>;
  setSaveDisabled: (next: boolean) => void;
  setClearDisabled: (next: boolean) => void;
  setSaveStatusUi: (kind: string, message: string) => void;
  setScanStatusUi: (kind: string, message: string) => void;
};

export function useLegacyBridge({ dispatch, setSaveDisabled, setClearDisabled, setSaveStatusUi, setScanStatusUi }: UseLegacyBridgeArgs) {
  const lastLegacyStateSig = useRef("");
  const lastSaveStatusSig = useRef("");

  useEffect(() => {
    let cancelled = false;
    const disposers: Array<() => void> = [];
    const w = window as Window & {
      __ldvFlags?: { disableLegacyTheme?: boolean; disableLegacyApi?: boolean; disableLegacyDomSync?: boolean };
      __ldvSetApiState?: (apiOk: boolean, dictsOk: boolean) => void;
    };

    const setSaveStatus = (kind: string, message: string) => setSaveStatusUi(kind, message);

    const setLegacyApiState = (apiOk: boolean, dictsOk: boolean) => {
      if (typeof w.__ldvSetApiState === "function") w.__ldvSetApiState(apiOk, dictsOk);
    };

    const onLegacyState = (ev: Event) => {
      const detail = (ev as CustomEvent<Record<string, unknown>>).detail || {};
      const mode: Mode = detail.mode === "manual" ? "manual" : "auto";
      const uploadChecked = !!detail.uploadChecked;

      const debugRaw = (detail.debug || {}) as Record<string, unknown>;
      const debug = {
        contour: !!debugRaw.contour,
        lineMask: !!debugRaw.lineMask,
        edgeDistance: !!debugRaw.edgeDistance,
        bbox: !!debugRaw.bbox,
        controlPoints: !!debugRaw.controlPoints,
        napArrow: debugRaw.napArrow === undefined ? true : !!debugRaw.napArrow,
        mmGrid: !!debugRaw.mmGrid,
      };

      const selects = (detail.selects || {}) as Record<string, unknown>;
      const noteValue = String(detail.noteValue || "");
      const outputText = String(detail.outputText || "");
      const zoom = Number(detail.zoomPercent || 100) || 100;
      const buttons = (detail.buttons || {}) as Record<string, unknown>;
      const pieceRaw = (detail.pieceView || {}) as Record<string, unknown>;
      const validationRaw = (detail.validation || {}) as Record<string, unknown>;
      const fileName = String(detail.fileName || "(файл не выбран)");
      const validation = {
        invMissing: !!validationRaw.invMissing,
        materialMissing: !!validationRaw.materialMissing,
        qualityMissing: !!validationRaw.qualityMissing,
        napMissing: !!validationRaw.napMissing,
        noteRequired: !!validationRaw.noteRequired,
        noteMissing: !!validationRaw.noteMissing,
        canSave: typeof validationRaw.canSave === "boolean" ? !!validationRaw.canSave : !buttons.saveDisabled,
      };

      const payload = {
        mode,
        uploadChecked,
        debug,
        materialValue: String(selects.materialValue || ""),
        storageValue: String(selects.storageValue || ""),
        qualityValue: String(selects.qualityValue || ""),
        noteValue,
        fileName,
        outputText,
        zoomPercent: Math.max(1, Math.min(300, Math.round(zoom))),
        pieceView: {
          invTag: String(pieceRaw.invTag || "-"),
          areaMm2: String(pieceRaw.areaMm2 || "-"),
          bboxWidthMm: String(pieceRaw.bboxWidthMm || "-"),
          bboxHeightMm: String(pieceRaw.bboxHeightMm || "-"),
          maxSpanMm: String(pieceRaw.maxSpanMm || "-"),
          napDeg: String(pieceRaw.napDeg || "-"),
        },
        validation,
      };

      const signature = JSON.stringify({
        ...payload,
        saveDisabled: !!buttons.saveDisabled,
        clearDisabled: !!buttons.clearDisabled,
      });
      if (signature === lastLegacyStateSig.current) return;
      lastLegacyStateSig.current = signature;

      dispatch({
        type: "sync_legacy_state",
        payload,
      });

      setSaveDisabled(!!buttons.saveDisabled);
      setClearDisabled(!!buttons.clearDisabled);
    };

    const onLegacySaveStatus = (ev: Event) => {
      const detail = (ev as CustomEvent<Record<string, unknown>>).detail || {};
      const kind = String(detail.kind || "");
      const message = String(detail.message || "");
      const sig = `${kind}\n${message}`;
      if (sig === lastSaveStatusSig.current) return;
      lastSaveStatusSig.current = sig;
      setSaveStatusUi(kind, message);
    };

    const onLegacyScanStatus = (ev: Event) => {
      const detail = (ev as CustomEvent<Record<string, unknown>>).detail || {};
      const kind = String(detail.kind || "");
      const message = String(detail.message || "");
      setScanStatusUi(kind, message);
    };

    const loadDictionaries = async () => {
      const api = new ApiClient();
      const { ok, status, json } = await api.dicts();
      if (!ok) {
        setLegacyApiState(true, false);
        setSaveStatus("warn", `Не загружены справочники: ${String(json.error || `HTTP ${status}`)}`);
        return;
      }

      const materialRows = normalizeDictRows(
        json.materials,
        ["idVal", "id", "materialId", "ID"],
        ["materialName", "name", "label", "descr", "code"]
      );
      const locationRows = normalizeDictRows(
        json.locations,
        ["idVal", "id", "locationId", "ID"],
        ["locCode", "code", "locationCode", "name", "label"]
      );
      const qualityRows = normalizeDictRows(
        json.qualities,
        ["code", "id", "value"],
        ["descr", "name", "label", "code"]
      );

      dispatch({
        type: "set_selects",
        payload: {
          materialOptions: materialRows.length ? materialRows : [{ value: "", label: "(выбери)" }],
          storageOptions: locationRows.length ? locationRows : [{ value: "", label: "(не размещен)" }],
          qualityOptions: qualityRows,
          materialValue: "",
          storageValue: "",
          qualityValue: "",
        },
      });

      const dictsOk = materialRows.length > 0 && qualityRows.length > 0;
      setLegacyApiState(true, dictsOk);
      setSaveStatus(dictsOk ? "" : "warn", dictsOk ? "" : "Справочники неполные");
    };

    const initApi = async () => {
      const api = new ApiClient();
      try {
        const health = await api.health();
        if (!health.ok) {
          setLegacyApiState(false, false);
          setSaveStatus("warn", "API недоступен: запусти node tools/ui_lab_server.js");
          return;
        }
        await loadDictionaries();
      } catch {
        setLegacyApiState(false, false);
        setSaveStatus("warn", "API недоступен: запусти node tools/ui_lab_server.js");
      }
    };

    w.__ldvFlags = {
      ...(w.__ldvFlags || {}),
      disableLegacyTheme: true,
      disableLegacyApi: true,
      disableLegacyDomSync: true,
    };

    document.documentElement.removeAttribute("data-theme");
    ["win98-css", "winxp-css", "pico-css"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });

    startLegacyCore()
      .then(() => {
        if (cancelled) return;

        window.addEventListener("ldv:state", onLegacyState as EventListener);
        disposers.push(() => window.removeEventListener("ldv:state", onLegacyState as EventListener));
        window.addEventListener("ldv:save-status", onLegacySaveStatus as EventListener);
        disposers.push(() => window.removeEventListener("ldv:save-status", onLegacySaveStatus as EventListener));
        window.addEventListener("ldv:scan-status", onLegacyScanStatus as EventListener);
        disposers.push(() => window.removeEventListener("ldv:scan-status", onLegacyScanStatus as EventListener));

        getLegacyBridge()?.notifyState?.();
        void initApi();
      })
      .catch((err) => console.error(err));

    return () => {
      cancelled = true;
      for (const dispose of disposers) dispose();
    };
  }, [dispatch, setSaveDisabled, setClearDisabled, setSaveStatusUi]);
}
