// Anthropic API Functions

let apiKey = localStorage.getItem('api_key') || '';

function saveApiKey() {
    const input = document.getElementById('apiKeyInput');
    const key = input.value.trim();
    
    if (!key.startsWith('sk-ant-')) {
        showToast('Invalid key format', '⚠️');
        return;
    }
    
    apiKey = key;
    localStorage.setItem('api_key', key);
    updateApiToggle(true);
    showToast('API key saved');
    toggleApiSection();
}

function clearApiKey() {
    if (!confirm('Clear API key?')) return;
    apiKey = '';
    localStorage.removeItem('api_key');
    document.getElementById('apiKeyInput').value = '';
    updateApiToggle(false);
    showToast('API key cleared');
}

function toggleApiSection() {
    const content = document.getElementById('apiContent');
    const icon = document.getElementById('apiToggleIcon');
    const expanded = content.classList.toggle('expanded');
    icon.textContent = expanded ? '▲' : '▼';
}

function updateApiToggle(hasKey) {
    const toggle = document.getElementById('apiToggle');
    const text = document.getElementById('apiToggleText');
    toggle.classList.toggle('has-key', hasKey);
    text.textContent = hasKey ? '🔑 API Key Saved' : '🔑 API Key';
}

async function callAPI(imageData) {
    console.log('Calling API via Vercel backend...');
    
    try {
        const response = await fetch('/api/anthropic', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                imageData: imageData
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || `API failed: ${response.status}`);
        }
        
        return await response.json();
        
    } catch (error) {
        console.error('API call failed:', error);
        throw error;
    }
}

async function compressImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                
                if (width > config.maxSize || height > config.maxSize) {
                    if (width > height) {
                        height = (height / width) * config.maxSize;
                        width = config.maxSize;
                    } else {
                        width = (width / height) * config.maxSize;
                        height = config.maxSize;
                    }
                }
                
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', config.quality).split(',')[1]);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}
