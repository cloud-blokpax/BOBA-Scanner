// Card Scanner - Process Images and Extract Data

async function handleFiles(e) {
    console.log('handleFiles called with:', e);
    const files = e.target.files || e.dataTransfer?.files;
    
    if (!files || files.length === 0) {
        console.log('No files selected');
        return;
    }
    
    // Reset progress
    setProgress(0);
    
    console.log(`Processing ${files.length} file(s)...`);
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.type.startsWith('image/')) {
            console.warn(`Skipping non-image file: ${file.name}`);
            continue;
        }
        
        setProgress((i / files.length) * 100);
        
        try {
            await processImage(file);
        } catch (error) {
            console.error(`Error processing ${file.name}:`, error);
            showToast(`Failed to process ${file.name}`, '❌');
        }
    }
    
    // Reset file input
    e.target.value = '';
}

async function processImage(file) {
    console.log(`Processing image: ${file.name}`);
    
    const imageUrl = URL.createObjectURL(file);
    const processed = await preprocessImage(imageUrl);
    
    let cardNum = null;
    let heroName = null;
    let confidence = 0;
    let match = null;
    
    // Try OCR first
    if (ready.ocr) {
        try {
            const ocrResult = await scanWithOCR(processed);
            cardNum = ocrResult.cardNumber;
            heroName = ocrResult.heroName;
            confidence = ocrResult.confidence || 0;
            
            if (confidence >= 70 && cardNum) {
                match = findCard(cardNum, heroName);
                
                if (match) {
                    console.log('✅ OCR match found:', match.Name);
                    addCard(match, processed, file.name, 'free', confidence);
                    setProgress(100);
                    showToast(`${match.Name} (${cardNum}) scanned (Free OCR)`, '🆓');
                    return;
                }
            }
        } catch (err) {
            console.log('OCR failed, trying AI:', err.message);
        }
    }
    
    // OCR failed or low confidence - try AI
    console.log('OCR failed, trying AI:', confidence < 70 ? 'Low confidence' : 'undefined');
    
    // Check if user can make API call
    if (typeof canMakeApiCall === 'function') {
        const canCall = await canMakeApiCall();
        if (!canCall) {
            console.log('❌ API call limit reached');
            URL.revokeObjectURL(imageUrl);
            URL.revokeObjectURL(processed);
            return;
        }
    }
    
    try {
        console.log('Calling API with image data...');
        const extracted = await callAPI(processed);
        
        if (!extracted || !extracted.cardNumber) {
            throw new Error('No card data extracted from AI');
        }
        
        cardNum = extracted.cardNumber;
        heroName = extracted.hero;
        
        console.log('✅ Extracted data:', { cardNumber: cardNum, hero: heroName });
        
        // Find card in database
        match = findCard(cardNum, heroName);
        
        if (match) {
            console.log('✅ Perfect match found:', {
                cardNumber: match['Card Number'],
                hero: match.Name,
                set: match.Set,
                cardId: match['Card ID']
            });
            
            addCard(match, imageUrl, file.name, 'ai');
            setProgress(100);
            showToast(`${match.Name} (${cardNum}) scanned (AI)`, '💰');
            
            // Track API call if function exists
            if (typeof trackApiCall === 'function') {
                await trackApiCall('scan', true, 0.01, 1);
            }
            
        } else {
            console.error('❌ Card not found in database');
            console.log('Searched for:', { cardNumber: cardNum, hero: heroName });
            
            // Track failed API call
            if (typeof trackApiCall === 'function') {
                await trackApiCall('scan', false, 0.01, 1);
            }
            
            throw new Error(`Card "${cardNum}" with hero "${heroName}" not found`);
        }
        
    } catch (err) {
        console.error('❌ AI scan failed:', err.message);
        showToast('Scan failed. Try again or check image quality.', '❌');
        URL.revokeObjectURL(imageUrl);
        URL.revokeObjectURL(processed);
        throw err;
    }
}

function addCard(match, imageUrl, fileName, type, confidence = null) {
    console.log('📝 Adding card to collection:', match['Card Number']);
    
    // CRITICAL: Get full collections array, not just current collection reference
    const collections = getCollections();
    const currentId = getCurrentCollectionId();
    const collection = collections.find(c => c.id === currentId);
    
    if (!collection) {
        console.error('❌ No collection found!');
        if (typeof showToast === 'function') {
            showToast('Failed to save card - no collection', '❌');
        }
        return;
    }
    
    // Create card object
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
        scanMethod: type === 'free' ? `Free OCR (${Math.round(confidence)}%)` : 'AI + Database',
        timestamp: new Date().toISOString()
    };
    
    // Add card to collection
    collection.cards.push(card);
    
    // Update stats
    collection.stats.scanned++;
    if (type === 'free') collection.stats.free++;
    if (type === 'ai') collection.stats.aiCalls = (collection.stats.aiCalls || 0) + 1;
    
    console.log(`✅ Card added: ${card.hero} (${card.cardNumber})`);
    console.log(`📊 Collection now has ${collection.cards.length} cards`);
    
    // CRITICAL: Save to localStorage with the full collections array
    saveCollections(collections);
    
    // Track in Supabase if available
    if (typeof trackCardAdded === 'function') {
        trackCardAdded();
    }
    
    // Update all UI elements
    if (typeof updateStats === 'function') {
        updateStats();
    }
    
    if (typeof renderCards === 'function') {
        renderCards();
    }
    
    if (typeof renderCollections === 'function') {
        renderCollections();
    }
    
    // Haptic feedback
    if (navigator.vibrate) {
        navigator.vibrate(type === 'free' ? 50 : [50, 100, 50]);
    }
    
    // Show success message
    if (typeof showToast === 'function') {
        showToast(`Added: ${card.hero} (${card.cardNumber})`, '✅');
    }
}

function removeCard(index) {
    console.log('🗑️ Removing card at index:', index);
    
    const collections = getCollections();
    const currentId = getCurrentCollectionId();
    const collection = collections.find(c => c.id === currentId);
    
    if (!collection || !collection.cards[index]) {
        console.error('❌ Card not found at index:', index);
        return;
    }
    
    const card = collection.cards[index];
    
    // Revoke object URL to free memory
    if (card.imageUrl) {
        URL.revokeObjectURL(card.imageUrl);
    }
    
    // Remove from array
    collection.cards.splice(index, 1);
    
    // Update stats
    collection.stats.scanned--;
    if (card.scanType === 'free') collection.stats.free--;
    
    console.log(`✅ Card removed: ${card.hero || 'Unknown'}`);
    console.log(`📊 Collection now has ${collection.cards.length} cards`);
    
    // Save
    saveCollections(collections);
    
    // Track removal
    if (typeof trackCardAdded === 'function') {
        trackCardAdded();
    }
    
    // Update UI
    if (typeof updateStats === 'function') {
        updateStats();
    }
    
    if (typeof renderCards === 'function') {
        renderCards();
    }
    
    if (typeof renderCollections === 'function') {
        renderCollections();
    }
    
    if (typeof showToast === 'function') {
        showToast('Card removed', '🗑️');
    }
}

function updateCard(index, field, value) {
    console.log(`✏️ Updating card ${index}, field: ${field}`);
    
    const collections = getCollections();
    const currentId = getCurrentCollectionId();
    const collection = collections.find(c => c.id === currentId);
    
    if (!collection || !collection.cards[index]) {
        console.error('❌ Card not found at index:', index);
        return;
    }
    
    collection.cards[index][field] = value;
    saveCollections(collections);
    
    console.log(`✅ Card updated: ${field} = ${value}`);
}
