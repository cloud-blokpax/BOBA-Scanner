// OCR Functions (Tesseract)

async function initTesseract() {
    setStatus('ocr', 'loading');
    try {
        while (typeof Tesseract === 'undefined') {
            await new Promise(r => setTimeout(r, 100));
        }
        
        tesseractWorker = await Tesseract.createWorker('eng');
        ready.ocr = true;
        setStatus('ocr', 'ready');
        console.log('✅ OCR ready');
    } catch (err) {
        console.error('❌ OCR failed:', err);
        setStatus('ocr', 'error');
    }
}

async function runOCR(imageUrl) {
    if (!ready.ocr) throw new Error('OCR not ready');
    
    let targetImage = imageUrl;
    
    if (config.regionOcr) {
        targetImage = await extractRegion(imageUrl, config.region);
    }
    
    const result = await tesseractWorker.recognize(targetImage);
    return {
        text: result.data.text,
        confidence: result.data.confidence
    };
}

function extractRegion(imageUrl, region) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            const x = img.width * region.x;
            const y = img.height * region.y;
            const w = img.width * region.w;
            const h = img.height * region.h;
            
            canvas.width = w;
            canvas.height = h;
            ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
            
            const imageData = ctx.getImageData(0, 0, w, h);
            const data = imageData.data;
            
            for (let i = 0; i < data.length; i += 4) {
                const gray = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
                const adjusted = gray > 128 ? 255 : 0;
                data[i] = data[i + 1] = data[i + 2] = adjusted;
            }
            
            ctx.putImageData(imageData, 0, 0);
            resolve(canvas.toDataURL('image/png'));
        };
        
        img.onerror = reject;
        img.src = imageUrl;
    });
}

function extractCardNumber(text) {
    const cleaned = text.replace(/[|]/g, 'I').replace(/[O]/g, '0').toUpperCase();
    
    const patterns = [
        /\b([A-Z]{2,4})[-–—]\s*(\d{2,4})\b/,
        /\b([A-Z]{2,4})\s+(\d{2,4})\b/,
        /\b([A-Z]{2,4})(\d{2,4})\b/
    ];
    
    for (const pattern of patterns) {
        const match = cleaned.match(pattern);
        if (match && match[1].length >= 2 && match[2].length >= 2) {
            return `${match[1]}-${match[2]}`;
        }
    }
    
    const fallback = cleaned.match(/\b([A-Z]{2,})[^\w]*(\d{2,})\b/);
    return fallback ? `${fallback[1]}-${fallback[2]}` : null;
}
