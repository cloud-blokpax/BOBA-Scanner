/**
 * Market Explorer Types
 *
 * Shared type definitions for the market explorer page and its sub-components.
 */

export interface FacetValue {
	value: string;
	count: number;
	pricedCount?: number;
}

export interface Facets {
	parallel: FacetValue[];
	weapon: FacetValue[];
	set: FacetValue[];
	rarity: FacetValue[];
	hero: FacetValue[];
	power: FacetValue[];
}

export interface ExploreCard {
	id: string;
	hero: string;
	num: string;
	set: string;
	power: number;
	rarity: string;
	weapon: string;
	parallel: string;
	athlete: string;
	priceMid: number | null;
	priceLow: number | null;
	priceHigh: number | null;
	bnMid: number | null;
	bnLow: number | null;
	bnCount: number;
	listings: number;
	filtered: number;
	confidence: number;
	fetchedAt: string | null;
	pricePerPower: number | null;
	bnPremium: number | null;
	liquidity: string;
	hasPriceData: boolean;
}

export interface ExplorePlayCard {
	id: string;
	name: string;
	num: string;
	release: string;
	dbs: number;
	hotDogCost: number;
	ability: string;
	priceMid: number | null;
	priceLow: number | null;
	priceHigh: number | null;
	bnMid: number | null;
	bnLow: number | null;
	bnCount: number;
	listings: number;
	filtered: number;
	confidence: number;
	fetchedAt: string | null;
	pricePerDbs: number | null;
	liquidity: string;
	hasPriceData: boolean;
}

export interface Aggregates {
	totalResults: number;
	pricedCount: number;
	avgPrice: number;
	totalListings: number;
	totalBnAvailable: number;
	avgConfidence: number;
	priceRange: { min: number; max: number } | null;
}
