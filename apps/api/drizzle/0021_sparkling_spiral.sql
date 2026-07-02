--> NOTE: entries are now keyed per-dataset via `scope` (= the owning dataset slug; '' for all other kinds).
--> This ships against a WIPED database, so no backfill runs here. If ever applied to a POPULATED db, existing
--> entry rows would get scope='' and become unreachable by the new (dataset-scoped) routes — backfill first:
-->   UPDATE content SET scope = json_extract(data, '$.dataset') WHERE kind = 'entry';
-->   UPDATE content_revisions SET scope = json_extract(data, '$.dataset') WHERE kind = 'entry';
DROP INDEX `uniq_content`;--> statement-breakpoint
ALTER TABLE `content` ADD `scope` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_content` ON `content` (`project_id`,`kind`,`scope`,`entity_id`);--> statement-breakpoint
DROP INDEX `content_rev_entity_idx`;--> statement-breakpoint
ALTER TABLE `content_revisions` ADD `scope` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `content_rev_entity_idx` ON `content_revisions` (`project_id`,`kind`,`scope`,`entity_id`,`revision_at`);