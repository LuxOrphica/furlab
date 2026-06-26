function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pickFirst(obj, keys, fallback = "") {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== "") {
      return String(obj[k]);
    }
  }
  return fallback;
}

function normalizeDictRows(rows, valueKeys, labelKeys) {
  const out = [];
  for (const r of (rows || [])) {
    const value = pickFirst(r, valueKeys, "");
    const label = pickFirst(r, labelKeys, value);
    if (!value) continue;
    out.push({ value, label });
  }
  return out;
}

function fillSelect(select, items, valueField, labelField, keepEmptyOption) {
  if (!select) return;
  const current = select.value;
  const opts = [];
  if (keepEmptyOption) {
    const emptyLabel = keepEmptyOption === true ? "(не размещен)" : String(keepEmptyOption);
    opts.push(`<option value="">${escapeHtml(emptyLabel)}</option>`);
  }
  for (const it of (items || [])) {
    const v = String(it?.[valueField] ?? "");
    const l = String(it?.[labelField] ?? v);
    opts.push(`<option value="${escapeHtml(v)}">${escapeHtml(l)}</option>`);
  }
  select.innerHTML = opts.join("");
  if (current && Array.from(select.options).some((o) => o.value === current)) select.value = current;
}

export function createLegacyDictsRuntime(config) {
  const {
    LDV_FLAGS,
    LEGACY_DOM_SYNC,
    apiFetch,
    materialSelect,
    storageSelect,
    qualitySelect,
    setSelectValueState,
    getUiSelectState,
    setSaveStatus,
    updateControlsState,
    setApiReady,
    getDictLoadInFlight,
    setDictLoadInFlight,
    setDictsLoaded,
    getDictsLoaded
  } = config;

  function syncSelectState() {
    const ui = getUiSelectState();
    setSelectValueState("material", materialSelect ? materialSelect.value : ui.materialValue);
    setSelectValueState("storage", storageSelect ? storageSelect.value : ui.storageValue);
    setSelectValueState("quality", qualitySelect ? qualitySelect.value : ui.qualityValue);
  }

  function applyFallbackDicts() {
    const qualityRows = [
      { code: "Good", descr: "Good" },
      { code: "Limited", descr: "Limited" }
    ];
    if (LEGACY_DOM_SYNC) {
      fillSelect(materialSelect, [], "idVal", "materialName", "(optional)");
      fillSelect(storageSelect, [], "idVal", "locCode", "(optional)");
      fillSelect(qualitySelect, qualityRows, "code", "code", "не выбрано");
      syncSelectState();
    }
    setDictsLoaded(true);
  }

  async function loadDictionaries() {
    if (LDV_FLAGS.disableLegacyApi) return;
    if (getDictLoadInFlight()) return;
    setDictLoadInFlight(true);
    try {
      const { res } = await apiFetch("/api/dicts", { method: "GET" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        applyFallbackDicts();
        setSaveStatus("warn", `Dictionaries API unavailable (${json.error || `HTTP ${res.status}`}). Fallback mode.`);
        updateControlsState();
        return;
      }

      const materialRows = normalizeDictRows(
        json.materials,
        ["idVal", "id", "materialId", "ID"],
        ["materialName", "name", "label", "descr", "code"]
      ).map((x) => ({ idVal: x.value, materialName: x.label }));

      const locationRows = normalizeDictRows(
        json.locations,
        ["idVal", "id", "locationId", "ID"],
        ["locCode", "code", "locationCode", "name", "label"]
      ).map((x) => ({ idVal: x.value, locCode: x.label }));

      const qualityRows = normalizeDictRows(
        json.qualities,
        ["code", "id", "value"],
        ["code", "descr", "name", "label"]
      ).map((x) => ({ code: x.value, descr: x.label }));

      if (LEGACY_DOM_SYNC) {
        fillSelect(materialSelect, materialRows, "idVal", "materialName", "(optional)");
        fillSelect(storageSelect, locationRows, "idVal", "locCode", "(optional)");
        fillSelect(qualitySelect, qualityRows, "code", "code", "не выбрано");
        syncSelectState();
      }

      if (qualityRows.length === 0) {
        applyFallbackDicts();
        setSaveStatus("warn", "Quality dictionary is empty. Fallback mode.");
      }

      setDictsLoaded(true);
      updateControlsState();
    } catch (_e) {
      applyFallbackDicts();
      setSaveStatus("warn", "Cannot load dictionaries from API. Fallback mode.");
      updateControlsState();
    } finally {
      setDictLoadInFlight(false);
    }
  }

  async function checkApiHealth() {
    if (LDV_FLAGS.disableLegacyApi) return;
    try {
      const { res } = await apiFetch("/api/health", { method: "GET" });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) {
        setApiReady(true);
        await loadDictionaries();
        if (getDictsLoaded()) setSaveStatus("", "");
      } else {
        setApiReady(false);
        setSaveStatus("warn", "API недоступен: запусти node tools/ui_lab_server.js");
      }
    } catch (_err) {
      setApiReady(false);
      setSaveStatus("warn", "API недоступен: запусти node tools/ui_lab_server.js");
    } finally {
      updateControlsState();
    }
  }

  return {
    checkApiHealth,
    loadDictionaries,
    applyFallbackDicts
  };
}

