// Main Scanner Logic

async function handleFiles(e) {
    console.log('handleFiles called with:', e);
    
    // Handle multiple call patterns
    let files;
    
    if (!e) {
        // Called without parameter - get files from input directly
        const fileInput = document.getElementById('fileInput');
        if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
            console.warn('No files selected');
            return;
        }
        files = Array.from(fileInput.files).filter(f => f.type.startsWith('image/'));
    } else if (e.target && e.target.files) {
        // Standard event object
        files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
    } else if (e.dataTransfer && e.dataTransfer.files) {
        // Drag and drop event
        files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    } else {
        console.error('Invalid event object:', e);
        return;
    }
    
    if (!files.length) {
        console.warn('No image files found');
        return;
    }
    
    console.log(`Processing ${files.length} file(s)...`);
    
    if (files.length > 1) {
        if (!confirm(`Scan ${files.length} cards?`)) {
            const fileInput = document.getElementById('fileInput');
            if (fileInput) fileInput.value = '';
            return;
        }
    }
    
    for (let i = 0; i < files.length; i++) {
        showLoading(true, `Processing ${i + 1}/${files.length}...`);
        await processImage(files[i]);
        if (i < files.length - 1) await new Promise(r => setTimeout(r, 300));
    }
    
    // Clear file input
    const fileInput = document.getElementById('fileInput');
    if (fileInput) fileInput.value = '';
}

async function processImage(file) {
    console.log('Processing image:', file.name);
    
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
        
        // Check if we need to check API limits
        if (typeof canMakeApiCall === 'function') {
            const canCall = await canMakeApiCall();
            if (!canCall) {
                showLoading(false);
                return; // Limit modal already shown
            }
        }
        
        try {
            showLoading(true, 'Using AI...');
            const imageUrl = URL.createObjectURL(file);
            const compressed = await compressImage(file);
            setProgress(70);
            
            console.log('Calling API with image data...');
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
            
            // Track API call if function exists
            if (typeof trackApiCall === 'function') {
                await trackApiCall('card_scan', true, config.aiCost, 1);
            } else {
                collection.stats.cost += config.aiCost;
                saveCollections();
            }
            
        } catch (aiErr) {
            console.error('AI scan failed:', aiErr.message);
            showToast('AI scan failed: ' + aiErr.message, '❌');
        }
    } finally {
        showLoading(false);
        const uploadArea = document.getElementById('uploadArea');
        if (uploadArea) uploadArea.classList.remove('processing');
        setProgress(0);
    }
}

function addCard(match, imageUrl, fileName, type, confidence = null) {
    console.log('📝 Adding card:', match['Card Number']);
    
    // NEW WAY: Get full collections array
    const collections = getCollections();
    const currentId = getCurrentCollectionId();
    const collection = collections.find(c => c.id === currentId);
    
    if (!collection) {
        console.error('❌ No collection found!');
        return;
    }
    
    // Create card
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
    
    // Add to collection
    collection.cards.push(card);
    collection.stats.scanned++;
    if (type === 'free') collection.stats.free++;
    
    console.log(`✅ Card added: ${card.hero} (${card.cardNumber})`);
    console.log(`📊 Collection now has ${collection.cards.length} cards`);
    
    // CRITICAL: Save with full collections array
    saveCollections(collections);
    
    // Track
    if (typeof trackCardAdded === 'function') {
        trackCardAdded();
    }
    
    // Update UI
    if (typeof updateStats === 'function') updateStats();
    if (typeof renderCards === 'function') renderCards();
    if (typeof renderCollections === 'function') renderCollections();
    
    showToast(`Added: ${card.hero} (${card.cardNumber})`, '✅');
}
    
    collection.cards.push(card);
    collection.stats.scanned++;
    if (type === 'free') collection.stats.free++;
    
    // Track card added if function exists
    if (typeof trackCardAdded === 'function') {
        trackCardAdded();
    }
    
    saveCollections();
    updateStats();
    renderCards();
    renderCollections();
    
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
}

function updateCard(index, field, value) {
    const collection = getCurrentCollection();
    collection.cards[index][field] = value;
    saveCollections();
}
