/**
 * Download Carde.io Card Images to Supabase Storage
 *
 * Fetches all BoBA card images from GCS and uploads them to your
 * Supabase Storage bucket. Then generates SQL to update image_url
 * to point to your own copies.
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
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { config } from 'dotenv';

// Load .env
config();

// ── Config ───────────────────────────────────────────────────────
const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const GAME_ID = '651f3b0e5f72a5fca3f6fe34';
const API_BASE = 'https://play-api.carde.io/v1/cards';
const PAGE_SIZE = 50;
const STORAGE_BUCKET = 'scans';
const STORAGE_PREFIX = 'card-images';
const CONCURRENCY = parseInt(process.argv.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '5');
const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_EXISTING = process.argv.includes('--skip-existing');

// ── Validate env ─────────────────────────────────────────────────
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing env vars. Need PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Types ────────────────────────────────────────────────────────
interface CardeCard {
  id: string;
  name: string;
  slug: string;
  imageUrl: string;
  cardType: { name: string };
  subtype: { name: string };
  element: { name: string };
}

interface DownloadResult {
  slug: string;
  success: boolean;
  supabaseUrl?: string;
  error?: string;
  skipped?: boolean;
}

// ── Fetch all cards from Carde.io API ────────────────────────────
async function fetchAllCards(): Promise<CardeCard[]> {
  // Try loading from cached JSON first (from the backfill script)
  const cachePath = 'scripts/output/carde-mapping.json';
  if (existsSync(cachePath)) {
    console.log('📦 Loading card data from cached mapping file...');
    const cached = JSON.parse(readFileSync(cachePath, 'utf-8'));
    // Convert mapping format back to CardeCard format
    return cached.map((c: Record<string, string>) => ({
      id: c.carde_id,
      name: c.carde_name,
      slug: c.carde_slug,
      imageUrl: c.image_url,
      cardType: { name: c.card_type },
      subtype: { name: '' },
      element: { name: c.weapon_type || 'None' },
    }));
  }

  console.log('🌐 Fetching card data from Carde.io API...');
  const all: CardeCard[] = [];
  let page = 1;

  while (true) {
    const url = `${API_BASE}/${GAME_ID}?limit=${PAGE_SIZE}&page=${page}`;
    const res = await fetch(url);
    if (!res.ok) break;

    const json = await res.json();
    const data = json.data as CardeCard[];
    if (!data || data.length === 0) break;

    all.push(...data);
    if (page >= json.pagination.totalPages) break;
    page++;
  }

  console.log(`✓ Fetched ${all.length} cards\n`);
  return all;
}

// ── Check if image already exists in storage ─────────────────────
async function imageExists(storagePath: string): Promise<boolean> {
  const { data } = await supabase.storage
    .from(STORAGE_BUCKET)
    .list(STORAGE_PREFIX, {
      search: storagePath.replace(`${STORAGE_PREFIX}/`, ''),
      limit: 1
    });
  return (data?.length ?? 0) > 0;
}

// ── Download from GCS and upload to Supabase ─────────────────────
async function downloadAndUpload(card: CardeCard): Promise<DownloadResult> {
  const storagePath = `${STORAGE_PREFIX}/${card.slug}.webp`;

  try {
    // Check if already exists
    if (SKIP_EXISTING) {
      const exists = await imageExists(storagePath);
      if (exists) {
        return { slug: card.slug, success: true, skipped: true };
      }
    }

    // Download from GCS
    const response = await fetch(card.imageUrl);
    if (!response.ok) {
      return { slug: card.slug, success: false, error: `GCS returned ${response.status}` };
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (DRY_RUN) {
      return {
        slug: card.slug,
        success: true,
        supabaseUrl: `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${storagePath}`,
      };
    }

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, buffer, {
        contentType: 'image/webp',
        upsert: true,  // overwrite if exists
      });

    if (uploadError) {
      return { slug: card.slug, success: false, error: uploadError.message };
    }

    const supabaseUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${storagePath}`;
    return { slug: card.slug, success: true, supabaseUrl };
  } catch (err) {
    return { slug: card.slug, success: false, error: String(err) };
  }
}

// ── Process in batches with concurrency control ──────────────────
async function processBatch(cards: CardeCard[]): Promise<DownloadResult[]> {
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

    // Progress update every 50 cards
    if (completed % 50 === 0 || completed === cards.length) {
      console.log(
        `  Progress: ${completed}/${cards.length} ` +
        `(✓ ${successCount} uploaded, ⏭ ${skipCount} skipped, ✗ ${failCount} failed)`
      );
    }
  }

  return results;
}

// ── Generate SQL to swap GCS URLs → Supabase URLs ───────────────
function generateSwapSQL(results: DownloadResult[]): string {
  const lines: string[] = [];

  lines.push('-- ═══════════════════════════════════════════════════════════');
  lines.push('-- Swap GCS image URLs → Supabase Storage URLs');
  lines.push(`-- Generated: ${new Date().toISOString()}`);
  lines.push('-- Run this AFTER confirming images uploaded successfully.');
  lines.push('-- ═══════════════════════════════════════════════════════════');
  lines.push('');
  lines.push('BEGIN;');
  lines.push('');

  const successful = results.filter(r => r.success && r.supabaseUrl && !r.skipped);

  for (const r of successful) {
    const gcsUrl = `https://storage.googleapis.com/cardeio-images/bo-jackson-battle-arena/cards/small/${r.slug}.webp`;
    const safeGcsUrl = gcsUrl.replace(/'/g, "''");
    const safeSupaUrl = r.supabaseUrl!.replace(/'/g, "''");

    // Update cards table (hero cards)
    lines.push(`UPDATE cards SET image_url = '${safeSupaUrl}'`);
    lines.push(`  WHERE image_url = '${safeGcsUrl}';`);

    // Update play_cards table
    lines.push(`UPDATE play_cards SET image_url = '${safeSupaUrl}'`);
    lines.push(`  WHERE image_url = '${safeGcsUrl}';`);
    lines.push('');
  }

  lines.push('COMMIT;');
  lines.push('');

  // Verification
  lines.push('-- ═══ VERIFICATION ═══');
  lines.push('-- After running, confirm no GCS URLs remain:');
  lines.push("SELECT COUNT(*) AS still_on_gcs FROM cards");
  lines.push("  WHERE image_url LIKE '%storage.googleapis.com/cardeio-images%';");
  lines.push('');
  lines.push("SELECT COUNT(*) AS now_on_supabase FROM cards");
  lines.push(`  WHERE image_url LIKE '%${SUPABASE_URL}/storage%';`);

  return lines.join('\n');
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  console.log('📸 Carde.io Image Download & Upload');
  console.log('====================================');
  console.log(`  Bucket:      ${STORAGE_BUCKET}/${STORAGE_PREFIX}/`);
  console.log(`  Concurrency: ${CONCURRENCY}`);
  console.log(`  Dry run:     ${DRY_RUN}`);
  console.log(`  Skip exist:  ${SKIP_EXISTING}`);
  console.log('');

  // Fetch card data
  const cards = await fetchAllCards();
  console.log(`Found ${cards.length} cards to process\n`);

  // Download and upload
  console.log(DRY_RUN ? '🔍 Dry run — no uploads will happen\n' : '⬇️  Downloading and uploading...\n');
  const results = await processBatch(cards);

  // Report
  const uploaded = results.filter(r => r.success && !r.skipped);
  const skipped = results.filter(r => r.skipped);
  const failed = results.filter(r => !r.success);

  console.log('\n📊 Results:');
  console.log(`  ✓ Uploaded:  ${uploaded.length}`);
  console.log(`  ⏭ Skipped:   ${skipped.length}`);
  console.log(`  ✗ Failed:    ${failed.length}`);

  if (failed.length > 0) {
    console.log('\n❌ Failed images:');
    for (const f of failed.slice(0, 20)) {
      console.log(`  ${f.slug}: ${f.error}`);
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
    console.log('\n✓ Generated scripts/output/swap-image-urls.sql');
    console.log('  Run this in Supabase SQL Editor to point image_url at your copies.');
  }

  // Save results for debugging
  writeFileSync('scripts/output/download-results.json', JSON.stringify({
    timestamp: new Date().toISOString(),
    total: cards.length,
    uploaded: uploaded.length,
    skipped: skipped.length,
    failed: failed.length,
    failures: failed.map(f => ({ slug: f.slug, error: f.error })),
  }, null, 2));
  console.log('✓ Generated scripts/output/download-results.json');

  if (failed.length > 0) {
    console.log(`\n⚠ Re-run with --skip-existing to retry only failed images.`);
  }

  console.log('\n✅ Done!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
