# Card Scanner

AI-powered multi-game trading card scanner and pricing platform. Identifies cards from photos using a two-tier pipeline (local PaddleOCR with Claude Haiku as a confidence-gated fallback) and provides pricing via the eBay Browse API plus full tournament deck building.

Currently supports Bo Jackson Battle Arena (BoBA) and Wonders of The First (WOTF). Hosted at boba.cards.

## Quick Start

```bash
npm install
npm run dev
```

See [CLAUDE.md](./CLAUDE.md) for complete developer documentation including architecture, conventions, environment variables, and deployment.

## Tech Stack

SvelteKit 2 · Svelte 5 (runes) · TypeScript · Supabase (PostgreSQL + RLS) · Claude API (Haiku/Sonnet) · PaddleOCR via @gutenye/ocr-browser · eBay API · Upstash (Redis + QStash) · Vercel

## License

MIT
