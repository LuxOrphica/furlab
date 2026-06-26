import type { Opt } from "./uiState";

function normalizeBaseUrl(u: string): string {
  return String(u || "").trim().replace(/\/+$/, "");
}

function getEnvApiBase(): string {
  return normalizeBaseUrl(String((import.meta as { env?: Record<string, unknown> }).env?.VITE_API_BASE_URL || ""));
}

export function getPreferredApiBase(): string {
  const envBase = getEnvApiBase();
  if (envBase) return envBase;
  return "";
}
function buildApiBases(): string[] {
  const out: string[] = [];
  const push = (u: string) => {
    const s = normalizeBaseUrl(u);
    if (!out.includes(s)) out.push(s);
  };
  const envBase = getEnvApiBase();
  if (envBase) {
    // In configured environments use explicit base only.
    push(envBase);
    return out;
  }

  const proto = window.location.protocol === "https:" ? "https" : "http";
  push("");
  push(`${proto}://${window.location.hostname}:5500`);
  push(`${proto}://localhost:5500`);
  push(`${proto}://127.0.0.1:5500`);
  push(`${proto}://${window.location.hostname}:5501`);
  push(`${proto}://localhost:5501`);
  push(`${proto}://127.0.0.1:5501`);
  return out;
}

export class ApiClient {
  private apiBase = getEnvApiBase();

  private async apiFetch(path: string, options?: RequestInit): Promise<Response> {
    if (this.apiBase) return fetch(`${this.apiBase}${path}`, options);
    let lastErr: unknown = null;
    const tried: string[] = [];
    for (const base of buildApiBases()) {
      tried.push(base);
      try {
        const res = await fetch(`${base}${path}`, options);
        const contentType = String(res.headers.get("content-type") || "").toLowerCase();
        if (!contentType.includes("application/json")) {
          lastErr = new Error(`non_json_response_from_${base || "same_origin"}`);
          // Same-origin proxy is reachable — don't fall through to direct-port URLs
          // that won't work from external/HTTPS contexts (e.g. zrok). Pin and surface.
          if (base === "") { this.apiBase = base; throw lastErr; }
          continue;
        }
        this.apiBase = base;
        return res;
      } catch (e) {
        lastErr = e;
      }
    }
    const reason = lastErr instanceof Error ? lastErr.message : String(lastErr || "");
    throw new Error(`api_unreachable: ${reason || "fetch_failed"}; tried=${tried.join(",")}`);
  }

