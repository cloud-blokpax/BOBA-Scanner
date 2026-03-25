<script lang="ts">
	import { getSupabase } from '$lib/services/supabase';
	import { showToast } from '$lib/stores/toast.svelte';
	import { debounce } from '$lib/utils';

	interface UserRow {
		id: string;
		auth_user_id: string;
		email: string;
		name: string | null;
		is_admin: boolean;
		is_pro: boolean;
		is_organizer: boolean;
		scan_count: number;
		created_at: string;
	}

	let users = $state<UserRow[]>([]);
	let filteredUsers = $state<UserRow[]>([]);
	let loading = $state(true);
	let searchQuery = $state('');
	let togglingOrganizer = $state<string | null>(null);

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	const filterUsers = debounce((query: string) => {
		if (!query.trim()) {
			filteredUsers = users;
			return;
		}
		const q = query.toLowerCase();
		filteredUsers = users.filter(
			(u) =>
				u.email?.toLowerCase().includes(q) ||
				u.name?.toLowerCase().includes(q)
		);
	}, 300);

	$effect(() => {
		filterUsers(searchQuery);
	});

	$effect(() => {
		loadUsers();
	});

	async function loadUsers() {
		loading = true;
		const client = getSupabase();
		if (!client) {
			showToast('Supabase not configured', 'x');
			loading = false;
			return;
		}
		try {
			const { data } = await client
				.from('users')
				.select('*')
				.order('created_at', { ascending: false })
				.limit(100);
			if (data) {
				users = data as unknown as UserRow[];
				filteredUsers = users;
			}
		} catch {
			showToast('Failed to load users', 'x');
		}
		loading = false;
	}

	async function toggleOrganizer(user: UserRow) {
		togglingOrganizer = user.auth_user_id;
		try {
			const res = await fetch('/api/admin/set-organizer', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					user_id: user.auth_user_id,
					is_organizer: !user.is_organizer
				})
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				throw new Error(data.message || 'Failed to update');
			}
			user.is_organizer = !user.is_organizer;
			showToast(
				user.is_organizer ? `${user.name || user.email} is now an organizer` : `Organizer role removed`,
				'check'
			);
		} catch (err) {
			showToast(err instanceof Error ? err.message : 'Failed to update organizer status', 'x');
		}
		togglingOrganizer = null;
	}
</script>

<div class="tab-content">
	{#if loading}
		<div class="loading">Loading users...</div>
	{:else}
		<input
			type="text"
			bind:value={searchQuery}
			placeholder="Search users..."
			class="search-input"
		/>
		<div class="table-wrapper">
			<table>
				<thead>
					<tr>
						<th>Name</th>
						<th>Email</th>
						<th>Role</th>
						<th>Organizer</th>
						<th>Scans</th>
						<th>Joined</th>
					</tr>
				</thead>
				<tbody>
					{#each filteredUsers as user}
						<tr>
							<td>{user.name || '—'}</td>
							<td class="email-cell">{user.email}</td>
							<td>
								{#if user.is_admin}
									<span class="badge admin">Admin</span>
								{:else if user.is_pro}
									<span class="badge member">Pro</span>
								{:else}
									<span class="badge">User</span>
								{/if}
							</td>
							<td>
								<button
									class="organizer-toggle"
									class:active={user.is_organizer}
									onclick={() => toggleOrganizer(user)}
									disabled={togglingOrganizer === user.auth_user_id}
								>
									{user.is_organizer ? 'Yes' : 'No'}
								</button>
							</td>
							<td>{user.scan_count}</td>
							<td>{formatDate(user.created_at)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<style>
	.loading {
		text-align: center;
		padding: 3rem;
		color: var(--text-tertiary);
	}
	.search-input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 0.9rem;
		margin-bottom: 0.75rem;
	}
	.table-wrapper { overflow-x: auto; }
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}
	th {
		text-align: left;
		padding: 0.5rem;
		border-bottom: 1px solid var(--border-color);
		color: var(--text-secondary);
		font-weight: 600;
		white-space: nowrap;
	}
	td {
		padding: 0.5rem;
		border-bottom: 1px solid var(--border-color);
	}
	.email-cell {
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.badge {
		display: inline-block;
		padding: 2px 8px;
		border-radius: 4px;
		font-size: 0.7rem;
		font-weight: 600;
		background: var(--bg-hover);
		color: var(--text-secondary);
	}
	.badge.admin {
		background: #7c3aed20;
		color: #7c3aed;
	}
	.badge.member {
		background: #2563eb20;
		color: #2563eb;
	}
	.organizer-toggle {
		padding: 2px 10px;
		border-radius: 4px;
		font-size: 0.7rem;
		font-weight: 600;
		border: 1px solid var(--border-color);
		background: var(--bg-base);
		color: var(--text-secondary);
		cursor: pointer;
	}
	.organizer-toggle.active {
		background: #16a34a20;
		color: #16a34a;
		border-color: #16a34a40;
	}
	.organizer-toggle:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
