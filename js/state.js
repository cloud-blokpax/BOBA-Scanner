// Global State Management
let collections = [];
let currentCollectionId = null;
let collectionModalMode = 'create';
let editingCollectionId = null;

let apiKey = localStorage.getItem('api_key') || '';
let database = [];
let tesseractWorker = null;
let ready = { db: false, ocr: false, cv: false };

function getCurrentCollection() {
    return collections.find(c => c.id === currentCollectionId);
}
