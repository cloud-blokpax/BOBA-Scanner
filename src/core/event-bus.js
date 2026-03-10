// ============================================================
// src/core/event-bus.js
// Simple pub/sub event bus for cross-module communication.
// Replaces `typeof fn === 'function' && fn()` guards with
// explicit event contracts between modules.
//
// Usage:
//   emit('cards:changed', { collectionId })
//   on('cards:changed', ({ collectionId }) => renderCards())
//   off('cards:changed', handler)
// ============================================================

const _busListeners = {};

function on(event, fn) {
    (_busListeners[event] ||= []).push(fn);
}

function off(event, fn) {
    if (_busListeners[event]) {
        _busListeners[event] = _busListeners[event].filter(f => f !== fn);
    }
}

function emit(event, ...args) {
    for (const fn of _busListeners[event] || []) {
        try {
            fn(...args);
        } catch (e) {
            console.error(`[EventBus] "${event}" handler error:`, e);
        }
    }
}
