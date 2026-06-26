-- FurLab Access DB schema (normalized for Access + W UI)
-- Date: 2026-02-11
-- Target: Microsoft Access Jet/ACE

-- 0) Dictionaries
CREATE TABLE ScrapStatusDict (
    code TEXT(20) NOT NULL,
    descr TEXT(80),
    CONSTRAINT pk_ScrapStatusDict PRIMARY KEY (code)
);

CREATE TABLE ScrapQualityDict (
    code TEXT(20) NOT NULL,
    descr TEXT(80),
    CONSTRAINT pk_ScrapQualityDict PRIMARY KEY (code)
);

-- 1) Reference data
CREATE TABLE FurMaterial (
    id GUID NOT NULL,
    materialName TEXT(120) NOT NULL,
    propertiesJson MEMO,
    CONSTRAINT pk_FurMaterial PRIMARY KEY (id)
);

CREATE TABLE StorageLocation (
    id GUID NOT NULL,
    locCode TEXT(40) NOT NULL,
    descr TEXT(120),
    CONSTRAINT pk_StorageLocation PRIMARY KEY (id),
    CONSTRAINT ux_StorageLocation_locCode UNIQUE (locCode)
);

-- 2) Product structure
CREATE TABLE Part (
    id GUID NOT NULL,
    partNo LONG,
    partName TEXT(120),
    CONSTRAINT pk_Part PRIMARY KEY (id)
);

CREATE TABLE Zone (
    id GUID NOT NULL,
    partId GUID NOT NULL,
    zoneNo LONG,
    zoneContour MEMO,
    materialId GUID,
    pileDirectionDeg DOUBLE,
    CONSTRAINT pk_Zone PRIMARY KEY (id)
);

CREATE TABLE Fragment (
    id GUID NOT NULL,
    zoneId GUID NOT NULL,
    fragmentCode TEXT(32),
    fragmentContour MEMO,
    areaMm2 DOUBLE,
    CONSTRAINT pk_Fragment PRIMARY KEY (id)
);

-- 3) Layout and runs
CREATE TABLE Layout (
    id GUID NOT NULL,
    zoneId GUID NOT NULL,
    layoutType TEXT(40) NOT NULL,
    paramsJson MEMO,
    CONSTRAINT pk_Layout PRIMARY KEY (id)
);

CREATE TABLE LayoutRun (
    id GUID NOT NULL,
    layoutId GUID NOT NULL,
    startedAt DATETIME,
    paramsSnapshot MEMO,
    resultSnapshot MEMO,
    CONSTRAINT pk_LayoutRun PRIMARY KEY (id)
);

CREATE TABLE InventoryLayoutConfig (
    id GUID NOT NULL,
    layoutId GUID NOT NULL,
    maxCandidates LONG NOT NULL,
    filtersJson MEMO,
    constraintsJson MEMO,
    CONSTRAINT pk_InventoryLayoutConfig PRIMARY KEY (id)
);

-- 4) Warehouse core
CREATE TABLE ScrapPiece (
    id GUID NOT NULL,
    inventoryTag TEXT(64) NOT NULL,
    materialId GUID,
    storageLocationId GUID,
    scrapContour MEMO,
    napDirectionDeg DOUBLE,
    areaMm2 DOUBLE,
    bboxWidthMm DOUBLE,
    bboxHeightMm DOUBLE,
    maxSpanMm DOUBLE,
    scrapQuality TEXT(20),
    scrapStatus TEXT(20),
    [note] TEXT(255),
    createdAt DATETIME,
    updatedAt DATETIME,
    metricsJson MEMO,
    CONSTRAINT pk_ScrapPiece PRIMARY KEY (id),
    CONSTRAINT ux_ScrapPiece_inventoryTag UNIQUE (inventoryTag)
);

CREATE TABLE ScrapReservation (
    id GUID NOT NULL,
    scrapPieceId GUID NOT NULL,
    layoutRunId GUID,
    fragmentId GUID,
    reservedAt DATETIME NOT NULL,
    releasedAt DATETIME,
    reservedBy TEXT(80),
    [note] TEXT(255),
    CONSTRAINT pk_ScrapReservation PRIMARY KEY (id)
);

