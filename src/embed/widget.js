// ============================================================
// src/embed/widget.js
// Embeddable card scanner widget for integration into other apps
// like Bazooka Vault.
//
// Usage:
//   import { createScanner } from './boba-scanner-widget.js';
//
//   const scanner = createScanner({
//     container: document.getElementById('scan-area'),
//     collectionType: 'boba',
//     databaseUrl: '/card-database.json',
//     apiEndpoint: '/api/anthropic',
//     onCardScanned: (card) => vault.addCard(card),
//     onError: (err) => console.error(err),
//   });
//
//   // Later: scanner.destroy();
// ============================================================

/**
 * Create a minimal card scanner widget.
 * @param {Object} options
 * @param {HTMLElement} options.container - DOM element to mount the scanner into
 * @param {string} [options.collectionType='boba'] - Collection adapter ID
 * @param {string} [options.databaseUrl='/card-database.json'] - URL to card database
 * @param {string} [options.apiEndpoint='/api/anthropic'] - AI recognition endpoint
 * @param {Function} [options.onCardScanned] - Callback when a card is successfully scanned
 * @param {Function} [options.onError] - Callback on scan error
 * @returns {{ scan: Function, destroy: Function }}
 */
export function createScanner(options = {}) {
    const {
        container,
        collectionType = 'boba',
        databaseUrl = '/card-database.json',
        apiEndpoint = '/api/anthropic',
        onCardScanned = () => {},
        onError = console.error,
    } = options;

    if (!container || !(container instanceof HTMLElement)) {
        throw new Error('createScanner: container must be a valid HTMLElement');
    }

    let destroyed = false;

    // ── Render minimal UI ─────────────────────────────────────────────────────
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
    const scanBtn = container.querySelector('.boba-scanner-btn');
    const statusEl = container.querySelector('.boba-scanner-status');
    const resultEl = container.querySelector('.boba-scanner-result');

    // ── File selection ────────────────────────────────────────────────────────
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
            const card = await processImage(file);
            if (destroyed) return;

            resultEl.style.display = '';
            resultEl.textContent = `Found: ${card.cardNumber || 'Unknown'}`;
            onCardScanned(card);
        } catch (err) {
            if (destroyed) return;
            statusEl.textContent = 'Scan failed';
            onError(err);
        }

        fileInput.value = '';
    });

    // ── Image processing ─────────────────────────────────────────────────────
    async function processImage(file) {
        // Compress image
        const compressed = await compressForUpload(file);
        const base64 = await blobToBase64(compressed);

        // Call AI endpoint
        const response = await fetch(apiEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image: base64,
                collectionType,
            }),
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const result = await response.json();
        return result;
    }

    function compressForUpload(file, maxSize = 1400, quality = 0.7) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
            img.onload = () => {
                URL.revokeObjectURL(url);
                const canvas = document.createElement('canvas');
                let { width, height } = img;
                if (width > maxSize || height > maxSize) {
                    const ratio = Math.min(maxSize / width, maxSize / height);
                    width = Math.round(width * ratio);
                    height = Math.round(height * ratio);
                }
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                canvas.toBlob(resolve, 'image/jpeg', quality);
            };
            img.src = url;
        });
    }

    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                // Strip the data URL prefix (e.g. "data:image/jpeg;base64,") to get raw base64
                const dataUrl = reader.result;
                const base64 = dataUrl.split(',')[1] || dataUrl;
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    // ── Public API ───────────────────────────────────────────────────────────
    return {
        /** Programmatically trigger a scan with a File object */
        async scan(file) {
            if (destroyed) throw new Error('Scanner destroyed');
            const card = await processImage(file);
            onCardScanned(card);
            return card;
        },

        /** Clean up and remove the widget */
        destroy() {
            destroyed = true;
            container.innerHTML = '';
        },
    };
}
