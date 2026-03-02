// ocr-worker.js

self.onmessage = function(event) {
    const imageData = event.data;
    const result = performOCR(imageData);
    self.postMessage(result);
};

function performOCR(imageData) {
    // Simulate OCR processing
    let processedText = 'Detected text from the image.'; // Replace with actual OCR logic
    return processedText;
}