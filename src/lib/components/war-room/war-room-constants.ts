export interface HeroCard {
	hero: string;
	num: string;
	p: string;
	w: string;
	pwr: number;
	s: string;
	ath: string;
	mid: number;
	bn: number;
	ls: number;
	bnC: number;
	cf: number;
	ppp: number;
}

export interface PlayCard {
	name: string;
	num: string;
	dbs: number;
	hd: number;
	mid: number;
	bn: number;
	ls: number;
	cf: number;
	r: string;
	dpd: number | null;
}

export const W_ICONS: Record<string, string> = {
	Fire: 'M12 2c0 6-4 8-4 14a6 6 0 1 0 8 0c0-6-4-8-4-14z',
	Ice: 'M12 2v20M4 7l8 5 8-5M4 17l8-5 8 5',
	Steel: 'M5 3l7 9 7-9M5 21l7-9 7 9',
	Glow: 'M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z',
	Hex: 'M12 2l-8 5v6l8 5 8-5V7z',
	Gum: 'M8 4a8 8 0 1 1 0 16 4 4 0 0 0 8 0V4',
	Super: 'M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z',
	Brawl: 'M12 2c-5 0-9 4-9 9s4 9 9 9 9-4 9-9-4-9-9-9z',
};

export const PARALLEL_COLORS: Record<string, string> = {
	// Base
	Paper: '#22c55e',
	Battlefoil: '#3b82f6',

	// Color Battlefoils
	'Blue Battlefoil': '#60a5fa',
	'Green Battlefoil': '#4ade80',
	'Orange Battlefoil': '#f97316',
	'Pink Battlefoil': '#f472b6',
	'Red Battlefoil': '#ef4444',
	'Silver Battlefoil': '#94a3b8',

	// Named Inserts
	"80's Rad Battlefoil": '#f59e0b',
	'Blizzard Battlefoil': '#67e8f9',
	'Bubble Gum Battlefoil': '#f472b6',
	'Colosseum Battlefoil': '#d97706',
	"Grandma's Linoleum Battlefoil": '#a78bfa',
	"Great Grandma's Linoleum Battlefoil": '#8b5cf6',
	'Headliner Battlefoil': '#fbbf24',
	'Blue Headliner Battlefoil': '#60a5fa',
	'Orange Headliner Battlefoil': '#f97316',
	'Red Headliner Battlefoil': '#ef4444',
	'Icon Battlefoil': '#c084fc',
	'Miami Ice Battlefoil': '#06b6d4',
	'Fire Tracks Battlefoil': '#ef4444',
	'Mixtape Battlefoil': '#34d399',
	'Logo Battlefoil': '#60a5fa',
	'Slime Battlefoil': '#22c55e',
	"Chillin' Battlefoil": '#3b82f6',
	"Grillin' Battlefoil": '#f97316',
	'Power Glove': '#a855f7',
	'Alpha Battlefoil': '#a78bfa',
	Cyber: '#06b6d4',
	Alt: '#8b5cf6',

	// Autographs
	'Inspired Ink Battlefoil': '#ffd700',
	'Inspired Ink Superfoil': '#ffd700',
	'Metallic Inspired Ink': '#c0c0c0',

	// Super
	Superfoil: '#ef4444',

	// Alpha Blast
	'Blue Blast': '#60a5fa',
	'Bubble Gum Blast': '#f472b6',
	'Green Blast': '#4ade80',
	'Orange Blast': '#f97316',
	'Pink Blast': '#f472b6',
	'Super Blast': '#ef4444',
};

export const RARITY_COLORS: Record<string, string> = {
	SSP: '#e24b4a',
	SP: '#ef9f27',
	Rare: '#7f77dd',
	Uncommon: '#378add',
	Common: '#888780',
	Bonus: '#1d9e75',
};
