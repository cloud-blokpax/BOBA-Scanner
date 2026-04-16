<svelte:head>
	<title>Privacy Policy — Card Scanner</title>
</svelte:head>

<div class="legal-page">
	<h1>Privacy Policy</h1>
	<p class="last-updated">Effective date: March 29, 2026. Last updated: March 29, 2026.</p>

	<p>Card Scanner ("we," "us," or "the app") is operated by James Poto ("James Poto"). This policy explains what personal data we collect, why, how we process it, who we share it with, and your rights.</p>
	<p>By using Card Scanner, you agree to the collection and use of information as described in this policy. If you do not agree, please do not use the app.</p>

	<section>
		<h2>1. Age Restriction</h2>
		<p>Card Scanner is intended for users who are at least eighteen (18) years of age. We do not knowingly collect personal information from anyone under 18. If we learn that we have collected data from a user under 18, we will promptly deactivate their account and delete associated personal data. If you believe a minor has provided us with personal information, please contact us at the address below.</p>
	</section>

	<section>
		<h2>2. Information We Collect</h2>
		<p><strong>Account information.</strong> When you sign in with Google, we receive your email address, display name, and profile picture from Google OAuth. We store these in our database to identify your account.</p>
		<p><strong>Card scan images.</strong> When you scan a card, images are processed through a multi-tier pipeline. Tier 1 (hash matching) and Tier 2 (OCR) run entirely in your browser — no image data leaves your device. Only when these client-side methods cannot identify a card is the image sent to our server and then to Anthropic's Claude AI API for identification (Tier 3). Images sent to the server are processed in memory, stripped of metadata, and are not permanently stored by us. Anthropic retains API-submitted data for up to 30 days for safety and abuse monitoring purposes, and does not use API data for model training.</p>
		<p><strong>Camera access.</strong> The app requests access to your device camera for live card scanning. Camera access is controlled by your browser's permission system. You can revoke camera permissions at any time through your browser settings. Camera frames are processed locally and are not transmitted to any server unless Tier 3 AI identification is triggered.</p>
		<p><strong>Collection and deck data.</strong> Cards you add to your collection, deck configurations, scan history, DBS calculations, and tournament registrations are stored in our database and associated with your account.</p>
		<p><strong>eBay seller credentials.</strong> If you connect your eBay seller account, we store encrypted OAuth access and refresh tokens on our server. These tokens allow the app to create listings on your behalf. Your eBay password is never transmitted to or stored by us. Tokens are encrypted at rest and accessible only via server-side code.</p>
		<p><strong>Device storage.</strong> The app uses your browser's IndexedDB, Service Worker cache, and authentication cookies to enable offline functionality, faster performance, and session management. See Section 8 (Browser Storage) for details.</p>
		<p><strong>Usage and diagnostic data.</strong> We log API calls (type, success/failure, timestamp) for rate limiting, abuse prevention, and service monitoring. Scan performance metrics (method, processing time, confidence — no images) are collected for service improvement. These logs do not contain card images or collection contents.</p>
	</section>

	<section>
		<h2>3. How We Use Your Information</h2>
		<p>We use the information we collect to provide and improve the app's card identification, collection management, deck building, pricing, and eBay listing features. Specifically:</p>
		<ul>
			<li>To identify cards from images using AI and OCR processing</li>
			<li>To store and sync your card collection and deck configurations</li>
			<li>To provide eBay market pricing estimates</li>
			<li>To create eBay listings on your behalf (if you connect your eBay account)</li>
			<li>To enforce rate limits and prevent abuse</li>
			<li>To improve card recognition accuracy over time (via hash caching and community correction data — no images are retained for this purpose)</li>
		</ul>
		<p>We do not sell your personal data. We do not use your data for advertising. We do not use your card images or collection data to train AI models.</p>
	</section>

	<section>
		<h2>4. AI Processing Disclosure</h2>
		<p>Card Scanner uses artificial intelligence to identify trading cards from images. This section explains exactly how AI processes your data.</p>
		<p><strong>Client-side processing (no data leaves your device):</strong> Tesseract.js OCR runs entirely in your browser's Web Worker. Perceptual hash computation and image quality analysis also run locally. Most card identifications complete without any data being sent to external services.</p>
		<p><strong>Cloud AI processing (Anthropic Claude API):</strong> When client-side methods cannot identify a card, the image is sent to our server, sanitized (metadata stripped, re-encoded), and forwarded to Anthropic's Claude API (currently Claude Haiku) for identification. For AI card grading, images are sent to Claude Sonnet. In both cases:</p>
		<ul>
			<li>The AI provider is <strong>Anthropic, PBC</strong>, based in San Francisco, California, USA</li>
			<li>Anthropic retains API-submitted data for up to <strong>30 days</strong> for safety monitoring and abuse prevention</li>
			<li>Anthropic does <strong>not</strong> use API-submitted data for model training</li>
			<li>Anthropic's data processing is covered by their Data Processing Addendum, which includes EU Standard Contractual Clauses</li>
		</ul>
		<p>AI-generated card identifications, price estimates, and condition grades are informational only and may contain errors. See our Terms of Service for accuracy disclaimers.</p>
	</section>

	<section>
		<h2>5. Third-Party Service Providers</h2>
		<p>We share data with the following service providers, each acting as a data processor on our behalf:</p>
		<ul>
			<li><strong>Anthropic (San Francisco, CA, USA)</strong> — AI card identification and grading. Receives card images only when client-side recognition fails. DPA with Standard Contractual Clauses in place.</li>
			<li><strong>Supabase (San Francisco, CA, USA)</strong> — Database, authentication, and file storage. Stores account data, collections, decks, and encrypted eBay tokens. SOC 2 Type 2 certified. DPA available.</li>
			<li><strong>Vercel (San Francisco, CA, USA)</strong> — Application hosting and content delivery. Processes HTTP requests and serves application files. SOC 2 Type II and ISO 27001 certified. DPA available on Pro plan and above.</li>
			<li><strong>Upstash (San Francisco, CA, USA)</strong> — Redis-based rate limiting. Stores only anonymized request counters keyed by user ID or IP address hash. No personal data beyond these counters.</li>
			<li><strong>Google (Mountain View, CA, USA)</strong> — OAuth authentication provider. We receive your email, name, and profile picture during sign-in. Google's Privacy Policy governs their handling of your data.</li>
			<li><strong>eBay (San Jose, CA, USA)</strong> — Card pricing via Browse API and optional seller listing creation via Seller API. Pricing queries include card metadata (name, number, set) but not your personal data. Seller API access requires your explicit OAuth authorization.</li>
		</ul>
	</section>

	<section>
		<h2 id="6-ebay-affiliate-links">6. eBay Affiliate Links</h2>
		<p>Card Scanner participates in the <strong>eBay Partner Network</strong> affiliate program. When you click a link to view a card on eBay, the link includes an affiliate tracking identifier. If you make a purchase on eBay after clicking one of these links, we may earn a commission at no additional cost to you.</p>
		<p>Affiliate links are present on card detail views, price displays, and the deck shop page. Each affiliate link is marked with a disclosure notice. eBay may place cookies on your device when you click these links, subject to eBay's own Privacy Policy and cookie settings.</p>
		<p>We do not share your Card Scanner account data with eBay through affiliate links. The only data transmitted is the click itself and standard HTTP request information (IP address, user agent, referrer).</p>
	</section>

	<section>
		<h2>7. International Data Transfers</h2>
		<p>Your personal data is transferred to and processed in the <strong>United States</strong>, where our service providers (Anthropic, Supabase, Vercel, Upstash) are located.</p>
		<p>For users in the European Economic Area (EEA), United Kingdom, or Switzerland, these transfers are protected by:</p>
		<ul>
			<li>The <strong>EU-U.S. Data Privacy Framework</strong> (adequacy decision upheld by the EU General Court in September 2025)</li>
			<li><strong>Standard Contractual Clauses (SCCs)</strong> incorporated into our data processing agreements with each provider, serving as a fallback transfer mechanism</li>
		</ul>
	</section>

	<section>
		<h2>8. Browser Storage (Cookies, IndexedDB, and Service Workers)</h2>
		<p>Card Scanner uses browser storage technologies to provide core functionality. We categorize our storage use as follows:</p>
		<p><strong>Essential (required for the app to function):</strong></p>
		<ul>
			<li><strong>Authentication cookies</strong> — Supabase session tokens for login persistence</li>
			<li><strong>Service Worker cache</strong> — Application shell files for offline access</li>
			<li><strong>IndexedDB: card database</strong> — Cached card data for offline card identification</li>
			<li><strong>IndexedDB: hash cache</strong> — Perceptual hashes of previously scanned cards for instant re-identification</li>
			<li><strong>IndexedDB: offline scan queue</strong> — Scan images queued for processing when you regain connectivity</li>
		</ul>
		<p><strong>Functional (improves your experience):</strong></p>
		<ul>
			<li><strong>IndexedDB: collection cache</strong> — Offline copy of your card collection</li>
			<li><strong>IndexedDB: price cache</strong> — Recently fetched price data to reduce API calls</li>
			<li><strong>IndexedDB: deck data</strong> — Local copy of your deck configurations</li>
			<li><strong>IndexedDB: scan history</strong> — Record of recent scans for the speed game and diagnostics</li>
			<li><strong>IndexedDB: OCR corrections</strong> — Learned corrections for improved card number recognition</li>
			<li><strong>IndexedDB: user preferences</strong> — Export templates and high scores</li>
		</ul>
		<p>We do not use any advertising, analytics, or tracking cookies. All browser storage is used exclusively to provide and improve the app's functionality for you.</p>
		<p>You can clear all stored data at any time through your browser's site data settings. Clearing IndexedDB will require the app to re-download card data from our servers on next use.</p>
	</section>

	<section>
		<h2>9. Data Retention</h2>
		<ul>
			<li><strong>Account and collection data:</strong> Retained until you delete it or request account deletion.</li>
			<li><strong>Scan images:</strong> Processed in memory and discarded immediately. Not stored by us. Anthropic retains API-submitted images for up to 30 days.</li>
			<li><strong>eBay seller tokens:</strong> Deleted immediately when you disconnect your eBay account, or when the refresh token expires (approximately 18 months).</li>
			<li><strong>API call logs:</strong> Retained for up to 90 days for rate limiting and abuse prevention, then purged.</li>
			<li><strong>Scan metrics:</strong> Aggregated performance data retained indefinitely (contains no personal data or images).</li>
			<li><strong>Community corrections:</strong> OCR correction mappings retained indefinitely to improve recognition for all users (contains only card number text, no images or personal data).</li>
		</ul>
	</section>

	<section>
		<h2>10. Your Rights</h2>
		<p><strong>All users:</strong></p>
		<ul>
			<li><strong>Access and export:</strong> Export your collection and deck data at any time via the Export page (CSV format).</li>
			<li><strong>Correction:</strong> Update your collection data directly within the app.</li>
			<li><strong>Deletion:</strong> Delete individual collection items or decks within the app. Request full account deletion by contacting us (see Section 14).</li>
			<li><strong>eBay disconnect:</strong> Revoke eBay access and delete stored tokens at any time from the Settings page.</li>
			<li><strong>Camera revocation:</strong> Revoke camera permissions at any time through your browser settings.</li>
		</ul>
		<p><strong>Additional rights for EEA, UK, and Swiss users (GDPR):</strong></p>
		<ul>
			<li><strong>Right of access:</strong> Request a copy of all personal data we hold about you.</li>
			<li><strong>Right to rectification:</strong> Request correction of inaccurate personal data.</li>
			<li><strong>Right to erasure:</strong> Request deletion of your personal data ("right to be forgotten").</li>
			<li><strong>Right to data portability:</strong> Receive your data in a structured, machine-readable format (JSON).</li>
			<li><strong>Right to restrict processing:</strong> Request limitation of processing in certain circumstances.</li>
			<li><strong>Right to object:</strong> Object to processing based on legitimate interests.</li>
			<li><strong>Right to lodge a complaint:</strong> File a complaint with your local data protection authority.</li>
		</ul>
		<p>We will respond to all data rights requests within 30 days. To exercise any of these rights, contact us at the address in Section 14.</p>
		<p><strong>Additional rights for California residents (CCPA/CPRA):</strong></p>
		<ul>
			<li>We do not sell your personal information.</li>
			<li>We do not share your personal information for cross-context behavioral advertising.</li>
			<li>You have the right to know what personal information we collect, request deletion, and opt out of any future sale or sharing. Contact us at the address in Section 14.</li>
		</ul>
	</section>

	<section>
		<h2>11. Legal Basis for Processing (GDPR)</h2>
		<p>For users in the EEA, UK, and Switzerland, we process personal data on the following legal bases:</p>
		<ul>
			<li><strong>Contract performance (Art. 6(1)(b)):</strong> Processing necessary to provide the scanning, collection management, deck building, and eBay listing services you signed up for.</li>
			<li><strong>Legitimate interest (Art. 6(1)(f)):</strong> Rate limiting, abuse prevention, service monitoring, and improving card recognition accuracy. We have balanced these interests against your privacy rights.</li>
			<li><strong>Consent (Art. 6(1)(a)):</strong> Where required for non-essential browser storage. You can withdraw consent at any time by clearing your browser data.</li>
		</ul>
	</section>

	<section>
		<h2>12. Security</h2>
		<p>We implement industry-standard security measures including: HTTPS encryption for all data in transit, Row Level Security on all database tables ensuring users can only access their own data, Content Disarm & Reconstruction on all uploaded images (metadata stripping, pixel bomb protection, re-encoding), encrypted storage of eBay OAuth tokens, bot and scraper protection via edge middleware, and rate limiting on all API endpoints.</p>
		<p>No method of electronic transmission or storage is 100% secure. While we strive to protect your data, we cannot guarantee absolute security.</p>
	</section>

	<section>
		<h2>13. Changes to This Policy</h2>
		<p>We may update this policy from time to time. Material changes will be communicated through a notice within the app. The "Last updated" date at the top reflects the most recent revision. Continued use of the app after changes constitutes acceptance of the updated policy.</p>
	</section>

	<section>
		<h2>14. Contact</h2>
		<p>For privacy questions, data rights requests, or concerns, contact:</p>
		<p>James Poto<br/>Email: jamespoto@gmail.com</p>
		<p>For GDPR-related inquiries, you may also contact your local data protection supervisory authority.</p>
	</section>
</div>

<style>
	.legal-page { max-width: 720px; margin: 2rem auto; padding: 0 1rem 4rem; }
	.legal-page h1 { font-family: var(--font-display, 'Syne', sans-serif); font-size: 1.5rem; margin-bottom: 0.5rem; }
	.last-updated { color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 2rem; }
	section { margin-bottom: 1.75rem; }
	h2 { font-size: 1.1rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary); }
	p { color: var(--text-secondary); font-size: 0.9rem; line-height: 1.7; margin-bottom: 0.625rem; }
	ul { color: var(--text-secondary); font-size: 0.9rem; line-height: 1.7; padding-left: 1.5rem; margin-bottom: 0.625rem; }
	li { margin-bottom: 0.375rem; }
</style>
