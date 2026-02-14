// Main Scanner Logic

async function handleFiles(e) {
    const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    
    if (files.length > 1) {
        if (!confirm(`Scan ${files.length} cards?`)) {
            e.target.value = '';
            return;
        }
    }
    
    for (let i = 0; i < files.length; i++) {
        showLoading(true, `Processing ${i + 1}/${files.length}...`);
        await processImage(files[i]);
        if (i < files.length - 1) await new Promise(r => setTimeout(r, 300));
    }
    
    e.target.value = '';
}

async function processImage(file) {
    try {
        const uploadArea = document.getElementById('uploadArea');
        uploadArea.classList.add('processing');
        
        setProgress(0);
        const imageUrl = URL.createObjectURL(file);
        setProgress(10);
        
        showLoading(true, 'Detecting card...');
        const processed = config.autoDetect ? await detectCard(imageUrl) : imageUrl;
        setProgress(30);
        
        showLoading(true, 'Reading card...');
        const { text, confidence } = await runOCR(processed);
        setProgress(60);
        
        const cardNumber = extractCardNumber(text);
        console.log({ text, confidence, cardNumber });
        
        if (!cardNumber || confidence < config.threshold) {
            throw new Error('Low confidence');
        }
        
        showLoading(true, 'Looking up...');
        const match = findCard(cardNumber, null);
        setProgress(80);
        
        if (!match) {
            console.warn('⚠️ Card number found but not unique or not in database - need AI');
            throw new Error('Multiple cards with this number or not found - need AI');
        }
        
        addCard(match, processed, file.name, 'free', confidence);
        setProgress(100);
        showToast(`Card ${cardNumber} scanned (FREE)`, '🎉');
        
    } catch (err) {
        console.log('OCR failed, trying AI:', err.message);
        
        if (!apiKey) {
            showLoading(false);
            showToast('OCR failed. Add API key?', '⚠️');
            return;
        }
        
        try {
            showLoading(true, 'Using AI...');
            const imageUrl = URL.createObjectURL(file);
            const compressed = await compressImage(file);
            setProgress(70);
            
            const data = await callAPI(compressed);
            setProgress(85);
            
            console.log('Full API response:', data);
            
            if (!data.content || !data.content[0] || !data.content[0].text) {
                throw new Error('Empty or invalid response from AI');
            }
            
            const rawText = data.content[0].text.replace(/```json|```/g, '').trim();
            console.log('Claude raw text:', rawText);
            
            let parsed;
            try {
                parsed = JSON.parse(rawText);
            } catch(e) {
                throw new Error('Claude response not valid JSON: ' + rawText);
            }
            
            const cardNum = parsed.cardNumber;
            const heroName = parsed.hero;
            
            if (!cardNum) {
                throw new Error('AI did not extract a card number');
            }
            
            if (!heroName) {
                console.warn('⚠️ AI did not extract hero name - may cause issues with duplicate card numbers');
            }
            
            const cardNumPattern = /^[A-Z]{2,4}-\d{2,4}$/i;
            if (!cardNumPattern.test(cardNum)) {
                console.warn(`⚠️ Warning: Card number "${cardNum}" has unusual format`);
            }
            
            console.log('✅ Extracted data:', { cardNumber: cardNum, hero: heroName });
            
            const match = findCard(cardNum, heroName);
            
            if (!match) {
                const normalized = String(cardNum).toUpperCase().trim();
                const similar = database
                    .filter(c => {
                        const dbNum = String(c['Card Number'] || '').toUpperCase().trim();
                        return dbNum === normalized;
                    })
                    .slice(0, 10)
                    .map(c => ({ num: c['Card Number'], name: c.Name, set: c.Set }));
                
                console.error('❌ Card not found in database');
                console.log('Searched for:', { cardNumber: normalized, hero: heroName });
                console.log('All cards with number', normalized + ':', similar);
                
                throw new Error(`Card "${cardNum}" with hero "${heroName}" not found`);
            }
            
            console.log('✅ Perfect match found:', {
                cardNumber: match['Card Number'],
                hero: match.Name,
                set: match.Set,
                cardId: match['Card ID']
            });
            
            const collection = getCurrentCollection();
            addCard(match, imageUrl, file.name, 'ai');
            setProgress(100);
            showToast(`${match.Name} (${cardNum}) scanned (AI)`, '💰');
            collection.stats.cost += config.aiCost;
            saveCollections();
            
        } catch (aiErr) {
            console.error('AI scan failed:', aiErr.message);
            showToast('AI scan failed: ' + aiErr.message, '❌');
        }
    } finally {
        showLoading(false);
        document.getElementById('uploadArea').classList.remove('processing');
        setProgress(0);
    }
}

function addCard(match, imageUrl, fileName, type, confidence = null) {
    const collection = getCurrentCollection();
    
    const card = {
        cardId: match['Card ID'] || '',
        hero: match.Name || '',
        year: match.Year || '',
        set: match.Set || '',
        cardNumber: match['Card Number'] || '',
        pose: match.Parallel || '',
        weapon: match.Weapon || '',
        power: match.Power || '',
        imageUrl,
        fileName,
        scanType: type,
        scanMethod: type === 'free' ? `Free OCR (${Math.round(confidence)}%)` : 'AI + Database'
    };
    
    collection.cards.push(card);
    collection.stats.scanned++;
    if (type === 'free') collection.stats.free++;
    
    saveCollections();
    updateStats();
    renderCards();
    renderCollections();
    
    // NEW: Refresh recent scans widget if it's open
    if (typeof refreshRecentScans === 'function') {
        refreshRecentScans();
    }
    
    if (navigator.vibrate) {
        navigator.vibrate(type === 'free' ? 50 : [50, 100, 50]);
    }
}

function removeCard(index) {
    const collection = getCurrentCollection();
    
    if (collection.cards[index].imageUrl) {
        URL.revokeObjectURL(collection.cards[index].imageUrl);
    }
    collection.cards.splice(index, 1);
    collection.stats.scanned--;
    
    saveCollections();
    updateStats();
    renderCards();
    renderCollections();
    
    // NEW: Refresh recent scans widget if it's open
    if (typeof refreshRecentScans === 'function') {
        refreshRecentScans();
    }
}

function updateCard(index, field, value) {
    const collection = getCurrentCollection();
    collection.cards[index][field] = value;
    saveCollections();
}
