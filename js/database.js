// Database Loading & Card Matching

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

function findCard(cardNumber, heroName = null) {
    if (!ready.db || !cardNumber) {
        console.error('findCard called but:', { dbReady: ready.db, cardNumber, heroName });
        return null;
    }
    
    const normalizedCardNum = String(cardNumber).toUpperCase().trim();
    const normalizedHero = heroName ? String(heroName).toUpperCase().trim() : null;
    
    console.log('🔍 Searching for card:', { cardNumber: normalizedCardNum, hero: normalizedHero });
    
    const cardNumberMatches = database.filter(c => {
        const dbNum = String(c['Card Number'] || '').toUpperCase().trim();
        return dbNum === normalizedCardNum;
    });
    
    console.log(`Found ${cardNumberMatches.length} card(s) with number "${normalizedCardNum}"`);
    
    if (cardNumberMatches.length === 0) {
        console.log('❌ No cards found with that number');
        console.log('Sample DB entries:', database.slice(0, 3).map(c => ({
            num: c['Card Number'],
            name: c.Name
        })));
        return null;
    }
    
    if (cardNumberMatches.length === 1) {
        const match = cardNumberMatches[0];
        console.log('✅ Single match found:', {
            cardNumber: match['Card Number'],
            name: match.Name,
            set: match.Set
        });
        return match;
    }
    
    console.log('⚠️ Multiple cards found with same number:', 
        cardNumberMatches.map(c => ({ name: c.Name, set: c.Set }))
    );
    
    if (!normalizedHero) {
        console.error('❌ Multiple matches but no hero name provided to disambiguate');
        console.log('Available options:', cardNumberMatches.map(c => c.Name));
        return null;
    }
    
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
