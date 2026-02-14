// Google Authentication & Drive Integration
// Complete implementation with auto-sync, backup, and restore

const GOOGLE_CONFIG = {
    // REPLACE THESE with your actual values from Google Cloud Console
    clientId: '572964589574-hn6786nf84q5joug9ts2vuln0r9oql6f.apps.googleusercontent.com',
    apiKey: 'YOUR_API_KEY', // Optional
    discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
    scopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email'
    ],
    appFolderName: 'Card Scanner Data',
    autoSyncDelay: 2000 // 2 seconds debounce
};

let googleUser = null;
let driveInitialized = false;
let appFolderId = null;
let syncTimeout = null;

// ==================== INITIALIZATION ====================

async function initGoogleAuth() {
    try {
        console.log('🔐 Initializing Google Auth...');
        
        // Load Google Identity Services
        await loadGoogleScript();
        
        // Check for stored user
        const user = getStoredUser();
        if (user) {
            googleUser = user;
            await initDriveAPI(user.access_token);
            updateAuthUI(true);
            console.log('✅ Restored session:', user.email);
        } else {
            updateAuthUI(false);
        }
        
        // Initialize sign-in button
        renderSignInButton();
        
        console.log('✅ Google Auth initialized');
        
    } catch (err) {
        console.error('❌ Google Auth failed:', err);
        showToast('Google Auth unavailable', '⚠️');
    }
}

function loadGoogleScript() {
    return new Promise((resolve, reject) => {
        if (typeof google !== 'undefined' && google.accounts) {
            resolve();
            return;
        }
        
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = resolve;
        script.onerror = () => reject(new Error('Failed to load Google script'));
        document.head.appendChild(script);
    });
}

function renderSignInButton() {
    const container = document.getElementById('googleSignInBtn');
    if (!container) return;
    
    google.accounts.id.initialize({
        client_id: GOOGLE_CONFIG.clientId,
        callback: handleCredentialResponse,
        auto_select: false,
        cancel_on_tap_outside: true
    });
    
    // Render button
    google.accounts.id.renderButton(
        container,
        {
            theme: 'outline',
            size: 'large',
            text: 'signin_with',
            shape: 'rectangular',
            width: 250
        }
    );
}

async function handleCredentialResponse(response) {
    try {
        // Decode JWT token
        const payload = parseJwt(response.credential);
        
        console.log('🔐 Credential received, requesting access token...');
        
        // Get access token for Drive API
        const tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CONFIG.clientId,
            scope: GOOGLE_CONFIG.scopes.join(' '),
            callback: async (tokenResponse) => {
                if (tokenResponse.error) {
                    console.error('Token error:', tokenResponse);
                    showToast('Authorization failed', '❌');
                    return;
                }
                
                googleUser = {
                    id: payload.sub,
                    email: payload.email,
                    name: payload.name,
                    picture: payload.picture,
                    access_token: tokenResponse.access_token,
                    expires_at: Date.now() + (tokenResponse.expires_in * 1000)
                };
                
                // Store user info
                storeUser(googleUser);
                
                // Initialize Drive API
                await initDriveAPI(tokenResponse.access_token);
                
                // Update UI
                updateAuthUI(true);
                
                // Ask user if they want to load from Drive
                await handleFirstSignIn();
                
                showToast(`Welcome, ${googleUser.name}!`, '👋');
            }
        });
        
        tokenClient.requestAccessToken();
        
    } catch (err) {
        console.error('Sign-in error:', err);
        showToast('Sign-in failed. Please try again.', '❌');
    }
}

