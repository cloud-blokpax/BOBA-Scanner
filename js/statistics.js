// js/statistics.js - Collection Statistics Module

function getCollectionStats(collection) {
    if (!collection || !collection.cards || collection.cards.length === 0) {
        return {
            totalCards: 0,
            uniqueSets: 0,
            uniqueHeroes: 0,
            mostCommonSet: null,
            mostCommonHero: null,
            scanRate: 0,
            totalCost: 0,
            avgCardsPerSet: 0,
            oldestCard: null,
            newestCard: null
        };
    }

    const cards = collection.cards;
    
    // Basic counts
    const totalCards = cards.length;
    const uniqueSets = new Set(cards.map(c => c.set).filter(Boolean)).size;
    const uniqueHeroes = new Set(cards.map(c => c.hero).filter(Boolean)).size;
    
    // Most common set
    const mostCommonSet = getMostCommon(cards.map(c => c.set).filter(Boolean));
    
    // Most common hero
    const mostCommonHero = getMostCommon(cards.map(c => c.hero).filter(Boolean));
    
    // Scan statistics
    const scanRate = collection.stats.scanned > 0 
        ? Math.round((collection.stats.free / collection.stats.scanned) * 100) 
        : 0;
    
    const totalCost = collection.stats.cost || 0;
    
    // Average cards per set
    const avgCardsPerSet = uniqueSets > 0 
        ? Math.round(totalCards / uniqueSets) 
        : 0;
    
    // Oldest and newest cards by year
    const yearsFiltered = cards.map(c => c.year).filter(y => y && !isNaN(parseInt(y)));
    const oldestCard = yearsFiltered.length > 0 
        ? Math.min(...yearsFiltered.map(y => parseInt(y))) 
        : null;
    const newestCard = yearsFiltered.length > 0 
        ? Math.max(...yearsFiltered.map(y => parseInt(y))) 
        : null;

    return {
        totalCards,
        uniqueSets,
        uniqueHeroes,
        mostCommonSet,
        mostCommonHero,
        scanRate,
        totalCost,
        avgCardsPerSet,
        oldestCard,
        newestCard
    };
}

function getMostCommon(arr) {
    if (!arr || arr.length === 0) return null;
    
    const frequency = {};
    let maxCount = 0;
    let mostCommon = null;
    
    arr.forEach(item => {
        frequency[item] = (frequency[item] || 0) + 1;
        if (frequency[item] > maxCount) {
            maxCount = frequency[item];
            mostCommon = item;
        }
    });
    
    return { value: mostCommon, count: maxCount };
}

function getAllCollectionsStats() {
    const totalCards = collections.reduce((sum, c) => sum + c.cards.length, 0);
    const totalCollections = collections.length;
    const totalScans = collections.reduce((sum, c) => sum + (c.stats.scanned || 0), 0);
    const totalFreeScans = collections.reduce((sum, c) => sum + (c.stats.free || 0), 0);
    const totalCost = collections.reduce((sum, c) => sum + (c.stats.cost || 0), 0);
    
    // Get all unique sets across all collections
    const allSets = new Set();
    collections.forEach(c => {
        c.cards.forEach(card => {
            if (card.set) allSets.add(card.set);
        });
    });
    
    // Get all unique heroes
    const allHeroes = new Set();
    collections.forEach(c => {
        c.cards.forEach(card => {
            if (card.hero) allHeroes.add(card.hero);
        });
    });
    
    const overallScanRate = totalScans > 0 
        ? Math.round((totalFreeScans / totalScans) * 100) 
        : 0;
    
    return {
        totalCards,
        totalCollections,
        totalScans,
        totalFreeScans,
        totalCost,
        uniqueSets: allSets.size,
        uniqueHeroes: allHeroes.size,
        overallScanRate,
        avgCardsPerCollection: totalCollections > 0 
            ? Math.round(totalCards / totalCollections) 
            : 0
    };
}

