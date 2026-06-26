import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  Collapse,
  Input,
  message,
  Radio,
  Select,
  Slider,
  Space,
  Tooltip,
} from "antd";
import { CheckCircleOutlined, CheckOutlined, EditOutlined, LoadingOutlined, ReloadOutlined, SaveOutlined, WarningOutlined } from "@ant-design/icons";
import type { CheckboxChangeEvent } from "antd/es/checkbox";
import type { RadioChangeEvent } from "antd/es/radio";
import {
  setLegacyDebugFlag,
  setLegacyMode,
  setLegacyManualInventoryTag,
  setLegacyNote,
  setLegacySelectValue,
  setLegacyUploadChecked,
  setLegacyZoom,
  refreshLegacyView,
  triggerLegacyAction,
} from "../core/legacyDom";
import { uiInitialState, uiReducer } from "../core/uiState";
import type { DebugState, Mode } from "../core/uiState";
import { useLegacyBridge } from "../hooks/useLegacyBridge";

const RU = {
  panelUpload: "Загрузка и файл",
  panelNap: "Определение направления ворса",
  panelSave: "Запись в Access",
  pickScan: "Выбрать скан",
  pickScanV1: "Прототип",
  pickScanV2: "Скан V2",
  pickScanV3: "Скан",
  contourEditToggle: "Редактировать контур",
  contourDraftReset: "Сброс контура",
  contourDraftApply: "Применить контур",
  trainingMode: "Обучающий режим",
  fileNone: "Файл не выбран",
  auto: "Авто",
  manual: "Ручной выбор",
  clear: "Очистить",
  hintManual: "Направление ворса по точкам задается оператором",
  hintAuto: "Направление ворса определяется по найденной метке",
  save: "Записать в Access",
  saveTraining: "В обучающий датасет",
  uploadToProject: "Сохранить скан в проект",
  invTag: "Инв. метка",
  area: "Площадь, мм²",
  bboxW: "Ширина габарита, мм",
  bboxH: "Высота габарита, мм",
  maxSpan: "Макс. габарит, мм",
  napDeg: "Угол ворса, °",
  material: "Материал",
  location: "Локация",
  quality: "Качество",
  comment: "Комментарий",
  notePlaceholder: "Обязательно для ограниченного качества",
  notSelected: "не выбрано",
  debug: "Отладка",
  techInfo: "Тех информация",
  dbgLineMask: "Показать маску линии",
  dbgEdgeDist: "Показать расстояния до контура",
  dbgBbox: "Показать габариты",
  dbgControls: "Показать контрольные точки",
};

