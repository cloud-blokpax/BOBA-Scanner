<script lang="ts">
	import { showToast } from '$lib/stores/toast.svelte';

	interface ChangelogEntry {
		id: string;
		title: string;
		body: string;
		published: boolean;
		is_notification: boolean;
		published_at: string | null;
		created_at: string;
	}

	let loading = $state(true);
	let entries = $state<ChangelogEntry[]>([]);
	let showForm = $state(false);
	let editingId = $state<string | null>(null);
	let saving = $state(false);

	let formTitle = $state('');
	let formBody = $state('');
	let formNotification = $state(false);

	$effect(() => {
		loadEntries();
	});

	async function loadEntries() {
		loading = true;
		try {
			const res = await fetch('/api/admin/changelog');
			if (!res.ok) throw new Error('Failed to load');
			const data = await res.json();
			entries = data.entries;
		} catch {
			showToast('Failed to load changelog', 'x');
		}
		loading = false;
	}

	function startNew() {
		formTitle = '';
		formBody = '';
		formNotification = false;
		editingId = null;
		showForm = true;
	}

	function startEdit(entry: ChangelogEntry) {
		formTitle = entry.title;
		formBody = entry.body;
		formNotification = entry.is_notification;
		editingId = entry.id;
		showForm = true;
	}

	function cancelForm() {
		showForm = false;
		editingId = null;
	}

	async function saveEntry() {
		if (!formTitle.trim()) { showToast('Title is required', 'x'); return; }
		saving = true;

		try {
			if (editingId) {
				const res = await fetch('/api/admin/changelog', {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						id: editingId,
						title: formTitle,
						body: formBody,
						is_notification: formNotification
					})
				});
				if (!res.ok) throw new Error('Failed to update');
				showToast('Entry updated', 'check');
			} else {
				const res = await fetch('/api/admin/changelog', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						title: formTitle,
						body: formBody,
						is_notification: formNotification
					})
				});
				if (!res.ok) throw new Error('Failed to create');
				showToast('Entry created', 'check');
			}
			showForm = false;
			editingId = null;
			await loadEntries();
		} catch {
			showToast('Failed to save entry', 'x');
		}
		saving = false;
	}

	async function togglePublish(entry: ChangelogEntry) {
		try {
			const res = await fetch('/api/admin/changelog', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					id: entry.id,
					published: !entry.published
				})
			});
			if (!res.ok) throw new Error('Failed to update');
			entry.published = !entry.published;
			showToast(entry.published ? 'Published' : 'Unpublished', 'check');
		} catch {
			showToast('Failed to toggle publish', 'x');
		}
	}

	async function deleteEntry(id: string) {
		try {
			const res = await fetch('/api/admin/changelog', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id })
			});
			if (!res.ok) throw new Error('Failed to delete');
			entries = entries.filter((e) => e.id !== id);
			showToast('Entry deleted', 'check');
		} catch {
			showToast('Failed to delete', 'x');
		}
	}

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-US', {
			month: 'short', day: 'numeric', year: 'numeric'
		});
	}
</script>

