/**
 * Collection adapter registry — manages available collection types.
 *
 * Replaces legacy src/collections/registry.js.
 */

import { writable, get } from 'svelte/store';
import type { CollectionAdapter } from './collection-adapter';

const adapters = new Map<string, CollectionAdapter>();
let _activeId = 'boba';

export const activeAdapter = writable<CollectionAdapter | null>(null);

export function registerAdapter(adapter: CollectionAdapter): void {
	adapters.set(adapter.id, adapter);
	// Auto-activate if first adapter or matches stored preference
	if (adapters.size === 1 || adapter.id === _activeId) {
		_activeId = adapter.id;
		activeAdapter.set(adapter);
	}
}

export function setActiveAdapter(id: string): void {
	const adapter = adapters.get(id);
	if (adapter) {
		_activeId = id;
		activeAdapter.set(adapter);
	}
}

export function getActiveAdapter(): CollectionAdapter | null {
	return get(activeAdapter);
}

export function getAdapter(id: string): CollectionAdapter | undefined {
	return adapters.get(id);
}

export function listAdapters(): Array<{ id: string; displayName: string }> {
	return [...adapters.values()].map((a) => ({ id: a.id, displayName: a.displayName }));
}
