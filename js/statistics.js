// Statistics tracking for card scans

function showStatsModal() {
    const collection = getCurrentCollection();
    
    const totalScanned = collection.stats.scanned || collection.cards.length;
    const freeScans = collection.cards.filter(c => c.scanMethod === 'OCR').length;
    const paidScans = collection.cards.filter(c => c.scanMethod === 'AI').length;
    const totalCost = paidScans * config.aiCost;
    const freeRate = totalScanned > 0 ? ((freeScans / totalScanned) * 100).toFixed(1) : 0;
    
    const modal = `
        <div class="modal active" id="statsModal">
            <div class="modal-content">
                <div class="modal-header">
                    <div class="modal-title">📊 Statistics - ${collection.name}</div>
                    <div class="modal-close" onclick="closeStatsModal()">×</div>
                </div>
                
                <div class="stats-grid-modal">
                    <div class="stat-card-modal">
                        <div class="stat-icon" style="color: var(--primary);">📸</div>
                        <div class="stat-value">${totalScanned}</div>
                        <div class="stat-label">Total Scanned</div>
                    </div>
                    
                    <div class="stat-card-modal">
                        <div class="stat-icon" style="color: #22c55e;">✨</div>
                        <div class="stat-value">${freeScans}</div>
                        <div class="stat-label">Free (OCR)</div>
                    </div>
                    
                    <div class="stat-card-modal">
                        <div class="stat-icon" style="color: #f59e0b;">🤖</div>
                        <div class="stat-value">${paidScans}</div>
                        <div class="stat-label">Paid (AI)</div>
                    </div>
                    
                    <div class="stat-card-modal">
                        <div class="stat-icon" style="color: #ef4444;">💰</div>
                        <div class="stat-value">$${totalCost.toFixed(2)}</div>
                        <div class="stat-label">Total Cost</div>
                    </div>
                    
                    <div class="stat-card-modal">
                        <div class="stat-icon" style="color: #8b5cf6;">📈</div>
                        <div class="stat-value">${freeRate}%</div>
                        <div class="stat-label">Free Rate</div>
                    </div>
                </div>
                
                <div class="modal-buttons">
                    <button class="btn btn-secondary" onclick="closeStatsModal()">Close</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modal);
}

function closeStatsModal() {
    const modal = document.getElementById('statsModal');
    if (modal) modal.remove();
}

function updateStatsBar() {
    const statsBar = document.getElementById('statsBar');
    if (!statsBar) return;
    
    const collection = getCurrentCollection();
    
    const totalScanned = collection.stats.scanned || collection.cards.length;
    const freeScans = collection.cards.filter(c => c.scanMethod === 'OCR').length;
    const paidScans = collection.cards.filter(c => c.scanMethod === 'AI').length;
    const totalCost = paidScans * config.aiCost;
    const freeRate = totalScanned > 0 ? ((freeScans / totalScanned) * 100).toFixed(0) : 0;
    
    document.getElementById('statFree').textContent = freeScans;
    document.getElementById('statPaid').textContent = paidScans;
    document.getElementById('statCost').textContent = `$${totalCost.toFixed(2)}`;
    document.getElementById('statRate').textContent = `${freeRate}%`;
    
    if (totalScanned > 0) {
        statsBar.classList.remove('hidden');
    }
}
