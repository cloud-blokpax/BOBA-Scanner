// ios-install-prompt.js — Custom "Add to Home Screen" instructions for iOS (ES Module)
// Shows only when the app is running in browser mode (not standalone PWA).
// On iOS, beforeinstallprompt doesn't fire, so we show manual instructions.

const IOS_PROMPT_KEY = 'boba_ios_prompt_dismissed';
const IOS_PROMPT_DELAY_MS = 30000; // Show after 30s of use

/**
 * Initialize iOS install prompt logic.
 * Only shows on iOS Safari in browser mode.
 */
function initIOSInstallPrompt() {
  // Check if already in standalone mode
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  if (isStandalone) return;

  // Check if iOS
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  if (!isIOS) return;

  // Check if already dismissed
  if (localStorage.getItem(IOS_PROMPT_KEY)) return;

  // Show after a delay so the user has experienced the app first
  setTimeout(showIOSInstallPrompt, IOS_PROMPT_DELAY_MS);
}

function showIOSInstallPrompt() {
  const html = `
    <div class="ios-install-prompt" id="iosInstallPrompt">
      <div class="ios-install-content">
        <button class="ios-install-close" id="iosInstallClose">✕</button>
        <div style="font-size:32px;margin-bottom:8px;">🎴</div>
        <strong>Add BOBA Scanner to Home Screen</strong>
        <p>For the best experience, install the app:</p>
        <div class="ios-install-steps">
          <div class="ios-install-step">
            <span>1.</span> Tap the <strong>Share</strong> button <span style="font-size:18px;">⬆</span>
          </div>
          <div class="ios-install-step">
            <span>2.</span> Scroll down and tap <strong>Add to Home Screen</strong>
          </div>
          <div class="ios-install-step">
            <span>3.</span> Tap <strong>Add</strong> to confirm
          </div>
        </div>
      </div>
    </div>

    <style>
      .ios-install-prompt {
        position: fixed;
        bottom: calc(var(--bottom-nav-height) + var(--safe-bottom) + 16px);
        left: 16px;
        right: 16px;
        background: var(--bg-elevated);
        border: 1px solid var(--border-strong);
        border-radius: 16px;
        padding: 20px;
        z-index: var(--z-tooltip);
        box-shadow: 0 8px 32px rgba(0,0,0,0.6);
        animation: iosPromptSlide 300ms ease-out;
      }
      @keyframes iosPromptSlide {
        from { transform: translateY(20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      .ios-install-content {
        position: relative;
        text-align: center;
        color: var(--text-primary);
        font-size: 14px;
      }
      .ios-install-content strong { color: var(--gold); }
      .ios-install-content p {
        color: var(--text-secondary);
        margin: 6px 0 12px;
        font-size: 13px;
      }
      .ios-install-close {
        position: absolute;
        top: -8px;
        right: -8px;
        background: none;
        border: none;
        color: var(--text-muted);
        font-size: 16px;
        cursor: pointer;
        padding: 4px;
      }
      .ios-install-steps {
        text-align: left;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .ios-install-step {
        font-size: 13px;
        color: var(--text-secondary);
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .ios-install-step span:first-child {
        color: var(--gold);
        font-weight: 700;
      }
      @media (prefers-reduced-motion: reduce) {
        .ios-install-prompt { animation: none; }
      }
    </style>`;

  document.body.insertAdjacentHTML('beforeend', html);

  document.getElementById('iosInstallClose')?.addEventListener('click', () => {
    localStorage.setItem(IOS_PROMPT_KEY, '1');
    const el = document.getElementById('iosInstallPrompt');
    if (el) {
      el.style.transition = 'opacity 200ms, transform 200ms';
      el.style.opacity = '0';
      el.style.transform = 'translateY(20px)';
      setTimeout(() => el.remove(), 250);
    }
  });
}

export { initIOSInstallPrompt };