async function handleFirstSignIn() {
    // Check if collections exist in Drive
    const driveCollections = await loadCollectionsFromDrive(true); // silent check
    
    if (driveCollections && driveCollections.length > 0) {
        const hasLocalCollections = collections.length > 1 || 
                                   (collections.length === 1 && collections[0].cards.length > 0);
        
        if (hasLocalCollections) {
            // Both local and Drive have data - ask user
            const choice = await showSyncConflictModal(driveCollections);
            
            if (choice === 'drive') {
                collections = driveCollections;
                saveCollections();
                renderCollections();
                renderCurrentCollection();
                showToast('Loaded collections from Drive', '☁️');
            } else if (choice === 'local') {
                // Keep local, sync to Drive
                await syncCollectionsToDrive();
            } else {
                // Merge
                await mergeCollections(driveCollections);
            }
        } else {
            // No local data, load from Drive
            collections = driveCollections;
            saveCollections();
            renderCollections();
            renderCurrentCollection();
            showToast('Loaded collections from Drive', '☁️');
        }
    } else {
        // No Drive data, sync current collections
        await syncCollectionsToDrive();
    }
}

function parseJwt(token) {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
}

function storeUser(user) {
    localStorage.setItem('google_user', JSON.stringify(user));
}

function getStoredUser() {
    const stored = localStorage.getItem('google_user');
    if (!stored) return null;
    
    const user = JSON.parse(stored);
    
    // Check if token expired
    if (user.expires_at < Date.now()) {
        localStorage.removeItem('google_user');
        return null;
    }
    
    return user;
}

function signOut() {
    if (!confirm('Sign out from Google? Your collections will remain on this device.')) {
        return;
    }
    
    google.accounts.id.disableAutoSelect();
    localStorage.removeItem('google_user');
    localStorage.removeItem('drive_folder_id');
    googleUser = null;
    appFolderId = null;
    driveInitialized = false;
    updateAuthUI(false);
    showToast('Signed out', '👋');
}

function updateAuthUI(signedIn) {
    const signInContainer = document.getElementById('googleSignInBtn');
    const userInfo = document.getElementById('googleUserInfo');
    const signOutBtn = document.getElementById('googleSignOutBtn');
    const driveSection = document.getElementById('driveExportSection');
    
    if (signedIn && googleUser) {
        signInContainer?.classList.add('hidden');
        userInfo?.classList.remove('hidden');
        signOutBtn?.classList.remove('hidden');
        driveSection?.classList.remove('hidden');
        
        const userName = document.getElementById('userName');
        const userEmail = document.getElementById('userEmail');
        const userAvatar = document.getElementById('userAvatar');
        
        if (userName) userName.textContent = googleUser.name;
        if (userEmail) userEmail.textContent = googleUser.email;
        if (userAvatar) userAvatar.src = googleUser.picture;
    } else {
        signInContainer?.classList.remove('hidden');
        userInfo?.classList.add('hidden');
        signOutBtn?.classList.add('hidden');
        driveSection?.classList.add('hidden');
    }
}

// ==================== GOOGLE DRIVE API ====================

async function initDriveAPI(accessToken) {
    try {
        console.log('☁️ Initializing Drive API...');
        
        // Load Google API client
        await loadGapiScript();
        
        await new Promise((resolve) => {
            gapi.load('client', resolve);
        });
        
        await gapi.client.init({
            apiKey: GOOGLE_CONFIG.apiKey,
            discoveryDocs: GOOGLE_CONFIG.discoveryDocs
        });
        
        gapi.client.setToken({ access_token: accessToken });
        
        // Get or create app folder
        appFolderId = await getOrCreateAppFolder();
        
        driveInitialized = true;
        console.log('✅ Drive API initialized, folder:', appFolderId);
        
    } catch (err) {
        console.error('❌ Drive API init failed:', err);
        showToast('Drive sync unavailable', '⚠️');
    }
}

function loadGapiScript() {
    return new Promise((resolve, reject) => {
        if (typeof gapi !== 'undefined') {
            resolve();
            return;
        }
        
        const script = document.createElement('script');
        script.src = 'https://apis.google.com/js/api.js';
        script.async = true;
        script.defer = true;
        script.onload = resolve;
        script.onerror = () => reject(new Error('Failed to load Google API'));
        document.head.appendChild(script);
    });
}

