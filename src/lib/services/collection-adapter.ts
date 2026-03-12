/**
 * Collection adapter interface — defines the contract for card collection types.
 *
 * Replaces legacy src/collections/adapter.js with TypeScript interfaces.
 */

import type { Card } from '$lib/types';

export interface OcrRegion {
	x: number;
	y: number;
	w: number;
	h: number;
	label?: string;
}

export interface ScanConfig {
	quality: number;
	threshold: number;
	maxSize: number;
	aiCost: number;
}

export interface FieldDefinition {
	key: string;
	label: string;
	type: 'text' | 'number' | 'select';
	options?: string[];
}

export interface SearchResult {
	title: string;
	subtitle: string;
	id: string;
}

export interface CollectionAdapter {
	readonly id: string;
	readonly displayName: string;
	readonly databaseUrl?: string;

	getFieldDefinitions(): FieldDefinition[];
	normalizeDbRecord(raw: Record<string, unknown>): Partial<Card>;
	buildCardFromMatch(match: Partial<Card>, scanMeta?: Record<string, unknown>): Partial<Card>;
	getAIPrompt(dualImage?: boolean): string;
	buildEbayQuery(card: Partial<Card>): string;
	getOCRRegions(): OcrRegion[];
	getCardNumberCropRegion(): OcrRegion;
	getScanConfig(): ScanConfig;
	getSearchableFields(): Record<string, string>;
	formatSearchResult(dbRecord: Record<string, unknown>): SearchResult;
	getAIResponseFields(): string[];
}
