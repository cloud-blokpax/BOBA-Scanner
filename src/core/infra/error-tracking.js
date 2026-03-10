// error-tracking.js — Lightweight client-side error tracking (ES Module)
// Captures unhandled errors and promise rejections, sends to /api/log via sendBeacon.
// No external dependencies. Privacy-respecting — no PII collected.

const ERROR_QUEUE = [];
const MAX_QUEUE = 10;
const FLUSH_INTERVAL = 30000; // 30 seconds

function createErrorPayload(type, data) {
  return {
    type,
    message: (data.message || '').slice(0, 500),
    file: (data.file || '').replace(location.origin, ''),
    line: data.line || 0,
    col: data.col || 0,
    stack: (data.stack || '').slice(0, 800),
    url: location.pathname,
    ua: navigator.userAgent.slice(0, 200),
    ts: Date.now(),
    session: _getSessionId()
  };
}

// Stable session ID for correlating errors within a visit
function _getSessionId() {
  if (!window._errorSessionId) {
    window._errorSessionId = Math.random().toString(36).slice(2, 10);
  }
  return window._errorSessionId;
}

function queueError(payload) {
  ERROR_QUEUE.push(payload);
  if (ERROR_QUEUE.length >= MAX_QUEUE) {
    flushErrors();
  }
}

function flushErrors() {
  if (ERROR_QUEUE.length === 0) return;
  const batch = ERROR_QUEUE.splice(0, MAX_QUEUE);
  try {
    const blob = new Blob([JSON.stringify(batch)], { type: 'application/json' });
    navigator.sendBeacon('/api/log', blob);
  } catch {
    // sendBeacon not available or failed — errors are lost (acceptable)
  }
}

// Capture global errors
window.addEventListener('error', (event) => {
  queueError(createErrorPayload('error', {
    message: event.message,
    file: event.filename,
    line: event.lineno,
    col: event.colno,
    stack: event.error?.stack
  }));
});

// Capture unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  queueError(createErrorPayload('unhandled_rejection', {
    message: reason instanceof Error ? reason.message : String(reason).slice(0, 500),
    stack: reason instanceof Error ? reason.stack : ''
  }));
});

// Flush on page unload
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushErrors();
});

// Periodic flush
setInterval(flushErrors, FLUSH_INTERVAL);

// Track scan performance metrics
function trackScanMetric(metric) {
  queueError(createErrorPayload('metric', {
    message: JSON.stringify(metric)
  }));
}

window.trackScanMetric = trackScanMetric;

export { trackScanMetric };

console.log('✅ Error tracking loaded');
