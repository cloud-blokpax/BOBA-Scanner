// Card Scanner - Process Images and Extract Data
// COMPLETE VERSION with all helper functions

// ========================================
// IMAGE PREPROCESSING
// ========================================

async function preprocessImage(imageUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                // Resize to reasonable dimensions for processing
                const maxWidth = 800;
                const maxHeight = 600;
                let width = img.width;
                let height = img.height;
                
                if (width > maxWidth) {
                    height = (height * maxWidth) / width;
                    width = maxWidth;
                }
                if (height > maxHeight) {
                    width = (width * maxHeight) / height;
                    height = maxHeight;
                }
                
                canvas.width = width;
                canvas.height = height;
                
                // Draw image
                ctx.drawImage(img, 0, 0, width, height);
                
                // Convert to data URL
                const processedUrl = canvas.toDataURL('image/jpeg', 0.95);
                resolve(processedUrl);
            } catch (error) {
                reject(error);
            }
        };
        
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = imageUrl;
    });
}

// ========================================
// OCR SCANNING
// ========================================

async function scanWithOCR(imageUrl) {
    console.log('🔍 Starting OCR scan...');
    
    if (!ready.ocr || typeof Tesseract === 'undefined') {
        throw new Error('OCR not ready');
    }
    
    try {
        const result = await Tesseract.recognize(imageUrl, 'eng', {
            logger: m => {
                if (m.status === 'recognizing text') {
                    setProgress(m.progress * 50); // OCR is 50% of progress
                }
            }
        });
        
        const text = result.data.text;
        console.log('OCR raw text:', text);
        
        // Extract card number (format: XXXX-###)
        const cardNumMatch = text.match(/[A-Z]{2,4}-?\d{1,3}/i);
        const cardNumber = cardNumMatch ? cardNumMatch[0].replace(/\s/g, '').toUpperCase() : null;
        
        // Extract hero name (usually all caps)
        const lines = text.split('\n').filter(l => l.trim().length > 0);
        const heroName = lines.find(l => /^[A-Z\s]{3,}$/.test(l.trim()));
        
        return {
            cardNumber,
            heroName: heroName ? heroName.trim() : null,
            confidence: result.data.confidence,
            fullText: text
        };
        
    } catch (error) {
        console.error('OCR error:', error);
        throw error;
    }
}

// ========================================
// API CALLING
// ========================================

async function callAPI(imageUrl) {
    console.log('Calling API via Vercel backend...');
    
    try {
        // FIXED: Better base64 conversion
        let base64Data;
        
        if (imageUrl.startsWith('data:image')) {
            // Data URL - extract base64 directly
            base64Data = imageUrl.split(',')[1];
        } else {
            // Blob URL - convert to base64
            const response = await fetch(imageUrl);
            const blob = await response.blob();
            
            base64Data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const base64String = reader.result.split(',')[1];
                    resolve(base64String);
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        }
        
        console.log('📤 Sending image data... (base64 length:', base64Data?.length || 0, ')');
        
        // CRITICAL: Verify we have data
        if (!base64Data || base64Data.length === 0) {
            throw new Error('Failed to convert image to base64');
        }
        
        // Call Vercel serverless function
        const apiResponse = await fetch('/api/anthropic', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                image: base64Data,  // FIXED: Send as 'image' not 'imageData'
                prompt: `Extract the following information from this Bo Jackson trading card image:
                
                Look for:
                - Card number (format like "BLBF-127" or "BF-108")
                - Hero/Character name
                - Year
                - Set name
                - Parallel/Pose type
                - Weapon type
                - Power level
                
                Return ONLY valid JSON with these exact keys:
                {
                  "cardNumber": "BLBF-127",
                  "hero": "Donny Buckets",
                  "year": "2023",
                  "set": "Battle Arena",
                  "pose": "First Edition",
                  "weapon": "Fire",
                  "power": "130"
                }
                
                CRITICAL: Look carefully at card numbers. Common OCR errors to avoid:
                - 6 vs 8 (BLBF-64 vs BLBF-84)
                - 0 vs O
                - 1 vs I
                
                Return ONLY the JSON object, no explanations.`
            })
        });
        
        console.log('📥 API response status:', apiResponse.status);
        
        if (!apiResponse.ok) {
            const errorText = await apiResponse.text();
            console.error('API error response:', errorText);
            throw new Error(`API error: ${apiResponse.status} - ${errorText}`);
        }
        
        const data = await apiResponse.json();
        console.log('Full API response:', data);
        
        // Extract JSON from Claude's response
        const textContent = data.content.find(c => c.type === 'text');
        if (!textContent) {
            throw new Error('No text content in API response');
        }
        
        const rawText = textContent.text;
        console.log('Claude raw text:', rawText);
        
        // Parse JSON (remove markdown code blocks if present)
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('No JSON found in response');
        }
        
        const extracted = JSON.parse(jsonMatch[0]);
        return extracted;
        
    } catch (error) {
        console.error('API call error:', error);
        throw error;
    }
}


// ========================================
// MAIN SCANNING FUNCTIONS
// ========================================

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
    
    // Try OCR first (if available)
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
            
            // Track API call
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
    
    // Get full collections array
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
    
    // Save to localStorage
    saveCollections(collections);
    
    // Track in Supabase
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
    
    // Revoke object URL
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
