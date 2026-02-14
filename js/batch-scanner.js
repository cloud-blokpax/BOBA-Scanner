// Simplified Batch Scanner
// For full featured version with 5 enhancements, contact support

const BATCH_CONFIG = {
    maxCards: 9,
    minCardWidth: 150,
    minCardHeight: 200,
    parallelProcessing: 3
};

async function processBatchImage(file) {
    // Simplified: Just process as single card for now
    // Full batch detection requires OpenCV contour analysis
    return await processImage(file, true);
}

function showBatchGuide() {
    const modal = `
        <div class="modal active" id="batchGuideModal">
            <div class="modal-content">
                <div class="modal-header">
                    <div class="modal-title">📸 Batch Scan Guide</div>
                    <div class="modal-close" onclick="closeBatchGuide()">×</div>
                </div>
                
                <div class="batch-guide-content" style="padding: 20px;">
                    <h4>How to scan multiple cards:</h4>
                    <ol style="margin-left: 20px; line-height: 1.8;">
                        <li>Arrange cards in a grid (2x2, 3x3, etc.)</li>
                        <li>Leave 1-2 inches space between cards</li>
                        <li>Take photo from directly above</li>
                        <li>Ensure good lighting, no shadows</li>
                        <li>White or solid background works best</li>
                    </ol>
                    <p style="margin-top: 16px;"><strong>Note:</strong> Basic batch scanning is enabled. For advanced multi-card detection features, see documentation.</p>
                </div>
                
                <div class="modal-buttons">
                    <button class="btn btn-primary" onclick="closeBatchGuide()">Got It!</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modal);
}

function closeBatchGuide() {
    const modal = document.getElementById('batchGuideModal');
    if (modal) modal.remove();
}