async function getOrCreateAppFolder() {
    try {
        // Check if folder ID is stored
        const storedId = localStorage.getItem('drive_folder_id');
        if (storedId) {
            // Verify folder still exists
            try {
                await gapi.client.drive.files.get({ fileId: storedId });
                console.log('✅ Using existing folder:', storedId);
                return storedId;
            } catch {
                console.log('⚠️ Stored folder not found, will create new');
                localStorage.removeItem('drive_folder_id');
            }
        }
        
        // Search for existing folder
        const response = await gapi.client.drive.files.list({
            q: `name='${GOOGLE_CONFIG.appFolderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
            spaces: 'drive',
            fields: 'files(id, name)'
        });
        
        if (response.result.files.length > 0) {
            const folderId = response.result.files[0].id;
            localStorage.setItem('drive_folder_id', folderId);
            console.log('✅ Found existing folder:', folderId);
            return folderId;
        }
        
        // Create new folder
        console.log('📁 Creating new Drive folder...');
        const folderMetadata = {
            name: GOOGLE_CONFIG.appFolderName,
            mimeType: 'application/vnd.google-apps.folder'
        };
        
        const folder = await gapi.client.drive.files.create({
            resource: folderMetadata,
            fields: 'id'
        });
        
        const folderId = folder.result.id;
        localStorage.setItem('drive_folder_id', folderId);
        
        console.log('✅ Created Drive folder:', folderId);
        return folderId;
        
    } catch (err) {
        console.error('Failed to get/create folder:', err);
        throw err;
    }
}

// ==================== SYNC COLLECTIONS ====================

async function syncCollectionsToDrive() {
    if (!driveInitialized || !appFolderId) {
        console.warn('Drive not initialized');
        return false;
    }
    
    try {
        showToast('Syncing to Drive...', '☁️');
        
        const collectionsData = JSON.stringify(collections, null, 2);
        const blob = new Blob([collectionsData], { type: 'application/json' });
        
        // Check if collections file exists
        const existingFile = await findFileInFolder('collections.json');
        
        const metadata = {
            name: 'collections.json',
            mimeType: 'application/json',
            description: `Card Scanner Collections - Last synced: ${new Date().toISOString()}`
        };
        
        if (!existingFile) {
            metadata.parents = [appFolderId];
        }
        
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', blob);
        
        const url = existingFile 
            ? `https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=multipart`
            : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
        
        const method = existingFile ? 'PATCH' : 'POST';
        
        const response = await fetch(url, {
            method: method,
            headers: {
                'Authorization': `Bearer ${googleUser.access_token}`
            },
            body: form
        });
        
        if (response.ok) {
            const result = await response.json();
            console.log('✅ Collections synced to Drive:', result.id);
            showToast('Synced to Drive!', '✅');
            return true;
        } else {
            const error = await response.json();
            console.error('Sync failed:', error);
            throw new Error('Sync failed');
        }
        
    } catch (err) {
        console.error('Sync error:', err);
        showToast('Sync failed', '❌');
        return false;
    }
}

async function loadCollectionsFromDrive(silent = false) {
    if (!driveInitialized || !appFolderId) {
        if (!silent) showToast('Drive not initialized', '⚠️');
        return null;
    }
    
    try {
        if (!silent) showLoading(true, 'Loading from Drive...');
        
        const file = await findFileInFolder('collections.json');
        
        if (!file) {
            if (!silent) {
                showLoading(false);
                showToast('No collections file in Drive', 'ℹ️');
            }
            return null;
        }
        
        const response = await fetch(
            `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
            {
                headers: {
                    'Authorization': `Bearer ${googleUser.access_token}`
                }
            }
        );
        
        if (response.ok) {
            const data = await response.json();
            
            if (!silent) {
                showLoading(false);
                
                if (confirm(`Load ${data.length} collection(s) from Drive? This will replace your current collections.`)) {
                    collections = data;
                    saveCollections();
                    renderCollections();
                    renderCurrentCollection();
                    showToast('Loaded from Drive!', '☁️');
                }
            }
            
            return data;
        }
        
        if (!silent) showLoading(false);
        return null;
        
    } catch (err) {
        console.error('Load from Drive failed:', err);
        if (!silent) {
            showLoading(false);
            showToast('Failed to load from Drive', '❌');
        }
        return null;
    }
}

async function findFileInFolder(fileName) {
    try {
        const response = await gapi.client.drive.files.list({
            q: `name='${fileName}' and '${appFolderId}' in parents and trashed=false`,
            spaces: 'drive',
            fields: 'files(id, name, modifiedTime, size)',
            orderBy: 'modifiedTime desc'
        });
        
        return response.result.files.length > 0 ? response.result.files[0] : null;
        
    } catch (err) {
        console.error('Find file error:', err);
        return null;
    }
}

// ==================== FILE BROWSER ====================

async function showDriveFileBrowser() {
    if (!driveInitialized || !appFolderId) {
        showToast('Please sign in first', '⚠️');
        return;
    }
    
    try {
        showLoading(true, 'Loading files...');
        
        const response = await gapi.client.drive.files.list({
            q: `'${appFolderId}' in parents and trashed=false`,
            spaces: 'drive',
            fields: 'files(id, name, mimeType, modifiedTime, size)',
            orderBy: 'modifiedTime desc'
        });
        
        showLoading(false);
        
        const files = response.result.files;
        
        if (files.length === 0) {
            showToast('No files in Drive yet', 'ℹ️');
            return;
        }
        
        // Show file browser modal
        const modal = createFileBrowserModal(files);
        document.body.insertAdjacentHTML('beforeend', modal);
        
    } catch (err) {
        showLoading(false);
        console.error('File browser error:', err);
        showToast('Failed to load files', '❌');
    }
}

function createFileBrowserModal(files) {
    return `
        <div class="modal active" id="fileBrowserModal">
            <div class="modal-content">
                <div class="modal-header">
                    <div class="modal-title">☁️ Files in Drive</div>
                    <div class="modal-close" onclick="closeFileBrowser()">×</div>
                </div>
                
                <div class="file-browser-list">
                    ${files.map(file => createFileItem(file)).join('')}
                </div>
                
                <div class="modal-buttons">
                    <button class="btn btn-secondary" onclick="closeFileBrowser()">Close</button>
                </div>
            </div>
        </div>
    `;
}

function createFileItem(file) {
    const icon = getFileIcon(file.mimeType);
    const size = formatFileSize(file.size);
    const date = new Date(file.modifiedTime).toLocaleDateString();
    
    return `
        <div class="file-item">
            <div class="file-icon">${icon}</div>
            <div class="file-info">
                <div class="file-name">${file.name}</div>
                <div class="file-meta">${size} • ${date}</div>
            </div>
            <div class="file-actions">
                ${file.name === 'collections.json' 
                    ? `<button class="btn btn-sm btn-primary" onclick="restoreCollections('${file.id}')">Restore</button>`
                    : `<button class="btn btn-sm btn-secondary" onclick="downloadDriveFile('${file.id}', '${file.name}')">Download</button>`
                }
                <button class="btn btn-sm btn-danger" onclick="deleteDriveFile('${file.id}', '${file.name}')">Delete</button>
            </div>
        </div>
    `;
}

function getFileIcon(mimeType) {
    if (mimeType.includes('json')) return '📄';
    if (mimeType.includes('csv') || mimeType.includes('text/csv')) return '📊';
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '📗';
    return '📎';
}

function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function closeFileBrowser() {
    const modal = document.getElementById('fileBrowserModal');
    if (modal) modal.remove();
}

async function restoreCollections(fileId) {
    if (!confirm('Restore collections from this backup? This will replace your current collections.')) {
        return;
    }
    
    try {
        showLoading(true, 'Restoring...');
        
        const response = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
            {
                headers: {
                    'Authorization': `Bearer ${googleUser.access_token}`
                }
            }
        );
        
        if (response.ok) {
            const data = await response.json();
            collections = data;
            saveCollections();
            renderCollections();
            renderCurrentCollection();
            
            showLoading(false);
            closeFileBrowser();
            showToast('Collections restored!', '✅');
        } else {
            throw new Error('Restore failed');
        }
        
    } catch (err) {
        showLoading(false);
        console.error('Restore error:', err);
        showToast('Restore failed', '❌');
    }
}

