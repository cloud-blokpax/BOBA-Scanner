# Scan Pipeline Benchmark

Reference test set for the pre-launch geometry rebuild and all subsequent
scan pipeline changes. Every PR that touches scan code MUST run this benchmark
and attach the results to the PR description.

## Files

- `images/` — 30 photos (5 cards × 6 conditions). Not committed by default
  if the cards are personal property; `.gitignore` excludes `images/*.jpg`.
  Re-shoot or check with admin if running locally.
- `ground-truth.json` — what each photo SHOULD identify as.
- `run-bench.ts` — runs the current pipeline against the images, produces a
  JSON report at `reports/{timestamp}.json`.
- `compare-reports.ts` — diffs two reports; used to compare baseline vs
  post-rebuild.
- `reports/` — historical baseline runs. Keep the pre-rebuild baseline
  (`reports/baseline-pre-geometry-rebuild.json`) forever.

## Running

```bash
# Place the 30 photos in tests/scan-bench/images/ first.
# Start the dev server in one terminal:
npm run dev

# In another terminal:
npm run bench:scan

# Compare against the baseline:
npm run bench:scan:compare \
  tests/scan-bench/reports/baseline-pre-geometry-rebuild.json \
  tests/scan-bench/reports/{latest}.json
```

## Naming convention

Photos are named `card{N}_C{M}.jpg` where N is 1–5 (the card) and M is 1–6
(the condition). The harness parses these names; stick to the convention
exactly.

Conditions:
- C1 — flat & clean
- C2 — 15° tilt
- C3 — 25° two-axis tilt
- C4 — distant
- C5 — low light
- C6 — glare on foil/holo

## What "pass" means

A change that touches the scan pipeline passes the benchmark if:

1. **No regressions on C1–C2** (easy + mild tilt). Identification rate
   stays at 100%, latency stays within ±20% of baseline.
2. **Improvement OR no regression on C3–C6** (hard cases). Identification
   rate >= baseline.

The geometry rebuild specifically should show measurable gains on C2–C4.
