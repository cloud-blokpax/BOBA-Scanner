/**
 * BOBA hero-to-athlete lookup table.
 *
 * Maps uppercase hero names to real athlete names.
 * Replaces legacy src/collections/boba/heroes.js.
 */

const HERO_TO_ATHLETE: Record<string, string> = {
	'UNIBROW': 'Anthony Davis',
	'BOJAX': 'Bo Jackson',
	'SHOWTIME': 'Patrick Mahomes',
	'PRIME TIME': 'Deion Sanders',
	'SWEETNESS': 'Walter Payton',
	'THE FREAK': 'Tim Lincecum',
	'BLACK MAMBA': 'Kobe Bryant',
	'THE KID': 'Ken Griffey Jr.',
	'AIR JORDAN': 'Michael Jordan',
	'THE GREAT ONE': 'Wayne Gretzky',
	'THE ANSWER': 'Allen Iverson',
	'THE MAILMAN': 'Karl Malone',
	'FLASH': 'Dwyane Wade',
	'KING JAMES': 'LeBron James',
	'THE DIESEL': 'Shaquille O\'Neal',
	'MR. OCTOBER': 'Reggie Jackson',
	'THE DREAM': 'Hakeem Olajuwon',
	'THE ADMIRAL': 'David Robinson',
	'THE GLOVE': 'Gary Payton',
	'THE BIG UNIT': 'Randy Johnson',
	'THE ROCKET': 'Roger Clemens',
	'NEON DEION': 'Deion Sanders',
	'THE ROUND MOUND': 'Charles Barkley',
	'THE HUMAN HIGHLIGHT REEL': 'Dominique Wilkins',
	'ICE MAN': 'George Gervin',
	'DR. J': 'Julius Erving',
	'MAGIC': 'Magic Johnson',
	'THE BIG FUNDAMENTAL': 'Tim Duncan',
	'THE CLAW': 'Kawhi Leonard',
	'THE BEARD': 'James Harden',
	'CHEF CURRY': 'Stephen Curry',
	'THE GREEK FREAK': 'Giannis Antetokounmpo',
	'SLIM REAPER': 'Kevin Durant',
	'THE PROCESS': 'Joel Embiid',
	'SPIDER': 'Donovan Mitchell',
	'ANT MAN': 'Anthony Edwards',
	'JOKER': 'Nikola Jokic',
	'THE TERMINATOR': 'Arnold Palmer',
	'NIGHTHAWK': 'Unknown',
	'VIPER': 'Unknown',
	'BLAZE': 'Unknown',
	'FROST': 'Unknown',
	'THUNDER': 'Unknown',
	'STORM': 'Unknown',
	'PHOENIX': 'Unknown',
	'SHADOW': 'Unknown',
	'TITAN': 'Unknown',
	'APEX': 'Unknown',
	'NOVA': 'Unknown',
	'VOLTAGE': 'Unknown',
	'INFERNO': 'Unknown',
	'GLACIER': 'Unknown',
	'RAPTOR': 'Unknown',
	'COBRA': 'Unknown'
};

/**
 * Get the real athlete name for a BOBA hero name.
 */
export function getAthleteForHero(heroName: string): string | null {
	if (!heroName) return null;
	return HERO_TO_ATHLETE[heroName.toUpperCase()] || null;
}

/**
 * Get all hero-athlete mappings.
 */
export function getAllHeroes(): Record<string, string> {
	return { ...HERO_TO_ATHLETE };
}
