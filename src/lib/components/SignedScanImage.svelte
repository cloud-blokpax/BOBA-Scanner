<script lang="ts">
	/**
	 * Renders an `<img>` for a scan-images storage path or legacy URL.
	 *
	 * The bucket is private (migration 044), so a fresh signed URL is minted
	 * via the user-scoped Supabase client whenever `path` changes. If signing
	 * fails (no client, bad path, RLS reject) the element renders nothing.
	 */
	import { signScanImageUrl } from '$lib/services/scan-image-url';
	import { getSupabase } from '$lib/services/supabase';

	interface Props {
		path: string | null | undefined;
		alt?: string;
		class?: string;
		ttlSeconds?: number;
	}

	let {
		path,
		alt = '',
		class: klass = '',
		ttlSeconds = 3600
	}: Props = $props();

	let signed = $state<string | null>(null);

	$effect(() => {
		const value = path ?? null;
		if (!value) { signed = null; return; }
		let cancelled = false;
		signScanImageUrl(getSupabase(), value, ttlSeconds).then((url) => {
			if (!cancelled) signed = url;
		});
		return () => { cancelled = true; };
	});
</script>

{#if signed}
	<img src={signed} {alt} class={klass} loading="lazy" />
{/if}
