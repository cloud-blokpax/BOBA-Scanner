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

/**
 * Show a toast notification.
 */
export function showToast(message: string, icon = '', duration = 3000): void {
	const id = Math.random().toString(36).slice(2, 8);
	toasts.update((t) => [...t, { id, message, icon, duration }]);

	setTimeout(() => {
		toasts.update((t) => t.filter((toast) => toast.id !== id));
	}, duration);
}
