<!--
  Inline affiliate disclosure for eBay Partner Network links.
  FTC and EPN require this near every affiliate link, not just in legal pages.
  Use: <AffiliateNotice /> placed near any "View on eBay" link.
  Use: <AffiliateNotice compact /> for tight spaces (e.g., card grid rows).
-->
<script lang="ts">
	let { compact = false }: { compact?: boolean } = $props();
</script>

{#if compact}
	<span class="affiliate-compact" title="As an eBay Partner, we may earn from qualifying purchases">eBay Partner link</span>
{:else}
	<p class="affiliate-notice">As an eBay Partner, we may earn a commission if you purchase through links in this app — at no extra cost to you.</p>
{/if}

<style>
	.affiliate-notice {
		font-size: 0.72rem;
		color: var(--text-muted, #475569);
		margin: 0.25rem 0 0;
		line-height: 1.4;
	}
	.affiliate-compact {
		font-size: 0.65rem;
		color: var(--text-muted, #475569);
		opacity: 0.8;
	}
</style>
