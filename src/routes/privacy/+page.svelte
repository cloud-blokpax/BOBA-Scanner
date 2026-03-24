<svelte:head>
	<title>Privacy Policy — BOBA Scanner</title>
</svelte:head>

<div class="legal-page">
	<h1>Privacy Policy</h1>
	<p class="last-updated">Last updated: March 24, 2026</p>

	<section>
		<h2>1. Information We Collect</h2>
		<p>When you use BOBA Scanner, we may collect the following information:</p>
		<ul>
			<li><strong>Account information:</strong> Email address and name provided through Google OAuth sign-in.</li>
			<li><strong>Card scan images:</strong> Photos you upload or capture for card identification. These are processed in real-time and are not stored after processing.</li>
			<li><strong>Collection data:</strong> Cards you add to your collection, deck configurations, and scan history.</li>
			<li><strong>eBay seller tokens:</strong> If you connect your eBay seller account, we store encrypted OAuth tokens to enable listing creation on your behalf.</li>
			<li><strong>Discord ID:</strong> Optionally provided for tournament communication.</li>
			<li><strong>Usage data:</strong> API call logs for rate limiting and abuse prevention.</li>
		</ul>
	</section>

	<section>
		<h2>2. How We Store Your Data</h2>
		<ul>
			<li><strong>Server-side:</strong> Your account and collection data is stored in Supabase (PostgreSQL), hosted in the United States.</li>
			<li><strong>Client-side:</strong> Card data, scan hashes, and collection snapshots are cached in your browser's IndexedDB for offline access and faster performance.</li>
			<li><strong>No image storage:</strong> Card scan images are processed in memory and discarded immediately after identification. They are not saved to any server or database.</li>
		</ul>
	</section>

	<section>
		<h2>3. Third-Party Services</h2>
		<p>BOBA Scanner integrates with the following third-party services:</p>
		<ul>
			<li><strong>Anthropic (Claude AI):</strong> Card images are sent to the Claude API for identification when client-side recognition (hash cache and OCR) is insufficient. Anthropic's data usage policies apply to these API calls.</li>
			<li><strong>eBay:</strong> Used for card pricing data (Browse API) and optional seller listing creation (Seller API). Only accessed when you request pricing or connect your eBay account.</li>
			<li><strong>Supabase:</strong> Provides authentication, database, and real-time services.</li>
			<li><strong>Upstash:</strong> Redis-based rate limiting to prevent API abuse. No personal data is stored in Upstash beyond anonymized request counters.</li>
			<li><strong>Vercel:</strong> Hosts the application and serves static assets.</li>
		</ul>
	</section>

	<section>
		<h2>4. Data Retention</h2>
		<ul>
			<li>Collection and deck data persists until you delete it or request account deletion.</li>
			<li>Scan images are not stored after processing — they exist only in memory during the identification pipeline.</li>
			<li>eBay seller tokens are deleted immediately when you disconnect your eBay account from the Settings page.</li>
			<li>API call logs are retained for rate limiting purposes and are periodically purged.</li>
		</ul>
	</section>

	<section>
		<h2>5. Your Rights</h2>
		<ul>
			<li><strong>Export:</strong> You can export your entire collection data at any time via the Export page.</li>
			<li><strong>Deletion:</strong> You can delete your collection data from the Settings page. To request full account deletion, contact us at the email below.</li>
			<li><strong>Disconnect:</strong> You can disconnect your eBay seller account at any time from Settings, which immediately deletes stored tokens.</li>
		</ul>
	</section>

	<section>
		<h2>6. Cookies</h2>
		<p>BOBA Scanner uses only essential cookies for authentication session management (Supabase auth). We do not use advertising, tracking, or analytics cookies.</p>
	</section>

	<section>
		<h2>7. Children's Privacy</h2>
		<p>BOBA Scanner is not directed at children under 13. We do not knowingly collect personal information from children under 13.</p>
	</section>

	<section>
		<h2>8. Changes to This Policy</h2>
		<p>We may update this privacy policy from time to time. Changes will be reflected by the "Last updated" date at the top of this page.</p>
	</section>

	<section>
		<h2>9. Contact</h2>
		<p>For questions about this privacy policy or to request data deletion, please contact the BOBA Scanner team through the app's support channels.</p>
	</section>
</div>

<style>
	.legal-page { max-width: 720px; margin: 2rem auto; padding: 0 1rem; }
	.legal-page h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
	.last-updated { color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 2rem; }
	section { margin-bottom: 1.5rem; }
	h2 { font-size: 1.1rem; font-weight: 600; margin-bottom: 0.5rem; }
	p { color: var(--text-secondary); font-size: 0.9rem; line-height: 1.6; margin-bottom: 0.5rem; }
	ul { color: var(--text-secondary); font-size: 0.9rem; line-height: 1.6; padding-left: 1.5rem; margin-bottom: 0.5rem; }
	li { margin-bottom: 0.375rem; }
</style>