  async health(): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
    const res = await this.apiFetch("/api/health", { method: "GET" });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: !!(res.ok && json.ok), status: res.status, json };
  }

  async dicts(forceRefresh = false): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
    const res = await this.apiFetch(forceRefresh ? "/api/dicts?refresh=1" : "/api/dicts", { method: "GET" });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: !!(res.ok && json.ok), status: res.status, json };
  }

  async registry(params: {
    page?: number;
    pageSize?: number;
    q?: string;
    quality?: string;
    status?: string;
    materialId?: string;
    storageLocationId?: string;
    sortBy?: string;
    sortDir?: "asc" | "desc";
    refresh?: boolean;
  }): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
    const timed = await this.registryTimed(params);
    return { ok: timed.ok, status: timed.status, json: timed.json };
  }

  async registryTimed(params: {
    page?: number;
    pageSize?: number;
    q?: string;
    quality?: string;
    status?: string;
    materialId?: string;
    storageLocationId?: string;
    sortBy?: string;
    sortDir?: "asc" | "desc";
    refresh?: boolean;
  }): Promise<{
    ok: boolean;
    status: number;
    json: Record<string, unknown>;
    timings: { requestMs: number; jsonMs: number; totalMs: number };
  }> {
    const sp = new URLSearchParams();
    if (params.page) sp.set("page", String(params.page));
    if (params.pageSize) sp.set("pageSize", String(params.pageSize));
    if (params.q) sp.set("q", params.q);
    if (params.quality) sp.set("quality", params.quality);
    if (params.status) sp.set("status", params.status);
    if (params.materialId) sp.set("materialId", params.materialId);
    if (params.storageLocationId) sp.set("storageLocationId", params.storageLocationId);
    if (params.sortBy) sp.set("sortBy", params.sortBy);
    if (params.sortDir) sp.set("sortDir", params.sortDir);
    if (params.refresh) sp.set("refresh", "1");
    const qs = sp.toString();
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const res = await this.apiFetch(`/api/registry${qs ? `?${qs}` : ""}`, { method: "GET" });
    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const t2 = typeof performance !== "undefined" ? performance.now() : Date.now();
    return {
      ok: !!(res.ok && json.ok),
      status: res.status,
      json,
      timings: {
        requestMs: Math.max(0, Math.round(t1 - t0)),
        jsonMs: Math.max(0, Math.round(t2 - t1)),
        totalMs: Math.max(0, Math.round(t2 - t0)),
      },
    };
  }

  async pieceById(
    id: string,
    options?: { includeReservation?: boolean; includeHistory?: boolean; lite?: boolean; refresh?: boolean; force?: boolean }
  ): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
    const safe = encodeURIComponent(String(id || "").trim());
    const sp = new URLSearchParams();
    if (options?.includeReservation) sp.set("includeReservation", "1");
    if (options?.includeHistory) sp.set("includeHistory", "1");
    if (options?.lite) sp.set("lite", "1");
    if (options?.refresh) sp.set("refresh", "1");
    if (options?.force) sp.set("force", "1");
    const qs = sp.toString();
    const res = await this.apiFetch(`/api/piece/${safe}${qs ? `?${qs}` : ""}`, { method: "GET" });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: !!(res.ok && json.ok), status: res.status, json };
  }

  async pieceContourById(id: string): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
    const timed = await this.pieceContourByIdTimed(id);
    return { ok: timed.ok, status: timed.status, json: timed.json };
  }

  async pieceContourByIdTimed(id: string): Promise<{
    ok: boolean;
    status: number;
    json: Record<string, unknown>;
    timings: { requestMs: number; jsonMs: number; totalMs: number };
  }> {
    const safe = encodeURIComponent(String(id || "").trim());
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const res = await this.apiFetch(`/api/piece/${safe}/contour`, { method: "GET" });
    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const t2 = typeof performance !== "undefined" ? performance.now() : Date.now();
    return {
      ok: !!(res.ok && json.ok),
      status: res.status,
      json,
      timings: {
        requestMs: Math.max(0, Math.round(t1 - t0)),
        jsonMs: Math.max(0, Math.round(t2 - t1)),
        totalMs: Math.max(0, Math.round(t2 - t0)),
      },
    };
  }

  async pieceReservationById(id: string): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
    const safe = encodeURIComponent(String(id || "").trim());
    const res = await this.apiFetch(`/api/piece/${safe}/reservation`, { method: "GET" });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: !!(res.ok && json.ok), status: res.status, json };
  }

  async pieceHistoryById(id: string): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
    const safe = encodeURIComponent(String(id || "").trim());
    const res = await this.apiFetch(`/api/piece/${safe}/history`, { method: "GET" });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: !!(res.ok && json.ok), status: res.status, json };
  }

  async usageHistoryAll(): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
    const res = await this.apiFetch("/api/history/usage", { method: "GET" });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: !!(res.ok && json.ok), status: res.status, json };
  }

  async pieceStatusTransition(
    id: string,
    action: "reserve" | "release" | "use",
    payload?: { userName?: string; note?: string }
  ): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
    const safe = encodeURIComponent(String(id || "").trim());
    const act = encodeURIComponent(String(action || "").trim().toLowerCase());
    const res = await this.apiFetch(`/api/piece/${safe}/${act}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: !!(res.ok && json.ok), status: res.status, json };
  }

  async pieceUpdateById(
    id: string,
    payload: { materialId?: string; storageLocationId?: string; scrapQuality?: string; note?: string }
  ): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
    const safe = encodeURIComponent(String(id || "").trim());
    const res = await this.apiFetch(`/api/piece/${safe}/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: !!(res.ok && json.ok), status: res.status, json };
  }
}

function pickFirst(obj: unknown, keys: string[], fallback = ""): string {
  if (!obj || typeof obj !== "object") return fallback;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
  }
  return fallback;
}

export function normalizeDictRows(rows: unknown, valueKeys: string[], labelKeys: string[]): Opt[] {
  if (!Array.isArray(rows)) return [];
  const out: Opt[] = [];
  for (const r of rows) {
    const value = pickFirst(r, valueKeys, "");
    const label = pickFirst(r, labelKeys, value);
    if (!value) continue;
    out.push({ value, label });
  }
  return out;
}

