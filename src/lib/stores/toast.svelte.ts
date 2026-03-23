/**
 * Toast notification store.
 */

export interface ToastMessage {
	id: string;
	message: string;
	icon: string;
	duration: number;
}

// ── Private mutable state ──────────────────────────────────
let _toasts = $state<ToastMessage[]>([]);

// ── Public reactive accessor ──────────────────────────────────
export function toasts(): ToastMessage[] { return _toasts; }

const _toastTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function showToast(message: string, icon = '', duration = 3000): void {
	const id = Math.random().toString(36).slice(2, 8);
	_toasts = [..._toasts, { id, message, icon, duration }];

	const timer = setTimeout(() => {
		_toastTimers.delete(id);
		_toasts = _toasts.filter((toast) => toast.id !== id);
	}, duration);
	_toastTimers.set(id, timer);
}

export function dismissToast(id: string): void {
	const timer = _toastTimers.get(id);
	if (timer) {
		clearTimeout(timer);
		_toastTimers.delete(id);
	}
	_toasts = _toasts.filter((toast) => toast.id !== id);
}
