/**
 * Typed event bus for cross-module communication.
 *
 * Replaces legacy src/core/event-bus.js with typed generics.
 * Prefer Svelte stores for reactive state; use this for fire-and-forget events.
 */

type EventHandler<T = unknown> = (data: T) => void;

const listeners = new Map<string, Set<EventHandler>>();

export function on<T = unknown>(event: string, handler: EventHandler<T>): void {
	if (!listeners.has(event)) {
		listeners.set(event, new Set());
	}
	listeners.get(event)!.add(handler as EventHandler);
}

export function off<T = unknown>(event: string, handler: EventHandler<T>): void {
	listeners.get(event)?.delete(handler as EventHandler);
}

export function emit<T = unknown>(event: string, data?: T): void {
	const handlers = listeners.get(event);
	if (!handlers) return;
	for (const fn of handlers) {
		try {
			fn(data);
		} catch (e) {
			console.error(`[EventBus] "${event}" handler error:`, e);
		}
	}
}

export const eventBus = { on, off, emit };
