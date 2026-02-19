/* ========================================
   UI ENHANCEMENTS - MODERN INTERACTIONS
   Bo Jackson Card Scanner
   ======================================== */

// ========================================
// INITIALIZATION
// ========================================

document.addEventListener('DOMContentLoaded', () => {
    initializeUIEnhancements();
});

function initializeUIEnhancements() {
    setupFloatingActionButton();
    setupSmoothScrolling();
    setupIntersectionObservers();
    setupHapticFeedback();
    setupPullToRefresh();
    setupSwipeGestures();
    enhanceAccessibility();
}

// ========================================
// FLOATING ACTION BUTTON (FAB)
// ========================================

function setupFloatingActionButton() {
    const cardsGrid = document.getElementById('cardsGrid');
    const fabContainer = document.getElementById('fabContainer');
    const uploadSection = document.getElementById('uploadArea');
    
    if (!cardsGrid || !fabContainer) return;
    
    // Show FAB when cards exist and upload area is not visible
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.target === uploadSection) {
                // Upload area is visible
                if (entry.isIntersecting) {
                    fabContainer.style.display = 'none';
                } else {
                    // Upload area scrolled out of view
                    const hasCards = cardsGrid.children.length > 0;
                    fabContainer.style.display = hasCards ? 'block' : 'none';
                }
            }
        });
    }, {
        threshold: 0.1
    });
    
    if (uploadSection) {
        observer.observe(uploadSection);
    }
}

// ========================================
// SMOOTH SCROLLING
// ========================================

function setupSmoothScrolling() {
    // Smooth scroll to top when clicking logo
    const logo = document.querySelector('.app-logo');
    if (logo) {
        logo.addEventListener('click', (e) => {
            e.preventDefault();
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        });
    }
    
    // Smooth scroll to card after scan
    window.scrollToLatestCard = function() {
        const cardsGrid = document.getElementById('cardsGrid');
        if (cardsGrid && cardsGrid.children.length > 0) {
            const latestCard = cardsGrid.children[cardsGrid.children.length - 1];
            latestCard.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });
        }
    };
}

// ========================================
// INTERSECTION OBSERVERS - PERFORMANCE
// ========================================

function setupIntersectionObservers() {
    // Lazy load card images
    const imageObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                if (img.dataset.src) {
                    img.src = img.dataset.src;
                    img.removeAttribute('data-src');
                    imageObserver.unobserve(img);
                }
            }
        });
    }, {
        rootMargin: '50px'
    });
    
    // Observe all images with data-src
    document.querySelectorAll('img[data-src]').forEach(img => {
        imageObserver.observe(img);
    });
    
    // Animate cards on scroll
    const cardObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, {
        threshold: 0.1
    });
    
    // Apply initial animation state
    document.querySelectorAll('.card-item').forEach(card => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        card.style.transition = 'all 0.3s ease-out';
        cardObserver.observe(card);
    });
}

// ========================================
// HAPTIC FEEDBACK (Mobile)
// ========================================

function setupHapticFeedback() {
    // Add haptic feedback to button clicks
    const buttons = document.querySelectorAll('button, .btn-primary, .btn-secondary');
    
    buttons.forEach(button => {
        button.addEventListener('click', () => {
            triggerHaptic('light');
        });
    });
    
    // Success haptic on card add
    window.cardAddedHaptic = function() {
        triggerHaptic('success');
    };
    
    // Error haptic on failure
    window.cardErrorHaptic = function() {
        triggerHaptic('error');
    };
}

function triggerHaptic(type = 'light') {
    if (!navigator.vibrate) return;
    
    const patterns = {
        light: [10],
        medium: [20],
        heavy: [30],
        success: [10, 50, 10],
        error: [20, 100, 20, 100, 20]
    };
    
    navigator.vibrate(patterns[type] || patterns.light);
}

// ========================================
// PULL TO REFRESH (Mobile)
// ========================================

