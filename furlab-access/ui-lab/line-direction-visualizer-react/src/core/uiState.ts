export type Opt = { value: string; label: string };
export type Mode = "auto" | "manual";

export type DebugState = {
  contour: boolean;
  lineMask: boolean;
  edgeDistance: boolean;
  bbox: boolean;
  controlPoints: boolean;
  napArrow: boolean;
  mmGrid: boolean;
};

export type UiState = {
  mode: Mode;
  uploadChecked: boolean;
  debug: DebugState;
  materialOptions: Opt[];
  storageOptions: Opt[];
  qualityOptions: Opt[];
  materialValue: string;
  storageValue: string;
  qualityValue: string;
  noteValue: string;
  fileName: string;
  outputText: string;
  zoomPercent: number;
  pieceView: {
    invTag: string;
    areaMm2: string;
    bboxWidthMm: string;
    bboxHeightMm: string;
    maxSpanMm: string;
    napDeg: string;
  };
  validation: {
    invMissing: boolean;
    materialMissing: boolean;
    qualityMissing: boolean;
    napMissing: boolean;
    noteRequired: boolean;
    noteMissing: boolean;
    canSave: boolean;
  };
};

export type UiAction =
  | { type: "set_mode"; payload: Mode }
  | { type: "set_upload_checked"; payload: boolean }
  | { type: "set_debug"; payload: DebugState }
  | { type: "patch_debug"; payload: Partial<DebugState> }
  | {
      type: "set_selects";
      payload: {
        materialOptions: Opt[];
        storageOptions: Opt[];
        qualityOptions: Opt[];
        materialValue: string;
        storageValue: string;
        qualityValue: string;
      };
    }
  | { type: "set_material_value"; payload: string }
  | { type: "set_storage_value"; payload: string }
  | { type: "set_quality_value"; payload: string }
  | { type: "set_note_value"; payload: string }
  | { type: "set_zoom"; payload: number }
  | {
      type: "sync_legacy_state";
      payload: {
        mode: Mode;
        uploadChecked: boolean;
        debug: DebugState;
        materialValue: string;
        storageValue: string;
        qualityValue: string;
        noteValue: string;
        fileName: string;
        outputText: string;
        zoomPercent: number;
        pieceView: {
          invTag: string;
          areaMm2: string;
          bboxWidthMm: string;
          bboxHeightMm: string;
          maxSpanMm: string;
          napDeg: string;
        };
        validation: {
          invMissing: boolean;
          materialMissing: boolean;
          qualityMissing: boolean;
          napMissing: boolean;
          noteRequired: boolean;
          noteMissing: boolean;
          canSave: boolean;
        };
      };
    };

export const uiInitialState: UiState = {
  mode: "auto",
  uploadChecked: true,
  debug: {
    contour: true,
    lineMask: false,
    edgeDistance: false,
    bbox: false,
    controlPoints: true,
    napArrow: true,
    mmGrid: true,
  },
  materialOptions: [{ value: "", label: "(выбери)" }],
  storageOptions: [{ value: "", label: "(не размещен)" }],
  qualityOptions: [],
  materialValue: "",
  storageValue: "",
  qualityValue: "",
  noteValue: "",
  fileName: "(файл не выбран)",
  outputText:
    "Шаги:\n1) Загрузи скан.\n2) В режиме \"Авто\" система пытается сама найти отрезок P1->P2 на мездре.\n3) Если авто не сработало, переключись в \"Ручной\" и поставь 2 точки.\n4) Направление считается от P1->P2.",
  zoomPercent: 100,
  pieceView: {
    invTag: "-",
    areaMm2: "-",
    bboxWidthMm: "-",
    bboxHeightMm: "-",
    maxSpanMm: "-",
    napDeg: "-",
  },
  validation: {
    invMissing: false,
    materialMissing: false,
    qualityMissing: false,
    napMissing: false,
    noteRequired: false,
    noteMissing: false,
    canSave: false,
  },
};

export function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case "set_mode":
      return { ...state, mode: action.payload };
    case "set_upload_checked":
      return { ...state, uploadChecked: action.payload };
    case "set_debug":
      return { ...state, debug: action.payload };
    case "patch_debug":
      return { ...state, debug: { ...state.debug, ...action.payload } };
    case "set_selects":
      return {
        ...state,
        materialOptions: action.payload.materialOptions,
        storageOptions: action.payload.storageOptions,
        qualityOptions: action.payload.qualityOptions,
        materialValue: action.payload.materialValue,
        storageValue: action.payload.storageValue,
        qualityValue: action.payload.qualityValue,
      };
    case "set_material_value":
      return { ...state, materialValue: action.payload };
    case "set_storage_value":
      return { ...state, storageValue: action.payload };
    case "set_quality_value":
      return { ...state, qualityValue: action.payload };
    case "set_note_value":
      return { ...state, noteValue: action.payload };
    case "set_zoom":
      return { ...state, zoomPercent: Math.max(1, Math.min(300, Math.round(action.payload))) };
    case "sync_legacy_state":
      return {
        ...state,
        mode: action.payload.mode,
        uploadChecked: action.payload.uploadChecked,
        debug: action.payload.debug,
        materialValue: action.payload.materialValue,
        storageValue: action.payload.storageValue,
        qualityValue: action.payload.qualityValue,
        noteValue: action.payload.noteValue,
        fileName: action.payload.fileName,
        outputText: action.payload.outputText,
        zoomPercent: Math.max(1, Math.min(300, Math.round(action.payload.zoomPercent))),
        pieceView: action.payload.pieceView,
        validation: action.payload.validation,
      };
    default:
      return state;
  }
}
