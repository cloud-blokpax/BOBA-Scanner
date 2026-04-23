/**
 * Unit tests for the live-OCR vote tallier.
 *
 * ConsensusBuilder reaches across catalog-mirror for prefix/name
 * shortlists. We mock those to keep the test hermetic — the shortlist
 * content is representative, not the full catalog.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the catalog-mirror getters. Each test sets the values it wants
// before instantiating a builder.
vi.mock('../src/lib/services/catalog-mirror', () => {
	return {
		getBobaPrefixes: vi.fn(),
		getBobaHeroes: vi.fn(),
		getWondersNames: vi.fn()
	};
});

import {
	getBobaPrefixes,
	getBobaHeroes,
	getWondersNames
} from '../src/lib/services/catalog-mirror';
import { ConsensusBuilder } from '../src/lib/services/consensus-builder';

describe('ConsensusBuilder.validateCardNumber (via addVote/getConsensus)', () => {
	beforeEach(() => {
		vi.mocked(getBobaPrefixes).mockReturnValue(new Set(['BF', 'PL', 'HTD', 'RAD']));
		vi.mocked(getBobaHeroes).mockReturnValue(['Bo Jackson', 'Speed Demon', 'Cruze Control']);
		vi.mocked(getWondersNames).mockReturnValue(['Cast Out', 'Shimmer', 'Laviathan']);
	});

	it('accepts known prefixes on BoBA', () => {
		const b = new ConsensusBuilder(1, 'boba');
		b.addVote({ task: 'card_number', rawValue: 'BF-108', confidence: 0.95, sessionId: 1 });
		b.addVote({ task: 'card_number', rawValue: 'BF-108', confidence: 0.96, sessionId: 1 });
		b.addVote({ task: 'name', rawValue: 'Bo Jackson', confidence: 0.95, sessionId: 1 });
		b.addVote({ task: 'name', rawValue: 'Bo Jackson', confidence: 0.92, sessionId: 1 });
		b.tickFrame(); b.tickFrame();
		const c = b.getConsensus();
		expect(c.cardNumber?.value).toBe('BF-108');
	});
	it('rejects unknown prefixes on BoBA', () => {
		const b = new ConsensusBuilder(1, 'boba');
		b.addVote({ task: 'card_number', rawValue: 'XYZ-999', confidence: 0.95, sessionId: 1 });
		b.addVote({ task: 'card_number', rawValue: 'XYZ-999', confidence: 0.96, sessionId: 1 });
		const c = b.getConsensus();
		expect(c.cardNumber).toBeNull();
	});
	it('accepts plain-numeric card numbers (BoBA paper)', () => {
		const b = new ConsensusBuilder(1, 'boba');
		b.addVote({ task: 'card_number', rawValue: '108', confidence: 0.95, sessionId: 1 });
		b.addVote({ task: 'card_number', rawValue: '108', confidence: 0.92, sessionId: 1 });
		const c = b.getConsensus();
		expect(c.cardNumber?.value).toBe('108');
	});
	it('drops votes from stale sessions', () => {
		const b = new ConsensusBuilder(2, 'boba');
		b.addVote({ task: 'card_number', rawValue: 'BF-108', confidence: 0.95, sessionId: 1 });
		b.addVote({ task: 'card_number', rawValue: 'BF-108', confidence: 0.95, sessionId: 1 });
		const c = b.getConsensus();
		expect(c.cardNumber).toBeNull();
	});
	it('uppercases and strips special chars before validating', () => {
		const b = new ConsensusBuilder(1, 'boba');
		// OCR might return "bf-108!" — builder should normalize
		b.addVote({ task: 'card_number', rawValue: 'bf-108!', confidence: 0.95, sessionId: 1 });
		b.addVote({ task: 'card_number', rawValue: 'BF-108', confidence: 0.95, sessionId: 1 });
		const c = b.getConsensus();
		expect(c.cardNumber?.value).toBe('BF-108');
		expect(c.cardNumber?.agreementCount).toBe(2);
	});
});

describe('ConsensusBuilder.collapseName', () => {
	beforeEach(() => {
		vi.mocked(getBobaPrefixes).mockReturnValue(new Set(['BF', 'PL']));
		vi.mocked(getBobaHeroes).mockReturnValue(['Bo Jackson', 'Cruze Control']);
		vi.mocked(getWondersNames).mockReturnValue(['Cast Out', 'Shimmer']);
	});

	it('collapses space-dropped OCR reads to the catalog name', () => {
		const b = new ConsensusBuilder(1, 'wonders');
		b.addVote({ task: 'name', rawValue: 'CastOut', confidence: 0.95, sessionId: 1 });
		b.addVote({ task: 'name', rawValue: 'CastOut', confidence: 0.95, sessionId: 1 });
		const c = b.getConsensus();
		expect(c.name?.value).toBe('Cast Out');
	});
	it('collapses 0↔o confusion', () => {
		const b = new ConsensusBuilder(1, 'boba');
		b.addVote({ task: 'name', rawValue: 'B0 Jacks0n', confidence: 0.95, sessionId: 1 });
		b.addVote({ task: 'name', rawValue: 'B0 Jacks0n', confidence: 0.95, sessionId: 1 });
		const c = b.getConsensus();
		expect(c.name?.value).toBe('Bo Jackson');
	});
	it('rejects names too far from any catalog entry', () => {
		const b = new ConsensusBuilder(1, 'boba');
		b.addVote({ task: 'name', rawValue: 'Random Garbage', confidence: 0.95, sessionId: 1 });
		b.addVote({ task: 'name', rawValue: 'Random Garbage', confidence: 0.95, sessionId: 1 });
		const c = b.getConsensus();
		expect(c.name).toBeNull();
	});
});

describe('ConsensusBuilder threshold behavior', () => {
	beforeEach(() => {
		vi.mocked(getBobaPrefixes).mockReturnValue(new Set(['BF']));
		vi.mocked(getBobaHeroes).mockReturnValue(['Bo Jackson']);
		vi.mocked(getWondersNames).mockReturnValue([]);
	});

	it('does not reach threshold with a single vote', () => {
		const b = new ConsensusBuilder(1, 'boba');
		b.addVote({ task: 'card_number', rawValue: 'BF-108', confidence: 0.95, sessionId: 1 });
		b.addVote({ task: 'name', rawValue: 'Bo Jackson', confidence: 0.95, sessionId: 1 });
		expect(b.getConsensus().reachedThreshold).toBe(false);
	});
	it('reaches threshold with two agreeing high-confidence votes (default config)', () => {
		const b = new ConsensusBuilder(1, 'boba');
		b.addVote({ task: 'card_number', rawValue: 'BF-108', confidence: 0.95, sessionId: 1 });
		b.addVote({ task: 'card_number', rawValue: 'BF-108', confidence: 0.95, sessionId: 1 });
		b.addVote({ task: 'name', rawValue: 'Bo Jackson', confidence: 0.95, sessionId: 1 });
		b.addVote({ task: 'name', rawValue: 'Bo Jackson', confidence: 0.95, sessionId: 1 });
		expect(b.getConsensus().reachedThreshold).toBe(true);
	});
	it('does not reach threshold when summed confidence is too low (two weak votes)', () => {
		const b = new ConsensusBuilder(1, 'boba');
		b.addVote({ task: 'card_number', rawValue: 'BF-108', confidence: 0.7, sessionId: 1 });
		b.addVote({ task: 'card_number', rawValue: 'BF-108', confidence: 0.7, sessionId: 1 });
		b.addVote({ task: 'name', rawValue: 'Bo Jackson', confidence: 0.7, sessionId: 1 });
		b.addVote({ task: 'name', rawValue: 'Bo Jackson', confidence: 0.7, sessionId: 1 });
		// 2 × 0.7 = 1.4 < default 1.5 summed confidence threshold
		expect(b.getConsensus().reachedThreshold).toBe(false);
	});
	it('respects the tighter upload-TTA config', () => {
		const b = new ConsensusBuilder(1, 'boba', {
			minAgreement: 3,
			minSummedConfidence: 2.25
		});
		b.addVote({ task: 'card_number', rawValue: 'BF-108', confidence: 0.9, sessionId: 1 });
		b.addVote({ task: 'card_number', rawValue: 'BF-108', confidence: 0.9, sessionId: 1 });
		b.addVote({ task: 'name', rawValue: 'Bo Jackson', confidence: 0.9, sessionId: 1 });
		b.addVote({ task: 'name', rawValue: 'Bo Jackson', confidence: 0.9, sessionId: 1 });
		// 2 votes per task; upload config needs 3
		expect(b.getConsensus().reachedThreshold).toBe(false);

		b.addVote({ task: 'card_number', rawValue: 'BF-108', confidence: 0.9, sessionId: 1 });
		b.addVote({ task: 'name', rawValue: 'Bo Jackson', confidence: 0.9, sessionId: 1 });
		// 3 votes × 0.9 = 2.7, above 2.25 threshold
		expect(b.getConsensus().reachedThreshold).toBe(true);
	});
	it('requires parallel consensus for Wonders but not BoBA', () => {
		vi.mocked(getWondersNames).mockReturnValue(['Cast Out']);
		const bWonders = new ConsensusBuilder(1, 'wonders');
		bWonders.addVote({ task: 'card_number', rawValue: '42', confidence: 0.95, sessionId: 1 });
		bWonders.addVote({ task: 'card_number', rawValue: '42', confidence: 0.95, sessionId: 1 });
		bWonders.addVote({ task: 'name', rawValue: 'Cast Out', confidence: 0.95, sessionId: 1 });
		bWonders.addVote({ task: 'name', rawValue: 'Cast Out', confidence: 0.95, sessionId: 1 });
		// No parallel votes — Wonders must not reach threshold
		expect(bWonders.getConsensus().reachedThreshold).toBe(false);

		bWonders.addVote({ task: 'parallel', rawValue: 'paper', confidence: 0.9, sessionId: 1 });
		bWonders.addVote({ task: 'parallel', rawValue: 'paper', confidence: 0.9, sessionId: 1 });
		expect(bWonders.getConsensus().reachedThreshold).toBe(true);
	});
});
