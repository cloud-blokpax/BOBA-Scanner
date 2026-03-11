// ============================================================
// src/embed/widget.js
// Embeddable card scanner widget for integration into other apps
// like Bazooka Vault. Now powered by the headless scanner-client.
//
// Usage:
//   import { createWidget } from '@boba/scanner-sdk';
//
//   const widget = createWidget({
//     container: document.getElementById('scan-area'),
//     collectionType: 'boba',
//     apiEndpoint: '/api/anthropic',
//     onCardScanned: (card) => vault.addCard(card),
//     onError: (err) => console.error(err),
//   });
//
//   // Headless mode (no UI):
//   const widget = createWidget({ container: el, ui: false, ... });
//   const result = await widget.scan(file);
//
//   // Later: widget.destroy();
// ============================================================

import { createScanner } from '../sdk/scanner-client.js';

/**
 * Create an embeddable card scanner widget.
 * @param {import('../sdk/types.js').WidgetOptions} options
 * @returns {{ scan: Function, destroy: Function, on: Function, off: Function }}
 */
export function createWidget(options = {}) {
    const {
        container,
        ui             = true,
        collectionType = 'boba',
        apiEndpoint    = '/api/anthropic',
        apiToken       = null,
        databaseUrl    = null,
        onCardScanned  = () => {},
        onError        = console.error,
    } = options;

    if (!container || !(container instanceof HTMLElement)) {
        throw new Error('createWidget: container must be a valid HTMLElement');
    }

    // Create headless scanner instance
    const scanner = createScanner({
        collectionType,
        apiEndpoint,
        apiToken,
        databaseUrl,
        onCardIdentified: onCardScanned,
        onScanError: onError,
    });

    let destroyed = false;

    // ── Render UI (optional) ────────────────────────────────────────────────
    if (ui) {
        container.innerHTML = `
            <div class="boba-scanner-widget">
                <div class="boba-scanner-upload">
                    <input type="file" accept="image/*" capture="environment"
                           class="boba-scanner-input" style="display:none">
                    <button class="boba-scanner-btn" type="button">
                        Scan Card
                    </button>
                    <div class="boba-scanner-status" style="display:none"></div>
                </div>
                <div class="boba-scanner-result" style="display:none"></div>
            </div>
        `;

        const fileInput = container.querySelector('.boba-scanner-input');
        const scanBtn   = container.querySelector('.boba-scanner-btn');
        const statusEl  = container.querySelector('.boba-scanner-status');
        const resultEl  = container.querySelector('.boba-scanner-result');

        scanBtn.addEventListener('click', () => {
            if (!destroyed) fileInput.click();
        });

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file || destroyed) return;

            statusEl.style.display = '';
            statusEl.textContent = 'Processing...';
            resultEl.style.display = 'none';

            try {
                const card = await scanner.scan(file);
                if (destroyed) return;

                resultEl.style.display = '';
                resultEl.textContent = `Found: ${card.cardNumber || 'Unknown'}`;
            } catch (err) {
                if (destroyed) return;
                statusEl.textContent = 'Scan failed';
            }

            fileInput.value = '';
        });
    }

    // ── Public API ──────────────────────────────────────────────────────────
    return {
        /** Programmatically trigger a scan with a File object */
        async scan(file) {
            if (destroyed) throw new Error('Widget destroyed');
            return scanner.scan(file);
        },

        /** Identify from pre-encoded base64 */
        async identify(imageBase64) {
            if (destroyed) throw new Error('Widget destroyed');
            return scanner.identify(imageBase64);
        },

        /** Subscribe to scanner events */
        on: scanner.on,

        /** Unsubscribe from scanner events */
        off: scanner.off,

        /** Clean up and remove the widget */
        destroy() {
            destroyed = true;
            scanner.destroy();
            if (ui) container.innerHTML = '';
        },
    };
}

// Keep backward-compatible export name
export const createScanner = createWidget;
