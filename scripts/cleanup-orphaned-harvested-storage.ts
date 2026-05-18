/**
 * Deletes orphaned files from card-images/harvested/ folder.
 *
 * Context: harvester wrote ~12k images here between 2026-04-19 and 2026-04-27,
 * then migrated to Cloudflare R2. Source files were never cleaned up.
 * Zero DB rows reference these files (verified 2026-05-18).
 *
 * Run:
 *   DRY_RUN=true  npx tsx scripts/cleanup-orphaned-harvested-storage.ts  # default
 *   DRY_RUN=false npx tsx scripts/cleanup-orphaned-harvested-storage.ts  # actually delete
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.env.DRY_RUN !== 'false';
const BUCKET = 'card-images';
const FOLDER = 'harvested';
const BATCH_SIZE = 1000;
const EXPECTED_COUNT_LOWER = 11000;
const EXPECTED_COUNT_UPPER = 13000;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('FATAL: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Pre-flight ref check.
 *
 * We MUST match only Supabase Storage URLs (which we're about to delete), not
 * R2 URLs. The R2 migration preserved the bucket prefix as the key, so R2 URLs
 * also contain the substring "/card-images/harvested/". A naive substring
 * filter flags ~12k already-migrated rows as false positives and aborts.
 *
 * `card_reference_images.image_path` is a storage path (not a URL); it lives
 * in a separate `references/` folder but we still defensively check.
 */
async function preflightDbRefCheck(): Promise<boolean> {
  const supabaseUrlChecks: Array<{ table: string; column: string }> = [
    { table: 'cards', column: 'image_url' },
    { table: 'ebay_card_images', column: 'image_url' },
    { table: 'ebay_card_images', column: 'thumbnail_url' },
    { table: 'ebay_listing_observations', column: 'image_url' },
    { table: 'external_pricing', column: 'ep_image_url' },
  ];

  let allClear = true;
  for (const { table, column } of supabaseUrlChecks) {
    const { count, error } = await supabase
      .from(table)
      .select(column, { count: 'exact', head: true })
      .like(column, 'https://%.supabase.co/storage/v1/object/public/card-images/harvested/%');

    if (error) {
      console.error(
        `✗ Pre-flight error on ${table}.${column}: ${error.message || '(empty)'}`
      );
      allClear = false;
      continue;
    }
    const c = count ?? 0;
    if (c > 0) {
      console.error(`✗ ABORT: ${c} rows in ${table}.${column} reference Supabase harvested/`);
      allClear = false;
    } else {
      console.log(`✓ ${table}.${column}: 0 refs`);
    }
  }

  const { count: refImgCount, error: refImgError } = await supabase
    .from('card_reference_images')
    .select('image_path', { count: 'exact', head: true })
    .or('image_path.like.card-images/harvested/%,image_path.like.harvested/%');
  if (refImgError) {
    console.error(
      `✗ Pre-flight error on card_reference_images.image_path: ${refImgError.message || '(empty)'}`
    );
    allClear = false;
  } else if ((refImgCount ?? 0) > 0) {
    console.error(
      `✗ ABORT: ${refImgCount} rows in card_reference_images.image_path reference harvested/`
    );
    allClear = false;
  } else {
    console.log('✓ card_reference_images.image_path: 0 refs');
  }

  return allClear;
}

async function fetchAllPaths(): Promise<string[]> {
  const paths: string[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(FOLDER, {
        limit: BATCH_SIZE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });

    if (error) {
      throw new Error(`list() failed at offset ${offset}: ${error.message}`);
    }
    if (!data || data.length === 0) break;

    for (const obj of data) {
      if (obj.id === null) continue;
      paths.push(`${FOLDER}/${obj.name}`);
    }

    console.log(`  listed ${paths.length} files so far...`);
    if (data.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  return paths;
}

async function removeBatched(paths: string[]): Promise<number> {
  let totalRemoved = 0;
  const totalBatches = Math.ceil(paths.length / BATCH_SIZE);

  for (let i = 0; i < paths.length; i += BATCH_SIZE) {
    const batch = paths.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    const { data, error } = await supabase.storage.from(BUCKET).remove(batch);

    if (error) {
      console.error(`✗ Batch ${batchNum}/${totalBatches} failed: ${error.message}`);
      throw error;
    }
    const removed = data?.length ?? 0;
    totalRemoved += removed;
    console.log(
      `  batch ${batchNum}/${totalBatches}: removed ${removed} (running total ${totalRemoved}/${paths.length})`
    );
  }
  return totalRemoved;
}

async function main() {
  const startedAt = Date.now();
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : '*** LIVE DELETE ***'}`);
  console.log(`Target: ${BUCKET}/${FOLDER}/`);
  console.log('---');

  console.log('Step 1: Pre-flight DB reference check');
  const ok = await preflightDbRefCheck();
  if (!ok) {
    console.error('\nPre-flight failed. Aborting without deleting anything.');
    process.exit(1);
  }

  console.log('\nStep 2: Listing files in harvested/');
  const paths = await fetchAllPaths();
  console.log(`\nFound ${paths.length} files`);

  if (paths.length < EXPECTED_COUNT_LOWER || paths.length > EXPECTED_COUNT_UPPER) {
    console.error(
      `\n✗ ABORT: file count ${paths.length} outside safe range ` +
        `[${EXPECTED_COUNT_LOWER}, ${EXPECTED_COUNT_UPPER}]. ` +
        `Investigate before re-running.`
    );
    process.exit(1);
  }

  if (paths.length === 0) {
    console.log('Nothing to delete. Done.');
    return;
  }

  console.log('Sample paths (first 3):');
  paths.slice(0, 3).forEach((p) => console.log(`  - ${p}`));

  if (DRY_RUN) {
    console.log('\nDRY RUN — no deletes performed.');
    console.log('Re-run with DRY_RUN=false to execute.');
    return;
  }

  console.log('\nStep 3: Deleting in batches of 1000');
  const removed = await removeBatched(paths);
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n✓ Done. Removed ${removed}/${paths.length} files in ${elapsedSec}s.`);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});
