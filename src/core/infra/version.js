// ============================================================
// js/version.js — App versioning + update banner
// Shows a non-intrusive banner when a newer version is deployed.
// ============================================================

import { escapeHtml } from '../../ui/utils.js';

export const APP_VERSION = '1.1.0';

export async function checkForUpdates() {
  try {
    const res = await fetch(`/version.json?_=${Date.now()}`);
    if (!res.ok) return;
    const remote = await res.json();

    const stored = localStorage.getItem('knownAppVersion');
    if (stored && stored !== remote.version) {
      showUpdateBanner(remote.version, remote.notes || '');
    }
    localStorage.setItem('knownAppVersion', remote.version);
  } catch (e) {
    // Non-critical — silent fail
  }
}

export function showUpdateBanner(version, notes) {
  if (document.getElementById('updateBanner')) return;

  const banner = document.createElement('div');
  banner.id = 'updateBanner';
  banner.className = 'update-banner';
  banner.innerHTML = `
    <div class="update-banner-content">
      <span class="update-banner-icon">✨</span>
      <span class="update-banner-text">
        <strong>Update available (v${escapeHtml(version)})</strong>
        ${notes ? `<span class="update-banner-notes"> — ${escapeHtml(notes)}</span>` : ''}
      </span>
    </div>
    <div class="update-banner-actions">
      <button class="update-banner-btn update-banner-refresh" onclick="window.location.reload(true)">
        Refresh Now
      </button>
      <button class="update-banner-btn update-banner-dismiss" onclick="document.getElementById('updateBanner').remove()">
        ✕
      </button>
    </div>
  `;

  // Insert after header
  const header = document.querySelector('.app-header');
  if (header?.nextSibling) {
    header.parentNode.insertBefore(banner, header.nextSibling);
  } else {
    document.body.prepend(banner);
  }
}

// Display version in settings modal when opened
export function injectVersionIntoSettings() {
  const existingVersion = document.getElementById('settingsVersionInfo');
  if (existingVersion) return;

  const settingsBody = document.querySelector('#settingsModal .modal-body');
  if (!settingsBody) return;

  const versionEl = document.createElement('div');
  versionEl.id = 'settingsVersionInfo';
  versionEl.className = 'setting-group';
  versionEl.innerHTML = `
    <h3>About</h3>
    <p style="font-size:13px;color:#666;margin:0;">
      BOBA Scanner v${APP_VERSION}
      <button id="versionCheckBtn"
              style="margin-left:10px;padding:3px 10px;font-size:12px;border:1px solid #ddd;
                     border-radius:6px;background:white;cursor:pointer;">
        Check for updates
      </button>
    </p>
  `;
  settingsBody.appendChild(versionEl);
  document.getElementById('versionCheckBtn')?.addEventListener('click', () => {
    checkForUpdates().then(() => {
      if (typeof window.showToast === 'function') window.showToast('Version check complete', '✓');
    });
  });
}

// Run version check 4 seconds after load (non-blocking)
setTimeout(checkForUpdates, 4000);
// Re-check every 30 minutes
setInterval(checkForUpdates, 30 * 60 * 1000);

// Hook into settings open
const _origOpenSettings = window.openSettings;
window.openSettings = function() {
  if (typeof _origOpenSettings === 'function') _origOpenSettings();
  setTimeout(injectVersionIntoSettings, 50);
};

console.log(`✅ Version module loaded (v${APP_VERSION})`);
