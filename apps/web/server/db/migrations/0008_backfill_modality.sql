-- Custom SQL migration file, put your code below! --
-- Reclassify existing datasets as text when they have items and none carry an
-- image (storage_key). Empty datasets and image-bearing datasets keep the
-- 'image' default.
UPDATE datasets d
SET modality = 'text'
WHERE EXISTS (
        SELECT 1 FROM dataset_items i WHERE i.dataset_id = d.id
    )
    AND NOT EXISTS (
        SELECT 1 FROM dataset_items i
        WHERE i.dataset_id = d.id AND i.storage_key IS NOT NULL
    );