# BOBA Scanner 

AI-powered card scanner for Bo Jackson Battle Arena (BoBA) trading cards. Identifies cards from photos using a three-tier pipeline (hash cache, OCR, Claude AI), with pricing via eBay Browse API and full tournament deck building.

## Quick Start

```bash
npm install
npm run dev
```

See [CLAUDE.md](./CLAUDE.md) for complete developer documentation including architecture, conventions, environment variables, and deployment.

## Tech Stack

SvelteKit 2 · Svelte 5 · TypeScript · Supabase · Claude API (Haiku/Sonnet) · Tesseract.js · eBay API · Vercel

## License

MIT
