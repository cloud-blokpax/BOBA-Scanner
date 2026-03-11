// ============================================================
// js/config.js
// Scan settings — supports per-adapter config with global overrides.
// Settings are stored in localStorage scoped by adapter ID.
// ============================================================

import { showToast } from '../ui/toast.js';
import { getActiveAdapter } from '../collections/registry.js';

// Global settings (shared across all adapters)
export const config = {
  autoDetect:  localStorage.getItem('autoDetect') !== 'false',
  perspective: localStorage.getItem('perspective') !== 'false',
  regionOcr:   localStorage.getItem('regionOcr') !== 'false',
  quality:     parseFloat(localStorage.getItem('quality')) || 0.7,
  threshold:   parseInt(localStorage.getItem('threshold')) || 60,
  maxSize:     1400,
  aiCost:      0.002,
  region:      { x: 0.05, y: 0.85, w: 0.4, h: 0.12 }
};

/**
 * Get the effective config for the active adapter.
 * Merges global settings with adapter-specific defaults and any
 * per-adapter overrides stored in localStorage.
 */
export function getAdapterConfig() {
  const adapter = getActiveAdapter();
  if (!adapter) return config;

  const adapterDefaults = adapter.getScanConfig();
  const prefix = `config.${adapter.id}.`;

  return {
    autoDetect:  config.autoDetect,
    perspective: config.perspective,
    regionOcr:   config.regionOcr,
    quality:     parseFloat(localStorage.getItem(`${prefix}quality`))   || adapterDefaults.quality   || config.quality,
    threshold:   parseInt(localStorage.getItem(`${prefix}threshold`))   || adapterDefaults.threshold || config.threshold,
    maxSize:     adapterDefaults.maxSize   || config.maxSize,
    aiCost:      adapterDefaults.aiCost    || config.aiCost,
    region:      adapterDefaults.region    || config.region,
  };
}

export function updateSetting(key, value) {
  config[key] = key === 'quality'    ? parseFloat(value) :
                key === 'threshold'  ? parseInt(value)   : value;
  localStorage.setItem(key, value);

  // Also persist per-adapter override for adapter-scoped settings
  const adapter = getActiveAdapter();
  if (adapter && (key === 'quality' || key === 'threshold')) {
    localStorage.setItem(`config.${adapter.id}.${key}`, value);
  }
}

export function resetSettings() {
  ['autoDetect','perspective','regionOcr','quality','threshold'].forEach(k => {
    localStorage.removeItem(k);
  });
  const adapter = getActiveAdapter();
  if (adapter) {
    ['quality', 'threshold'].forEach(k => {
      localStorage.removeItem(`config.${adapter.id}.${k}`);
    });
  }
  config.autoDetect  = true;
  config.perspective = true;
  config.regionOcr   = true;
  config.quality     = 0.7;
  config.threshold   = 60;
  if (typeof openSettings === 'function') openSettings();
  showToast('Settings reset');
}

console.log('✅ Config module loaded');
