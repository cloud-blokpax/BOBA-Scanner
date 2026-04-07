/**
 * Download Card Images to Supabase Storage
 *
 * Reads all cards with GCS image_url from Supabase, downloads the images,
 * and uploads them to your own Supabase Storage bucket. Then generates SQL
 * to update image_url to point to your copies.
 *
 * Prerequisites:
 *   - .env file with PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 *   - The 'scans' storage bucket must exist and allow public reads
 *
 * Usage: npx tsx scripts/download-carde-images.ts
 *
 * Options:
 *   --dry-run     Show what would be downloaded without uploading
 *   --skip-existing  Skip images that already exist in storage
 *   --concurrency=N  Number of parallel downloads (default: 5)
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'fs';
import { config } from 'dotenv';

// Load .env
config();

// ── Config ───────────────────────────────────────────────────────
const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const STORAGE_BUCKET = 'scans';
const STORAGE_PREFIX = 'card-images';
const CONCURRENCY = parseInt(process.argv.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '5');
const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_EXISTING = process.argv.includes('--skip-existing');

// ── Validate env ─────────────────────────────────────────────────
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing env vars. Need PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Types ────────────────────────────────────────────────────────
interface CardRow {
  id: string;
  image_url: string;
}

interface DownloadResult {
  cardId: string;
  gcsUrl: string;
  slug: string;
  success: boolean;
  supabaseUrl?: string;
  error?: string;
  skipped?: boolean;
}

// ── Extract slug from GCS URL ────────────────────────────────────
function extractSlug(gcsUrl: string): string {
  // URL pattern: https://storage.googleapis.com/cardeio-images/.../small/SLUG.webp
  const match = gcsUrl.match(/\/([^/]+)\.webp$/);
  return match ? match[1] : '';
}

// ── Fetch all cards with GCS image URLs from Supabase ────────────
async function fetchCardsWithGcsImages(): Promise<CardRow[]> {
  console.log('Querying Supabase for cards with GCS image URLs...');
  const all: CardRow[] = [];
  const PAGE = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('cards')
      .select('id, image_url')
      .like('image_url', '%storage.googleapis.com/cardeio-images%')
      .range(from, from + PAGE - 1);

    if (error) {
      console.error('Supabase query error:', error.message);
      break;
    }
    if (!data || data.length === 0) break;

    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  return all;
}

// ── Download from GCS and upload to Supabase Storage ─────────────
async function downloadAndUpload(card: CardRow): Promise<DownloadResult> {
  const slug = extractSlug(card.image_url);
  if (!slug) {
    return { cardId: card.id, gcsUrl: card.image_url, slug: '', success: false, error: 'Could not extract slug from URL' };
  }

  const storagePath = `${STORAGE_PREFIX}/${slug}.webp`;

  try {
    // Check if already exists
    if (SKIP_EXISTING) {
      const { data } = await supabase.storage
        .from(STORAGE_BUCKET)
        .list(STORAGE_PREFIX, { search: `${slug}.webp`, limit: 1 });
      if (data && data.length > 0) {
        return { cardId: card.id, gcsUrl: card.image_url, slug, success: true, skipped: true };
      }
    }

    // Download from GCS
    const response = await fetch(card.image_url);
    if (!response.ok) {
      return { cardId: card.id, gcsUrl: card.image_url, slug, success: false, error: `GCS returned ${response.status}` };
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (DRY_RUN) {
      return {
        cardId: card.id,
        gcsUrl: card.image_url,
        slug,
        success: true,
        supabaseUrl: `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${storagePath}`,
      };
    }

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, buffer, {
        contentType: 'image/webp',
        upsert: true,
      });

    if (uploadError) {
      return { cardId: card.id, gcsUrl: card.image_url, slug, success: false, error: uploadError.message };
    }

    const supabaseUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${storagePath}`;
    return { cardId: card.id, gcsUrl: card.image_url, slug, success: true, supabaseUrl };
  } catch (err) {
    return { cardId: card.id, gcsUrl: card.image_url, slug, success: false, error: String(err) };
  }
}

// ── Process in batches with concurrency control ──────────────────
async function processBatch(cards: CardRow[]): Promise<DownloadResult[]> {
  const results: DownloadResult[] = [];
  let completed = 0;

  for (let i = 0; i < cards.length; i += CONCURRENCY) {
    const batch = cards.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(downloadAndUpload));
    results.push(...batchResults);

    completed += batch.length;
    const successCount = results.filter(r => r.success && !r.skipped).length;
    const skipCount = results.filter(r => r.skipped).length;
    const failCount = results.filter(r => !r.success).length;

    if (completed % 50 === 0 || completed === cards.length) {
      console.log(
        `  Progress: ${completed}/${cards.length} ` +
        `(uploaded: ${successCount}, skipped: ${skipCount}, failed: ${failCount})`
      );
    }
  }

  return results;
}

// ── Generate SQL to swap GCS URLs to Supabase URLs ───────────────
function generateSwapSQL(results: DownloadResult[]): string {
  const lines: string[] = [];

  lines.push('-- Swap GCS image URLs to Supabase Storage URLs');
  lines.push(`-- Generated: ${new Date().toISOString()}`);
  lines.push('-- Run this AFTER confirming images uploaded successfully.');
  lines.push('');
  lines.push('BEGIN;');
  lines.push('');

  const successful = results.filter(r => r.success && r.supabaseUrl && !r.skipped);

  for (const r of successful) {
    const safeGcsUrl = r.gcsUrl.replace(/'/g, "''");
    const safeSupaUrl = r.supabaseUrl!.replace(/'/g, "''");

    lines.push(`UPDATE cards SET image_url = '${safeSupaUrl}'`);
    lines.push(`  WHERE id = '${r.cardId.replace(/'/g, "''")}';`);
    lines.push('');
  }

  lines.push('COMMIT;');
  lines.push('');

  // Verification
  lines.push('-- VERIFICATION');
  lines.push('-- Should return 0:');
  lines.push("SELECT COUNT(*) AS still_on_gcs FROM cards");
  lines.push("  WHERE image_url LIKE '%storage.googleapis.com/cardeio-images%';");
  lines.push('');
  lines.push('-- Should match your total card count:');
  lines.push("SELECT COUNT(*) AS now_on_supabase FROM cards");
  lines.push(`  WHERE image_url LIKE '${SUPABASE_URL}/storage%';`);

  return lines.join('\n');
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  console.log('Card Image Download & Upload to Supabase Storage');
  console.log('=================================================');
  console.log(`  Bucket:      ${STORAGE_BUCKET}/${STORAGE_PREFIX}/`);
  console.log(`  Concurrency: ${CONCURRENCY}`);
  console.log(`  Dry run:     ${DRY_RUN}`);
  console.log(`  Skip exist:  ${SKIP_EXISTING}`);
  console.log('');

  // Fetch cards from Supabase that still point to GCS
  const cards = await fetchCardsWithGcsImages();
  console.log(`Found ${cards.length} cards with GCS image URLs\n`);

  if (cards.length === 0) {
    console.log('Nothing to do — all cards already migrated or no GCS URLs found.');
    return;
  }

  console.log(DRY_RUN ? 'Dry run — no uploads will happen\n' : 'Downloading and uploading...\n');
  const results = await processBatch(cards);

  // Report
  const uploaded = results.filter(r => r.success && !r.skipped);
  const skipped = results.filter(r => r.skipped);
  const failed = results.filter(r => !r.success);

  console.log('\nResults:');
  console.log(`  Uploaded:  ${uploaded.length}`);
  console.log(`  Skipped:   ${skipped.length}`);
  console.log(`  Failed:    ${failed.length}`);

  if (failed.length > 0) {
    console.log('\nFailed images:');
    for (const f of failed.slice(0, 20)) {
      console.log(`  ${f.cardId} (${f.slug}): ${f.error}`);
    }
    if (failed.length > 20) {
      console.log(`  ... and ${failed.length - 20} more`);
    }
  }

  // Generate output
  mkdirSync('scripts/output', { recursive: true });

  if (!DRY_RUN && uploaded.length > 0) {
    const sql = generateSwapSQL(results);
    writeFileSync('scripts/output/swap-image-urls.sql', sql);
    console.log('\nGenerated scripts/output/swap-image-urls.sql');
    console.log('  Run this in Supabase SQL Editor to point image_url at your copies.');
  }

  // Save results for debugging
  writeFileSync('scripts/output/download-results.json', JSON.stringify({
    timestamp: new Date().toISOString(),
    total: cards.length,
    uploaded: uploaded.length,
    skipped: skipped.length,
    failed: failed.length,
    failures: failed.map(f => ({ cardId: f.cardId, slug: f.slug, error: f.error })),
  }, null, 2));
  console.log('Generated scripts/output/download-results.json');

  if (failed.length > 0) {
    console.log(`\nRe-run with --skip-existing to retry only failed images.`);
  }

  console.log('\nDone!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