CREATE TABLE ScrapTransaction (
    id GUID NOT NULL,
    scrapPieceId GUID NOT NULL,
    transType TEXT(20) NOT NULL,
    transAt DATETIME NOT NULL,
    fromLocId GUID,
    toLocId GUID,
    statusBefore TEXT(20),
    statusAfter TEXT(20),
    [note] TEXT(255),
    sourceRef TEXT(120),
    CONSTRAINT pk_ScrapTransaction PRIMARY KEY (id)
);

-- 5) Traceability fact
CREATE TABLE LayoutRunScrapPlacement (
    layoutRunId GUID NOT NULL,
    fragmentId GUID NOT NULL,
    scrapPieceId GUID NOT NULL,
    rotationDeg DOUBLE,
    offsetXmm DOUBLE,
    offsetYmm DOUBLE,
    resultContourSnapshot MEMO,
    CONSTRAINT pk_LayoutRunScrapPlacement PRIMARY KEY (layoutRunId, fragmentId),
    CONSTRAINT ux_LRSP_run_scrap UNIQUE (layoutRunId, scrapPieceId)
);

-- 6) Import from FurLab spec (optional)
CREATE TABLE ImportBatch (
    id GUID NOT NULL,
    sourceName TEXT(80),
    createdAt DATETIME,
    CONSTRAINT pk_ImportBatch PRIMARY KEY (id)
);

CREATE TABLE ImportSpecLine (
    id GUID NOT NULL,
    batchId GUID NOT NULL,
    modelNo LONG,
    partNo LONG,
    zoneNo LONG,
    fragmentCode TEXT(32),
    qty LONG,
    areaMm2 DOUBLE,
    napDirectionDeg DOUBLE,
    inventoryTag TEXT(64),
    layoutRunIdText TEXT(64),
    CONSTRAINT pk_ImportSpecLine PRIMARY KEY (id)
);

-- Foreign keys
ALTER TABLE Zone
    ADD CONSTRAINT fk_Zone_partId FOREIGN KEY (partId) REFERENCES Part (id);
ALTER TABLE Zone
    ADD CONSTRAINT fk_Zone_materialId FOREIGN KEY (materialId) REFERENCES FurMaterial (id);

ALTER TABLE Fragment
    ADD CONSTRAINT fk_Fragment_zoneId FOREIGN KEY (zoneId) REFERENCES Zone (id);

ALTER TABLE Layout
    ADD CONSTRAINT fk_Layout_zoneId FOREIGN KEY (zoneId) REFERENCES Zone (id);

ALTER TABLE LayoutRun
    ADD CONSTRAINT fk_LayoutRun_layoutId FOREIGN KEY (layoutId) REFERENCES Layout (id);

ALTER TABLE InventoryLayoutConfig
    ADD CONSTRAINT fk_InventoryLayoutConfig_layoutId FOREIGN KEY (layoutId) REFERENCES Layout (id);

ALTER TABLE ScrapPiece
    ADD CONSTRAINT fk_ScrapPiece_materialId FOREIGN KEY (materialId) REFERENCES FurMaterial (id);
ALTER TABLE ScrapPiece
    ADD CONSTRAINT fk_ScrapPiece_storageLocationId FOREIGN KEY (storageLocationId) REFERENCES StorageLocation (id);
ALTER TABLE ScrapPiece
    ADD CONSTRAINT fk_ScrapPiece_scrapStatus FOREIGN KEY (scrapStatus) REFERENCES ScrapStatusDict (code);
ALTER TABLE ScrapPiece
    ADD CONSTRAINT fk_ScrapPiece_scrapQuality FOREIGN KEY (scrapQuality) REFERENCES ScrapQualityDict (code);

ALTER TABLE ScrapReservation
    ADD CONSTRAINT fk_ScrapReservation_scrapPieceId FOREIGN KEY (scrapPieceId) REFERENCES ScrapPiece (id);
ALTER TABLE ScrapReservation
    ADD CONSTRAINT fk_ScrapReservation_layoutRunId FOREIGN KEY (layoutRunId) REFERENCES LayoutRun (id);
ALTER TABLE ScrapReservation
    ADD CONSTRAINT fk_ScrapReservation_fragmentId FOREIGN KEY (fragmentId) REFERENCES Fragment (id);

