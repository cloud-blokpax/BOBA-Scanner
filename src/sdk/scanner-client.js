// ============================================================
// src/sdk/scanner-client.js — Headless card scanner for embedding
// Provides the full scan pipeline (image compress → AI identify)
// without requiring DOM globals, event bus, or global state.
//
// Usage:
//   import { createScanner } from '@boba/scanner-sdk';
//   const scanner = createScanner({ collectionType: 'boba', apiEndpoint: '/api/anthropic' });
//   const result = await scanner.scan(file);
// ============================================================

/**
 * Create a headless card scanner.
 * @param {import('./types.js').ScannerOptions} options
 */
export function createScanner(options = {}) {
    const {
        collectionType = 'boba',
        apiEndpoint    = '/api/anthropic',
        apiToken       = null,
        databaseUrl    = null,
        onCardIdentified = () => {},
        onScanError      = console.error,
        onScanStart      = () => {},
        onScanProgress   = () => {},
    } = options;

    let _destroyed = false;
    const _listeners = {};

    // ── Event emitter ───────────────────────────────────────────────────────
    function on(event, fn) {
        if (!_listeners[event]) _listeners[event] = [];
        _listeners[event].push(fn);
        return () => off(event, fn);
    }

    function off(event, fn) {
        if (!_listeners[event]) return;
        _listeners[event] = _listeners[event].filter(f => f !== fn);
    }

    function _emit(event, data) {
        (_listeners[event] || []).forEach(fn => {
            try { fn(data); } catch (e) { console.error(`[Scanner SDK] Error in ${event} listener:`, e); }
        });
    }

    // ── Image compression ───────────────────────────────────────────────────
    function _compressImage(file, maxSize = 1400, quality = 0.7) {
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
                    width  = Math.round(width * ratio);
                    height = Math.round(height * ratio);
                }
                canvas.width  = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                canvas.toBlob(blob => {
                    if (!blob) return reject(new Error('Compression failed'));
                    resolve(blob);
                }, 'image/jpeg', quality);
            };
            img.src = url;
        });
    }

    function _blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const dataUrl = reader.result;
                resolve(dataUrl.split(',')[1] || dataUrl);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    // ── AI identification ───────────────────────────────────────────────────
    async function _callAI(base64) {
        const headers = { 'Content-Type': 'application/json' };
        if (apiToken) headers['X-Api-Token'] = apiToken;

        const body = {
            imageData: base64,
            collectionType,
        };

        const response = await fetch(apiEndpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        const textContent = data.content?.find(c => c.type === 'text');
        if (!textContent) throw new Error('No text in API response');

        const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON found in API response');

        return JSON.parse(jsonMatch[0]);
    }

    // ── Public API ──────────────────────────────────────────────────────────

    /**
     * Scan an image file and identify the card.
     * @param {File|Blob} file - Image file to scan
     * @returns {Promise<import('./types.js').ScanResult>}
     */
    async function scan(file) {
        if (_destroyed) throw new Error('Scanner has been destroyed');

        _emit('scan:start', { file });
        onScanStart({ file });

        try {
            _emit('scan:progress', { stage: 'compressing' });
            onScanProgress({ stage: 'compressing' });
            const compressed = await _compressImage(file);
            const base64 = await _blobToBase64(compressed);

            _emit('scan:progress', { stage: 'identifying' });
            onScanProgress({ stage: 'identifying' });
            const aiResult = await _callAI(base64);

            const result = {
                ...aiResult,
                scanMethod: 'ai',
                collectionType,
                imageUrl: URL.createObjectURL(compressed),
            };

            _emit('card:identified', result);
            onCardIdentified(result);
            return result;
        } catch (err) {
            _emit('scan:error', err);
            onScanError(err);
            throw err;
        }
    }

    /**
     * Identify a card from a pre-encoded base64 image.
     * @param {string} imageBase64 - Base64-encoded image data
     * @returns {Promise<import('./types.js').ScanResult>}
     */
    async function identify(imageBase64) {
        if (_destroyed) throw new Error('Scanner has been destroyed');

        _emit('scan:start', {});
        onScanStart({});

        try {
            const aiResult = await _callAI(imageBase64);
            const result = { ...aiResult, scanMethod: 'ai', collectionType };

            _emit('card:identified', result);
            onCardIdentified(result);
            return result;
        } catch (err) {
            _emit('scan:error', err);
            onScanError(err);
            throw err;
        }
    }

    /** Clean up resources. */
    function destroy() {
        _destroyed = true;
        Object.keys(_listeners).forEach(k => delete _listeners[k]);
    }

    return { scan, identify, destroy, on, off };
}
