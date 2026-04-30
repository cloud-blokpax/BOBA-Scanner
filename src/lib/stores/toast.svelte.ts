/**
 * Toast notification store.
 *
 * Toasts can optionally include an action — a labeled button that fires a
 * callback when tapped (Gmail-style "UNDO" pattern). When the toast dismisses
 * (timer expiry or manual dismissal), the action is forgotten — there's no
 * second-chance retry.
 */

export interface ToastAction {
	label: string;
	onAction: () => void;
}

export interface ToastMessage {
	id: string;
	message: string;
	icon: string;
	duration: number;
	action?: ToastAction;
}

// ── Private mutable state ──────────────────────────────────
let _toasts = $state<ToastMessage[]>([]);

// ── Public reactive accessor ──────────────────────────────────
export function toasts(): ToastMessage[] {
	return _toasts;
}

const _toastTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function showToast(message: string, icon = '', duration = 3000): void {
	const id = crypto.randomUUID();
	_toasts = [..._toasts, { id, message, icon, duration }];

	const timer = setTimeout(() => {
		_toastTimers.delete(id);
		_toasts = _toasts.filter((toast) => toast.id !== id);
	}, duration);
	_toastTimers.set(id, timer);
}

/**
 * Show a toast with an action button (e.g. "UNDO").
 * Default duration is 5s — long enough to react, short enough not to nag.
 * The action callback fires once. Tapping it auto-dismisses the toast.
 */
export function showToastWithAction(
	message: string,
	action: ToastAction,
	icon = '',
	duration = 5000
): void {
	const id = crypto.randomUUID();
	const wrappedAction: ToastAction = {
		label: action.label,
		onAction: () => {
			action.onAction();
			dismissToast(id);
		}
	};
	_toasts = [..._toasts, { id, message, icon, duration, action: wrappedAction }];

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