export default function LineDirectionScreen() {
  const [trainingMode, setTrainingMode] = useState(false);
  const [contourEditActive, setContourEditActive] = useState(false);
  const [saveDisabled, setSaveDisabled] = useState(true);
  const [clearDisabled, setClearDisabled] = useState(false);
  const [saveStatusUi, setSaveStatusUi] = useState<{ kind: string; message: string }>({ kind: "", message: "" });
  const [scanStatusUi, setScanStatusUi] = useState<{ kind: string; message: string }>({ kind: "", message: "" });
  const [messageApi, messageContextHolder] = message.useMessage();
  const lastToastKeyRef = useRef("");
  const [ui, dispatch] = useReducer(uiReducer, uiInitialState);

  const {
    mode,
    uploadChecked,
    debug,
    materialOptions,
    storageOptions,
    qualityOptions,
    materialValue,
    storageValue,
    qualityValue,
    noteValue,
    fileName,
    outputText,
    zoomPercent,
    pieceView,
    validation,
  } = ui;

  const invInvalid = validation.invMissing;
  const napInvalid = validation.napMissing;
  const materialInvalid = validation.materialMissing;
  const qualityInvalid = validation.qualityMissing;
  const noteInvalid = validation.noteMissing;
  const invRaw = String(pieceView.invTag || "");
  const invDigits = (() => {
    const upper = invRaw.toUpperCase();
    if (upper.startsWith("FL-SCR-")) return upper.slice(7).replace(/\D+/g, "").slice(0, 6);
    return upper.replace(/\D+/g, "").slice(0, 6);
  })();

  useLegacyBridge({
    dispatch,
    setSaveDisabled,
    setClearDisabled,
    setSaveStatusUi: useCallback((kind: string, message: string) => setSaveStatusUi({ kind, message }), []),
    setScanStatusUi: useCallback((kind: string, message: string) => {
      setScanStatusUi({ kind, message });
      if (kind === "success" || kind === "error" || kind === "") {
        window.setTimeout(() => setScanStatusUi({ kind: "", message: "" }), 1400);
      }
    }, []),
  });

  const onModeChange = (e: RadioChangeEvent) => {
    const next: Mode = e.target.value === "manual" ? "manual" : "auto";
    dispatch({ type: "set_mode", payload: next });
    setLegacyMode(next);
  };

  const onUploadChange = (e: CheckboxChangeEvent) => {
    const checked = !!e.target.checked;
    dispatch({ type: "set_upload_checked", payload: checked });
    setLegacyUploadChecked(checked);
  };

  const onDebugChange = (id: keyof DebugState, checked: boolean) => {
    dispatch({ type: "patch_debug", payload: { [id]: checked } });
    setLegacyDebugFlag(id, checked);
  };

  useEffect(() => {
    if (!fileName || fileName === "(файл не выбран)") return;
    const raf = window.requestAnimationFrame(() => refreshLegacyView());
    return () => window.cancelAnimationFrame(raf);
  }, [fileName]);

  useEffect(() => {
    const text = String(saveStatusUi.message || "").trim();
    if (!text) return;
    const key = `${saveStatusUi.kind}|${text}`;
    if (lastToastKeyRef.current === key) return;
    lastToastKeyRef.current = key;
    if (saveStatusUi.kind === "success" || saveStatusUi.kind === "ok") {
      messageApi.success({ content: text, duration: 2.8 });
      return;
    }
    if (saveStatusUi.kind === "error") {
      messageApi.error({ content: text, duration: 4 });
      return;
    }
    if (saveStatusUi.kind === "warn") {
      messageApi.warning({ content: text, duration: 3.2 });
      return;
    }
    if (saveStatusUi.kind === "pending") {
      messageApi.loading({ content: text, duration: 1.2 });
      return;
    }
    messageApi.info(text);
  }, [messageApi, saveStatusUi.kind, saveStatusUi.message]);


  return (
    <div className="line-screen-root theme-ant">
      {messageContextHolder}
      <div className="legacy-hidden" aria-hidden="true">
        <input id="fileInput" type="file" accept="image/*" />
      </div>

      <div className="line-shell">
        {saveStatusUi.message ? (
          <div className="line-status-row">
            <span id="saveStatusTop" className={`line-status-text ${saveStatusUi.kind || ""}`.trim()}>
              {saveStatusUi.message}
            </span>
          </div>
        ) : null}

        <div className="header-grid header-flat">
          <div className="toolbar-group toolbar-upload">
            <div className="scan-upload-row">
              <div className="scan-upload-actions">
              <Button className="toolbar-btn" type="primary" onClick={() => triggerLegacyAction("pickScanV3")}>
                {RU.pickScanV3}
              </Button>
              </div>
              <span id="fileNameText" className="file-name">
                {fileName && fileName !== "(файл не выбран)" ? fileName : RU.fileNone}
              </span>
              {scanStatusUi.message ? (
                <span className={`scan-status-inline ${scanStatusUi.kind || ""}`.trim()}>
                  {scanStatusUi.kind === "pending" ? <LoadingOutlined /> : null}
                  {scanStatusUi.kind === "success" ? <CheckCircleOutlined /> : null}
                  {scanStatusUi.kind === "error" ? <WarningOutlined /> : null}
                  <span>{scanStatusUi.message}</span>
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="workspace-head">
          <div className="workspace-head-left">
            <span className="section-caption">ПАРАМЕТРЫ КУСКА</span>
          </div>
          <div className="workspace-head-right">
            <span className="section-caption">ПРЕВЬЮ КОНТУРА</span>
            <div className="mode-row">
              <div className="mode-cluster">
                <span className="mode-row-label">Направление ворса</span>
                <Radio.Group value={mode} onChange={onModeChange}>
                  <Space size={10}>
                    <Tooltip placement="top" title={RU.hintAuto}>
                      <Radio value="auto">{RU.auto}</Radio>
                    </Tooltip>
                    <Tooltip placement="top" title={RU.hintManual}>
                      <Radio value="manual">{RU.manual}</Radio>
                    </Tooltip>
                  </Space>
                </Radio.Group>
              </div>
              <Button disabled={clearDisabled} onClick={() => triggerLegacyAction("clear")}>
                {RU.clear}
              </Button>
            </div>
          </div>
          <p id="hintText" className="hint hint-hidden">
            {mode === "manual" ? RU.hintManual : RU.hintAuto}
          </p>
        </div>

        <div className="workspace">
          <div className="stage">
            <div className="zoom-rail">
              <Button size="small" onClick={() => triggerLegacyAction("zoomIn")}>
                +
              </Button>
              <Slider
                className="zoom-slider-ant"
                vertical
                min={1}
                max={300}
                step={10}
                value={zoomPercent}
                onChange={(v) => {
                  const next = Array.isArray(v) ? Number(v[0]) : Number(v);
                  dispatch({ type: "set_zoom", payload: next });
                  setLegacyZoom(next);
                }}
              />
              <Button size="small" onClick={() => triggerLegacyAction("zoomOut")}>
                -
              </Button>
              <span id="zoomValue">{zoomPercent}%</span>
            </div>

            <div id="debugOptions" className="stage-display-controls">
              <div className="stage-controls-inline-row">
                <div className="stage-training-controls-group">
                  <Button
                    size="small"
                    className={`stage-training-toggle ${trainingMode ? "is-on" : ""}`.trim()}
                    onClick={() => setTrainingMode((prev) => !prev)}
                  >
                    {RU.trainingMode}
                  </Button>
                  {trainingMode ? (
                    <div className="stage-edit-controls-row stage-edit-controls-row-compact">
                    <Tooltip title={RU.contourEditToggle} placement="bottom">
                      <Button
                        size="small"
                        className={`stage-edit-btn stage-edit-btn-icon ${contourEditActive ? "is-active" : ""}`.trim()}
                        icon={<EditOutlined />}
                        onClick={() => {
                          triggerLegacyAction("contourEditToggle");
                          setContourEditActive((prev) => !prev);
                        }}
                      />
                    </Tooltip>
                      <Tooltip title={RU.contourDraftReset} placement="bottom">
                        <Button
                          size="small"
                          className="stage-edit-btn stage-edit-btn-icon"
                          icon={<ReloadOutlined />}
                          onClick={() => triggerLegacyAction("contourDraftReset")}
                        />
                      </Tooltip>
                      <Tooltip title={RU.contourDraftApply} placement="bottom">
                      <Button
                        size="small"
                        className="stage-edit-btn stage-edit-btn-icon"
                        icon={<CheckOutlined />}
                        onClick={() => {
                          triggerLegacyAction("contourDraftApply");
                          setContourEditActive(false);
                        }}
                      />
                    </Tooltip>
                    <Tooltip title={RU.saveTraining} placement="bottom">
                      <Button
                        size="small"
                        className="stage-edit-btn stage-edit-btn-icon"
                        icon={<SaveOutlined />}
                        onClick={() => triggerLegacyAction("saveTraining")}
                      />
                    </Tooltip>
                    </div>
                  ) : null}
                </div>

                <div className="stage-display-controls-row">
                  <Checkbox id="showMmGridChk" checked={debug.mmGrid} onChange={(e) => onDebugChange("mmGrid", !!e.target.checked)}>
                    Сетка
                  </Checkbox>
                  <Checkbox id="showContourChk" checked={debug.contour} onChange={(e) => onDebugChange("contour", !!e.target.checked)}>
                    Контур
                  </Checkbox>
                  <Checkbox id="showBboxChk" checked={debug.bbox} onChange={(e) => onDebugChange("bbox", !!e.target.checked)}>
                    Габариты
                  </Checkbox>
                  <Checkbox id="showControlPointsChk" checked={debug.controlPoints} onChange={(e) => onDebugChange("controlPoints", !!e.target.checked)}>
                    Точки
                  </Checkbox>
                  <Checkbox id="showNapArrowChk" checked={debug.napArrow} onChange={(e) => onDebugChange("napArrow", !!e.target.checked)}>
                    Стрелка
                  </Checkbox>
                  <Checkbox id="showLineMaskChk" checked={debug.lineMask} onChange={(e) => onDebugChange("lineMask", !!e.target.checked)}>
                    Маска
                  </Checkbox>
                </div>
              </div>
            </div>

            <div className="stage-wrap">
              <canvas id="canvas" width={800} height={800} />
            </div>
            <canvas id="overlayCanvas" className="stage-overlay" />
          </div>

          <div className="right-stack">
            <Card className="piece-card" size="small">
              <div className="card-grid piece-fields-grid">
                <label>
                  {RU.invTag}
                  <Input
                    id="invTagView"
                    className={invInvalid ? "field-invalid-control" : ""}
                    addonBefore="FL-SCR-"
                    value={invDigits}
                    maxLength={6}
                    onChange={(e) => {
                      const digits = String(e.target.value || "").replace(/\D+/g, "").slice(0, 6);
                      setLegacyManualInventoryTag(digits ? `FL-SCR-${digits}` : "");
                    }}
                    placeholder="000123"
                  />
                </label>
                <label>{RU.area}<Input id="areaMm2View" readOnly value={pieceView.areaMm2} /></label>
                <label>{RU.bboxW}<Input id="bboxWidthMmView" readOnly value={pieceView.bboxWidthMm} /></label>
                <label>{RU.bboxH}<Input id="bboxHeightMmView" readOnly value={pieceView.bboxHeightMm} /></label>
                <label>{RU.maxSpan}<Input id="maxSpanMmView" readOnly value={pieceView.maxSpanMm} /></label>
                <label>{RU.napDeg}<Input id="napDegView" className={napInvalid ? "field-invalid-control" : ""} readOnly value={pieceView.napDeg} /></label>
                <label>
                  {RU.material}
                  <Select
                    id="materialSelect"
                    value={materialValue || undefined}
                    placeholder={RU.notSelected}
                    status={materialInvalid ? "error" : undefined}
                    options={materialOptions.map((o) => ({ value: o.value, label: o.label }))}
                    onChange={(v) => {
                      const next = String(v || "");
                      dispatch({ type: "set_material_value", payload: next });
                      setLegacySelectValue("material", next);
                    }}
                  />
                </label>
                <label>
                  {RU.location}
                  <Select
                    id="storageSelect"
                    value={storageValue || undefined}
                    placeholder={RU.notSelected}
                    options={storageOptions.map((o) => ({ value: o.value, label: o.label }))}
                    onChange={(v) => {
                      const next = String(v || "");
                      dispatch({ type: "set_storage_value", payload: next });
                      setLegacySelectValue("storage", next);
                    }}
                  />
                </label>
                <label>
                  {RU.quality}
                  <Select
                    id="qualitySelect"
                    value={qualityValue || undefined}
                    placeholder={RU.notSelected}
                    status={qualityInvalid ? "error" : undefined}
                    options={qualityOptions.map((o) => ({ value: o.value, label: o.label }))}
                    onChange={(v) => {
                      const next = String(v || "");
                      dispatch({ type: "set_quality_value", payload: next });
                      setLegacySelectValue("quality", next);
                    }}
                  />
                </label>
                <label className="note-label">
                  {RU.comment}
                  <Input.TextArea
                    id="noteInput"
                    className={`comment-field ${noteInvalid ? "field-invalid-control" : ""}`.trim()}
                    placeholder={RU.notePlaceholder}
                    value={noteValue}
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    onChange={(e) => {
                      const next = e.target.value;
                      dispatch({ type: "set_note_value", payload: next });
                      setLegacyNote(next);
                    }}
                  />
                </label>
              </div>
            </Card>

            <Card className="line-side-actions" size="small">
              <Button type="primary" className="toolbar-btn line-side-save-btn" disabled={saveDisabled} onClick={() => triggerLegacyAction("save")}>
                {RU.save}
              </Button>
              <Checkbox className="toolbar-check line-side-upload-check" checked={uploadChecked} onChange={onUploadChange}>
                {RU.uploadToProject}
              </Checkbox>
            </Card>

            <Collapse
              className="tech-panel tech-info-panel ant-collapse-panel"
              size="small"
              bordered
              expandIconPosition="end"
              defaultActiveKey={["tech-info"]}
              items={[
                {
                  key: "tech-info",
                  label: RU.techInfo,
                  children: (
                    <div id="output" className="out tech-info-body">
                      {outputText || ""}
                    </div>
                  ),
                },
              ]}
            />
          </div>
        </div>

      </div>
    </div>
  );
}

