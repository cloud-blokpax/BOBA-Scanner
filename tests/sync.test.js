// tests/sync.test.js — Tests for sync merge logic and tombstones
import { describe, it, expect } from 'vitest';

const TOMBSTONE_DELIM = '|||';

// Re-implement sync functions for testing
function cardTombstoneKey(card) {
  return (card.cardNumber || '') + TOMBSTONE_DELIM + (card.timestamp || '') + TOMBSTONE_DELIM + new Date().toISOString();
}

function isDeleted(card, tombstones) {
  const cardId = (card.cardNumber || '') + TOMBSTONE_DELIM + (card.timestamp || '');
  for (const key of tombstones) {
    if (key === cardId || key.startsWith(cardId + TOMBSTONE_DELIM)) return true;
  }
  const oldKey = (card.cardNumber || '') + ':' + (card.timestamp || '');
  return tombstones.includes(oldKey);
}

function mergeCardArrays(localCards, remoteCards, tombstones) {
  const merged = localCards.filter(c => !isDeleted(c, tombstones));
  for (const remoteCard of remoteCards) {
    if (isDeleted(remoteCard, tombstones)) continue;
    const existingIdx = merged.findIndex(c =>
      c.cardNumber === remoteCard.cardNumber &&
      Math.abs(new Date(c.timestamp) - new Date(remoteCard.timestamp)) < 10000
    );
    if (existingIdx === -1) {
      merged.push(remoteCard);
    } else {
      const localTags  = merged[existingIdx].tags || [];
      const remoteTags = remoteCard.tags || [];
      if (remoteTags.length > 0) {
        merged[existingIdx] = {
          ...merged[existingIdx],
          tags: [...new Set([...localTags, ...remoteTags])]
        };
      }
    }
  }
  return merged;
}

function pruneTombstones(list) {
  const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  return list.filter(key => {
    const parts = key.split(TOMBSTONE_DELIM);
    let tsStr;
    if (parts.length >= 3) {
      tsStr = parts[2];
    } else if (parts.length === 2) {
      tsStr = parts[1];
    } else {
      return true;
    }
    const ts = new Date(tsStr).getTime();
    return isNaN(ts) || ts > cutoff;
  });
}

describe('isDeleted', () => {
  it('detects a deleted card by tombstone', () => {
    const card = { cardNumber: 'BF-127', timestamp: '2024-01-01T00:00:00.000Z' };
    const tombstones = [cardTombstoneKey(card)];
    expect(isDeleted(card, tombstones)).toBe(true);
  });

  it('returns false for non-deleted card', () => {
    const card = { cardNumber: 'BF-127', timestamp: '2024-01-01T00:00:00.000Z' };
    expect(isDeleted(card, [])).toBe(false);
  });

  it('handles old colon-delimited tombstone format', () => {
    const card = { cardNumber: 'BF-127', timestamp: '2024-01-01T00:00:00.000Z' };
    const oldTombstone = 'BF-127:2024-01-01T00:00:00.000Z';
    expect(isDeleted(card, [oldTombstone])).toBe(true);
  });
});

describe('mergeCardArrays', () => {
  it('merges cards from both local and remote', () => {
    const local  = [{ cardNumber: 'A-1', timestamp: '2024-01-01T00:00:00.000Z' }];
    const remote = [{ cardNumber: 'B-2', timestamp: '2024-01-02T00:00:00.000Z' }];
    const result = mergeCardArrays(local, remote, []);
    expect(result).toHaveLength(2);
  });

  it('deduplicates cards scanned within 10 seconds', () => {
    const ts1 = '2024-01-01T12:00:00.000Z';
    const ts2 = '2024-01-01T12:00:05.000Z'; // 5 seconds later
    const local  = [{ cardNumber: 'A-1', timestamp: ts1 }];
    const remote = [{ cardNumber: 'A-1', timestamp: ts2 }];
    const result = mergeCardArrays(local, remote, []);
    expect(result).toHaveLength(1);
  });

  it('does not deduplicate cards scanned far apart', () => {
    const ts1 = '2024-01-01T12:00:00.000Z';
    const ts2 = '2024-01-01T13:00:00.000Z'; // 1 hour later
    const local  = [{ cardNumber: 'A-1', timestamp: ts1 }];
    const remote = [{ cardNumber: 'A-1', timestamp: ts2 }];
    const result = mergeCardArrays(local, remote, []);
    expect(result).toHaveLength(2);
  });

  it('excludes deleted cards from merge', () => {
    const card = { cardNumber: 'A-1', timestamp: '2024-01-01T00:00:00.000Z' };
    const tombstones = [cardTombstoneKey(card)];
    const local  = [card];
    const remote = [];
    const result = mergeCardArrays(local, remote, tombstones);
    expect(result).toHaveLength(0);
  });

  it('merges tags from both versions of a duplicate', () => {
    const ts = '2024-01-01T12:00:00.000Z';
    const local  = [{ cardNumber: 'A-1', timestamp: ts, tags: ['tag1'] }];
    const remote = [{ cardNumber: 'A-1', timestamp: ts, tags: ['tag2'] }];
    const result = mergeCardArrays(local, remote, []);
    expect(result).toHaveLength(1);
    expect(result[0].tags).toContain('tag1');
    expect(result[0].tags).toContain('tag2');
  });
});

describe('pruneTombstones', () => {
  it('keeps recent tombstones', () => {
    const recent = `BF-127|||2024-01-01T00:00:00.000Z|||${new Date().toISOString()}`;
    const result = pruneTombstones([recent]);
    expect(result).toHaveLength(1);
  });

  it('removes tombstones older than 30 days', () => {
    const old = `BF-127|||2020-01-01T00:00:00.000Z|||2020-01-02T00:00:00.000Z`;
    const result = pruneTombstones([old]);
    expect(result).toHaveLength(0);
  });

  it('keeps unparseable tombstones (safe default)', () => {
    const result = pruneTombstones(['garbage-data']);
    expect(result).toHaveLength(1);
  });
});
