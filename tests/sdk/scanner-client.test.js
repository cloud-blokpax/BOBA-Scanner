// tests/sdk/scanner-client.test.js — Tests for SDK scanner client
import { describe, it, expect } from 'vitest';

// Test the event emitter pattern used by scanner-client
describe('SDK Scanner Client - Event Emitter', () => {
    function createEmitter() {
        const listeners = {};
        return {
            on(event, fn) {
                if (!listeners[event]) listeners[event] = [];
                listeners[event].push(fn);
            },
            off(event, fn) {
                if (!listeners[event]) return;
                listeners[event] = listeners[event].filter(f => f !== fn);
            },
            emit(event, data) {
                (listeners[event] || []).forEach(fn => fn(data));
            },
            listenerCount(event) {
                return (listeners[event] || []).length;
            }
        };
    }

    it('registers and fires event listeners', () => {
        const emitter = createEmitter();
        let received = null;
        emitter.on('card:identified', (data) => { received = data; });
        emitter.emit('card:identified', { cardNumber: 'BF-108' });
        expect(received).toEqual({ cardNumber: 'BF-108' });
    });

    it('removes listeners with off()', () => {
        const emitter = createEmitter();
        const handler = () => {};
        emitter.on('test', handler);
        expect(emitter.listenerCount('test')).toBe(1);
        emitter.off('test', handler);
        expect(emitter.listenerCount('test')).toBe(0);
    });

    it('supports multiple listeners per event', () => {
        const emitter = createEmitter();
        const calls = [];
        emitter.on('scan:complete', () => calls.push('a'));
        emitter.on('scan:complete', () => calls.push('b'));
        emitter.emit('scan:complete', {});
        expect(calls).toEqual(['a', 'b']);
    });

    it('does not throw when emitting with no listeners', () => {
        const emitter = createEmitter();
        expect(() => emitter.emit('nonexistent', {})).not.toThrow();
    });
});

// Test the scanner options validation pattern
describe('SDK Scanner Options', () => {
    function validateOptions(options) {
        const errors = [];
        if (!options.adapter && !options.collectionType) {
            errors.push('Either adapter or collectionType is required');
        }
        if (!options.apiEndpoint) {
            errors.push('apiEndpoint is required');
        }
        return errors;
    }

    it('requires adapter or collectionType', () => {
        const errors = validateOptions({ apiEndpoint: '/api/scan' });
        expect(errors).toContain('Either adapter or collectionType is required');
    });

    it('requires apiEndpoint', () => {
        const errors = validateOptions({ collectionType: 'boba' });
        expect(errors).toContain('apiEndpoint is required');
    });

    it('passes with valid options', () => {
        const errors = validateOptions({ collectionType: 'boba', apiEndpoint: '/api/scan' });
        expect(errors).toHaveLength(0);
    });
});

// Test image compression utility pattern (used by scanner-client)
describe('SDK Image Compression', () => {
    it('validates maxSize parameter', () => {
        const validateMaxSize = (maxSize) => {
            if (typeof maxSize !== 'number' || maxSize < 100 || maxSize > 4096) {
                return false;
            }
            return true;
        };
        expect(validateMaxSize(1400)).toBe(true);
        expect(validateMaxSize(50)).toBe(false);
        expect(validateMaxSize(5000)).toBe(false);
        expect(validateMaxSize('big')).toBe(false);
    });
});
