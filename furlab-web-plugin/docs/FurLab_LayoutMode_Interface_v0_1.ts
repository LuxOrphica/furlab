// FurLab Layout Mode Plugin Interface (TypeScript) - v0.2
// Контракт типов между UI/router и реализациями режимов.

export type Point = { x: number; y: number };

export type ZoneInput = {
  id: string | number;
  points: Point[];
};

export type LayoutType =
  | "longitudinal"
  | "transverse"
  | "intarsia"
  | "inventory_direct"
  | "inventory_manual";

export type PreviewWrapperRequest = {
  layoutType: LayoutType;
  zone: ZoneInput;
  inputs?: Record<string, unknown>;
  options?: Record<string, unknown>;
  seed?: number;
};

export type RenderOrderPolicy =
  | "phase_priority"
  | "solve_order"
  | "last_on_top"
  | "first_on_top";

export type RenderItem = {
  id: string;
  contour: Point[];
  closed: boolean;
  renderIndex: number;
  meta?: Record<string, unknown>;
};

export type PreviewWrapperResponse = {
  ok: boolean;
  layoutType: LayoutType;
  modeVersion: string;

  resultStatus: "ok" | "needs_attention" | "failed";
  warnings?: string[];
  failedReason?: string | null;

  stats?: Record<string, unknown>;

  render: {
    renderOrderPolicy: RenderOrderPolicy;
    stackOrderPolicy: RenderOrderPolicy;
    solveOrder: string[];
    items: RenderItem[];
  };

  debug?: Record<string, unknown>;
};

export type ApplyWrapperRequest = {
  layoutType: LayoutType;
  zoneId: string | number;
  previewToken?: string;
  preview?: PreviewWrapperResponse;
};

export type ApplyWrapperResponse = {
  ok: boolean;
  layoutRunId?: string;
  warnings?: string[];
};

export type ModeDescriptor = {
  layoutType: LayoutType;
  modeVersion: string;
  displayName: string;
  supportsPreview: boolean;
  supportsApply: boolean;
};

export interface ILayoutMode {
  getDescriptor(): ModeDescriptor;

  validatePreview(req: PreviewWrapperRequest): { ok: boolean; error?: string };

  preview(req: PreviewWrapperRequest): Promise<PreviewWrapperResponse>;

  apply(req: ApplyWrapperRequest): Promise<ApplyWrapperResponse>;
}
