// js/opencv.js — unchanged (OpenCV disabled, not needed for current scan flow)
function loadOpenCV() {
  console.log('⏭️ OpenCV disabled');
  ready.cv = false;
  return Promise.resolve();
}
console.log('✅ OpenCV module loaded (disabled)');