async function downloadDriveFile(fileId, fileName) {
    try {
        const response = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
            {
                headers: {
                    'Authorization': `Bearer ${googleUser.access_token}`
                }
            }
        );
        
        if (response.ok) {
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            a.click();
            URL.revokeObjectURL(url);
            showToast('Downloaded!', '✅');
        }
        
    } catch (err) {
        console.error('Download error:', err);
        showToast('Download failed', '❌');
    }
}

async function deleteDriveFile(fileId, fileName) {
    if (!confirm(`Delete "${fileName}" from Drive?`)) {
        return;
    }
    
    try {
        await gapi.client.drive.files.delete({ fileId: fileId });
        showToast('Deleted from Drive', '✅');
        closeFileBrowser();
        
        // Refresh file browser
        setTimeout(() => showDriveFileBrowser(), 500);
        
    } catch (err) {
        console.error('Delete error:', err);
        showToast('Delete failed', '❌');
    }
}

// ==================== EXPORT TO DRIVE ====================

async function exportToDriveCSV() {
    if (!driveInitialized) {
        showToast('Please sign in with Google first', '⚠️');
        return;
    }
    
    const collection = getCurrentCollection();
    if (collection.cards.length === 0) {
        showToast('No cards to export', '⚠️');
        return;
    }
    
    try {
        showLoading(true, 'Uploading to Drive...');
        
        const csv = generateCSV(collection.cards);
        const blob = new Blob([csv], { type: 'text/csv' });
        const fileName = `${sanitizeFilename(collection.name)}_${new Date().toISOString().split('T')[0]}.csv`;
        
        await uploadFileToDrive(fileName, blob, 'text/csv');
        
        showLoading(false);
        showToast(`Saved to Drive: ${fileName}`, '☁️');
        
    } catch (err) {
        showLoading(false);
        console.error('Drive export error:', err);
        showToast('Export to Drive failed', '❌');
    }
}

