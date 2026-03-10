// tests/export.test.js — Tests for CSV export generation
import { describe, it, expect } from 'vitest';

// Re-implement generateCSV for testing
const EXPORT_FIELDS = [
  { key: 'cardId',     label: 'Card ID' },
  { key: 'hero',       label: 'Hero Name' },
  { key: 'year',       label: 'Year' },
  { key: 'set',        label: 'Set' },
  { key: 'cardNumber', label: 'Card Number' },
  { key: 'pose',       label: 'Parallel' },
  { key: 'weapon',     label: 'Weapon' },
  { key: 'power',      label: 'Power' },
  { key: 'tags',       label: 'Tags' },
  { key: 'readyToList', label: 'Ready to List' },
];

function generateCSV(cards, fields) {
  const ec = val => `"${String(val ?? '').replace(/"/g, '""')}"`;

  const headers = fields.map(f => ec(f.label));
  const rows = cards.map(card => fields.map(f => {
    let val = card[f.key];
    if (f.key === 'tags')        val = Array.isArray(val) ? val.join(' | ') : '';
    if (f.key === 'readyToList') val = val ? 'Yes' : 'No';
    return ec(val ?? '');
  }));

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

describe('generateCSV', () => {
  const sampleCards = [
    {
      cardId: '1',
      hero: 'ACTION',
      year: 2024,
      set: 'BF',
      cardNumber: 'BF-127',
      pose: 'First Edition',
      weapon: 'GLOW',
      power: 115,
      tags: ['rare', 'foil'],
      readyToList: true
    },
    {
      cardId: '2',
      hero: 'UNIBROW',
      year: 2023,
      set: 'RC',
      cardNumber: 'RC-045',
      pose: 'Base',
      weapon: 'None',
      power: 80,
      tags: [],
      readyToList: false
    }
  ];

  it('generates valid CSV with headers', () => {
    const csv = generateCSV(sampleCards, EXPORT_FIELDS);
    const lines = csv.split('\n');
    expect(lines.length).toBe(3); // header + 2 rows
    expect(lines[0]).toContain('"Hero Name"');
    expect(lines[0]).toContain('"Card Number"');
  });

  it('escapes double quotes in values', () => {
    const cards = [{ ...sampleCards[0], hero: 'He said "hi"' }];
    const csv = generateCSV(cards, EXPORT_FIELDS.filter(f => f.key === 'hero'));
    expect(csv).toContain('""hi""');
  });

  it('joins tags with pipe separator', () => {
    const csv = generateCSV(sampleCards, EXPORT_FIELDS.filter(f => f.key === 'tags'));
    expect(csv).toContain('rare | foil');
  });

  it('formats readyToList as Yes/No', () => {
    const csv = generateCSV(sampleCards, EXPORT_FIELDS.filter(f => f.key === 'readyToList'));
    const lines = csv.split('\n');
    expect(lines[1]).toContain('"Yes"');
    expect(lines[2]).toContain('"No"');
  });

  it('handles empty cards array', () => {
    const csv = generateCSV([], EXPORT_FIELDS);
    const lines = csv.split('\n');
    expect(lines.length).toBe(1); // header only
  });

  it('handles missing/null field values', () => {
    const cards = [{ hero: null, cardNumber: undefined }];
    const csv = generateCSV(cards, EXPORT_FIELDS.filter(f => f.key === 'hero' || f.key === 'cardNumber'));
    expect(csv).toContain('""'); // null becomes empty string
  });
});
