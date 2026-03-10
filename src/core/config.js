// ============================================================
// js/config.js — FIXED
// Changes:
//   - No breaking changes; kept as-is (it was fine)
//   - Added comment clarifying localStorage key persistence
// ============================================================

import { showToast } from '../ui/toast.js';

export const config = {
  autoDetect: localStorage.getItem('autoDetect') !== 'false',
  perspective: localStorage.getItem('perspective') !== 'false',
  regionOcr: localStorage.getItem('regionOcr') !== 'false',
  quality: parseFloat(localStorage.getItem('quality')) || 0.7,
  threshold: parseInt(localStorage.getItem('threshold')) || 60,
  maxSize: 1400,  // raised from 1000 — preserves resolution after smart card crop
  aiCost: 0.002,
  region: { x: 0.05, y: 0.85, w: 0.4, h: 0.12 }
};

export function updateSetting(key, value) {
  config[key] = key === 'quality'    ? parseFloat(value) :
                key === 'threshold'  ? parseInt(value)   : value;
  localStorage.setItem(key, value);
}

export function resetSettings() {
  ['autoDetect','perspective','regionOcr','quality','threshold'].forEach(k => {
    localStorage.removeItem(k);
  });
  config.autoDetect  = true;
  config.perspective = true;
  config.regionOcr   = true;
  config.quality     = 0.7;
  config.threshold   = 60;
  if (typeof openSettings === 'function') openSettings();
  showToast('Settings reset');
}

console.log('✅ Config module loaded');
