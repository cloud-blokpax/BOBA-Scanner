/**
 * Market Explorer Filters Composable
 *
 * Owns all 12 filter state variables, URL synchronization,
 * and search triggering with debounce.
 */

import { goto } from '$app/navigation';

export interface ExplorerFilters {
	parallel: string;
	setParallel: (v: string) => void;
	weapon: string;
	setWeapon: (v: string) => void;
	set: string;
	setSet: (v: string) => void;
	hero: string;
	setHero: (v: string) => void;
	rarity: string;
	setRarity: (v: string) => void;
	powerMin: string;
	setPowerMin: (v: string) => void;
	powerMax: string;
	setPowerMax: (v: string) => void;
	priceMin: string;
	setPriceMin: (v: string) => void;
	priceMax: string;
	setPriceMax: (v: string) => void;
	sort: string;
	setSort: (v: string) => void;
	cardType: 'hero' | 'play';
	setCardType: (v: 'hero' | 'play') => void;
	pricedOnly: boolean;
	setPricedOnly: (v: boolean) => void;
	filtersExpanded: boolean;
	setFiltersExpanded: (v: boolean) => void;
	readonly activeFilterCount: number;
	buildSearchParams: () => URLSearchParams;
	triggerSearch: () => void;
	clearFilters: () => void;
}

export function useExplorerFilters(
	initialParams: URLSearchParams,
	onSearch: () => void
): ExplorerFilters {
	let _parallel = $state(initialParams.get('parallel') || '');
	let _weapon = $state(initialParams.get('weapon') || '');
	let _set = $state(initialParams.get('set') || '');
	let _hero = $state(initialParams.get('hero') || '');
	let _rarity = $state(initialParams.get('rarity') || '');
	let _powerMin = $state(initialParams.get('power_min') || '');
	let _powerMax = $state(initialParams.get('power_max') || '');
	let _priceMin = $state(initialParams.get('price_min') || '');
	let _priceMax = $state(initialParams.get('price_max') || '');
	let _sort = $state(initialParams.get('sort') || 'price_asc');
	let _cardType = $state<'hero' | 'play'>((initialParams.get('card_type') as 'hero' | 'play') || 'hero');
	let _pricedOnly = $state(initialParams.get('priced_only') !== 'false');
	let _filtersExpanded = $state(false);

	let _searchTimeout: ReturnType<typeof setTimeout> | undefined;

	const _activeFilterCount = $derived(
		[_parallel, _weapon, _set, _hero, _rarity, _powerMin, _powerMax, _priceMin, _priceMax]
			.filter(v => v !== '').length
	);

	function buildSearchParams(): URLSearchParams {
		const params = new URLSearchParams();
		if (_parallel) params.set('parallel', _parallel);
		if (_weapon) params.set('weapon', _weapon);
		if (_set) params.set('set', _set);
		if (_hero) params.set('hero', _hero);
		if (_rarity) params.set('rarity', _rarity);
		if (_powerMin) params.set('power_min', _powerMin);
		if (_powerMax) params.set('power_max', _powerMax);
		if (_priceMin) params.set('price_min', _priceMin);
		if (_priceMax) params.set('price_max', _priceMax);
		if (_sort !== 'price_asc') params.set('sort', _sort);
		if (_cardType !== 'hero') params.set('card_type', _cardType);
		if (_pricedOnly) {
			params.set('priced_only', 'true');
		} else {
			params.set('priced_only', 'false');
		}
		return params;
	}

	function syncUrl() {
		const params = buildSearchParams();
		const qs = params.toString();
		goto(`/market/explore${qs ? '?' + qs : ''}`, { replaceState: true, noScroll: true });
	}

	function triggerSearch() {
		clearTimeout(_searchTimeout);
		_searchTimeout = setTimeout(() => {
			syncUrl();
			onSearch();
		}, 300);
	}

	function clearFilters() {
		_parallel = '';
		_weapon = '';
		_set = '';
		_hero = '';
		_rarity = '';
		_powerMin = '';
		_powerMax = '';
		_priceMin = '';
		_priceMax = '';
		_sort = 'price_asc';
		_pricedOnly = false;
		triggerSearch();
	}

	function setCardType(type: 'hero' | 'play') {
		_cardType = type;
		if (type === 'play') {
			_parallel = '';
			_weapon = '';
			_powerMin = '';
			_powerMax = '';
			_hero = '';
		}
		triggerSearch();
	}

	return {
		get parallel() { return _parallel; },
		setParallel: (v) => { _parallel = v; triggerSearch(); },
		get weapon() { return _weapon; },
		setWeapon: (v) => { _weapon = v; triggerSearch(); },
		get set() { return _set; },
		setSet: (v) => { _set = v; triggerSearch(); },
		get hero() { return _hero; },
		setHero: (v) => { _hero = v; triggerSearch(); },
		get rarity() { return _rarity; },
		setRarity: (v) => { _rarity = v; triggerSearch(); },
		get powerMin() { return _powerMin; },
		setPowerMin: (v) => { _powerMin = v; triggerSearch(); },
		get powerMax() { return _powerMax; },
		setPowerMax: (v) => { _powerMax = v; triggerSearch(); },
		get priceMin() { return _priceMin; },
		setPriceMin: (v) => { _priceMin = v; triggerSearch(); },
		get priceMax() { return _priceMax; },
		setPriceMax: (v) => { _priceMax = v; triggerSearch(); },
		get sort() { return _sort; },
		setSort: (v) => { _sort = v; triggerSearch(); },
		get cardType() { return _cardType; },
		setCardType,
		get pricedOnly() { return _pricedOnly; },
		setPricedOnly: (v) => { _pricedOnly = v; triggerSearch(); },
		get filtersExpanded() { return _filtersExpanded; },
		setFiltersExpanded: (v) => { _filtersExpanded = v; },
		get activeFilterCount() { return _activeFilterCount; },
		buildSearchParams,
		triggerSearch,
		clearFilters,
	};
}
