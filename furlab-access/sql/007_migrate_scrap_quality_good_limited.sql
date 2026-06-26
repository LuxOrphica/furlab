-- Migrate quality dictionary and data in current schema:
-- OK -> Good
-- Reject -> Limited

-- 1) Ensure new dictionary values exist.
INSERT INTO ScrapQualityDict (code, descr) VALUES ('Good', 'Good');
INSERT INTO ScrapQualityDict (code, descr) VALUES ('Limited', 'Limited');

-- 2) Move data to new codes.
UPDATE ScrapPiece
SET scrapQuality = 'Good'
WHERE scrapQuality='OK';

UPDATE ScrapPiece
SET scrapQuality = 'Limited'
WHERE scrapQuality='Reject';

-- 3) Remove old codes after all rows were migrated.
DELETE FROM ScrapQualityDict WHERE code='OK';
DELETE FROM ScrapQualityDict WHERE code='Reject';
