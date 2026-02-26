class OCRManager {
    constructor(workerScript) {
        this.worker = new Worker(workerScript);
        this.worker.onmessage = this.handleWorkerMessage.bind(this);
    }

    handleWorkerMessage(event) {
        // Handle message received from worker
        console.log('Message from worker:', event.data);
    }

    processImage(imageData) {
        this.worker.postMessage({ image: imageData });
    }

    terminateWorker() {
        this.worker.terminate();
    }
}

// Usage example:
// const ocrManager = new OCRManager('path/to/worker.js');
// ocrManager.processImage(imageData);