<div class="changelog-tab">
	{#if loading}
		<div class="loading">Loading changelog...</div>
	{:else}
		<div class="header-row">
			<h2 class="section-title">Changelog Entries</h2>
			<button class="btn-new" onclick={startNew}>+ New Entry</button>
		</div>

		{#if showForm}
			<div class="form-card">
				<h3 class="form-title">{editingId ? 'Edit Entry' : 'New Entry'}</h3>
				<div class="form-field">
					<label for="cl-title">Title</label>
					<input id="cl-title" type="text" bind:value={formTitle} placeholder="What changed?" class="form-input" />
				</div>
				<div class="form-field">
					<label for="cl-body">Body</label>
					<textarea id="cl-body" bind:value={formBody} placeholder="Detailed description..." rows="4" class="form-input form-textarea"></textarea>
				</div>
				<label class="checkbox-row">
					<input type="checkbox" bind:checked={formNotification} />
					<span>Show as "What's New" notification</span>
				</label>
				<div class="form-actions">
					<button class="btn-save" onclick={saveEntry} disabled={saving}>
						{saving ? 'Saving...' : 'Save'}
					</button>
					<button class="btn-cancel" onclick={cancelForm}>Cancel</button>
				</div>
			</div>
		{/if}

		{#if entries.length === 0}
			<div class="empty">No changelog entries yet. Create one above.</div>
		{:else}
			<div class="entries-list">
				{#each entries as entry}
					<div class="entry-card" class:published={entry.published}>
						<div class="entry-header">
							<div class="entry-title-row">
								<span class="entry-title">{entry.title}</span>
								{#if entry.published}
									<span class="badge-published">Published</span>
								{:else}
									<span class="badge-draft">Draft</span>
								{/if}
								{#if entry.is_notification}
									<span class="badge-notif">Notification</span>
								{/if}
							</div>
							<span class="entry-date">{formatDate(entry.created_at)}</span>
						</div>
						{#if entry.body}
							<p class="entry-body">{entry.body}</p>
						{/if}
						<div class="entry-actions">
							<button class="entry-btn" onclick={() => startEdit(entry)}>Edit</button>
							<button class="entry-btn" onclick={() => togglePublish(entry)}>
								{entry.published ? 'Unpublish' : 'Publish'}
							</button>
							<button class="entry-btn danger" onclick={() => deleteEntry(entry.id)}>Delete</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<style>
	.changelog-tab {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.loading, .empty {
		text-align: center;
		padding: 3rem;
		color: var(--text-tertiary);
	}

	.header-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.section-title {
		font-size: 1rem;
		font-weight: 700;
		margin: 0;
	}

	.btn-new {
		padding: 0.375rem 0.75rem;
		border-radius: 6px;
		border: 1px solid var(--gold);
		background: transparent;
		color: var(--gold);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
	}

	/* Form */
	.form-card {
		background: var(--bg-elevated);
		border-radius: 12px;
		padding: 1rem;
		border: 1px solid var(--border-strong);
	}

	.form-title {
		font-size: 0.9rem;
		font-weight: 700;
		margin-bottom: 0.75rem;
	}

	.form-field {
		margin-bottom: 0.75rem;
	}

	.form-field label {
		display: block;
		font-size: 0.8rem;
		color: var(--text-secondary);
		margin-bottom: 0.25rem;
	}

	.form-input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 0.85rem;
		font-family: inherit;
	}

	.form-textarea {
		resize: vertical;
		min-height: 80px;
	}

	.checkbox-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin-bottom: 0.75rem;
		cursor: pointer;
	}

	.form-actions {
		display: flex;
		gap: 0.5rem;
	}

	.btn-save {
		padding: 0.5rem 1rem;
		border-radius: 8px;
		border: none;
		background: var(--gold);
		color: #000;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
	}

	.btn-save:disabled { opacity: 0.5; cursor: not-allowed; }

	.btn-cancel {
		padding: 0.5rem 1rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--text-secondary);
		font-size: 0.85rem;
		cursor: pointer;
	}

	/* Entries */
	.entries-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.entry-card {
		background: var(--bg-elevated);
		border-radius: 10px;
		padding: 0.875rem;
		border-left: 3px solid var(--border);
	}

	.entry-card.published {
		border-left-color: var(--success);
	}

	.entry-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.entry-title-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.entry-title {
		font-weight: 600;
		font-size: 0.9rem;
	}

	.entry-date {
		font-size: 0.7rem;
		color: var(--text-tertiary);
		flex-shrink: 0;
	}

	.badge-published {
		padding: 1px 6px;
		border-radius: 4px;
		font-size: 0.65rem;
		font-weight: 600;
		background: rgba(16, 185, 129, 0.15);
		color: var(--success);
	}

	.badge-draft {
		padding: 1px 6px;
		border-radius: 4px;
		font-size: 0.65rem;
		font-weight: 600;
		background: var(--bg-hover);
		color: var(--text-tertiary);
	}

	.badge-notif {
		padding: 1px 6px;
		border-radius: 4px;
		font-size: 0.65rem;
		font-weight: 600;
		background: rgba(59, 130, 246, 0.15);
		color: var(--info);
	}

	.entry-body {
		font-size: 0.8rem;
		color: var(--text-secondary);
		margin: 0 0 0.5rem;
		line-height: 1.4;
		white-space: pre-wrap;
	}

	.entry-actions {
		display: flex;
		gap: 0.375rem;
	}

	.entry-btn {
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--text-secondary);
		font-size: 0.7rem;
		cursor: pointer;
	}

	.entry-btn:hover {
		border-color: var(--border-strong);
	}

	.entry-btn.danger {
		color: var(--danger);
		border-color: rgba(239, 68, 68, 0.3);
	}
</style>