function renderCollectionStats(collectionId) {
    const collection = collections.find(c => c.id === collectionId) || getCurrentCollection();
    const stats = getCollectionStats(collection);
    
    const statsHTML = `
        <div class="collection-stats-panel">
            <div class="stats-header">
                <h3>📊 Collection Statistics</h3>
                <div class="stats-collection-name">${collection.name}</div>
            </div>
            
            <div class="stats-grid">
                <div class="stat-item">
                    <div class="stat-icon">🎴</div>
                    <div class="stat-details">
                        <div class="stat-value">${stats.totalCards}</div>
                        <div class="stat-label">Total Cards</div>
                    </div>
                </div>
                
                <div class="stat-item">
                    <div class="stat-icon">📦</div>
                    <div class="stat-details">
                        <div class="stat-value">${stats.uniqueSets}</div>
                        <div class="stat-label">Unique Sets</div>
                    </div>
                </div>
                
                <div class="stat-item">
                    <div class="stat-icon">🦸</div>
                    <div class="stat-details">
                        <div class="stat-value">${stats.uniqueHeroes}</div>
                        <div class="stat-label">Unique Heroes</div>
                    </div>
                </div>
                
                <div class="stat-item">
                    <div class="stat-icon">📈</div>
                    <div class="stat-details">
                        <div class="stat-value">${stats.avgCardsPerSet}</div>
                        <div class="stat-label">Avg Cards/Set</div>
                    </div>
                </div>
                
                ${stats.mostCommonSet ? `
                <div class="stat-item wide">
                    <div class="stat-icon">⭐</div>
                    <div class="stat-details">
                        <div class="stat-value">${stats.mostCommonSet.value}</div>
                        <div class="stat-label">Most Common Set (${stats.mostCommonSet.count} cards)</div>
                    </div>
                </div>
                ` : ''}
                
                ${stats.mostCommonHero ? `
                <div class="stat-item wide">
                    <div class="stat-icon">🏆</div>
                    <div class="stat-details">
                        <div class="stat-value">${stats.mostCommonHero.value}</div>
                        <div class="stat-label">Most Common Hero (${stats.mostCommonHero.count} cards)</div>
                    </div>
                </div>
                ` : ''}
                
                ${stats.oldestCard && stats.newestCard ? `
                <div class="stat-item">
                    <div class="stat-icon">📅</div>
                    <div class="stat-details">
                        <div class="stat-value">${stats.oldestCard} - ${stats.newestCard}</div>
                        <div class="stat-label">Year Range</div>
                    </div>
                </div>
                ` : ''}
                
                <div class="stat-item">
                    <div class="stat-icon">🎉</div>
                    <div class="stat-details">
                        <div class="stat-value">${stats.scanRate}%</div>
                        <div class="stat-label">Free Scan Rate</div>
                    </div>
                </div>
                
                <div class="stat-item">
                    <div class="stat-icon">💰</div>
                    <div class="stat-details">
                        <div class="stat-value">$${stats.totalCost.toFixed(2)}</div>
                        <div class="stat-label">AI Cost</div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    return statsHTML;
}

function showStatsModal() {
    const collection = getCurrentCollection();
    const statsHTML = renderCollectionStats(collection.id);
    
    const modal = `
        <div class="modal active" id="statsModal">
            <div class="modal-content stats-modal-content">
                <div class="modal-header">
                    <div class="modal-title">Collection Statistics</div>
                    <div class="modal-close" onclick="closeStatsModal()">×</div>
                </div>
                ${statsHTML}
                
                <div class="stats-actions">
                    <button class="btn btn-secondary" onclick="showAllCollectionsStats()">
                        View All Collections
                    </button>
                </div>
            </div>
        </div>
    `;
    
    // Remove existing stats modal if any
    const existing = document.getElementById('statsModal');
    if (existing) existing.remove();
    
    document.body.insertAdjacentHTML('beforeend', modal);
}

function showAllCollectionsStats() {
    const allStats = getAllCollectionsStats();
    
    const statsHTML = `
        <div class="collection-stats-panel">
            <div class="stats-header">
                <h3>📊 Overall Statistics</h3>
                <div class="stats-collection-name">All Collections</div>
            </div>
            
            <div class="stats-grid">
                <div class="stat-item">
                    <div class="stat-icon">📁</div>
                    <div class="stat-details">
                        <div class="stat-value">${allStats.totalCollections}</div>
                        <div class="stat-label">Total Collections</div>
                    </div>
                </div>
                
                <div class="stat-item">
                    <div class="stat-icon">🎴</div>
                    <div class="stat-details">
                        <div class="stat-value">${allStats.totalCards}</div>
                        <div class="stat-label">Total Cards</div>
                    </div>
                </div>
                
                <div class="stat-item">
                    <div class="stat-icon">📦</div>
                    <div class="stat-details">
                        <div class="stat-value">${allStats.uniqueSets}</div>
                        <div class="stat-label">Unique Sets</div>
                    </div>
                </div>
                
                <div class="stat-item">
                    <div class="stat-icon">🦸</div>
                    <div class="stat-details">
                        <div class="stat-value">${allStats.uniqueHeroes}</div>
                        <div class="stat-label">Unique Heroes</div>
                    </div>
                </div>
                
                <div class="stat-item">
                    <div class="stat-icon">📈</div>
                    <div class="stat-details">
                        <div class="stat-value">${allStats.avgCardsPerCollection}</div>
                        <div class="stat-label">Avg Cards/Collection</div>
                    </div>
                </div>
                
                <div class="stat-item">
                    <div class="stat-icon">🎉</div>
                    <div class="stat-details">
                        <div class="stat-value">${allStats.overallScanRate}%</div>
                        <div class="stat-label">Free Scan Rate</div>
                    </div>
                </div>
                
                <div class="stat-item">
                    <div class="stat-icon">💰</div>
                    <div class="stat-details">
                        <div class="stat-value">$${allStats.totalCost.toFixed(2)}</div>
                        <div class="stat-label">Total AI Cost</div>
                    </div>
                </div>
            </div>
            
            <div class="per-collection-breakdown">
                <h4>Per Collection Breakdown</h4>
                ${collections.map(c => {
                    const stats = getCollectionStats(c);
                    return `
                        <div class="breakdown-item">
                            <div class="breakdown-name">${c.name}</div>
                            <div class="breakdown-stats">
                                <span>🎴 ${stats.totalCards}</span>
                                <span>📦 ${stats.uniqueSets} sets</span>
                                <span>🎉 ${stats.scanRate}% free</span>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
    
    const modal = document.getElementById('statsModal');
    modal.querySelector('.modal-content').innerHTML = `
        <div class="modal-header">
            <div class="modal-title">Overall Statistics</div>
            <div class="modal-close" onclick="closeStatsModal()">×</div>
        </div>
        ${statsHTML}
        <div class="stats-actions">
            <button class="btn btn-primary" onclick="closeStatsModal()">Close</button>
        </div>
    `;
}

function closeStatsModal() {
    const modal = document.getElementById('statsModal');
    if (modal) modal.remove();
}
