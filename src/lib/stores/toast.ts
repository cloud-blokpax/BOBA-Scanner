/**
 * Toast notification store.
 *
 * Replaces legacy src/ui/toast.js.
 */

import { writable } from 'svelte/store';

export interface ToastMessage {
	id: string;
	message: string;
	icon: string;
	duration: number;
}

export const toasts = writable<ToastMessage[]>([]);

// Track active timers so they can be cancelled on early dismissal
const _toastTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Show a toast notification.
 */
export function showToast(message: string, icon = '', duration = 3000): void {
	const id = Math.random().toString(36).slice(2, 8);
	toasts.update((t) => [...t, { id, message, icon, duration }]);

	const timer = setTimeout(() => {
		_toastTimers.delete(id);
		toasts.update((t) => t.filter((toast) => toast.id !== id));
	}, duration);
	_toastTimers.set(id, timer);
}

/**
 * Dismiss a toast early and cancel its auto-remove timer.
 */
export function dismissToast(id: string): void {
	const timer = _toastTimers.get(id);
	if (timer) {
		clearTimeout(timer);
		_toastTimers.delete(id);
	}
	toasts.update((t) => t.filter((toast) => toast.id !== id));
}