function setupPullToRefresh() {
    let touchStartY = 0;
    let touchCurrentY = 0;
    let isPulling = false;
    let refreshThreshold = 80;
    
    const header = document.querySelector('.app-header');
    
    document.addEventListener('touchstart', (e) => {
        if (window.scrollY === 0) {
            touchStartY = e.touches[0].clientY;
            isPulling = true;
        }
    }, { passive: true });
    
    document.addEventListener('touchmove', (e) => {
        if (!isPulling) return;
        
        touchCurrentY = e.touches[0].clientY;
        const pullDistance = touchCurrentY - touchStartY;
        
        if (pullDistance > 0 && window.scrollY === 0) {
            const scale = Math.min(pullDistance / refreshThreshold, 1);
            header.style.transform = `translateY(${pullDistance * 0.5}px)`;
            header.style.opacity = `${1 - (scale * 0.3)}`;
        }
    }, { passive: true });
    
    document.addEventListener('touchend', () => {
        if (!isPulling) return;
        
        const pullDistance = touchCurrentY - touchStartY;
        
        if (pullDistance > refreshThreshold) {
            // Trigger refresh
            refreshApp();
        }
        
        // Reset
        header.style.transform = '';
        header.style.opacity = '';
        header.style.transition = 'all 0.3s ease';
        
        setTimeout(() => {
            header.style.transition = '';
        }, 300);
        
        isPulling = false;
        touchStartY = 0;
        touchCurrentY = 0;
    });
}

function refreshApp() {
    showToast('Refreshing...', '🔄');
    triggerHaptic('light');
    
    // Reload collections
    if (typeof loadCollections === 'function') {
        loadCollections();
    }
    
    // Update UI
    if (typeof renderCards === 'function') {
        renderCards();
    }
    
    setTimeout(() => {
        showToast('Updated!', '✓');
    }, 1000);
}

// ========================================
// SWIPE GESTURES (Card Deletion)
// ========================================

function setupSwipeGestures() {
    let touchStartX = 0;
    let touchCurrentX = 0;
    let swipeCard = null;
    
    document.addEventListener('touchstart', (e) => {
        const card = e.target.closest('.card-item');
        if (!card) return;
        
        touchStartX = e.touches[0].clientX;
        swipeCard = card;
    }, { passive: true });
    
    document.addEventListener('touchmove', (e) => {
        if (!swipeCard) return;
        
        touchCurrentX = e.touches[0].clientX;
        const swipeDistance = touchCurrentX - touchStartX;
        
        // Only allow left swipe (delete)
        if (swipeDistance < 0) {
            swipeCard.style.transform = `translateX(${swipeDistance}px)`;
            swipeCard.style.opacity = `${1 + (swipeDistance / 200)}`;
        }
    }, { passive: true });
    
    document.addEventListener('touchend', () => {
        if (!swipeCard) return;
        
        const swipeDistance = touchCurrentX - touchStartX;
        
        if (swipeDistance < -120) {
            // Delete card
            const cardIndex = Array.from(swipeCard.parentElement.children).indexOf(swipeCard);
            
            if (confirm('Delete this card?')) {
                swipeCard.style.transform = 'translateX(-100%)';
                swipeCard.style.opacity = '0';
                
                setTimeout(() => {
                    if (typeof removeCard === 'function') {
                        removeCard(cardIndex);
                    }
                }, 300);
            } else {
                // Reset
                swipeCard.style.transform = '';
                swipeCard.style.opacity = '';
            }
        } else {
            // Reset
            swipeCard.style.transform = '';
            swipeCard.style.opacity = '';
        }
        
        swipeCard.style.transition = 'all 0.3s ease';
        setTimeout(() => {
            if (swipeCard) swipeCard.style.transition = '';
        }, 300);
        
        swipeCard = null;
        touchStartX = 0;
        touchCurrentX = 0;
    });
}

// ========================================
// ACCESSIBILITY ENHANCEMENTS
// ========================================

