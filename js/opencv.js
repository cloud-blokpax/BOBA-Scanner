// OpenCV - DISABLED (Not needed for current scanning flow)

function loadOpenCV() {
    console.log('⏭️ OpenCV disabled - not required for scanning');
    ready.cv = false;
    return Promise.resolve();
}

console.log('✅ OpenCV module loaded (disabled)');
