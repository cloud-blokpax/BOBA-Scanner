const VENMO_BASE = 'https://venmo.com/u/James-Poto';
const PAYPAL_BASE = 'https://www.paypal.me/jamespoto';

export function buildVenmoUrl(amount: number | null): string {
	if (amount && amount > 0) {
		return `${VENMO_BASE}?txn=pay&amount=${amount.toFixed(2)}&note=BOBA%20Scanner%20Pro`;
	}
	return VENMO_BASE;
}

export function buildPayPalUrl(amount: number | null): string {
	if (amount && amount > 0) {
		return `${PAYPAL_BASE}/${amount.toFixed(2)}`;
	}
	return PAYPAL_BASE;
}
