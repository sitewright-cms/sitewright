-- Rename the built-in global snippet `logo-marquee` -> `logo-marquee-snippet`.
--
-- WHY: `logo-marquee` is also the name of a managed Widget. Widget bodies are spread LAST into the
-- partials map in every render path, so this snippet was shadowed and could never render — an author
-- who edited it saw the edit save and nothing change. The WIDGET keeps the old name, so every
-- existing `{{> logo-marquee}}` in page source keeps resolving to exactly what it already rendered
-- (the widget); this migration only makes the snippet reachable again, under a name of its own.
--
-- The `data` JSON carries its own `id`/`name` alongside the `entity_id` key, so all three move.
-- Guarded on the target not already existing: `uniq_content` is UNIQUE on
-- (project_id, kind, scope, entity_id), so an instance that somehow already holds the new name must
-- be left alone rather than fail the boot. Idempotent — a second run matches no rows.
UPDATE content
SET
  entity_id = 'logo-marquee-snippet',
  data = json_set(json_set(data, '$.id', 'logo-marquee-snippet'), '$.name', 'logo-marquee-snippet')
WHERE project_id = '__global__'
  AND kind = 'snippet'
  AND entity_id = 'logo-marquee'
  AND NOT EXISTS (
    SELECT 1 FROM content
    WHERE project_id = '__global__' AND kind = 'snippet' AND entity_id = 'logo-marquee-snippet'
  );
