// ── src/ui/upload-area.js ────────────────────────────────────────────────────
// ES Module — Upload area initialization, settings modal, camera/gallery handlers,
// sign-in prompt, auth UI, user menu, and screen reader announcements.

import { config } from '../core/config.js';
import { showToast } from './toast.js';

function initUploadArea() {
    const uploadArea = document.getElementById('uploadArea');
    
    if (!uploadArea) {
        console.warn('Upload area element not found');
        return;
    }
    
    console.log('📤 Setting up upload area...');
    
    // Drag and drop handlers - attached directly, NO cloneNode
    // (cloneNode was stripping onclick attributes from the buttons inside,
    // making "Choose Image", "Take Photo" and "Settings" do nothing)
    uploadArea.addEventListener('dragover', function(e) {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });
    
    uploadArea.addEventListener('dragleave', function(e) {
        if (!uploadArea.contains(e.relatedTarget)) {
            uploadArea.classList.remove('dragover');
        }
    });
    
    uploadArea.addEventListener('drop', function(e) {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        
        const files = Array.from(e.dataTransfer.files).filter(f => 
            f.type.startsWith('image/')
        );
        
        if (files.length > 0) {
            const input = document.getElementById('fileInput');
            if (input) {
                const dataTransfer = new DataTransfer();
                files.forEach(file => dataTransfer.items.add(file));
                input.files = dataTransfer.files;
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    });
    
    console.log('✅ Upload area ready');
}

// ========================================
// COMPATIBILITY FUNCTIONS FOR REDESIGNED UI
// ========================================

window.openSettings = function() {
    const modal = document.getElementById('settingsModal');
    if (modal) {
        modal.classList.add('active');
        
        const toggleAutoDetect = document.getElementById('toggleAutoDetect');
        const togglePerspective = document.getElementById('togglePerspective');
        const toggleRegionOcr = document.getElementById('toggleRegionOcr');
        const selectQuality = document.getElementById('selectQuality');
        const rangeThreshold = document.getElementById('rangeThreshold');
        const thresholdValue = document.getElementById('thresholdValue');
        
        if (toggleAutoDetect) toggleAutoDetect.checked = config.autoDetect;
        if (togglePerspective) togglePerspective.checked = config.perspective;
        if (toggleRegionOcr) toggleRegionOcr.checked = config.regionOcr;
        if (selectQuality) selectQuality.value = config.quality;
        if (rangeThreshold) rangeThreshold.value = config.threshold;
        if (thresholdValue) thresholdValue.textContent = config.threshold;

        // Show theme section only for signed-in users, then populate it
        const themeGroup = document.getElementById('themeSettingGroup');
        if (themeGroup) {
            themeGroup.style.display = window.currentUser ? '' : 'none';
            if (window.currentUser && typeof window.renderThemeSettingsSection === 'function') {
                window.renderThemeSettingsSection();
            }
        }
    } else {
        showToast('Settings coming soon!', '\u2699\uFE0F');
    }
};

window.closeSettings = function() {
    const modal = document.getElementById('settingsModal');
    if (modal) {
        modal.classList.remove('active');
    }
};

window.capturePhoto = function(e) {
    if (e) e.stopPropagation();
    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
        fileInput.setAttribute('capture', 'environment');
        fileInput.setAttribute('accept', 'image/*');
        fileInput.click();
        
        setTimeout(() => {
            fileInput.removeAttribute('capture');
        }, 100);
    }
};

window.chooseFromGallery = function(e) {
    if (e) e.stopPropagation();
    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
        fileInput.removeAttribute('capture');
        fileInput.setAttribute('accept', 'image/*');
        fileInput.click();
    }
};

window.showSignInPrompt = function() {
    // Show the sign-in modal which contains the rendered Google button.
    // google.accounts.id.prompt() does not work on iOS Safari (blocked by ITP).
    // The rendered button opens a proper popup/tab that iOS allows.
    const modal = document.getElementById('signInModal');
    if (modal) {
        modal.classList.add('active');
        // Render Google button inside modal if not already rendered
        const container = document.getElementById('googleSignInButton');
        if (container && typeof google !== 'undefined' && google.accounts) {
            container.innerHTML = '';
            google.accounts.id.renderButton(container, {
                theme: 'outline', size: 'large', width: 280,
                text: 'signin_with', shape: 'rectangular'
            });
        }
    } else if (typeof google !== 'undefined' && google.accounts) {
        // Fallback: try prompt (works on desktop)
        google.accounts.id.prompt();
    } else {
        showToast('Sign-in not available — try refreshing', '🔐');
    }
};

window.closeSignInModal = function() {
    const modal = document.getElementById('signInModal');
    if (modal) modal.classList.remove('active');
};

window.updateAuthUI = function(user) {
    const btnSignIn = document.getElementById('btnSignIn');
    const userAuthenticated = document.getElementById('userAuthenticated');
    const userName = document.getElementById('userName');
    const userEmail = document.getElementById('userEmail');
    const userAvatar = document.getElementById('userAvatar');
    
    if (user) {
        if (btnSignIn) btnSignIn.style.display = 'none';
        if (userAuthenticated) userAuthenticated.style.display = 'flex';
        
        if (userName) userName.textContent = user.name || 'User';
        if (userEmail) userEmail.textContent = user.email || '';
        if (userAvatar) {
            userAvatar.src = user.picture || user.profilePicture || '';
            userAvatar.alt = user.name || 'User';
        }
    } else {
        if (btnSignIn) btnSignIn.style.display = 'block';
        if (userAuthenticated) userAuthenticated.style.display = 'none';
    }
};

window.toggleUserMenu = function() {
    // Open the More sheet which contains Settings, Sign Out, and all tools
    if (typeof window.openMoreSheet === 'function') {
        window.openMoreSheet();
    }
};

window.signOut = function() {
    if (!confirm('Sign out?')) return;
    
    if (typeof google !== 'undefined' && google.accounts) {
        google.accounts.id.disableAutoSelect();
    }
    
    // Only clear auth data — preserve collections and settings
    localStorage.removeItem('googleUser');
    localStorage.removeItem('currentCollectionId');
    sessionStorage.clear();
    
    if (typeof googleUser !== 'undefined') {
        window.googleUser = null;
    }
    if (typeof currentUser !== 'undefined') {
        window.currentUser = null;
    }
    
    window.updateAuthUI(null);
    showToast('Signed out successfully', '👋');
    
    setTimeout(() => {
        window.location.reload();
    }, 1000);
};

window.announceToScreenReader = function(message) {
    const announcement = document.createElement('div');
    announcement.setAttribute('role', 'status');
    announcement.setAttribute('aria-live', 'polite');
    announcement.setAttribute('aria-atomic', 'true');
    announcement.className = 'sr-only';
    announcement.style.position = 'absolute';
    announcement.style.left = '-10000px';
    announcement.style.width = '1px';
    announcement.style.height = '1px';
    announcement.style.overflow = 'hidden';
    announcement.textContent = message;
    document.body.appendChild(announcement);
    
    setTimeout(() => {
        if (announcement.parentNode) {
            document.body.removeChild(announcement);
        }
    }, 1000);
};

export { initUploadArea };
