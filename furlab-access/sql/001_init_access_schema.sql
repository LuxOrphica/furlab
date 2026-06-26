-- FurLab schema bootstrap for MS Access (ACE/Jet)
-- Source: spec/extracted/schema_tables.md
-- Date: 2026-02-11

-- 1) Enum dictionaries
CREATE TABLE Ref_LayoutType (
    code TEXT(64) NOT NULL,
    displayName TEXT(128),
    CONSTRAINT pk_Ref_LayoutType PRIMARY KEY (code)
);

CREATE TABLE Ref_ScrapQuality (
    code TEXT(32) NOT NULL,
    displayName TEXT(128),
    CONSTRAINT pk_Ref_ScrapQuality PRIMARY KEY (code)
);

CREATE TABLE Ref_ScrapStatus (
    code TEXT(32) NOT NULL,
    displayName TEXT(128),
    CONSTRAINT pk_Ref_ScrapStatus PRIMARY KEY (code)
);

CREATE TABLE Ref_TransType (
    code TEXT(32) NOT NULL,
    displayName TEXT(128),
    CONSTRAINT pk_Ref_TransType PRIMARY KEY (code)
);

-- 2) Core tables
CREATE TABLE FurMaterial (
    id GUID NOT NULL,
    name TEXT(255) NOT NULL,
    properties LONGTEXT,
    CONSTRAINT pk_FurMaterial PRIMARY KEY (id)
);

CREATE TABLE Part (
    id GUID NOT NULL,
    name TEXT(255) NOT NULL,
    CONSTRAINT pk_Part PRIMARY KEY (id)
);

CREATE TABLE Zone (
    id GUID NOT NULL,
    partId GUID NOT NULL,
    materialId GUID NOT NULL,
    zoneContour LONGTEXT,
    pileDirectionMode TEXT(32),
    pileDirectionDeg DOUBLE,
    CONSTRAINT pk_Zone PRIMARY KEY (id),
    CONSTRAINT fk_Zone_Part FOREIGN KEY (partId) REFERENCES Part (id),
    CONSTRAINT fk_Zone_FurMaterial FOREIGN KEY (materialId) REFERENCES FurMaterial (id)
);

CREATE TABLE Fragment (
    id GUID NOT NULL,
    zoneId GUID NOT NULL,
    fragmentContour LONGTEXT,
    areaMm2 DOUBLE,
    CONSTRAINT pk_Fragment PRIMARY KEY (id),
    CONSTRAINT fk_Fragment_Zone FOREIGN KEY (zoneId) REFERENCES Zone (id)
);

CREATE TABLE Layout (
    id GUID NOT NULL,
    zoneId GUID NOT NULL,
    layoutType TEXT(64) NOT NULL,
    params LONGTEXT,
    CONSTRAINT pk_Layout PRIMARY KEY (id),
    CONSTRAINT fk_Layout_Zone FOREIGN KEY (zoneId) REFERENCES Zone (id),
    CONSTRAINT fk_Layout_LayoutType FOREIGN KEY (layoutType) REFERENCES Ref_LayoutType (code)
);

CREATE TABLE LayoutRun (
    id GUID NOT NULL,
    layoutId GUID NOT NULL,
    startedAt DATETIME,
    finishedAt DATETIME,
    paramsSnapshot LONGTEXT,
    CONSTRAINT pk_LayoutRun PRIMARY KEY (id),
    CONSTRAINT fk_LayoutRun_Layout FOREIGN KEY (layoutId) REFERENCES Layout (id)
);

CREATE TABLE ScrapPiece (
    id GUID NOT NULL,
    inventoryTag TEXT(128) NOT NULL,
    materialId GUID NOT NULL,
    geometry LONGTEXT,
    metrics LONGTEXT,
    quality TEXT(32),
    status TEXT(32),
    CONSTRAINT pk_ScrapPiece PRIMARY KEY (id),
    CONSTRAINT uq_ScrapPiece_inventoryTag UNIQUE (inventoryTag),
    CONSTRAINT fk_ScrapPiece_FurMaterial FOREIGN KEY (materialId) REFERENCES FurMaterial (id),
    CONSTRAINT fk_ScrapPiece_Quality FOREIGN KEY (quality) REFERENCES Ref_ScrapQuality (code),
    CONSTRAINT fk_ScrapPiece_Status FOREIGN KEY (status) REFERENCES Ref_ScrapStatus (code)
);

CREATE TABLE LayoutSettings (
    id GUID NOT NULL,
    layoutId GUID NOT NULL,
    maxCandidates LONG,
    filters LONGTEXT,
    constraints LONGTEXT,
    CONSTRAINT pk_LayoutSettings PRIMARY KEY (id),
    CONSTRAINT fk_LayoutSettings_Layout FOREIGN KEY (layoutId) REFERENCES Layout (id)
);

