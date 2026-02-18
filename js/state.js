// State Management and Helper Functions

let ready = {
    db: false,
    ocr: false,
    cv: false
};

// Status management
function setStatus(component, status) {
    const statusMap = {
        'db': 'dbStatus',
        'ocr': 'ocrStatus',
        'cv': 'cvStatus'
    };
    
    const elementId = statusMap[component];
    if (!elementId) return;
    
    const element = document.getElementById(elementId);
    if (!element) return;
    
    const statusIcons = {
        'loading': '⏳',
        'ready': '✅',
        'error': '❌'
    };
    
    element.textContent = statusIcons[status] || status;
    element.className = `status-${status}`;
}

// Progress bar
function setProgress(percent) {
    const bar = document.getElementById('progressBar');
    const text = document.getElementById('progressText');
    
    if (bar) {
        bar.style.width = `${percent}%`;
        bar.setAttribute('aria-valuenow', percent);
    }
    
    if (text) {
        text.textContent = `${Math.round(percent)}%`;
    }
    
    // Hide progress bar when complete
    if (percent >= 100) {
        setTimeout(() => {
            if (bar) bar.style.width = '0%';
            if (text) text.textContent = '';
        }, 1000);
    }
}

// Toast notifications
function showToast(message, icon = '✅') {
    console.log(`🔔 Toast: ${icon} ${message}`);
    
    // Create toast element
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
        <span class="toast-icon">${icon}</span>
        <span class="toast-message">${message}</span>
    `;
    
    // Add to document
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
            display: flex;
            flex-direction: column;
            gap: 10px;
        `;
        document.body.appendChild(container);
    }
    
    container.appendChild(toast);
    
    // Style toast
    toast.style.cssText = `
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 12px 16px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        animation: slideIn 0.3s ease;
        max-width: 300px;
    `;
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 3000);
}

// Loading overlay
function showLoading(show, message = 'Loading...') {
    let overlay = document.getElementById('loadingOverlay');
    
    if (show) {
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'loadingOverlay';
            overlay.innerHTML = `
                <div class="loading-spinner"></div>
                <div class="loading-message">${message}</div>
            `;
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.5);
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                z-index: 9999;
            `;
            document.body.appendChild(overlay);
        }
        overlay.style.display = 'flex';
    } else {
        if (overlay) {
            overlay.style.display = 'none';
        }
    }
}

console.log('✅ State management loaded');
