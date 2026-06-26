"use strict";

const { loadRegistryPage: loadRegistryPageService } = require("../services/registry_service");
const { createCacheService } = require("../services/cache/cache_service");
const { createRegistryDataService } = require("../services/cache/registry_data_service");
const { createCscriptRunner } = require("../services/accessRunner/cscript_runner");
const { createPieceWriteService } = require("../services/piece_write_service");
const { createHistoryService } = require("../services/history_service");
const { createPieceReadService } = require("../services/piece_read_service");
const { createDictsService } = require("../services/dicts_service");
const { createUploadService } = require("../services/upload_service");
const { createTrainingDatasetService } = require("../services/training_dataset_service");
const { createQrRegistryService } = require("../services/qr_registry_service");
const { createManualPlacementLogService } = require("../services/manual_placement_log_service");
const { createTempWriters } = require("../utils/temp_files");
const { parseScriptJson } = require("../utils/script_json");
const {
  accessText,
  accessNumber,
  accessDateNowLiteral,
  accessGuid
} = require("../utils/access_literals");
const {
  normalizeGuidLike,
  looksLikeGuid,
  isSamePieceId
} = require("../utils/piece_id");

function createAppServices(deps) {
  const {
    fs,
    path,
    os,
    crypto,
    spawnSync,
    rootDir,
    dbPath,
    apiTmpDir,
    uploadsDir,
    ttl,
    timeouts,
    mirror
  } = deps;

  const registryCache = { items: null, loadedAt: 0 };
  const registryMirror = {
    path: path.join(apiTmpDir, "registry_read_mirror.accdb"),
    copiedAt: 0,
    sourceMtimeMs: 0
  };
  const historyCache = new Map();
  const pieceCache = new Map();
  const pieceLiteCache = new Map();
  const contourCache = new Map();
  const diskCacheDir = path.join(apiTmpDir, "piece-cache");
  const registryDiskCache = path.join(apiTmpDir, "registry_cache.json");

  const cscriptRunner = createCscriptRunner({ spawnSync, cwd: rootDir, defaultTimeoutMs: 8000 });
  const runCscript = (scriptPath, args = [], options = {}) => cscriptRunner.runCscript(scriptPath, args, options);
  const runReaderWithFallback = (scriptPath, args = [], options = {}) =>
    cscriptRunner.runReaderWithFallback(scriptPath, args, options);

  const { writeTempSql, writeTempJson } = createTempWriters({
    fs,
    path,
    apiTmpDir
  });

  const registryDataService = createRegistryDataService({
    fs,
    path,
    os,
    DB_PATH: dbPath,
    API_TMP_DIR: apiTmpDir,
    REGISTRY_DISK_CACHE: registryDiskCache,
    registryMirror,
    registryCache,
    REGISTRY_CACHE_TTL_SAFE_MS: ttl.registryMs,
    REGISTRY_MIRROR_MAX_AGE_MS: mirror.registryMaxAgeMs,
    REGISTRY_READER_TIMEOUT_MS: timeouts.registryReaderMs,
    ROOT_DIR: rootDir,
    runReaderWithFallback,
    parseScriptJson
  });

  const dictsService = createDictsService({
    fs,
    os,
    path,
    DB_PATH: dbPath,
    DICTS_CACHE_TTL_SAFE_MS: ttl.dictsMs,
    runReaderWithFallback,
    parseScriptJson,
    ROOT_DIR: rootDir
  });

  const uploadService = createUploadService({
    fs,
    path,
    crypto,
    rootDir,
    uploadsDir
  });

  const trainingDatasetService = createTrainingDatasetService({
    fs,
    path,
    crypto,
    rootDir,
    dbPathOverride: process.env.FURLAB_TRAINING_DB_PATH
  });

  const qrRegistryService = createQrRegistryService({
    fs,
    path,
    rootDir,
    dbPathOverride: process.env.FURLAB_QR_REGISTRY_DB_PATH
  });

  const manualPlacementLogService = createManualPlacementLogService({
    fs,
    path,
    rootDir,
    crypto
  });

  const cacheService = createCacheService({
    fs,
    path,
    crypto,
    DISK_CACHE_DIR: diskCacheDir,
    pieceCache,
    pieceLiteCache,
    contourCache,
    historyCache,
    PIECE_CACHE_TTL_SAFE_MS: ttl.pieceMs,
    CONTOUR_CACHE_TTL_SAFE_MS: ttl.contourMs,
    HISTORY_CACHE_TTL_SAFE_MS: ttl.historyMs,
    looksLikeGuid,
    normalizeGuidLike
  });

  const runReaderViaTempDbCopy = (scriptPath, args = [], options = {}) =>
    registryDataService.runReaderViaTempDbCopy(scriptPath, args, options);

  const pieceReadService = createPieceReadService({
    ROOT_DIR: rootDir,
    path,
    PIECE_READER_TIMEOUT_MS: timeouts.pieceReaderMs,
    PIECE_CACHE_TTL_SAFE_MS: ttl.pieceMs,
    CONTOUR_CACHE_TTL_SAFE_MS: ttl.contourMs,
    registryCache,
    runReaderViaTempDbCopy,
    parseScriptJson,
    readPieceCache: cacheService.readPieceCache,
    readPieceLiteCache: cacheService.readPieceLiteCache,
    writePieceLiteCache: cacheService.writePieceLiteCache,
    writePieceCache: cacheService.writePieceCache,
    readContourCache: cacheService.readContourCache,
    writeContourCache: cacheService.writeContourCache,
    readDiskCache: cacheService.readDiskCache,
    writeDiskCache: cacheService.writeDiskCache,
    readHistoryCache: cacheService.readHistoryCache,
    writeHistoryCache: cacheService.writeHistoryCache,
    isSamePieceId,
    looksLikeGuid,
    normalizeGuidLike
  });

  const pieceWriteService = createPieceWriteService({
    DB_PATH: dbPath,
    ROOT_DIR: rootDir,
    fs,
    path,
    crypto,
    accessText,
    accessNumber,
    accessDateNowLiteral,
    accessGuid,
    writeTempSql,
    writeTempJson,
    runCscript,
    runReaderWithFallback,
    parseScriptJson,
    saveUploadedSourceImage: uploadService.saveUploadedSourceImage,
    invalidateRegistryCache: registryDataService.invalidateRegistryCache,
    invalidatePieceCacheById: cacheService.invalidatePieceCacheById,
    invalidateHistoryCacheByPieceId: cacheService.invalidateHistoryCacheByPieceId,
    loadPieceById: (pieceId, options = {}) => pieceReadService.loadPieceById(pieceId, options)
  });

  const asText = (v) => (v === null || v === undefined ? "" : String(v));
  const historyService = createHistoryService({
    DB_PATH: dbPath,
    ROOT_DIR: rootDir,
    path,
    fs,
    runReaderWithFallback,
    runReaderViaTempDbCopy,
    parseScriptJson,
    asText,
    readHistoryCache: cacheService.readHistoryCache,
    writeHistoryCache: cacheService.writeHistoryCache,
    HISTORY_CACHE_TTL_SAFE_MS: ttl.historyMs,
    PIECE_READER_TIMEOUT_MS: timeouts.pieceReaderMs
  });

  return {
    loadRegistryRowsCached: (force = false) => registryDataService.loadRegistryRowsCached(force),
    invalidateRegistryCache: () => registryDataService.invalidateRegistryCache(),
    loadRegistryPage: (query) => {
      const refresh = String(query?.get?.("refresh") || "").trim() === "1";
      return loadRegistryPageService(query, () => registryDataService.loadRegistryRowsCached(refresh));
    },
    loadDictsCached: (force = false) => dictsService.loadDictsCached(force),
    loadUsageHistoryAll: (force = false) => historyService.loadUsageHistoryAll(force),
    loadPieceById: (pieceId, options = {}) => pieceReadService.loadPieceById(pieceId, options),
    loadPieceBundleById: (pieceId, options = {}) => pieceReadService.loadPieceBundleById(pieceId, options),
    loadPieceReservationById: (pieceId) => pieceReadService.loadPieceReservationById(pieceId),
    loadPieceHistoryById: (pieceId, inventoryTag) => {
      let resolvedTag = String(inventoryTag || "").trim();
      if (!resolvedTag) {
        const lite = pieceReadService.loadPieceLiteById(pieceId, { includeReservation: false });
        if (lite && lite.ok && lite.item && typeof lite.item === "object") {
          resolvedTag = String(lite.item.inventoryTag || "").trim();
        }
      }
      return historyService.loadPieceHistoryById(pieceId, resolvedTag);
    },
    loadPieceContourById: (pieceId) => pieceReadService.loadPieceContourById(pieceId),
    transitionPieceStatus: (pieceId, action, payload) => pieceWriteService.transitionPieceStatus(pieceId, action, payload),
    updatePieceFields: (pieceId, payload) => pieceWriteService.updatePieceFields(pieceId, payload),
    inventoryTagExists: (inventoryTag) => pieceWriteService.inventoryTagExists(inventoryTag),
    saveScrapPiece: (payload) => pieceWriteService.saveScrapPiece(payload),
    listTrainingAnnotations: (query) => trainingDatasetService.listAnnotations(query),
    saveTrainingAnnotation: (payload) => trainingDatasetService.saveAnnotation(payload),
    loadTrainingStats: () => trainingDatasetService.getStats(),
    loadQrRegistryStats: () => qrRegistryService.listStats(),
    listQrRegistryRecords: (query) => qrRegistryService.listRecords(query),
    checkQrRegistryTags: (payload) => qrRegistryService.checkTags(payload),
    issueQrRegistryTags: (payload) => qrRegistryService.issueTags(payload),
    commitManualPlacements: (payload) => manualPlacementLogService.commitPlacements(payload),
    loadManualPlacements: () => manualPlacementLogService.loadAll()
  };
}

module.exports = {
  createAppServices
};