async function exportToDriveExcel() {
    if (!driveInitialized) {
        showToast('Please sign in with Google first', '⚠️');
        return;
    }
    
    if (collections.every(c => c.cards.length === 0)) {
        showToast('No cards to export', '⚠️');
        return;
    }
    
    try {
        showLoading(true, 'Creating Excel file...');
        
        const wb = XLSX.utils.book_new();
        let totalCards = 0;
        
        collections.forEach(collection => {
            if (collection.cards.length > 0) {
                const data = [
                    ['Card ID', 'Name', 'Year', 'Set', 'Card Number', 'Parallel', 'Weapon', 'Power', 'Scan Method'],
                    ...collection.cards.map(c => [
                        c.cardId, c.hero, c.year, c.set, c.cardNumber, c.pose, c.weapon, c.power, c.scanMethod
                    ])
                ];
                
                const ws = XLSX.utils.aoa_to_sheet(data);
                const colWidths = [
                    { wch: 12 }, { wch: 20 }, { wch: 8 }, { wch: 25 },
                    { wch: 12 }, { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 20 }
                ];
                ws['!cols'] = colWidths;
                
                XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(collection.name));
                totalCards += collection.cards.length;
            }
        });
        
        showLoading(true, 'Uploading to Drive...');
        
        // Convert workbook to blob
        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([wbout], { 
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
        });
        
        const fileName = `Card_Collections_${new Date().toISOString().split('T')[0]}.xlsx`;
        
        await uploadFileToDrive(fileName, blob, 
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        
        showLoading(false);
        showToast(`Saved ${totalCards} cards to Drive!`, '☁️');
        
    } catch (err) {
        showLoading(false);
        console.error('Drive export error:', err);
        showToast('Export to Drive failed', '❌');
    }
}

