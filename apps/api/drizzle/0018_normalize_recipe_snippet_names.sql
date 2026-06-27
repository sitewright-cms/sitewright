-- Normalize the four "recipe-"-prefixed GLOBAL snippet names to match the other 24 (no prefix):
--   recipe-dataset-grid -> dataset-grid, recipe-folder-gallery -> folder-gallery,
--   recipe-i18n -> i18n, recipe-page-vars -> page-vars.
-- Renames the GLOBAL library rows (project_id = '__global__') and their revision history. The seed
-- code (seedGlobalLibrary) only fills an EMPTY kind, so on a persisted DB it would never rename
-- existing rows — hence this data migration. 'recipe-' is 7 chars, so substr(x, 8) drops the prefix.
-- The unique key is (project_id, kind, entity_id); no global snippet already owns the bare names, so
-- there is no collision. User projects' own 'recipe-*' snippets are intentionally left untouched.
UPDATE `content`
SET `entity_id` = substr(`entity_id`, 8),
    `data` = json_set(`data`,
      '$.id', substr(json_extract(`data`, '$.id'), 8),
      '$.name', substr(json_extract(`data`, '$.name'), 8))
WHERE `project_id` = '__global__' AND `kind` = 'snippet'
  AND `entity_id` IN ('recipe-dataset-grid', 'recipe-folder-gallery', 'recipe-i18n', 'recipe-page-vars');
--> statement-breakpoint
UPDATE `content_revisions`
SET `entity_id` = substr(`entity_id`, 8),
    `data` = json_set(`data`,
      '$.id', substr(json_extract(`data`, '$.id'), 8),
      '$.name', substr(json_extract(`data`, '$.name'), 8))
WHERE `project_id` = '__global__' AND `kind` = 'snippet'
  AND `entity_id` IN ('recipe-dataset-grid', 'recipe-folder-gallery', 'recipe-i18n', 'recipe-page-vars');
