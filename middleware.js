// Vercel Edge Middleware — Bot & Scraper Protection
// Returns 403 Forbidden for known bots, scrapers, and automated tools

const BLOCKED_USER_AGENTS = [
  // Scrapers & crawlers
  'scrapy', 'wget', 'curl', 'httpie', 'python-requests', 'python-urllib',
  'go-http-client', 'java/', 'apache-httpclient', 'okhttp',
  'node-fetch', 'axios/', 'got/',
  // Headless browsers & automation
  'headlesschrome', 'phantomjs', 'selenium', 'puppeteer', 'playwright',
  'webdriver', 'chromedriver',
  // SEO & content scrapers
  'semrush', 'ahrefs', 'mj12bot', 'dotbot', 'rogerbot', 'megaindex',
  'blexbot', 'linkfluence', 'dataforseo', 'serpstat', 'seokicks',
  // AI training crawlers
  'gptbot', 'chatgpt-user', 'claudebot', 'claude-web', 'anthropic',
  'ccbot', 'google-extended', 'bytespider', 'amazonbot',
  'facebookexternalhit', 'twitterbot',
  // Generic bots
  'bot/', 'spider/', 'crawl/', 'slurp', 'ia_archiver',
  'archive.org_bot', 'yandexbot', 'baiduspider', 'sogou',
  'exabot', 'konqueror', 'linkwalker', 'nutch',
  // HTTrack / offline browsers
  'httrack', 'offline', 'copier', 'mirror', 'grabber', 'sitesucker',
  'blackwidow', 'webcopier', 'webzip', 'teleport',
];

// Paths that should always be accessible (health checks, etc.)
const ALLOWED_PATHS = [
  '/api/config',  // needed for app initialization
];

export const config = {
  // Run middleware on all routes except static assets that Vercel serves from CDN
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

export default function middleware(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Allow specific paths through without checks
  if (ALLOWED_PATHS.some(p => pathname.startsWith(p))) {
    return;  // pass through
  }

  const userAgent = (request.headers.get('user-agent') || '').toLowerCase();

  // Block requests with no User-Agent (usually automated tools)
  if (!userAgent || userAgent.trim() === '') {
    return new Response(forbidden403Page(), {
      status: 403,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // Check against blocked user agents
  const isBlocked = BLOCKED_USER_AGENTS.some(bot => userAgent.includes(bot));
  if (isBlocked) {
    return new Response(forbidden403Page(), {
      status: 403,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // Block requests with suspicious headers that indicate automated tools
  const suspiciousHeaders = [
    'x-forwarded-for-original',  // proxy chains
  ];
  // Check for missing Accept header (browsers always send it)
  const acceptHeader = request.headers.get('accept');
  if (!acceptHeader && pathname === '/') {
    return new Response(forbidden403Page(), {
      status: 403,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // Pass through — legitimate request
  return;
}

function forbidden403Page() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>403 Forbidden</title>
  <style>
    body {
      margin: 0; display: flex; align-items: center; justify-content: center;
      min-height: 100vh; background: #0a0a0a; color: #666;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    }
    .container { text-align: center; }
    h1 { font-size: 72px; margin: 0; color: #333; }
    p { font-size: 16px; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>403</h1>
    <p>Access Denied</p>
  </div>
</body>
</html>`;
}
