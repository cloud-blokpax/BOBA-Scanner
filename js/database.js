// Database Loading & Card Matching - ENHANCED WITH FUZZY MATCHING

async function loadDatabase() {
    setStatus('db', 'loading');
    try {
        const res = await fetch('./card-database.json');
        if (!res.ok) throw new Error('DB not found');
        database = await res.json();
        ready.db = true;
        setStatus('db', 'ready');
        console.log(`✅ DB: ${database.length} cards`);
    } catch (err) {
        console.error('❌ DB failed:', err);
        setStatus('db', 'error');
    }
}

// Calculate Levenshtein distance (how different two strings are)
function levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
    }
    
    return matrix[str2.length][str1.length];
}

// Find closest matching card numbers (for OCR errors like 64 vs 84)
function findSimilarCardNumbers(searchNumber, maxDistance = 2) {
    const normalized = String(searchNumber).toUpperCase().trim();
    const results = [];
    
    database.forEach(card => {
        const cardNum = String(card['Card Number'] || '').toUpperCase().trim();
        const distance = levenshteinDistance(normalized, cardNum);
        
        if (distance <= maxDistance) {
            results.push({
                card: card,
                cardNumber: cardNum,
                distance: distance,
                score: 1 - (distance / Math.max(normalized.length, cardNum.length))
            });
        }
    });
    
    // Sort by distance (closest first)
    results.sort((a, b) => a.distance - b.distance);
    
    return results;
}

function findCard(cardNumber, heroName = null) {
    if (!ready.db || !cardNumber) {
        console.error('findCard called but:', { dbReady: ready.db, cardNumber, heroName });
        return null;
    }
    
    const normalizedCardNum = String(cardNumber).toUpperCase().trim();
    const normalizedHero = heroName ? String(heroName).toUpperCase().trim() : null;
    
    console.log('🔍 Searching for card:', { cardNumber: normalizedCardNum, hero: normalizedHero });
    
    // STEP 1: Try exact match
    const cardNumberMatches = database.filter(c => {
        const dbNum = String(c['Card Number'] || '').toUpperCase().trim();
        return dbNum === normalizedCardNum;
    });
    
    console.log(`Found ${cardNumberMatches.length} exact match(es) with number "${normalizedCardNum}"`);
    
    // STEP 2: If no exact match, try fuzzy matching (for OCR errors)
    if (cardNumberMatches.length === 0) {
        console.log('⚠️ No exact match found, trying fuzzy matching...');
        
        const similarCards = findSimilarCardNumbers(normalizedCardNum, 2);
        
        if (similarCards.length > 0) {
            console.log(`🔍 Found ${similarCards.length} similar card(s):`);
            similarCards.slice(0, 5).forEach(s => {
                console.log(`   - ${s.cardNumber} (distance: ${s.distance}, score: ${(s.score * 100).toFixed(1)}%)`);
            });
            
            // If we have a hero name, try to match with it
            if (normalizedHero) {
                const heroMatch = similarCards.find(s => {
                    const dbHero = String(s.card.Name || '').toUpperCase().trim();
                    return dbHero === normalizedHero || 
                           dbHero.includes(normalizedHero) || 
                           normalizedHero.includes(dbHero);
                });
                
                if (heroMatch) {
                    console.log(`✅ FUZZY MATCH with hero: ${heroMatch.cardNumber} - ${heroMatch.card.Name}`);
                    console.log(`   Original AI read: "${normalizedCardNum}" → Corrected to: "${heroMatch.cardNumber}"`);
                    
                    if (typeof showToast === 'function') {
                        showToast(`OCR corrected: ${normalizedCardNum} → ${heroMatch.cardNumber}`, '🔧');
                    }
                    
                    return heroMatch.card;
                }
            }
            
            // If only one very close match (distance 1), use it
            if (similarCards.length === 1 && similarCards[0].distance === 1) {
                console.log(`✅ AUTO-CORRECTED: ${normalizedCardNum} → ${similarCards[0].cardNumber}`);
                
                if (typeof showToast === 'function') {
                    showToast(`OCR corrected: ${normalizedCardNum} → ${similarCards[0].cardNumber}`, '🔧');
                }
                
                return similarCards[0].card;
            }
            
            // Show user the options
            console.log('⚠️ Multiple similar cards found, need more info to decide');
            console.log('Available options:', similarCards.map(s => ({
                cardNumber: s.cardNumber,
                name: s.card.Name,
                distance: s.distance
            })));
        }
        
        console.log('❌ No cards found (exact or fuzzy)');
        return null;
    }
    
    // STEP 3: Handle exact matches
    if (cardNumberMatches.length === 1) {
        const match = cardNumberMatches[0];
        console.log('✅ Single exact match found:', {
            cardNumber: match['Card Number'],
            name: match.Name,
            set: match.Set
        });
        return match;
    }
    
    // STEP 4: Multiple exact matches - use hero name to disambiguate
    console.log('⚠️ Multiple cards found with same number:', 
        cardNumberMatches.map(c => ({ name: c.Name, set: c.Set }))
    );
    
    if (!normalizedHero) {
        console.error('❌ Multiple matches but no hero name provided');
        console.log('Available options:', cardNumberMatches.map(c => c.Name));
        return null;
    }
    
    // Try exact hero match
    let match = cardNumberMatches.find(c => {
        const dbHero = String(c.Name || '').toUpperCase().trim();
        return dbHero === normalizedHero;
    });
    
    if (match) {
        console.log('✅ Exact match found with hero name:', {
            cardNumber: match['Card Number'],
            name: match.Name,
            set: match.Set
        });
        return match;
    }
    
    // Try partial hero match
    match = cardNumberMatches.find(c => {
        const dbHero = String(c.Name || '').toUpperCase().trim();
        return dbHero.includes(normalizedHero) || normalizedHero.includes(dbHero);
    });
    
    if (match) {
        console.log('✅ Partial match found with hero name:', {
            cardNumber: match['Card Number'],
            name: match.Name,
            set: match.Set,
            confidence: 'partial'
        });
        return match;
    }
    
    console.error('❌ Hero name mismatch');
    console.log('AI extracted hero:', normalizedHero);
    console.log('Available heroes for this card number:', cardNumberMatches.map(c => c.Name));
    
    return null;
}
