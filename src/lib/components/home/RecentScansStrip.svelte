<script lang="ts">
	import { onMount } from 'svelte';
	import { scanHistory, removeFromScanHistory } from '$lib/stores/scan-history.svelte';
	import { getOptimizedImageUrls, getCardImageUrl } from '$lib/utils/image-url';
	import { getCardById } from '$lib/services/card-db';
	import { getSupabase } from '$lib/services/supabase';
	import CardDetail from '$lib/components/CardDetail.svelte';
	import type { CollectionItem } from '$lib/types';

	interface Props { userId: string | undefined; gameId?: 'boba' | 'wonders' | null; }
	let { userId, gameId = null }: Props = $props();

	interface RecentScan {
		id: string; card_id: string | null; hero_name: string | null; card_number: string | null;
		scan_method: string; created_at: string; timestamp: number; imageUrl: string | null;
		cardId: string | null; heroName: string | null; cardNumber: string | null;
		confidence: number; method: string; processingMs: number; success: boolean;
	}

	let supabaseScans = $state<RecentScan[]>([]);
	let supabaseScansLoaded = $state(false);
	let selectedRecentItem = $state<CollectionItem | null>(null);

	async function loadRecentScans() {
		const client = getSupabase();
		if (!client || !userId) return;
		try {
			let query = client
				.from('scans').select('id, card_id, hero_name, card_number, scan_method, game_id, created_at')
				.not('card_id', 'is', null).order('created_at', { ascending: false }).limit(10);
			if (gameId) query = query.eq('game_id', gameId);
			const { data: rows, error: err } = await query;
			if (err) throw err;
			supabaseScans = (rows || []).map(row => ({
				...row,
				timestamp: new Date(row.created_at).getTime(),
				imageUrl: row.card_id ? getCardImageUrl({ id: row.card_id }) : null,
				cardId: row.card_id, heroName: row.hero_name, cardNumber: row.card_number,
				confidence: 1, method: row.scan_method || 'unknown', processingMs: 0, success: true,
			}));
		} catch (err) { console.debug('[home] Failed to load recent scans:', err); }
		supabaseScansLoaded = true;
	}

	const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

	async function removeScan(scanId: string) {
		if (UUID_RE.test(scanId)) {
			const client = getSupabase();
			if (client) {
				try {
					const { error: delError } = await client.from('scans').delete().eq('id', scanId);
					if (delError) console.warn('[home] Supabase scan delete failed:', delError.message);
				} catch (err) { console.warn('[home] Scan delete error:', err); }
			}
		}
		supabaseScans = supabaseScans.filter(s => s.id !== scanId);
		removeFromScanHistory(scanId);
	}

	function openRecentScan(scan: typeof recentScans[number]) {
		const card = scan.cardId ? getCardById(scan.cardId) ?? undefined : undefined;
		const imageUrl = scan.imageUrl || (scan.cardId ? getCardImageUrl({ id: scan.cardId }) : null);
		selectedRecentItem = {
			id: scan.id || `scan-${scan.timestamp}`, user_id: userId || '',
			card_id: scan.cardId || '', quantity: 1, condition: 'near_mint', notes: null,
			added_at: new Date(scan.timestamp).toISOString(), scan_image_url: imageUrl, card
		};
	}

	onMount(() => { loadRecentScans(); });

	const recentScans = $derived.by(() => {
		const local = scanHistory().filter(s => s.success);
		if (!userId || !supabaseScansLoaded) return local.slice(0, 5);
		const seen = new Set(supabaseScans.map(s => s.cardId).filter(Boolean));
		const localOnly = local.filter(s => s.cardId && !seen.has(s.cardId));
		return [...supabaseScans, ...localOnly].sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);
	});

	function timeAgo(timestamp: number): string {
		const seconds = Math.floor((Date.now() - timestamp) / 1000);
		if (seconds < 60) return 'Just now';
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		return `${Math.floor(hours / 24)}d ago`;
	}
</script>

<CardDetail item={selectedRecentItem} ebayConnected={false} onClose={() => { selectedRecentItem = null; }} />

