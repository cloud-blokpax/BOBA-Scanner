// tests/price-trends.test.js — Tests for price history tracking
import { describe, it, expect, beforeEach } from 'vitest';

class MockLocalStorage {
  constructor() { this.store = {}; }
  getItem(key) { return this.store[key] || null; }
  setItem(key, value) { this.store[key] = String(value); }
  removeItem(key) { delete this.store[key]; }
  clear() { this.store = {}; }
}

const PRICE_HISTORY_KEY = 'priceHistory';
const PRICE_ALERTS_KEY  = 'priceAlerts';
const MAX_HISTORY = 90;
let storage;

function getPriceHistory() {
  try { return JSON.parse(storage.getItem(PRICE_HISTORY_KEY) || '{}'); }
  catch { return {}; }
}

function savePriceHistory(history) {
  storage.setItem(PRICE_HISTORY_KEY, JSON.stringify(history));
}

function recordPrice(cardNumber, priceData) {
  if (!cardNumber || !priceData) return;
  const history = getPriceHistory();
  const key = cardNumber.toUpperCase();
  if (!history[key]) history[key] = [];
  history[key].push({
    avg: priceData.avgPrice || null,
    low: priceData.lowPrice || null,
    high: priceData.highPrice || null,
    sold: priceData.soldAvg || null,
    count: priceData.count || 0,
    ts: Date.now()
  });
  if (history[key].length > MAX_HISTORY) {
    history[key] = history[key].slice(-MAX_HISTORY);
  }
  savePriceHistory(history);
}

function getPriceAlerts() {
  try { return JSON.parse(storage.getItem(PRICE_ALERTS_KEY) || '[]'); }
  catch { return []; }
}

function addPriceAlert(cardNumber, heroName, targetPrice, direction) {
  const alerts = getPriceAlerts();
  if (alerts.find(a => a.cardNumber === cardNumber && a.direction === direction)) return;
  alerts.push({
    cardNumber, heroName, targetPrice: parseFloat(targetPrice),
    direction: direction || 'below', created: Date.now(), triggered: false
  });
  storage.setItem(PRICE_ALERTS_KEY, JSON.stringify(alerts));
}

beforeEach(() => {
  storage = new MockLocalStorage();
});

describe('recordPrice', () => {
  it('records a price data point', () => {
    recordPrice('BF-127', { avgPrice: 5.50, lowPrice: 3.00, highPrice: 8.00, count: 5 });
    const history = getPriceHistory();
    expect(history['BF-127']).toHaveLength(1);
    expect(history['BF-127'][0].avg).toBe(5.50);
    expect(history['BF-127'][0].low).toBe(3.00);
  });

  it('accumulates multiple data points', () => {
    recordPrice('BF-127', { avgPrice: 5.50 });
    recordPrice('BF-127', { avgPrice: 6.00 });
    recordPrice('BF-127', { avgPrice: 4.50 });
    const history = getPriceHistory();
    expect(history['BF-127']).toHaveLength(3);
  });

  it('normalizes card number to uppercase', () => {
    recordPrice('bf-127', { avgPrice: 5.50 });
    const history = getPriceHistory();
    expect(history['BF-127']).toBeDefined();
  });

  it('trims to MAX_HISTORY entries', () => {
    for (let i = 0; i < MAX_HISTORY + 10; i++) {
      recordPrice('BF-127', { avgPrice: i });
    }
    const history = getPriceHistory();
    expect(history['BF-127'].length).toBeLessThanOrEqual(MAX_HISTORY);
  });

  it('ignores null inputs', () => {
    recordPrice(null, { avgPrice: 5 });
    recordPrice('BF-127', null);
    const history = getPriceHistory();
    expect(Object.keys(history)).toHaveLength(0);
  });
});

describe('Price Alerts', () => {
  it('adds a price alert', () => {
    addPriceAlert('BF-127', 'ACTION', '5.00', 'below');
    const alerts = getPriceAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].targetPrice).toBe(5.00);
    expect(alerts[0].direction).toBe('below');
  });

  it('prevents duplicate alerts', () => {
    addPriceAlert('BF-127', 'ACTION', '5.00', 'below');
    addPriceAlert('BF-127', 'ACTION', '3.00', 'below'); // same card + direction
    const alerts = getPriceAlerts();
    expect(alerts).toHaveLength(1);
  });

  it('allows different direction alerts for same card', () => {
    addPriceAlert('BF-127', 'ACTION', '3.00', 'below');
    addPriceAlert('BF-127', 'ACTION', '10.00', 'above');
    const alerts = getPriceAlerts();
    expect(alerts).toHaveLength(2);
  });
});