CREATE TABLE LayoutRunScrapPlacement (
    layoutRunId GUID NOT NULL,
    fragmentId GUID NOT NULL,
    scrapPieceId GUID NOT NULL,
    resultContourSnapshot LONGTEXT,
    CONSTRAINT pk_LayoutRunScrapPlacement PRIMARY KEY (layoutRunId, fragmentId),
    CONSTRAINT fk_LRSP_LayoutRun FOREIGN KEY (layoutRunId) REFERENCES LayoutRun (id),
    CONSTRAINT fk_LRSP_Fragment FOREIGN KEY (fragmentId) REFERENCES Fragment (id),
    CONSTRAINT fk_LRSP_ScrapPiece FOREIGN KEY (scrapPieceId) REFERENCES ScrapPiece (id)
);

-- 3) Inventory extension tables
CREATE TABLE StorageLocation (
    id GUID NOT NULL,
    locCode TEXT(32) NOT NULL,
    descr TEXT(255),
    CONSTRAINT pk_StorageLocation PRIMARY KEY (id),
    CONSTRAINT uq_StorageLocation_locCode UNIQUE (locCode)
);

CREATE TABLE ScrapReservation (
    id GUID NOT NULL,
    scrapPieceId GUID NOT NULL,
    layoutRunId GUID,
    fragmentId GUID,
    reservedAt DATETIME,
    releasedAt DATETIME,
    CONSTRAINT pk_ScrapReservation PRIMARY KEY (id),
    CONSTRAINT fk_ScrapReservation_ScrapPiece FOREIGN KEY (scrapPieceId) REFERENCES ScrapPiece (id),
    CONSTRAINT fk_ScrapReservation_LayoutRun FOREIGN KEY (layoutRunId) REFERENCES LayoutRun (id),
    CONSTRAINT fk_ScrapReservation_Fragment FOREIGN KEY (fragmentId) REFERENCES Fragment (id)
);

CREATE TABLE ScrapTransaction (
    id GUID NOT NULL,
    scrapPieceId GUID NOT NULL,
    transType TEXT(32) NOT NULL,
    transAt DATETIME NOT NULL,
    fromLocId GUID,
    toLocId GUID,
    CONSTRAINT pk_ScrapTransaction PRIMARY KEY (id),
    CONSTRAINT fk_ScrapTransaction_ScrapPiece FOREIGN KEY (scrapPieceId) REFERENCES ScrapPiece (id),
    CONSTRAINT fk_ScrapTransaction_TransType FOREIGN KEY (transType) REFERENCES Ref_TransType (code),
    CONSTRAINT fk_ScrapTransaction_FromLoc FOREIGN KEY (fromLocId) REFERENCES StorageLocation (id),
    CONSTRAINT fk_ScrapTransaction_ToLoc FOREIGN KEY (toLocId) REFERENCES StorageLocation (id)
);

-- 4) Secondary indexes
CREATE INDEX ix_LayoutRun_layoutId_startedAt ON LayoutRun (layoutId, startedAt);
CREATE INDEX ix_ScrapReservation_piece ON ScrapReservation (scrapPieceId);
CREATE INDEX ix_ScrapReservation_run ON ScrapReservation (layoutRunId);
CREATE INDEX ix_ScrapReservation_fragment ON ScrapReservation (fragmentId);
CREATE INDEX ix_ScrapTransaction_piece_time ON ScrapTransaction (scrapPieceId, transAt);

-- 5) Seed dictionaries
INSERT INTO Ref_LayoutType (code, displayName) VALUES ('RegularLayout', 'Regular layout');
INSERT INTO Ref_LayoutType (code, displayName) VALUES ('IrregularLayout', 'Irregular layout');
INSERT INTO Ref_LayoutType (code, displayName) VALUES ('InventoryLayout', 'Inventory layout');
INSERT INTO Ref_LayoutType (code, displayName) VALUES ('FillRemainingAreaLayout', 'Fill remaining area layout');

INSERT INTO Ref_ScrapQuality (code, displayName) VALUES ('Good', 'Good');
INSERT INTO Ref_ScrapQuality (code, displayName) VALUES ('Limited', 'Limited');

INSERT INTO Ref_ScrapStatus (code, displayName) VALUES ('Available', 'Available');
INSERT INTO Ref_ScrapStatus (code, displayName) VALUES ('Reserved', 'Reserved');
INSERT INTO Ref_ScrapStatus (code, displayName) VALUES ('Used', 'Used');
INSERT INTO Ref_ScrapStatus (code, displayName) VALUES ('WriteOff', 'Write-off');

INSERT INTO Ref_TransType (code, displayName) VALUES ('Receipt', 'Receipt');
INSERT INTO Ref_TransType (code, displayName) VALUES ('Move', 'Move');
INSERT INTO Ref_TransType (code, displayName) VALUES ('Reserve', 'Reserve');
INSERT INTO Ref_TransType (code, displayName) VALUES ('Release', 'Release');
INSERT INTO Ref_TransType (code, displayName) VALUES ('UseConfirm', 'Use confirm');
INSERT INTO Ref_TransType (code, displayName) VALUES ('WriteOff', 'Write-off');
