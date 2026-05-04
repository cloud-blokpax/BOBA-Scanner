-- Phase 1 Doc 1.2 — consolidate client error logs into app_events.
-- Both error_logs and client_errors solved the same problem with
-- different schemas. Their data lands in app_events with source='client'
-- and richer fields go into error_detail jsonb.

INSERT INTO app_events (
  level, event_name, source, summary, error_code, error_detail,
  context, user_id, request_path, created_at, schema_version
)
SELECT
  'error' AS level,
  COALESCE(NULLIF(type, ''), 'client.error') AS event_name,
  'client' AS source,
  LEFT(COALESCE(message, ''), 500) AS summary,
  NULL AS error_code,
  jsonb_build_object(
    'message', message,
    'stack', stack,
    'file', file,
    'line', line,
    'col', col,
    'url', url,
    'user_agent', user_agent,
    'session_id', session_id,
    'legacy_table', 'error_logs'
  ) AS error_detail,
  '{}'::jsonb AS context,
  NULL::uuid AS user_id,
  NULL AS request_path,
  created_at,
  1 AS schema_version
FROM error_logs;

INSERT INTO app_events (
  level, event_name, source, summary, error_code, error_detail,
  context, user_id, request_path, created_at, schema_version
)
SELECT
  'error' AS level,
  COALESCE(NULLIF(error_type, ''), 'client.error') AS event_name,
  'client' AS source,
  LEFT(COALESCE(message, ''), 500) AS summary,
  NULL AS error_code,
  jsonb_build_object(
    'message', message,
    'stack', stack,
    'source_file', source,
    'line', line,
    'col', col,
    'url', url,
    'user_agent', user_agent,
    'flow', flow,
    'step', step,
    'heartbeat_age_ms', heartbeat_age_ms,
    'viewport', viewport,
    'memory_mb', memory_mb,
    'device_memory_gb', device_memory_gb,
    'connection_type', connection_type,
    'breadcrumbs', breadcrumbs,
    'resolved', resolved,
    'notes', notes,
    'legacy_table', 'client_errors'
  ) AS error_detail,
  '{}'::jsonb AS context,
  user_id,
  NULL AS request_path,
  created_at,
  1 AS schema_version
FROM client_errors;
