// onboarding.js — Value-first onboarding flow (ES Module)
// Lets users scan their first card before requiring any account creation.
// Camera permission priming screen, then straight to scanning.

import { showToast } from './toast.js';

const ONBOARDING_KEY = 'boba_onboarding_complete';

/**
 * Check if onboarding should be shown.
 */
function shouldShowOnboarding() {
  return !localStorage.getItem(ONBOARDING_KEY);
}

/**
 * Mark onboarding as complete.
 */
function completeOnboarding() {
  localStorage.setItem(ONBOARDING_KEY, '1');
}

/**
 * Show the onboarding flow.
 * Returns a promise that resolves when onboarding is dismissed.
 */
function showOnboarding() {
  return new Promise((resolve) => {
    if (!shouldShowOnboarding()) {
      resolve();
      return;
    }

    const html = `
      <div class="onboarding-overlay" id="onboardingOverlay">
        <div class="onboarding-content">
          <div class="onboarding-illustration">🎴</div>
          <h1 class="onboarding-title">Welcome to BOBA Scanner</h1>
          <p class="onboarding-subtitle">
            Instantly identify your Bo Jackson trading cards and discover their market value
          </p>

          <div class="onboarding-features">
            <div class="onboarding-feature">
              <span class="onboarding-feature-icon">📸</span>
              <div>
                <strong>Instant Scan</strong>
                <span>Point your camera at any card</span>
              </div>
            </div>
            <div class="onboarding-feature">
              <span class="onboarding-feature-icon">💰</span>
              <div>
                <strong>Market Prices</strong>
                <span>Real eBay sold prices in seconds</span>
              </div>
            </div>
            <div class="onboarding-feature">
              <span class="onboarding-feature-icon">📁</span>
              <div>
                <strong>Track Collection</strong>
                <span>Build and manage your portfolio</span>
              </div>
            </div>
          </div>

          <button class="onboarding-cta" id="onboardingCta">
            Scan Your First Card
          </button>

          <button class="onboarding-skip" id="onboardingSkip">
            Skip for now
          </button>

          <p class="onboarding-camera-note" id="onboardingCameraNote" style="display:none;">
            BOBA Scanner uses your camera to identify cards and show you prices.
            Your camera feed stays on your device — nothing is uploaded without your action.
          </p>
        </div>
      </div>

      <style>
        .onboarding-overlay {
          position: fixed;
          inset: 0;
          z-index: 10005;
          background: var(--bg-base);
          display: flex;
          align-items: center;
          justify-content: center;
          animation: onboardingFadeIn 400ms ease-out;
        }
        @keyframes onboardingFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .onboarding-content {
          text-align: center;
          padding: 32px 24px;
          max-width: 380px;
          width: 100%;
        }
        .onboarding-illustration {
          font-size: 72px;
          margin-bottom: 16px;
          animation: onboardingBounce 600ms cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        @keyframes onboardingBounce {
          from { transform: scale(0.5); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .onboarding-title {
          font-family: var(--font-display);
          font-size: 28px;
          font-weight: 800;
          color: var(--text-primary);
          margin: 0 0 8px;
        }
        .onboarding-subtitle {
          font-size: 15px;
          color: var(--text-secondary);
          margin: 0 0 28px;
          line-height: 1.5;
        }
        .onboarding-features {
          display: flex;
          flex-direction: column;
          gap: 14px;
          margin-bottom: 32px;
          text-align: left;
        }
        .onboarding-feature {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 12px 16px;
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: 14px;
        }
        .onboarding-feature-icon { font-size: 28px; flex-shrink: 0; }
        .onboarding-feature strong {
          display: block;
          font-size: 14px;
          color: var(--text-primary);
          margin-bottom: 2px;
        }
        .onboarding-feature span:last-child {
          font-size: 12px;
          color: var(--text-secondary);
        }
        .onboarding-cta {
          width: 100%;
          padding: 16px;
          border-radius: 14px;
          border: none;
          background: linear-gradient(150deg, #fbbf24, #f59e0b, #d97706);
          color: #0d1524;
          font-family: var(--font-display);
          font-size: 17px;
          font-weight: 700;
          cursor: pointer;
          transition: transform 100ms, box-shadow 150ms;
          box-shadow: 0 4px 20px rgba(245, 158, 11, 0.35);
          -webkit-tap-highlight-color: transparent;
        }
        .onboarding-cta:active {
          transform: scale(0.97);
        }
        .onboarding-skip {
          display: block;
          margin: 14px auto 0;
          background: none;
          border: none;
          color: var(--text-muted);
          font-size: 14px;
          cursor: pointer;
          padding: 8px;
        }
        .onboarding-camera-note {
          margin-top: 16px;
          font-size: 12px;
          color: var(--text-muted);
          line-height: 1.5;
        }
        @media (prefers-reduced-motion: reduce) {
          .onboarding-overlay { animation: none; }
          .onboarding-illustration { animation: none; }
        }
      </style>`;

    document.body.insertAdjacentHTML('beforeend', html);

    const overlay = document.getElementById('onboardingOverlay');

    function dismiss(scanNow) {
      completeOnboarding();
      overlay?.remove();
      resolve(scanNow);
    }

    document.getElementById('onboardingCta')?.addEventListener('click', () => {
      dismiss(true);
    });

    document.getElementById('onboardingSkip')?.addEventListener('click', () => {
      dismiss(false);
    });
  });
}

/**
 * Update the empty collection state with a better CTA.
 */
function enhanceEmptyState() {
  const empty = document.getElementById('emptyState');
  if (!empty) return;

  // Only modify if it has the default content
  if (empty.querySelector('.empty-state-enhanced')) return;

  empty.innerHTML = `
    <div class="empty-state-enhanced" style="text-align:center;padding:40px 24px;">
      <div style="font-size:64px;margin-bottom:16px;opacity:0.8;">🎴</div>
      <h3 style="font-family:var(--font-display);font-size:20px;font-weight:700;color:var(--text-primary);margin:0 0 8px;">
        Start Your Collection
      </h3>
      <p style="font-size:14px;color:var(--text-secondary);margin:0 0 20px;">
        Scan your first card to begin building your portfolio
      </p>
      <button onclick="if(window.openContinuousScanner)window.openContinuousScanner();else{var fi=document.getElementById('fileInput');if(fi){fi.removeAttribute('capture');fi.click();}}"
              style="padding:14px 32px;border-radius:14px;border:none;
                     background:linear-gradient(150deg,#fbbf24,#f59e0b,#d97706);
                     color:#0d1524;font-size:16px;font-weight:700;cursor:pointer;
                     box-shadow:0 4px 20px rgba(245,158,11,0.35);
                     font-family:var(--font-display);-webkit-tap-highlight-color:transparent;">
        Scan Your First Card
      </button>
    </div>`;
}

window.showOnboarding = showOnboarding;
window.shouldShowOnboarding = shouldShowOnboarding;
window.enhanceEmptyState = enhanceEmptyState;

export { showOnboarding, shouldShowOnboarding, completeOnboarding, enhanceEmptyState };
