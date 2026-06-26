-- Replace FurMaterial dictionary with requested set.
-- Safe for existing data: clear FK refs first.

UPDATE Zone
SET materialId = Null
WHERE materialId Is Not Null;

UPDATE ScrapPiece
SET materialId = Null
WHERE materialId Is Not Null;

DELETE FROM FurMaterial;

INSERT INTO FurMaterial (id, materialName, propertiesJson) VALUES
('{3F1A1E2B-0DB1-4D89-A8D1-15D20F8A14A1}', 'fox', '{"weightGm2":303,"skinThicknessMm":0.67,"pileLengthMm":60.0,"pileDensityPerIn2":680,"hairThicknessMm":0.2}');

INSERT INTO FurMaterial (id, materialName, propertiesJson) VALUES
('{7B92DCC0-8A84-4B12-9C10-40DF1D2C7B62}', 'mink', '{"weightGm2":230,"skinThicknessMm":0.5,"pileLengthMm":25.0,"pileDensityPerIn2":890,"hairThicknessMm":0.17}');

INSERT INTO FurMaterial (id, materialName, propertiesJson) VALUES
('{98D4695F-2A61-4E3F-B274-6C1F4A319E93}', 'muskrat', '{"weightGm2":230,"skinThicknessMm":0.5,"pileLengthMm":25.0,"pileDensityPerIn2":890,"hairThicknessMm":0.17}');

INSERT INTO FurMaterial (id, materialName, propertiesJson) VALUES
('{B17EEFB4-66AB-4F70-AF9D-75EA29D98124}', 'angora', '{"weightGm2":null,"skinThicknessMm":null,"pileLengthMm":null,"pileDensityPerIn2":null,"hairThicknessMm":null}');

INSERT INTO FurMaterial (id, materialName, propertiesJson) VALUES
('{C2504A31-1D5D-4FEE-8ED8-2B50A6F24355}', 'rabbit', '{"weightGm2":null,"skinThicknessMm":null,"pileLengthMm":null,"pileDensityPerIn2":null,"hairThicknessMm":null}');
