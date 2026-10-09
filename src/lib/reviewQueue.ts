/** Phase 60: newest completion per session, selected BEFORE resolving it so
 * reviewing a newer result never resurrects a superseded one. PTY output is
 * never a source. The generic events table remains append-only. */
export interface ReviewResult {
  id: number;
  session_id: string;
  ts: number;
  project_key: string;
  tab_id: string | null;
  adapter_id: string | null;
  claimed_ts: number | null;
}

export const RESULTS_TO_REVIEW_SQL = `
WITH tracking AS (
  SELECT id, ts FROM events
  WHERE type = 'result_review_tracking_started'
  ORDER BY ts, id LIMIT 1
), landed AS (
  SELECT l.*,
         ROW_NUMBER() OVER (PARTITION BY l.session_id ORDER BY l.ts DESC, l.id DESC) AS rn
  FROM events l, tracking t
  WHERE l.type = 'result_landed' AND json_valid(l.payload_json)
    AND (l.ts > t.ts OR (l.ts = t.ts AND l.id > t.id))
)
SELECT l.id, l.session_id, l.ts,
       COALESCE(json_extract(l.payload_json, '$.project_key'), json_extract(l.payload_json, '$.cwd')) AS project_key,
       json_extract(l.payload_json, '$.tab_id') AS tab_id,
       json_extract(l.payload_json, '$.adapter_id') AS adapter_id,
       (SELECT MAX(c.ts) FROM events c
        WHERE c.type = 'result_claimed' AND c.session_id = l.session_id
          AND (c.ts > l.ts OR (c.ts = l.ts AND c.id > l.id))) AS claimed_ts
FROM landed l
WHERE l.rn = 1
  AND COALESCE(json_extract(l.payload_json, '$.project_key'), json_extract(l.payload_json, '$.cwd')) = $1
  AND NOT EXISTS (
    SELECT 1 FROM events r
    WHERE r.type = 'result_reviewed' AND r.session_id = l.session_id
      AND json_valid(r.payload_json)
      AND json_extract(r.payload_json, '$.landed_id') = l.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM events p
    WHERE p.type = 'hook:UserPromptSubmit' AND p.session_id = l.session_id
      AND (p.ts > l.ts OR (p.ts = l.ts AND p.id > l.id))
      AND json_valid(p.payload_json)
      AND json_extract(p.payload_json, '$.provenance') = 'human'
  )
ORDER BY l.ts DESC, l.id DESC`;