ALTER TABLE ScrapTransaction
    ADD CONSTRAINT fk_ScrapTransaction_scrapPieceId FOREIGN KEY (scrapPieceId) REFERENCES ScrapPiece (id);
ALTER TABLE ScrapTransaction
    ADD CONSTRAINT fk_ScrapTransaction_fromLocId FOREIGN KEY (fromLocId) REFERENCES StorageLocation (id);
ALTER TABLE ScrapTransaction
    ADD CONSTRAINT fk_ScrapTransaction_toLocId FOREIGN KEY (toLocId) REFERENCES StorageLocation (id);
ALTER TABLE ScrapTransaction
    ADD CONSTRAINT fk_ScrapTransaction_statusBefore FOREIGN KEY (statusBefore) REFERENCES ScrapStatusDict (code);
ALTER TABLE ScrapTransaction
    ADD CONSTRAINT fk_ScrapTransaction_statusAfter FOREIGN KEY (statusAfter) REFERENCES ScrapStatusDict (code);

ALTER TABLE LayoutRunScrapPlacement
    ADD CONSTRAINT fk_LRSP_layoutRunId FOREIGN KEY (layoutRunId) REFERENCES LayoutRun (id);
ALTER TABLE LayoutRunScrapPlacement
    ADD CONSTRAINT fk_LRSP_fragmentId FOREIGN KEY (fragmentId) REFERENCES Fragment (id);
ALTER TABLE LayoutRunScrapPlacement
    ADD CONSTRAINT fk_LRSP_scrapPieceId FOREIGN KEY (scrapPieceId) REFERENCES ScrapPiece (id);

ALTER TABLE ImportSpecLine
    ADD CONSTRAINT fk_ImportSpecLine_batchId FOREIGN KEY (batchId) REFERENCES ImportBatch (id);

-- Indexes
CREATE INDEX ix_Zone_partId ON Zone (partId);
CREATE INDEX ix_Zone_materialId ON Zone (materialId);

CREATE INDEX ix_Fragment_zoneId ON Fragment (zoneId);
CREATE INDEX ix_Fragment_fragmentCode ON Fragment (fragmentCode);

CREATE INDEX ix_Layout_zoneId ON Layout (zoneId);
CREATE INDEX ix_Layout_layoutType ON Layout (layoutType);

CREATE INDEX ix_LayoutRun_layoutId_startedAt ON LayoutRun (layoutId, startedAt);

CREATE INDEX ix_InventoryLayoutConfig_layoutId ON InventoryLayoutConfig (layoutId);

CREATE INDEX ix_ScrapPiece_materialId ON ScrapPiece (materialId);
CREATE INDEX ix_ScrapPiece_status ON ScrapPiece (scrapStatus);
CREATE INDEX ix_ScrapPiece_locationId ON ScrapPiece (storageLocationId);

CREATE INDEX ix_ScrapReservation_pieceId ON ScrapReservation (scrapPieceId);
CREATE INDEX ix_ScrapReservation_runId ON ScrapReservation (layoutRunId);

CREATE INDEX ix_ScrapTransaction_piece_time ON ScrapTransaction (scrapPieceId, transAt);

CREATE INDEX ix_LRSP_runId ON LayoutRunScrapPlacement (layoutRunId);
CREATE INDEX ix_LRSP_fragmentId ON LayoutRunScrapPlacement (fragmentId);
CREATE INDEX ix_LRSP_scrapPieceId ON LayoutRunScrapPlacement (scrapPieceId);

CREATE INDEX ix_ImportSpecLine_batchId ON ImportSpecLine (batchId);
CREATE INDEX ix_ImportSpecLine_inventoryTag ON ImportSpecLine (inventoryTag);

-- Seeds
INSERT INTO ScrapStatusDict (code, descr) VALUES ('Available', 'Available');
INSERT INTO ScrapStatusDict (code, descr) VALUES ('Reserved', 'Reserved');
INSERT INTO ScrapStatusDict (code, descr) VALUES ('Used', 'Used');
INSERT INTO ScrapStatusDict (code, descr) VALUES ('Discarded', 'Discarded');

INSERT INTO ScrapQualityDict (code, descr) VALUES ('Good', 'Good');
INSERT INTO ScrapQualityDict (code, descr) VALUES ('Limited', 'Limited');