{#if recentScans.length > 0}
	<div class="section-block">
		<div class="section-header"><h2 class="section-heading">Recent Scans</h2></div>
		<div class="recent-scans-strip">
			{#each recentScans as scan}
				{@const resolvedImageUrl = scan.imageUrl || (scan.cardId ? getCardImageUrl({ id: scan.cardId }) : null)}
				{@const isDataUrl = resolvedImageUrl?.startsWith('data:')}
				<div class="scan-card" role="button" tabindex="0" onclick={() => openRecentScan(scan)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRecentScan(scan); } }}>
					<div class="scan-card-image">
						{#if resolvedImageUrl}
							{@const urls = isDataUrl ? { avif: null, webp: null, fallback: resolvedImageUrl, width: 100 } : getOptimizedImageUrls(resolvedImageUrl, 'thumb')}
							<picture>
								{#if urls.avif}<source srcset={urls.avif} type="image/avif" />{/if}
								{#if urls.webp}<source srcset={urls.webp} type="image/webp" />{/if}
								<img src={urls.fallback} alt={scan.heroName || scan.cardNumber || 'Card'} class="scan-card-img" loading="lazy"
									onerror={(e) => { const img = e.currentTarget as HTMLImageElement; img.style.display = 'none'; const next = img.parentElement?.querySelector('.scan-card-fallback') as HTMLElement; if (next) next.style.display = 'flex'; }} />
							</picture>
							<div class="scan-card-fallback" style="display:none">🎴</div>
						{:else}
							<div class="scan-card-fallback">🎴</div>
						{/if}
					</div>
					<div class="scan-card-info">
						<span class="scan-card-name">{scan.heroName || scan.cardNumber || 'Unknown'}</span>
						<span class="scan-card-time">{timeAgo(scan.timestamp)}</span>
					</div>
					{#if userId && scan.id}
						<button class="scan-remove-btn" onclick={(e) => { e.stopPropagation(); removeScan(scan.id); }} title="Remove">&#x2715;</button>
					{/if}
				</div>
			{/each}
		</div>
	</div>
{/if}

<style>
	.section-block { margin-bottom: 1.5rem; }
	.section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.625rem; }
	.section-heading { font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted, #64748b); margin: 0 0 0.625rem; }
	.recent-scans-strip { display: flex; gap: 0.625rem; overflow-x: auto; scroll-snap-type: x mandatory; padding-bottom: 0.25rem; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
	.recent-scans-strip::-webkit-scrollbar { display: none; }
	.scan-card { position: relative; flex-shrink: 0; scroll-snap-align: start; width: 100px; border-radius: var(--radius-lg, 12px); overflow: hidden; background: var(--bg-surface, #0d1524); border: 1px solid var(--border, rgba(148,163,184,0.06)); cursor: pointer; transition: transform 0.12s ease; }
	.scan-card:active { transform: scale(0.96); }
	.scan-card-image { width: 100%; aspect-ratio: 5 / 7; background: linear-gradient(135deg, var(--bg-elevated, #0f172a), rgba(148,163,184,0.03)); display: flex; align-items: center; justify-content: center; overflow: hidden; }
	.scan-card-img { width: 100%; height: 100%; object-fit: cover; }
	.scan-card-fallback { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; }
	.scan-card-info { padding: 0.375rem 0.5rem; }
	.scan-card-name { display: block; font-size: 0.7rem; font-weight: 600; color: var(--text-primary, #e2e8f0); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.scan-card-time { font-size: 0.6rem; color: var(--text-muted, #475569); }
	.scan-remove-btn { position: absolute; top: 4px; right: 4px; width: 20px; height: 20px; border-radius: 50%; border: none; background: rgba(0,0,0,0.6); color: var(--text-tertiary); font-size: 0.6rem; cursor: pointer; display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.15s; }
	.scan-card:hover .scan-remove-btn, .scan-card:active .scan-remove-btn { opacity: 1; }
	@media (hover: none) { .scan-remove-btn { opacity: 0.7; } }
</style>