async function uploadFileToDrive(fileName, blob, mimeType) {
    const metadata = {
        name: fileName,
        mimeType: mimeType,
        parents: [appFolderId]
    };
    
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', blob);
    
    const response = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${googleUser.access_token}`
            },
            body: form
        }
    );
    
    if (!response.ok) {
        const error = await response.json();
        console.error('Upload error:', error);
        throw new Error('Upload failed');
    }
    
    return await response.json();
}

// ==================== AUTO-SYNC ====================

function setupAutoSync() {
    // Override saveCollections to also sync to Drive
    const originalSaveCollections = window.saveCollections;
    
    window.saveCollections = function() {
        // Save to localStorage
        originalSaveCollections();
        
        // Sync to Drive (debounced)
        if (driveInitialized && googleUser) {
            clearTimeout(syncTimeout);
            syncTimeout = setTimeout(() => {
                syncCollectionsToDrive().catch(err => {
                    console.error('Auto-sync failed:', err);
                });
            }, GOOGLE_CONFIG.autoSyncDelay);
        }
    };
    
    console.log('✅ Auto-sync enabled');
}

// ==================== SYNC CONFLICT RESOLUTION ====================

function showSyncConflictModal(driveCollections) {
    return new Promise((resolve) => {
        const driveCount = driveCollections.reduce((sum, c) => sum + c.cards.length, 0);
        const localCount = collections.reduce((sum, c) => sum + c.cards.length, 0);
        
        const modal = `
            <div class="modal active" id="syncConflictModal">
                <div class="modal-content">
                    <div class="modal-header">
                        <div class="modal-title">⚠️ Sync Conflict</div>
                    </div>
                    
                    <div class="sync-conflict-content">
                        <p>You have collections both on this device and in Google Drive. What would you like to do?</p>
                        
                        <div class="sync-options">
                            <div class="sync-option">
                                <strong>☁️ Use Drive Version</strong>
                                <p>${driveCollections.length} collections, ${driveCount} cards</p>
                                <button class="btn btn-primary" onclick="resolveSyncConflict('drive')">
                                    Use Drive
                                </button>
                            </div>
                            
                            <div class="sync-option">
                                <strong>📱 Use Local Version</strong>
                                <p>${collections.length} collections, ${localCount} cards</p>
                                <button class="btn btn-primary" onclick="resolveSyncConflict('local')">
                                    Use Local
                                </button>
                            </div>
                            
                            <div class="sync-option">
                                <strong>🔀 Merge Both</strong>
                                <p>Combine all collections</p>
                                <button class="btn btn-secondary" onclick="resolveSyncConflict('merge')">
                                    Merge
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modal);
        
        window.resolveSyncConflict = (choice) => {
            const modal = document.getElementById('syncConflictModal');
            if (modal) modal.remove();
            resolve(choice);
        };
    });
}

async function mergeCollections(driveCollections) {
    try {
        showLoading(true, 'Merging collections...');
        
        // Merge drive collections into local
        driveCollections.forEach(driveCol => {
            const existingCol = collections.find(c => c.name === driveCol.name);
            
            if (existingCol) {
                // Merge cards (avoid duplicates by card number)
                const existingCardNumbers = new Set(existingCol.cards.map(c => c.cardNumber));
                const newCards = driveCol.cards.filter(c => !existingCardNumbers.has(c.cardNumber));
                existingCol.cards.push(...newCards);
                
                // Update stats
                existingCol.stats.scanned = existingCol.cards.length;
            } else {
                // Add new collection
                collections.push(driveCol);
            }
        });
        
        // Save and sync
        saveCollections();
        await syncCollectionsToDrive();
        
        renderCollections();
        renderCurrentCollection();
        
        showLoading(false);
        showToast('Collections merged!', '✅');
        
    } catch (err) {
        showLoading(false);
        console.error('Merge error:', err);
        showToast('Merge failed', '❌');
    }
}
