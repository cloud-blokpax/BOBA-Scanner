// js/opencv.js — unchanged (OpenCV disabled, not needed for current scan flow)

import { ready } from '../state.js';

export function loadOpenCV() {
  console.log('⏭️ OpenCV disabled');
  ready.cv = false;
  return Promise.resolve();
}
console.log('✅ OpenCV module loaded (disabled)');
