// js/price-trends.js — Price history tracking and trend visualization
// Caches every eBay price lookup with timestamp, displays price charts,
// and supports price alerts.

(function() {
  const PRICE_HISTORY_KEY = 'priceHistory';
  const PRICE_ALERTS_KEY  = 'priceAlerts';
  const MAX_HISTORY_PER_CARD = 90; // Keep up to 90 data points per card

  // ── Storage ──────────────────────────────────────────────────────────────────

  function getPriceHistory() {
    try {
      return JSON.parse(localStorage.getItem(PRICE_HISTORY_KEY) || '{}');
    } catch { return {}; }
  }

  function savePriceHistory(history) {
    try {
      localStorage.setItem(PRICE_HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
      console.warn('Could not save price history:', e);
    }
  }

  function getPriceAlerts() {
    try {
      return JSON.parse(localStorage.getItem(PRICE_ALERTS_KEY) || '[]');
    } catch { return []; }
  }

  function savePriceAlerts(alerts) {
    try {
      localStorage.setItem(PRICE_ALERTS_KEY, JSON.stringify(alerts));
    } catch {}
  }

  // ── Record Price ──────────────────────────────────────────────────────────────

  /**
   * Record a price data point for a card.
   * Called after every successful eBay price lookup.
   */
  function recordPrice(cardNumber, priceData) {
    if (!cardNumber || !priceData) return;

    const history = getPriceHistory();
    const key = cardNumber.toUpperCase();

    if (!history[key]) history[key] = [];

    history[key].push({
      avg:  priceData.avgPrice  || null,
      low:  priceData.lowPrice  || null,
      high: priceData.highPrice || null,
      sold: priceData.soldAvg   || null,
      count: priceData.count    || 0,
      ts:   Date.now()
    });

    // Trim old entries
    if (history[key].length > MAX_HISTORY_PER_CARD) {
      history[key] = history[key].slice(-MAX_HISTORY_PER_CARD);
    }

    savePriceHistory(history);

    // Check price alerts
    checkAlerts(cardNumber, priceData);
  }

  // ── Price Alerts ───────────────────────────────────────────────────────────────

  function addPriceAlert(cardNumber, heroName, targetPrice, direction) {
    const alerts = getPriceAlerts();
    // Don't duplicate
    if (alerts.find(a => a.cardNumber === cardNumber && a.direction === direction)) {
      if (typeof showToast === 'function') showToast('Alert already exists', '⚠️');
      return;
    }
    alerts.push({
      cardNumber,
      heroName: heroName || '',
      targetPrice: parseFloat(targetPrice),
      direction: direction || 'below', // 'below' or 'above'
      created: Date.now(),
      triggered: false
    });
    savePriceAlerts(alerts);
    if (typeof showToast === 'function') {
      showToast(`Alert set: ${heroName || cardNumber} ${direction} $${targetPrice}`, '🔔');
    }
  }

  function removePriceAlert(index) {
    const alerts = getPriceAlerts();
    alerts.splice(index, 1);
    savePriceAlerts(alerts);
  }

  function checkAlerts(cardNumber, priceData) {
    const alerts = getPriceAlerts();
    let triggered = false;

    for (const alert of alerts) {
      if (alert.triggered) continue;
      if (alert.cardNumber.toUpperCase() !== cardNumber.toUpperCase()) continue;

      const currentPrice = priceData.avgPrice || priceData.soldAvg;
      if (!currentPrice) continue;

      const shouldTrigger = alert.direction === 'below'
        ? currentPrice <= alert.targetPrice
        : currentPrice >= alert.targetPrice;

      if (shouldTrigger) {
        alert.triggered = true;
        triggered = true;
        if (typeof showToast === 'function') {
          showToast(
            `🔔 Price alert! ${alert.heroName || alert.cardNumber} is now $${currentPrice.toFixed(2)} (target: ${alert.direction} $${alert.targetPrice})`,
            '🔔'
          );
        }
      }
    }

    if (triggered) savePriceAlerts(alerts);
  }

  // ── Trend Chart (CSS-only, no external library) ────────────────────────────

  /**
   * Render a price trend chart for a card.
   * Returns an HTML string with a pure CSS bar chart.
   */
  function renderPriceTrendChart(cardNumber, options = {}) {
    const history = getPriceHistory();
    const key = cardNumber.toUpperCase();
    const data = history[key];

    if (!data || data.length < 2) {
      return `<div style="text-align:center;color:#64748b;padding:20px;font-size:13px;">
        Not enough price data yet. Prices are recorded each time you look up this card on eBay.
      </div>`;
    }

    const width  = options.width  || '100%';
    const height = options.height || 120;
    const period = options.period || 90; // days

    // Filter to requested period
    const cutoff = Date.now() - (period * 24 * 60 * 60 * 1000);
    const filtered = data.filter(d => d.ts >= cutoff);
    if (filtered.length < 2) {
      return `<div style="text-align:center;color:#64748b;padding:20px;font-size:13px;">
        Not enough data for the last ${period} days.
      </div>`;
    }

    // Get value range for scaling
    const prices = filtered.map(d => d.avg || d.sold || 0).filter(p => p > 0);
    if (prices.length === 0) return '';

    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const range = maxPrice - minPrice || 1;

    // Calculate trend
    const firstPrice = prices[0];
    const lastPrice  = prices[prices.length - 1];
    const trendPct   = ((lastPrice - firstPrice) / firstPrice * 100).toFixed(1);
    const trendColor = lastPrice >= firstPrice ? '#22c55e' : '#ef4444';
    const trendArrow = lastPrice >= firstPrice ? '↑' : '↓';

    // Build SVG sparkline
    const svgWidth = 300;
    const svgHeight = height - 30; // leave room for labels
    const points = filtered.map((d, i) => {
      const x = (i / (filtered.length - 1)) * svgWidth;
      const price = d.avg || d.sold || minPrice;
      const y = svgHeight - ((price - minPrice) / range) * (svgHeight - 10) - 5;
      return `${x},${y}`;
    }).join(' ');

    // Build gradient fill path
    const fillPoints = `0,${svgHeight} ${points} ${svgWidth},${svgHeight}`;

    const firstDate = new Date(filtered[0].ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const lastDate  = new Date(filtered[filtered.length - 1].ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    return `
      <div style="width:${width};margin:8px 0;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;">
          <span style="font-size:12px;color:#94a3b8;">${firstDate} — ${lastDate}</span>
          <span style="font-size:14px;font-weight:700;color:${trendColor};">
            ${trendArrow} ${Math.abs(trendPct)}%
          </span>
        </div>
        <svg viewBox="0 0 ${svgWidth} ${svgHeight}" style="width:100%;height:${svgHeight}px;"
             preserveAspectRatio="none">
          <defs>
            <linearGradient id="priceGrad_${key}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${trendColor}" stop-opacity="0.3"/>
              <stop offset="100%" stop-color="${trendColor}" stop-opacity="0.02"/>
            </linearGradient>
          </defs>
          <polygon points="${fillPoints}" fill="url(#priceGrad_${key})" />
          <polyline points="${points}" fill="none" stroke="${trendColor}" stroke-width="2" stroke-linejoin="round" />
        </svg>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#64748b;margin-top:2px;">
          <span>Low: $${minPrice.toFixed(2)}</span>
          <span>Current: $${lastPrice.toFixed(2)}</span>
          <span>High: $${maxPrice.toFixed(2)}</span>
        </div>
      </div>`;
  }

  // ── Price Alert Modal ──────────────────────────────────────────────────────

  function showPriceAlertModal(cardNumber, heroName, currentPrice) {
    document.getElementById('priceAlertModal')?.remove();

    const alerts = getPriceAlerts().filter(a => a.cardNumber.toUpperCase() === cardNumber.toUpperCase());

    const html = `
      <div class="modal active" id="priceAlertModal" style="z-index:10002;">
        <div class="modal-backdrop" id="priceAlertBackdrop"></div>
        <div class="modal-content" style="max-width:400px;">
          <div class="modal-header">
            <h2>🔔 Price Alert</h2>
            <button class="modal-close" id="priceAlertClose">×</button>
          </div>
          <div class="modal-body" style="padding:20px;">
            <p style="color:#94a3b8;font-size:13px;margin:0 0 12px;">
              Get notified when <strong>${typeof escapeHtml === 'function' ? escapeHtml(heroName || cardNumber) : (heroName || cardNumber)}</strong>
              ${currentPrice ? ` (currently $${currentPrice.toFixed(2)})` : ''}
              reaches your target price.
            </p>
            <div style="display:flex;gap:8px;margin-bottom:16px;">
              <select id="priceAlertDirection" style="padding:8px;border:1px solid rgba(148,163,184,0.2);border-radius:8px;background:#0d1524;color:#e2e8f0;font-size:13px;">
                <option value="below">Drops below</option>
                <option value="above">Rises above</option>
              </select>
              <div style="position:relative;flex:1;">
                <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#64748b;">$</span>
                <input type="number" id="priceAlertTarget" step="0.01" min="0"
                       value="${currentPrice ? (currentPrice * 0.8).toFixed(2) : '5.00'}"
                       style="width:100%;padding:8px 8px 8px 24px;border:1px solid rgba(148,163,184,0.2);border-radius:8px;background:#0d1524;color:#e2e8f0;font-size:13px;box-sizing:border-box;">
              </div>
            </div>
            ${alerts.length > 0 ? `
              <div style="border-top:1px solid rgba(148,163,184,0.1);padding-top:12px;margin-top:12px;">
                <div style="font-size:12px;color:#64748b;margin-bottom:8px;">Active alerts:</div>
                ${alerts.map((a, i) => `
                  <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;font-size:13px;color:#94a3b8;">
                    <span>${a.direction === 'below' ? '↓' : '↑'} $${a.targetPrice.toFixed(2)} ${a.triggered ? '(triggered)' : ''}</span>
                    <button onclick="window._removePriceAlert(${i})" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:12px;">Remove</button>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
          <div class="modal-footer" style="gap:8px;">
            <button class="btn-secondary" id="priceAlertCancel" style="flex:1;">Cancel</button>
            <button class="btn-tag-add" id="priceAlertSave" style="flex:1;">Set Alert</button>
          </div>
        </div>
      </div>`;

    document.body.insertAdjacentHTML('beforeend', html);

    const close = () => document.getElementById('priceAlertModal')?.remove();
    document.getElementById('priceAlertClose')?.addEventListener('click', close);
    document.getElementById('priceAlertCancel')?.addEventListener('click', close);
    document.getElementById('priceAlertBackdrop')?.addEventListener('click', close);
    document.getElementById('priceAlertSave')?.addEventListener('click', () => {
      const target = parseFloat(document.getElementById('priceAlertTarget')?.value);
      const direction = document.getElementById('priceAlertDirection')?.value || 'below';
      if (isNaN(target) || target <= 0) {
        if (typeof showToast === 'function') showToast('Enter a valid price', '⚠️');
        return;
      }
      addPriceAlert(cardNumber, heroName, target, direction);
      close();
    });

    window._removePriceAlert = function(idx) {
      removePriceAlert(idx);
      close();
      showPriceAlertModal(cardNumber, heroName, currentPrice);
    };
  }

  // ── Expose globally ─────────────────────────────────────────────────────────

  window.recordPrice          = recordPrice;
  window.renderPriceTrendChart = renderPriceTrendChart;
  window.showPriceAlertModal  = showPriceAlertModal;
  window.addPriceAlert        = addPriceAlert;
  window.getPriceAlerts       = getPriceAlerts;
  window.getCorrectionStats   = typeof getCorrectionStats === 'function' ? getCorrectionStats : () => ({});

  console.log('✅ Price trends module loaded');
})();
