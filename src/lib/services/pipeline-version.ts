/**
 * Single source of truth for the pipeline version string stamped on every
 * scan row. Bumped manually when the end-to-end pipeline changes shape in
 * a way that would invalidate cross-version analytics.
 *
 * Bump rules:
 * - Bump when tier ordering changes
 * - Bump when a new tier is added (e.g. Phase 2 embedding tier)
 * - Bump when Claude prompt structure changes materially
 * - Do NOT bump for schema column additions (those have their own schema_version)
 * - Do NOT bump for bug fixes that don't alter the shape of produced data
 */
export const PIPELINE_VERSION = 'phase0-session0.3' as const;
export type PipelineVersion = typeof PIPELINE_VERSION;
