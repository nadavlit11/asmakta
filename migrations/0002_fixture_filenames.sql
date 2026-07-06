-- Fixtures reference their expected sources by FILENAME (stable across
-- re-ingests) rather than by chunk/document id (which change every re-ingest).
-- The rubric resolves filenames -> active-version document ids at eval time.
ALTER TABLE eval_fixtures ADD COLUMN expected_doc_filenames text[] NOT NULL DEFAULT '{}';