function enhanceAccessibility() {
    // Add ARIA labels to interactive elements
    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
        fileInput.setAttribute('aria-label', 'Choose card image to scan');
    }
    
    // Add keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Cmd/Ctrl + U - Upload
        if ((e.metaKey || e.ctrlKey) && e.key === 'u') {
            e.preventDefault();
            document.getElementById('fileInput')?.click();
        }
        
        // Cmd/Ctrl + S - Settings
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
            e.preventDefault();
            if (typeof openSettings === 'function') {
                openSettings();
            }
        }
        
        // Escape - Close modals
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal.active').forEach(modal => {
                modal.classList.remove('active');
            });
        }
    });
    
    // Announce screen reader updates
    window.announceToScreenReader = function(message) {
        const announcement = document.createElement('div');
        announcement.setAttribute('role', 'status');
        announcement.setAttribute('aria-live', 'polite');
        announcement.className = 'sr-only';
        announcement.textContent = message;
        document.body.appendChild(announcement);
        
        setTimeout(() => {
            document.body.removeChild(announcement);
        }, 1000);
    };
}

// ========================================
// PROGRESSIVE ENHANCEMENT - ANIMATIONS
// ========================================

function animateCardEntry(cardElement) {
    cardElement.style.opacity = '0';
    cardElement.style.transform = 'scale(0.8) translateY(20px)';
    
    requestAnimationFrame(() => {
        cardElement.style.transition = 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
        cardElement.style.opacity = '1';
        cardElement.style.transform = 'scale(1) translateY(0)';
    });
    
    setTimeout(() => {
        cardElement.style.transition = '';
    }, 400);
}

function animateStatUpdate(statElement, newValue) {
    statElement.style.transform = 'scale(1.2)';
    statElement.style.color = 'var(--primary)';
    
    setTimeout(() => {
        statElement.textContent = newValue;
        statElement.style.transform = 'scale(1)';
        statElement.style.color = '';
        statElement.style.transition = 'all 0.3s ease';
    }, 150);
    
    setTimeout(() => {
        statElement.style.transition = '';
    }, 450);
}

// ========================================
// PERFORMANCE OPTIMIZATIONS
// ========================================

// Debounce function for scroll events
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Throttle function for frequent events
function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// ========================================
// IMAGE OPTIMIZATION
// ========================================

function optimizeImageDisplay(imgElement, width = 400) {
    // Create a canvas to resize image
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    const img = new Image();
    img.onload = function() {
        const ratio = img.height / img.width;
        canvas.width = width;
        canvas.height = width * ratio;
        
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        canvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            imgElement.src = url;
        }, 'image/jpeg', 0.85);
    };
    
    img.src = imgElement.src;
}

// ========================================
// NETWORK STATUS INDICATOR
// ========================================

function setupNetworkIndicator() {
    window.addEventListener('online', () => {
        showToast('Back online!', '🌐');
    });
    
    window.addEventListener('offline', () => {
        showToast('You\'re offline', '📡');
    });
}

// ========================================
// INSTALL PROMPT (PWA)
// ========================================

// ========================================
// INSTALL PROMPT (PWA)
// ========================================

if (!window.deferredPrompt) {
    window.deferredPrompt = null;
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window.deferredPrompt = e;
    
    // Show install button
    showInstallPrompt();
});

function showInstallPrompt() {
    // Only show if not already shown
    if (document.getElementById('install-prompt-btn')) return;
    
    const installButton = document.createElement('button');
    installButton.id = 'install-prompt-btn';
    installButton.className = 'btn-secondary';
    installButton.textContent = '📱 Install App';
    installButton.style.position = 'fixed';
    installButton.style.top = '80px';
    installButton.style.right = '16px';
    installButton.style.zIndex = '1000';
    
    installButton.addEventListener('click', async () => {
        if (!window.deferredPrompt) return;
        
        window.deferredPrompt.prompt();
        const { outcome } = await window.deferredPrompt.userChoice;
        
        if (outcome === 'accepted') {
            if (typeof showToast === 'function') {
                showToast('App installed!', '✓');
            }
        }
        
        window.deferredPrompt = null;
        installButton.remove();
    });
    
    document.body.appendChild(installButton);
}
// ========================================
// EXPORT ENHANCEMENTS
// ========================================

window.UIEnhancements = {
    animateCardEntry,
    animateStatUpdate,
    triggerHaptic,
    announceToScreenReader,
    optimizeImageDisplay,
    refreshApp
};

// Initialize network indicator
setupNetworkIndicator();

console.log('✨ UI Enhancements loaded');
