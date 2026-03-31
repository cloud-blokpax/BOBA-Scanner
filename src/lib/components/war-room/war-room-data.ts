export interface HeroCard {
	hero: string;
	num: string;
	p: string;
	w: string;
	pwr: number;
	s: string;
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

const RAW_HEROES: Omit<HeroCard, 'ppp'>[] = [
	{ hero: 'Tattoo', num: '49', p: 'Paper', w: 'Fire', pwr: 120, s: 'AE', mid: 8.5, bn: 9.99, ls: 18, bnC: 12, cf: 0.91 },
	{ hero: 'Tattoo', num: '50', p: 'Paper', w: 'Ice', pwr: 120, s: 'AE', mid: 9, bn: 11.99, ls: 15, bnC: 10, cf: 0.88 },
	{ hero: 'Tattoo', num: '51', p: 'Paper', w: 'Steel', pwr: 115, s: 'AE', mid: 7.5, bn: 8.99, ls: 20, bnC: 14, cf: 0.93 },
	{ hero: 'Action', num: '76', p: 'Paper', w: 'Fire', pwr: 110, s: 'AE', mid: 5, bn: 6.99, ls: 25, bnC: 18, cf: 0.95 },
	{ hero: 'Action', num: '77', p: 'Paper', w: 'Ice', pwr: 110, s: 'AE', mid: 4.5, bn: 5.99, ls: 28, bnC: 20, cf: 0.96 },
	{ hero: 'Action', num: '78', p: 'Paper', w: 'Steel', pwr: 105, s: 'AE', mid: 3.5, bn: 4.99, ls: 32, bnC: 22, cf: 0.97 },
	{ hero: 'Tank', num: '89', p: 'Paper', w: 'Fire', pwr: 100, s: 'AE', mid: 3, bn: 3.99, ls: 35, bnC: 25, cf: 0.97 },
	{ hero: 'Tank', num: '90', p: 'Paper', w: 'Ice', pwr: 100, s: 'AE', mid: 2.75, bn: 3.49, ls: 38, bnC: 28, cf: 0.98 },
	{ hero: 'Time', num: '96', p: 'Paper', w: 'Steel', pwr: 100, s: 'AE', mid: 2.5, bn: 3.29, ls: 40, bnC: 30, cf: 0.98 },
	{ hero: 'Big-Z', num: '102', p: 'Paper', w: 'Glow', pwr: 105, s: 'AU', mid: 4, bn: 5.49, ls: 22, bnC: 15, cf: 0.94 },
	{ hero: 'Spike', num: '103', p: 'Paper', w: 'Ice', pwr: 95, s: 'AE', mid: 2, bn: 2.99, ls: 45, bnC: 32, cf: 0.98 },
	{ hero: 'Flash', num: '104', p: 'Paper', w: 'Glow', pwr: 95, s: 'AE', mid: 1.75, bn: 2.49, ls: 50, bnC: 38, cf: 0.99 },
	{ hero: 'Bolt', num: '105', p: 'Paper', w: 'Steel', pwr: 90, s: 'AE', mid: 1.5, bn: 1.99, ls: 55, bnC: 42, cf: 0.99 },
	{ hero: 'Storm', num: '106', p: 'Paper', w: 'Fire', pwr: 90, s: 'AE', mid: 1.25, bn: 1.79, ls: 60, bnC: 45, cf: 0.99 },
	{ hero: 'Wave', num: 'AU-10', p: 'Paper', w: 'Ice', pwr: 110, s: 'AU', mid: 5.5, bn: 6.99, ls: 20, bnC: 14, cf: 0.92 },
	{ hero: 'Blaze', num: 'AU-22', p: 'Paper', w: 'Fire', pwr: 115, s: 'AU', mid: 6.5, bn: 7.99, ls: 18, bnC: 12, cf: 0.90 },
	{ hero: 'Frost', num: 'AU-35', p: 'Paper', w: 'Ice', pwr: 120, s: 'AU', mid: 8, bn: 9.99, ls: 14, bnC: 10, cf: 0.87 },
	{ hero: 'Tattoo', num: 'BF-81', p: 'Battlefoil', w: 'Hex', pwr: 170, s: 'AE', mid: 85, bn: 99.99, ls: 5, bnC: 3, cf: 0.58 },
	{ hero: 'Tattoo', num: 'BF-82', p: 'Battlefoil', w: 'Glow', pwr: 125, s: 'AE', mid: 42, bn: 49.99, ls: 8, bnC: 5, cf: 0.72 },
	{ hero: 'Action', num: 'BF-126', p: 'Battlefoil', w: 'Hex', pwr: 160, s: 'AE', mid: 72, bn: 85, ls: 6, bnC: 4, cf: 0.65 },
	{ hero: 'Tank', num: 'BF-156', p: 'Battlefoil', w: 'Hex', pwr: 155, s: 'AE', mid: 65, bn: 79.99, ls: 4, bnC: 3, cf: 0.55 },
	{ hero: 'Time', num: 'BF-157', p: 'Battlefoil', w: 'Glow', pwr: 110, s: 'AE', mid: 28, bn: 34.99, ls: 9, bnC: 6, cf: 0.74 },
	{ hero: 'Tattoo', num: 'RAD-79', p: "80's Rad", w: 'Hex', pwr: 170, s: 'AE', mid: 145, bn: 175, ls: 3, bnC: 2, cf: 0.42 },
	{ hero: 'Tattoo', num: 'RAD-80', p: "80's Rad", w: 'Glow', pwr: 125, s: 'AE', mid: 68, bn: 79.99, ls: 4, bnC: 3, cf: 0.52 },
	{ hero: 'Action', num: 'RAD-126', p: "80's Rad", w: 'Fire', pwr: 110, s: 'AE', mid: 55, bn: 64.99, ls: 5, bnC: 3, cf: 0.58 },
	{ hero: 'Tank', num: 'RAD-334', p: "80's Rad", w: 'Ice', pwr: 100, s: 'AE', mid: 42, bn: 49.99, ls: 6, bnC: 4, cf: 0.62 },
	{ hero: 'Time', num: 'RAD-160', p: "80's Rad", w: 'Steel', pwr: 100, s: 'AE', mid: 38, bn: 44.99, ls: 7, bnC: 5, cf: 0.66 },
	{ hero: 'Tattoo', num: 'SF-11', p: 'Superfoil', w: 'Super', pwr: 165, s: 'AE', mid: 320, bn: 399.99, ls: 2, bnC: 1, cf: 0.35 },
	{ hero: 'Tank', num: 'SF-67', p: 'Superfoil', w: 'Super', pwr: 150, s: 'AE', mid: 245, bn: 299.99, ls: 3, bnC: 2, cf: 0.40 },
	{ hero: 'Time', num: 'BGBF-32', p: 'Bubble Gum', w: 'Gum', pwr: 155, s: 'AE', mid: 180, bn: 219.99, ls: 2, bnC: 1, cf: 0.38 },
	{ hero: 'Action', num: 'BBF-47', p: 'Blue BF', w: 'Ice', pwr: 110, s: 'AE', mid: 35, bn: 42.99, ls: 7, bnC: 5, cf: 0.70 },
	{ hero: 'Tank', num: 'GBF-62', p: 'Green BF', w: 'Glow', pwr: 110, s: 'AE', mid: 32, bn: 39.99, ls: 8, bnC: 5, cf: 0.72 },
	{ hero: 'Time', num: 'SBF-37', p: 'Silver BF', w: 'Steel', pwr: 95, s: 'AE', mid: 45, bn: 54.99, ls: 4, bnC: 3, cf: 0.55 },
	{ hero: 'Tattoo', num: 'BLBF-49', p: 'Blizzard BF', w: 'Ice', pwr: 120, s: 'AE', mid: 52, bn: 62.99, ls: 5, bnC: 3, cf: 0.60 },
	{ hero: 'Action', num: 'GLBF-126', p: 'Linoleum BF', w: 'Hex', pwr: 160, s: 'AE', mid: 78, bn: 89.99, ls: 4, bnC: 2, cf: 0.50 },
];

export const HEROES: HeroCard[] = RAW_HEROES.map((h) => ({
	...h,
	ppp: h.pwr > 0 ? +((h.mid / h.pwr).toFixed(3)) : 0,
}));

const RAW_PLAYS: Omit<PlayCard, 'dpd'>[] = [
	{ name: 'Full Court Press', num: 'PL-1', dbs: 110, hd: 5, mid: 125, bn: 149.99, ls: 3, cf: 0.45, r: 'SSP' },
	{ name: 'Front Run', num: 'PL-2', dbs: 16, hd: 2, mid: 42, bn: 54.99, ls: 6, cf: 0.62, r: 'SSP' },
	{ name: 'Victory Dinner', num: 'PL-3', dbs: 34, hd: 1, mid: 38, bn: 44.99, ls: 8, cf: 0.68, r: 'SSP' },
	{ name: '4 New Plays Baby!', num: 'PL-10', dbs: 45, hd: 3, mid: 55, bn: 64.99, ls: 4, cf: 0.52, r: 'SSP' },
	{ name: 'Heads I Win', num: 'PL-18', dbs: 28, hd: 1, mid: 22, bn: 27.99, ls: 10, cf: 0.78, r: 'SP' },
	{ name: 'Coin Flip Chaos', num: 'PL-25', dbs: 18, hd: 1, mid: 15, bn: 18.99, ls: 14, cf: 0.82, r: 'SP' },
	{ name: 'Steel Surge', num: 'PL-35', dbs: 22, hd: 2, mid: 8.5, bn: 10.99, ls: 18, cf: 0.88, r: 'Rare' },
	{ name: 'Fire Storm', num: 'PL-40', dbs: 15, hd: 1, mid: 6, bn: 7.99, ls: 22, cf: 0.90, r: 'Rare' },
	{ name: 'Ice Shield', num: 'PL-55', dbs: 12, hd: 1, mid: 3.5, bn: 4.99, ls: 30, cf: 0.94, r: 'Uncommon' },
	{ name: 'Quick Draw', num: 'PL-60', dbs: 8, hd: 0, mid: 2.5, bn: 3.49, ls: 35, cf: 0.96, r: 'Uncommon' },
	{ name: 'Basic Block', num: 'PL-80', dbs: 5, hd: 0, mid: 1, bn: 1.49, ls: 50, cf: 0.99, r: 'Common' },
	{ name: 'Simple Strike', num: 'PL-85', dbs: 4, hd: 0, mid: 0.75, bn: 0.99, ls: 55, cf: 0.99, r: 'Common' },
	{ name: 'Tap Out', num: 'PL-90', dbs: 3, hd: 0, mid: 0.50, bn: 0.79, ls: 60, cf: 0.99, r: 'Common' },
];

export const PLAYS: PlayCard[] = RAW_PLAYS.map((p) => ({
	...p,
	dpd: p.dbs > 0 ? +((p.mid / p.dbs).toFixed(2)) : null,
}));

export const PAR_ORDER = [
	'Paper',
	'Battlefoil',
	'Blue BF',
	'Green BF',
	'Blizzard BF',
	"80's Rad",
	'Linoleum BF',
	'Silver BF',
	'Bubble Gum',
	'Superfoil',
];

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
	Paper: '#22c55e',
	Battlefoil: '#3b82f6',
	"80's Rad": '#f59e0b',
	Superfoil: '#ef4444',
	'Bubble Gum': '#f472b6',
	'Blue BF': '#60a5fa',
	'Green BF': '#4ade80',
	'Silver BF': '#94a3b8',
	'Blizzard BF': '#67e8f9',
	'Linoleum BF': '#a78bfa',
};

export const RARITY_COLORS: Record<string, string> = {
	SSP: '#e24b4a',
	SP: '#ef9f27',
	Rare: '#7f77dd',
	Uncommon: '#378add',
	Common: '#888780',
	Bonus: '#1d9e75',
};
