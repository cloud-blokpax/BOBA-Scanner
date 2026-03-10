// ============================================================
// js/deck-builder.js — Deck Builder v2.0
//
// Resolve escapeHtml from window (defined in ui.js core bundle)
const escapeHtml = (...args) => window.escapeHtml(...args);

// Workflow:
//  1. User opens Deck Builder → prompted for deck name + composition
//  2. Name becomes the tag applied to all cards in this deck
//  3. User sets target counts: Heroes, Plays, Bonus Plays (each >= 0)
//  4. Scans cards one at a time (photo or upload)
//  5. Manual card additions count toward deck + retain scanned image
//  6. User can finish early before reaching target counts
//  7. On Finish → tag all scanned cards → save to Deck Building collection
//
// BoBA API: GET https://www.bobaleagues.com/api/cards
// Returns DBS score, Cost, Ability per card.
//
// Export: handled in export.js — "BoBA Deck" template
// ============================================================

const DECK_BUILDING_COLLECTION_ID = 'deck_building';
const BOBA_API_BASE = 'https://www.bobaleagues.com/api/cards';

// ── Local BoBA play card database ─────────────────────────────────────────
// 411 play/bonus-play cards with DBS score, cost, and ability.
// Keyed by release+type+number. Lookup is done entirely client-side —
// no external API calls needed.
//
// Release codes → Set names:
//   A   = Alpha Edition
//   U   = Alpha Update
//   G   = Griffey Edition
//   HTD = Alpha Blast
//
// Card number is reconstructed as: type + "-" + number  (e.g. PL-59, BPL-23, HTD-40)
// For HTD release the type is "" so the card number is just "HTD-" + number.
const BOBA_PLAY_DB = (function() {
  const raw = [{"id":"A---PL-59","release":"A","type":"PL","number":59,"name":"Full Court Press","cost":2,"ability":"Your opponent can't run any Plays this Battle.","dbs":110},{"id":"HTD-40","release":"HTD","type":"","number":40,"name":"Steel Defense - htd","cost":0,"ability":"If your Hero has a Steel weapon, your opponent can't run any Plays this Battle.","dbs":108},{"id":"HTD-38","release":"HTD","type":"","number":38,"name":"Flame Wall - htd","cost":0,"ability":"If your Hero has a Fire weapon, your opponent can't run any Plays this Battle.","dbs":106},{"id":"HTD-39","release":"HTD","type":"","number":39,"name":"Icy Shield - htd","cost":0,"ability":"If your Hero has an Ice weapon, your opponent can't run any Plays this Battle.","dbs":106},{"id":"A---PL-57","release":"A","type":"PL","number":57,"name":"Steel Defense","cost":1,"ability":"If your Hero has a Steel weapon, your opponent can't run any Plays this Battle.","dbs":95},{"id":"A---PL-55","release":"A","type":"PL","number":55,"name":"Flame Wall","cost":1,"ability":"If your Hero has a Fire weapon, your opponent can't run any Plays this Battle.","dbs":94},{"id":"A---PL-56","release":"A","type":"PL","number":56,"name":"Icy Shield","cost":1,"ability":"If your Hero has an Ice weapon, your opponent can't run any Plays this Battle.","dbs":94},{"id":"A---PL-13","release":"A","type":"PL","number":13,"name":"Play Booster","cost":2,"ability":"Draw the same number of Plays as you've used in this Battle, including this one. (Ex: If you have run 2 Plays this Battle, draw 2 Plays.)","dbs":80},{"id":"U---BPL-17","release":"U","type":"BPL","number":17,"name":"A Hard Bargain","cost":2,"ability":"Your opponent flips the top card of their Hero Deck. If its Power is 130 or higher, they can't run any additional Plays this Battle. Discard the drawn Hero.","dbs":73},{"id":"A---PL-14","release":"A","type":"PL","number":14,"name":"You're Not Alone","cost":4,"ability":"For the rest of the game, whenever your opponent runs a Play, you can draw a Play from your Playbook.","dbs":67},{"id":"A---BPL-8","release":"A","type":"BPL","number":8,"name":"Call it a Day","cost":3,"ability":"The Hero with the highest current Power wins this Battle now (or it's a tie). Both players draw a Play and move to the next Battle.","dbs":69},{"id":"U---PL-9","release":"U","type":"PL","number":9,"name":"Roll Some Plays","cost":3,"ability":"Roll a dice, draw Plays equivalent to that number. (Ex. If you roll a 3, draw 3 Plays.)","dbs":60},{"id":"A---PL-10","release":"A","type":"PL","number":10,"name":"4 New Plays Baby!","cost":2,"ability":"Shuffle all the Plays in your hand back into your Playbook, then draw 4 new Plays.","dbs":52},{"id":"HTD-2","release":"HTD","type":"","number":2,"name":"Recycle - htd","cost":1,"ability":"Shuffle all Plays used in previous Battles back into your Playbook. Draw 2 Plays.","dbs":51},{"id":"A---PL-39","release":"A","type":"PL","number":39,"name":"Flash Sale","cost":1,"ability":"For this Battle and the next, all your Plays cost 1 less Hot Dog (including this one).","dbs":50},{"id":"G---BPL-23","release":"G","type":"BPL","number":23,"name":"Clean Slate","cost":1,"ability":"Both Players Discard all the Plays in their hands and Draw 3 new Plays.","dbs":49},{"id":"HTD-52","release":"HTD","type":"","number":52,"name":"Tough Call - htd","cost":1,"ability":"Reveal the top 3 Plays of your Playbook; choose 1 and add it to your hand then Discard the other 2.","dbs":49},{"id":"A---BPL-23","release":"A","type":"BPL","number":23,"name":"Play Reset","cost":2,"ability":"Both players shuffle all their Plays back into their Playbooks and draw the same number of Plays again. (Ex: Shuffle 3 Plays, draw 3 Plays.)","dbs":47},{"id":"G---PL-13","release":"G","type":"PL","number":13,"name":"Hero Tax","cost":4,"ability":"Your opponent must pay 1 Hot Dog for each Hero in their hand. If they can't, they must Discard a random Hero instead.","dbs":46},{"id":"U---PL-23","release":"U","type":"PL","number":23,"name":"2 For 20","cost":1,"ability":"Draw 2 additional Plays, but your Hero loses -20.","dbs":45},{"id":"U---BPL-13","release":"U","type":"BPL","number":13,"name":"Play Lockdown","cost":4,"ability":"Your opponent can't draw Plays until they win a Battle.","dbs":45},{"id":"U---PL-43","release":"U","type":"PL","number":43,"name":"Recycle","cost":2,"ability":"Shuffle all Plays used in previous Battles back into your Playbook. Draw 2 Plays.","dbs":45},{"id":"A---PL-8","release":"A","type":"PL","number":8,"name":"Reload","cost":1,"ability":"Pick up 1 Play you used in a previous Battle and add it back to your Hand.","dbs":45},{"id":"A---PL-65","release":"A","type":"PL","number":65,"name":"Dog Gone Inflation","cost":1,"ability":"Your opponent's Plays each cost an extra 2 Hot Dogs for this Battle and the next Battle.","dbs":90},{"id":"G---PL-1","release":"G","type":"PL","number":1,"name":"Grilled Bandit","cost":5,"ability":"For the rest of the game, if your opponent would recover Hot Dogs, you recover them instead.","dbs":44},{"id":"A---BPL-21","release":"A","type":"BPL","number":21,"name":"Locked Playbook","cost":1,"ability":"Your opponent can't draw any Plays this Battle, including at the end of their turn.","dbs":43},{"id":"HTD-27","release":"HTD","type":"","number":27,"name":"Over Under - htd","cost":1,"ability":"Send 2 Heroes from your hand to your Discard Pile. Draw 1 Play and 1 Hero.","dbs":43},{"id":"A---PL-66","release":"A","type":"PL","number":66,"name":"Tough Call","cost":2,"ability":"Reveal the top 3 Plays of your Playbook; choose 1 and add it to your hand then Discard the other 2.","dbs":43},{"id":"U---PL-15","release":"U","type":"PL","number":15,"name":"Money Line","cost":1,"ability":"If you win this Battle, draw 2 Plays.","dbs":41},{"id":"U---PL-24","release":"U","type":"PL","number":24,"name":"Overwhelm","cost":4,"ability":"Your opponent must Discard 2 random Plays.","dbs":41},{"id":"HTD-46","release":"HTD","type":"","number":46,"name":"1-4-1 Play - htd","cost":0,"ability":"Draw a Play from your Playbook.","dbs":40},{"id":"G---PL-28","release":"G","type":"PL","number":28,"name":"Quick Draw","cost":1,"ability":"If you run this Play before Battle 3, Draw 2 Plays. If not, Draw 1 Play.","dbs":40},{"id":"G---PL-8","release":"G","type":"PL","number":8,"name":"Sacrifice And Scheme","cost":1,"ability":"Draw 2 Plays and Discard 2 Heroes.","dbs":40},{"id":"U---PL-22","release":"U","type":"PL","number":22,"name":"1 For 10","cost":0,"ability":"Draw 1 additional Play, but your Hero loses -10.","dbs":39},{"id":"U---PL-52","release":"U","type":"PL","number":52,"name":"2 Plays","cost":2,"ability":"Draw 2 Plays.","dbs":39},{"id":"HTD-34","release":"HTD","type":"","number":34,"name":"3rd Time Charm - htd","cost":1,"ability":"Flip a coin 3 times. If all 3 flips land on heads, your Hero's Power is doubled. Each time the coin lands on tails, draw a Play.","dbs":39},{"id":"A---PL-61","release":"A","type":"PL","number":61,"name":"Add Firepower","cost":2,"ability":"Flip a coin 4 times. For each heads, you can either draw a card (Hero or Play) or Recover a Hot Dog from your Discard Pile.","dbs":39},{"id":"A---PL-7","release":"A","type":"PL","number":7,"name":"Back From The Dumps","cost":0,"ability":"Each player gets up to 3 Hot Dogs back from their Discard Pile.","dbs":39},{"id":"G---PL-63","release":"G","type":"PL","number":63,"name":"First Draw","cost":0,"ability":"If this is the first play you've run this Battle, Draw 1 Play.","dbs":39},{"id":"G---PL-25","release":"G","type":"PL","number":25,"name":"Trade-Up","cost":2,"ability":"Discard a Play from your hand to Draw 2 new Plays.","dbs":39},{"id":"HTD-47","release":"HTD","type":"","number":47,"name":"Adding Depth - htd","cost":1,"ability":"Draw a card from either your Playbook or your Hero Deck.","dbs":38},{"id":"G---PL-50","release":"G","type":"PL","number":50,"name":"Refill And Reload","cost":1,"ability":"Shuffle 1 of your Plays from a previous Round into your Playbook to Draw 1 Play.","dbs":38},{"id":"G---PL-37","release":"G","type":"PL","number":37,"name":"Snack Sanction","cost":1,"ability":"For the rest of the game, neither Player can Recover more than 1 Hot Dog per Battle.","dbs":38},{"id":"U---PL-10","release":"U","type":"PL","number":10,"name":"Updog","cost":0,"ability":"Whichever player has fewer Hot Dogs Recovers 2 Hot Dogs and draws 1 Play.","dbs":38},{"id":"U---PL-2","release":"U","type":"PL","number":2,"name":"Cheap Addition","cost":1,"ability":"Reveal the top 5 Plays of your Playbook. Add one to your hand and shuffle the rest back into your Playbook.","dbs":37},{"id":"A---PL-4","release":"A","type":"PL","number":4,"name":"It's Gonna Cost Ya","cost":0,"ability":"Your Hero loses -15, but you can recover up to 2 Hot Dogs from your Discard Pile.","dbs":37},{"id":"G---PL-9","release":"G","type":"PL","number":9,"name":"Momentum Breaker","cost":1,"ability":"Your opponent's Hero gets -5 and they Discard 1 random Play.","dbs":37},{"id":"U---PL-7","release":"U","type":"PL","number":7,"name":"10 Per Play","cost":1,"ability":"Your Hero gets +10 for every other Play you have used so far in this Battle.","dbs":36},{"id":"U---PL-17","release":"U","type":"PL","number":17,"name":"Combo Deal","cost":3,"ability":"Your Hero gets +10. Draw 2 Plays.","dbs":36},{"id":"G---PL-6","release":"G","type":"PL","number":6,"name":"Too Full To Fight","cost":3,"ability":"If your opponent has 5 or more Hot Dogs, their Hero gets -15 and they lose 2 Hot Dogs.","dbs":25},{"id":"A---PL-9","release":"A","type":"PL","number":9,"name":"Leave It To Chance","cost":5,"ability":"For the rest of the game, your opponent must roll a dice after paying the Hot Dog cost to run a Play. If they roll a 2-5, they can run the Play. If they roll anything else, they cannot.","dbs":35},{"id":"U---PL-100","release":"U","type":"PL","number":100,"name":"Mutually Assured Dogstruction","cost":0,"ability":"You and your opponent each discard 2 Hot Dogs.","dbs":35},{"id":"U---PL-96","release":"U","type":"PL","number":96,"name":"Over Under","cost":2,"ability":"Send 2 Heroes from your hand to your Discard Pile. Draw 1 Play and 1 Hero.","dbs":35},{"id":"A---PL-41","release":"A","type":"PL","number":41,"name":"Pay It For Me","cost":1,"ability":"If you choose to Substitute in the next Battle, your opponent must pay the 2 Hot Dog cost.","dbs":35},{"id":"A---PL-80","release":"A","type":"PL","number":80,"name":"1-4-1 Play","cost":1,"ability":"Draw a Play from your Playbook.","dbs":34},{"id":"A---PL-81","release":"A","type":"PL","number":81,"name":"Adding Depth","cost":2,"ability":"Draw a card from either your Playbook or your Hero Deck.","dbs":32},{"id":"U---PL-49","release":"U","type":"PL","number":49,"name":"Feast Or Famine","cost":0,"ability":"If you win this Battle, Recover 2 Hot Dogs. If you lose, Discard 1 Hot Dog.","dbs":34},{"id":"U---BPL-19","release":"U","type":"BPL","number":19,"name":"Hungry Demands","cost":3,"ability":"Your opponent must Discard 2 Hot Dogs.","dbs":34},{"id":"G---PL-36","release":"G","type":"PL","number":36,"name":"Pick Your Poison","cost":0,"ability":"If you lost the previous Battle, your opponent must pay 1 Hot Dog at the start of the next Battle or Discard a Play.","dbs":34},{"id":"G---PL-56","release":"G","type":"PL","number":56,"name":"Power Pick","cost":2,"ability":"Reveal the top 3 Plays of your Playbook. Add 1 to your hand and Discard the rest. If it's a Play with a cost of 3 or higher, your Hero gets +10.","dbs":34},{"id":"HTD-49","release":"HTD","type":"","number":49,"name":"Prevent D - htd","cost":2,"ability":"Your opponent can't run any Plays in Battle 7.","dbs":34},{"id":"G---PL-47","release":"G","type":"PL","number":47,"name":"Second Wind","cost":3,"ability":"Shuffle your entire Discard Pile (excluding Hot Dogs) back into your deck. Draw 2 Plays.","dbs":34},{"id":"G---PL-30","release":"G","type":"PL","number":30,"name":"Synergy Snacks","cost":0,"ability":"If your previous 2 revealed Heroes shared a weapon type, Recover 2 Hot Dogs.","dbs":34},{"id":"A---PL-2","release":"A","type":"PL","number":2,"name":"Victory Dinner","cost":1,"ability":"If you win this Battle, recover up to 3 Hot Dogs from your Discard Pile.","dbs":34},{"id":"A---PL-76","release":"A","type":"PL","number":76,"name":"Win The Toss","cost":1,"ability":"Flip a coin; if heads, run the top Play from your Playbook in this Battle for free (0 Hot Dog cost).","dbs":34},{"id":"G---PL-16","release":"G","type":"PL","number":16,"name":"Rich Get Richer","cost":0,"ability":"If you have 6 or more Hot Dogs left, Recover 1 Hot Dog and Draw 1 Play.","dbs":33},{"id":"HTD-8","release":"HTD","type":"","number":8,"name":"Steel Crew - htd","cost":1,"ability":"For every Hero with a Steel weapon you've used in all Battles so far, your Hero gets +10.","dbs":33},{"id":"A---PL-74","release":"A","type":"PL","number":74,"name":"The Champion's Lasso","cost":0,"ability":"Get 1 Hot Dog back from your Discard Pile for each Hot Dog your opponent uses (or has used) in this Battle.","dbs":33},{"id":"G---PL-31","release":"G","type":"PL","number":31,"name":"Wildcard Wager","cost":0,"ability":"Draw 1 Play. If it costs 1 or less, you may play it immediately for free. If the cost is 2 or higher, Discard it.","dbs":33},{"id":"G---PL-27","release":"G","type":"PL","number":27,"name":"Consolation Combo","cost":0,"ability":"If your Hero loses this Battle, Draw 1 Play and Recover 1 Hot Dog.","dbs":31},{"id":"A---PL-48","release":"A","type":"PL","number":48,"name":"I Get 1. You Lose 1.","cost":2,"ability":"Draw a Play from your Playbook, then choose 1 random Play from your opponent's hand for them to Discard.","dbs":31},{"id":"HTD-33","release":"HTD","type":"","number":33,"name":"Only Upside - htd","cost":0,"ability":"Pick a number from 1 to 6, then roll a dice. If it lands on your number, your Hero gets +20. If not, draw a Play from your Playbook.","dbs":31},{"id":"G---BPL-6","release":"G","type":"BPL","number":6,"name":"Win or Weiners","cost":1,"ability":"If you lose this Battle, Recover 2 Hot Dogs. If you win, Draw a Play.","dbs":31},{"id":"G---PL-38","release":"G","type":"PL","number":38,"name":"Bun Shortage","cost":3,"ability":"For the rest of the game, neither Player can Recover any Hot Dogs.","dbs":30},{"id":"G---PL-39","release":"G","type":"PL","number":39,"name":"Burn To Burn","cost":1,"ability":"Discard a Play. If you do, your opponent loses 2 Hot Dogs.","dbs":30},{"id":"G---BPL-2","release":"G","type":"BPL","number":2,"name":"Drought","cost":2,"ability":"Your opponent loses 2 Hot Dogs and can't Recover any Hot Dogs this Battle or next Battle.","dbs":30},{"id":"HTD-9","release":"HTD","type":"","number":9,"name":"Fire Crew - htd","cost":2,"ability":"For every Hero with a Fire weapon you've used in all Battles so far, your Hero gets +10.","dbs":30},{"id":"G---PL-71","release":"G","type":"PL","number":71,"name":"Good Fortune","cost":1,"ability":"If you won the last Battle, your Hero gets +10. If you lost, Draw 1 Play.","dbs":30},{"id":"HTD-7","release":"HTD","type":"","number":7,"name":"Ice Crew - htd","cost":2,"ability":"For every Hero with an Ice weapon you've used in all Battles so far, your Hero gets +10.","dbs":30},{"id":"A---PL-16","release":"A","type":"PL","number":16,"name":"Locker Room Evacuation","cost":1,"ability":"Reveal the top 5 Heroes from your Hero Deck. Add one to your hand and Discard the rest.","dbs":30},{"id":"U---PL-1","release":"U","type":"PL","number":1,"name":"Hot Dog Dominance","cost":0,"ability":"Your Hero gets +5 for every Hot Dog you have Discarded this Battle, including Substitutions.","dbs":29},{"id":"A---PL-91","release":"A","type":"PL","number":91,"name":"Prevent D","cost":3,"ability":"Your opponent can't run any Plays in Battle 7.","dbs":29},{"id":"G---PL-10","release":"G","type":"PL","number":10,"name":"Drain And Deny","cost":3,"ability":"Your opponent's Hero gets -10 and they can't Recover Hot Dogs next Battle.","dbs":28},{"id":"HTD-17","release":"HTD","type":"","number":17,"name":"Forced Substitution - htd","cost":2,"ability":"Your opponent must pay 2 Hot Dogs and Substitute next Battle.","dbs":28},{"id":"G---PL-64","release":"G","type":"PL","number":64,"name":"Play Re-Order","cost":1,"ability":"Look at the top 3 Plays of your Playbook. Place them back on top in any order you want.","dbs":27},{"id":"A---PL-49","release":"A","type":"PL","number":49,"name":"3rd Time Charm","cost":2,"ability":"Flip a coin 3 times. If all 3 flips land on heads, your Hero's Power is doubled. Each time the coin lands on tails, draw a Play.","dbs":26},{"id":"G---PL-73","release":"G","type":"PL","number":73,"name":"Cheap Trick","cost":2,"ability":"Reveal the top card of your Playbook. If it costs 2 or less, Draw it and your Hero gets +10. If not, shuffle it back into your Playbook.","dbs":26},{"id":"U---BPL-1","release":"U","type":"BPL","number":1,"name":"Copycat","cost":null,"ability":"This card copies the effect and Hot Dog cost of the last Play you used.","dbs":25},{"id":"A---PL-29","release":"A","type":"PL","number":29,"name":"Dogpile","cost":5,"ability":"Draw the top card from your Hero Deck and add its power to your Hero.","dbs":25},{"id":"G---PL-12","release":"G","type":"PL","number":12,"name":"Momentum Meal","cost":0,"ability":"If you win this Battle, Recover Hot Dogs equal to the number of Plays you used this Battle which cost 2 or more. (Max 3).","dbs":25},{"id":"A---PL-30","release":"A","type":"PL","number":30,"name":"Noble Sacrifice","cost":2,"ability":"This Hero's Power is now 0. All your Heroes gain +10 for the rest of the Game.","dbs":25},{"id":"A---PL-42","release":"A","type":"PL","number":42,"name":"Only Upside","cost":1,"ability":"Pick a number from 1 to 6, then roll a dice. If it lands on your number, your Hero gets +20. If not, draw a Play from your Playbook.","dbs":25},{"id":"U---PL-58","release":"U","type":"PL","number":58,"name":"Steel Crew","cost":2,"ability":"For every Hero with a Steel weapon you've used in all Battles so far, your Hero gets +10.","dbs":25},{"id":"A---PL-5","release":"A","type":"PL","number":5,"name":"Deadline Deal","cost":3,"ability":"Swap your Hero's current power with your opponent's current power in this Battle.","dbs":24},{"id":"U---PL-3","release":"U","type":"PL","number":3,"name":"Edge Rush","cost":5,"ability":"Set your Hero's Power to 5 higher than your opponent's current Power.","dbs":24},{"id":"U---PL-59","release":"U","type":"PL","number":59,"name":"Fire Crew","cost":3,"ability":"For every Hero with a Fire weapon you've used in all Battles so far, your Hero gets +10.","dbs":24},{"id":"U---PL-85","release":"U","type":"PL","number":85,"name":"Forced Substitution","cost":3,"ability":"Your opponent must pay 2 Hot Dogs and Substitute next Battle.","dbs":24},{"id":"G---PL-11","release":"G","type":"PL","number":11,"name":"Free Booster","cost":3,"ability":"Your Hero gets +20. If you didn't run any Plays last Battle, this Play costs 0. This Play can't be used in Battle 1.","dbs":24},{"id":"A---PL-3","release":"A","type":"PL","number":3,"name":"Get What You Pay For","cost":0,"ability":"Pay as many Hot Dogs as you want to run this Play. Your Hero gets +10 for each Hot Dog you pay. (Ex: Pay 3 Hot Dogs, your Hero gets +30.)","dbs":24},{"id":"U---PL-57","release":"U","type":"PL","number":57,"name":"Ice Crew","cost":3,"ability":"For every Hero with an Ice weapon you've used in all Battles so far, your Hero gets +10.","dbs":24},{"id":"U---PL-16","release":"U","type":"PL","number":16,"name":"Make Up Meal","cost":0,"ability":"Recover 1 Hot Dog for every Battle you have lost.","dbs":24},{"id":"G---PL-5","release":"G","type":"PL","number":5,"name":"One And Done","cost":1,"ability":"This must be the only Play you use this Battle. Your Hero gets +20.","dbs":24},{"id":"HTD-56","release":"HTD","type":"","number":56,"name":"Pulling The Plug - htd","cost":0,"ability":"Any Plays that are affecting the rest of the Game are now cancelled going forward (including your own).","dbs":24},{"id":"HTD-14","release":"HTD","type":"","number":14,"name":"Forced Retreat - htd","cost":1,"ability":"Your opponent must Discard their current Hero, and replace it with one from their hand.","dbs":23},{"id":"A---PL-78","release":"A","type":"PL","number":78,"name":"No Huddle","cost":0,"ability":"If you ran a Play in the previous Battle, this Hero gets +15.","dbs":23},{"id":"HTD-58","release":"HTD","type":"","number":58,"name":"Rob Peter Pay Paul - htd","cost":0,"ability":"This Hero gets +15, but your Hero in the next Battle gets -5.","dbs":23},{"id":"A---PL-12","release":"A","type":"PL","number":12,"name":"Cloudy With A Chance Of Hot Dogs","cost":0,"ability":"Pick a number from 1 to 6 and roll a dice. If it lands on your number, Recover 4 Hot Dogs from your Discard Pile.","dbs":22},{"id":"G---PL-61","release":"G","type":"PL","number":61,"name":"Dead Red","cost":3,"ability":"Name a weapon type. Now and for the rest of the game, if your opponent's Hero has that weapon type, they get -10. Otherwise, you Discard 1 Play.","dbs":22},{"id":"A---PL-33","release":"A","type":"PL","number":33,"name":"Lose 1 To Win 2 (Hopefully)","cost":2,"ability":"Your current Hero loses -50, but your next 2 Heroes each gain +15.","dbs":22},{"id":"G---BPL-8","release":"G","type":"BPL","number":8,"name":"Lose And Discard","cost":3,"ability":"For the rest of the game, whenever a Player loses a Battle, they must also Discard a Hot Dog.","dbs":22},{"id":"U---PL-4","release":"U","type":"PL","number":4,"name":"Outside The Pocket","cost":2,"ability":"Your Hero gets +30. If you lose this Battle, Discard all Plays in your hand.","dbs":22},{"id":"A---PL-19","release":"A","type":"PL","number":19,"name":"Unlimited Subs","cost":4,"ability":"For the rest of the Game all of your Substitutions are free.","dbs":22},{"id":"G---PL-23","release":"G","type":"PL","number":23,"name":"Weapon Tangle","cost":2,"ability":"If your opponent's Hero has a different weapon type than yours, your Hero gets +15. If they are the same, your Hero gets +20.","dbs":22},{"id":"A---PL-46","release":"A","type":"PL","number":46,"name":"10/10 Unfair","cost":2,"ability":"Your opponent's Hero loses -10 in this Battle, and your Hero in the next Battle gets +10.","dbs":21},{"id":"A---PL-45","release":"A","type":"PL","number":45,"name":"2 Get 10","cost":2,"ability":"Your Hero in this Battle and the next Battle gets +10.","dbs":21},{"id":"A---PL-27","release":"A","type":"PL","number":27,"name":"By Any Means Necessary","cost":6,"ability":"Search your Playbook and run any play for free. (Then, re-shuffle your Playbook.)","dbs":21},{"id":"G---PL-46","release":"G","type":"PL","number":46,"name":"Delayed Recovery","cost":1,"ability":"Choose one of your unrevealed Heroes. When that Hero is revealed, it gets -10 but you Recover 2 Hot Dogs.","dbs":21},{"id":"A---PL-67","release":"A","type":"PL","number":67,"name":"Don't Call It A Comeback","cost":1,"ability":"Replace this Hero with any Hero from your Discard Pile.","dbs":21},{"id":"U---PL-5","release":"U","type":"PL","number":5,"name":"Dragging Anchor","cost":2,"ability":"Your opponent's Heroes in the next 2 Battles get -10.","dbs":21},{"id":"G---PL-75","release":"G","type":"PL","number":75,"name":"Streaky","cost":0,"ability":"If you've won 2 Battles in a row, your opponent's current Hero gets -10.","dbs":21},{"id":"G---BPL-24","release":"G","type":"BPL","number":24,"name":"Bull Market","cost":2,"ability":"Flip a coin. If heads, your opponent's Plays cost 1 extra Hot Dog this Battle and next Battle.","dbs":20},{"id":"A---PL-17","release":"A","type":"PL","number":17,"name":"Deep In The Playbook","cost":0,"ability":"For the rest of the Game, whenever a Player rolls a dice, they get to draw a Play from their Playbook.","dbs":20},{"id":"A---PL-35","release":"A","type":"PL","number":35,"name":"Discarded Heroes","cost":1,"ability":"Your Hero gets +10 for each Hero in your Discard Pile. (Ex: 3 Heroes = +30)","dbs":20},{"id":"HTD-55","release":"HTD","type":"","number":55,"name":"Easy Choice - htd","cost":0,"ability":"No matter the outcome of this Battle, you decide who gets Honors (goes first) in the next Battle.","dbs":20},{"id":"U---PL-65","release":"U","type":"PL","number":65,"name":"Frostbiter","cost":1,"ability":"Discard 1 Hero with an Ice weapon from your hand. Your opponent's Hero gets -15 this Battle.","dbs":20},{"id":"G---PL-42","release":"G","type":"PL","number":42,"name":"Glowaway","cost":2,"ability":"Discard a Hero with a Glow weapon from your hand. Your Hero gets +25.","dbs":20},{"id":"U---BPL-3","release":"U","type":"BPL","number":3,"name":"Student Loan","cost":2,"ability":"Next Battle only, you can spend up to 3 Hot Dogs more than what you have.","dbs":20},{"id":"G---PL-45","release":"G","type":"PL","number":45,"name":"Weapon Lineage","cost":1,"ability":"Your current Hero gets +10 for every Hero in your Discard Pile with the same weapon type.","dbs":20},{"id":"HTD-11","release":"HTD","type":"","number":11,"name":"Frost-Hardened - htd","cost":0,"ability":"For the rest of the game, if your Hero has a Steel weapon, it changes to an Ice weapon.","dbs":19},{"id":"HTD-4","release":"HTD","type":"","number":4,"name":"Hollow Bat - htd","cost":1,"ability":"Roll a dice. If it lands on 3-6, your Hero gets +25. If it lands on 1 or 2, your Hero gets -25.","dbs":19},{"id":"G---PL-55","release":"G","type":"PL","number":55,"name":"Lucky Discard","cost":2,"ability":"Discard the top card of your Hero Deck. If it has the same weapon type as your active Hero, your Hero gets +20.","dbs":19},{"id":"U---PL-8","release":"U","type":"PL","number":8,"name":"Opening Strike","cost":2,"ability":"If you won the first Battle, your Hero gets +30.","dbs":19},{"id":"A---PL-90","release":"A","type":"PL","number":90,"name":"Pinch Hitter","cost":1,"ability":"Next Battle you can Substitute for free (0 Hot Dog cost).","dbs":19},{"id":"G---PL-43","release":"G","type":"PL","number":43,"name":"Playbook Knowledge","cost":1,"ability":"Reveal the top 2 Plays of your opponent's Playbook. Put one back on top and send 1 to the bottom.","dbs":19},{"id":"A---PL-70","release":"A","type":"PL","number":70,"name":"Pulling The Plug","cost":1,"ability":"Any Plays that are affecting the rest of the Game are now cancelled going forward (including your own).","dbs":19},{"id":"A---PL-51","release":"A","type":"PL","number":51,"name":"Steel Resolve","cost":1,"ability":"If your Hero has a Steel weapon, after both players finish their turn, your Hero gets +15.","dbs":19},{"id":"G---PL-68","release":"G","type":"PL","number":68,"name":"Substitution Boost","cost":0,"ability":"For the rest of the game, any Hero that has been Substituted in gets +5.","dbs":19},{"id":"G---PL-52","release":"G","type":"PL","number":52,"name":"Combo Kick","cost":2,"ability":"Your Hero gets +15. If this is your second Play this Battle, it gets an additional +5.","dbs":18},{"id":"U---PL-34","release":"U","type":"PL","number":34,"name":"Damage On Discard","cost":2,"ability":"Discard 2 Plays from your hand. Your opponent's Hero gets -30.","dbs":18},{"id":"U---PL-29","release":"U","type":"PL","number":29,"name":"Early Round Magic","cost":2,"ability":"Your Hero gets +5 for every Battle still remaining in the game. (Ex. You use this on Battle 3, there are 4 Battles left, your Hero gets +20.)","dbs":18},{"id":"U---PL-69","release":"U","type":"PL","number":69,"name":"Forced Retreat","cost":2,"ability":"Your opponent must Discard their current Hero, and replace it with one from their hand.","dbs":18},{"id":"G---PL-35","release":"G","type":"PL","number":35,"name":"High Stakes Pump-Up","cost":0,"ability":"Your Hero gets +10. If you lose this Battle, your Hero in the next Battle gets -20.","dbs":18},{"id":"A---PL-88","release":"A","type":"PL","number":88,"name":"Lucky Bounce","cost":2,"ability":"Roll a die; your Hero gets +5x the number; (ex. If you roll a 3 your Hero gets +15).","dbs":18},{"id":"G---PL-66","release":"G","type":"PL","number":66,"name":"Maximum Effort","cost":0,"ability":"Your Hero gets +10 this Battle, but you can't use any Plays next Battle.","dbs":18},{"id":"G---PL-54","release":"G","type":"PL","number":54,"name":"More Plays, Less Power","cost":1,"ability":"Once this Play is run, if your opponent has more Plays in their hand than you, their Hero gets -10.","dbs":18},{"id":"A---PL-15","release":"A","type":"PL","number":15,"name":"No More Subs","cost":4,"ability":"Your opponent can't Substitute for the rest of the game.","dbs":18},{"id":"A---PL-18","release":"A","type":"PL","number":18,"name":"Pay The Price","cost":2,"ability":"For the rest of the Game, whenever a dice is rolled, the opponent's Hero loses -5.","dbs":18},{"id":"G---PL-48","release":"G","type":"PL","number":48,"name":"Protein Bar","cost":2,"ability":"Your Hero gets +15. If you lose this Battle, Recover 1 Hot Dog.","dbs":18},{"id":"A---PL-89","release":"A","type":"PL","number":89,"name":"Robin Who","cost":1,"ability":"Steal -5 from your opponent's Hero and give +5 to your own Hero.","dbs":18},{"id":"U---PL-6","release":"U","type":"PL","number":6,"name":"Saving Bullets","cost":2,"ability":"Your Hero gets +10 for every Battle you have lost.","dbs":18},{"id":"G---PL-44","release":"G","type":"PL","number":44,"name":"Scare Tactics","cost":1,"ability":"If you have Honors, reveal a Play from your hand. You may use it for free next Battle if your opponent uses a Play with equal or greater cost.","dbs":18},{"id":"U---PL-66","release":"U","type":"PL","number":66,"name":"Scrap Metal","cost":0,"ability":"Discard 1 Hero with a Steel weapon from your hand. Your opponent's Hero gets -10 this Battle.","dbs":18},{"id":"U---PL-50","release":"U","type":"PL","number":50,"name":"Winners Win","cost":0,"ability":"If you've won at least 2 Battles, your Hero gets +15.","dbs":18},{"id":"U---PL-55","release":"U","type":"PL","number":55,"name":"X-Ray Vision","cost":1,"ability":"Look at your opponent's unrevealed Hero in the next Battle.","dbs":18},{"id":"U---PL-14","release":"U","type":"PL","number":14,"name":"1/6 For 15","cost":1,"ability":"Roll a dice, if it lands on 1, your Hero's Power goes to 0. Otherwise, your Hero gets +15.","dbs":17},{"id":"G---PL-26","release":"G","type":"PL","number":26,"name":"Baseline Bonus","cost":1,"ability":"If your Hero's current Power is the same as its starting Power, your Hero gets +10.","dbs":17},{"id":"G---PL-22","release":"G","type":"PL","number":22,"name":"Battle Back","cost":2,"ability":"Your Hero gets +15. If your opponent has won more Battles than you, Draw 1 Play.","dbs":17},{"id":"G---PL-18","release":"G","type":"PL","number":18,"name":"Belly Buster","cost":1,"ability":"If your opponent has an equal or greater number of Hot Dogs than you before paying this Play's Hot Dog cost, their Hero gets -10.","dbs":17},{"id":"G---PL-41","release":"G","type":"PL","number":41,"name":"Buff Or Debuff","cost":2,"ability":"After paying this Play's cost, if your opponent has more Hot Dogs than you, your Hero gets +15. If you have more than them, their Hero gets -15.","dbs":17},{"id":"A---PL-31","release":"A","type":"PL","number":31,"name":"Buff Up 15","cost":2,"ability":"Your Hero gets +15.","dbs":17},{"id":"A---PL-11","release":"A","type":"PL","number":11,"name":"Burn That Play","cost":0,"ability":"Discard another Play from your hand and your Hero gets +10.","dbs":17},{"id":"G---PL-40","release":"G","type":"PL","number":40,"name":"Catch-Up Bonus","cost":2,"ability":"Your Hero gets +10. If your opponent has more Hot Dogs than you after you've paid this Play's cost, Recover 1 Hot Dog.","dbs":17},{"id":"HTD-3","release":"HTD","type":"","number":3,"name":"Contract Limitations - htd","cost":0,"ability":"Your Hero gets +15 but you don't draw a Play at the start of next Battle.","dbs":17},{"id":"G---PL-20","release":"G","type":"PL","number":20,"name":"Double-Edged Flip","cost":2,"ability":"Flip a coin. If heads, your opponent's Hero gets -15. If tails, your opponent's next Hero gets -15.","dbs":17},{"id":"A---PL-64","release":"A","type":"PL","number":64,"name":"Easy Choice","cost":1,"ability":"No matter the outcome of this Battle, you decide who gets Honors (goes first) in the next Battle.","dbs":17},{"id":"U---PL-21","release":"U","type":"PL","number":21,"name":"Heavy Swing","cost":2,"ability":"Flip a coin. If heads, your opponent's Hero gets -35.","dbs":17},{"id":"A---PL-68","release":"A","type":"PL","number":68,"name":"Late-Game Magic","cost":2,"ability":"You can only run this Play in Battle 5 or later; give your Hero +20.","dbs":17},{"id":"U---PL-13","release":"U","type":"PL","number":13,"name":"Line Drive","cost":1,"ability":"Roll a dice. If it lands on 3 or 4, your Hero gets +40. If not, it gets +5.","dbs":17},{"id":"U---PL-87","release":"U","type":"PL","number":87,"name":"No Retreat","cost":1,"ability":"If you don't Substitute your Hero next Battle, it gets +10.","dbs":17},{"id":"A---PL-32","release":"A","type":"PL","number":32,"name":"Opp Loses 15","cost":2,"ability":"Your opponent's Hero loses -15.","dbs":17},{"id":"G---PL-14","release":"G","type":"PL","number":14,"name":"Sack Streak","cost":3,"ability":"Roll a dice once. If you roll a 4-6, your opponent's Hero gets -15. You may roll again until you roll a 1-3.","dbs":17},{"id":"U---PL-31","release":"U","type":"PL","number":31,"name":"Save It For Later","cost":0,"ability":"Your Hero loses -20. But if you win this Battle, your Hero in the next Battle gets +20.","dbs":17},{"id":"A---PL-95","release":"A","type":"PL","number":95,"name":"Trash Bandit","cost":0,"ability":"Recover 1 Hot Dog from your Discard Pile.","dbs":17},{"id":"G---PL-29","release":"G","type":"PL","number":29,"name":"Weapon-Sync","cost":2,"ability":"If your previous Hero and your current Hero share a weapon type, your Hero gets +20. Otherwise, Draw 1 Play.","dbs":17},{"id":"A---PL-50","release":"A","type":"PL","number":50,"name":"Baby Phoenix","cost":1,"ability":"If your Hero has a Fire weapon, after both players finish their turn, your Hero gets +10.","dbs":16},{"id":"G---PL-59","release":"G","type":"PL","number":59,"name":"Bench Blocker","cost":3,"ability":"Your opponent's Hero gets -20. They can't Substitute next Battle.","dbs":16},{"id":"HTD-41","release":"HTD","type":"","number":41,"name":"Curveball - htd","cost":2,"ability":"Replace your Hero with any Hero from your hand and draw 1 Hero.","dbs":16},{"id":"G---PL-60","release":"G","type":"PL","number":60,"name":"Fallen Fighters","cost":1,"ability":"Discard 1 Hero from your hand. Your current Hero gets +10 for every Hero in your Discard Pile with the same weapon type as the one you discarded.","dbs":16},{"id":"A---PL-1","release":"A","type":"PL","number":1,"name":"Front Run","cost":2,"ability":"If your opponent has not used a Play in this Battle, your Hero gets +20.","dbs":16},{"id":"HTD-54","release":"HTD","type":"","number":54,"name":"Going Back to Back - htd","cost":2,"ability":"This Hero gets any extra Power your previous Hero had.","dbs":16},{"id":"A---PL-6","release":"A","type":"PL","number":6,"name":"Late Game Push","cost":2,"ability":"Play this on or before Battle 4. For the rest of the game, nothing changes until the start of Battle 7, when you recover all Hot Dogs from your Discard Pile.","dbs":16},{"id":"HTD-42","release":"HTD","type":"","number":42,"name":"Loan Sharked - htd","cost":1,"ability":"For the rest of the Game if a coin is flipped, lower the opponent's Hero in the active Battle by -5.","dbs":16},{"id":"U---PL-38","release":"U","type":"PL","number":38,"name":"Polished Comeback","cost":1,"ability":"Swap your Hero with a Steel weapon Hero in your Discard Pile.","dbs":16},{"id":"A---PL-72","release":"A","type":"PL","number":72,"name":"Rob Peter Pay Paul","cost":1,"ability":"This Hero gets +15, but your Hero in the next Battle gets -5.","dbs":16},{"id":"A---PL-22","release":"A","type":"PL","number":22,"name":"Steel Boost","cost":2,"ability":"For the rest of the game, all Heroes with Steel weapons get +10.","dbs":16},{"id":"G---PL-3","release":"G","type":"PL","number":3,"name":"Banked Power","cost":2,"ability":"After paying the Hot Dog cost of this Play, your Hero gets +5 for every Hot Dog you have left.","dbs":15},{"id":"U---PL-28","release":"U","type":"PL","number":28,"name":"Big Win Energy","cost":3,"ability":"If you win this Battle, your next Hero gets +40.","dbs":15},{"id":"HTD-19","release":"HTD","type":"","number":19,"name":"Cursed Coin - htd","cost":1,"ability":"Flip a coin 3 times; opponent's Hero gets -10 each time the coin lands on heads.","dbs":15},{"id":"U---PL-63","release":"U","type":"PL","number":63,"name":"Frost-Hardened","cost":1,"ability":"For the rest of the game, if your Hero has a Steel weapon, it changes to an Ice weapon.","dbs":15},{"id":"HTD-44","release":"HTD","type":"","number":44,"name":"Heads-Up! - htd","cost":1,"ability":"Flip a coin 4 times; your Hero gets +5 each time the coin lands on heads.","dbs":15},{"id":"U---PL-44","release":"U","type":"PL","number":44,"name":"Make Up Call","cost":0,"ability":"If you lose this Battle, Recover 1 Hot Dog.","dbs":15},{"id":"HTD-12","release":"HTD","type":"","number":12,"name":"Nasty Or Nada - htd","cost":0,"ability":"Roll a dice 3 times. Your Hero gets +30 if you roll a 6.","dbs":15},{"id":"HTD-37","release":"HTD","type":"","number":37,"name":"Only Steel - htd","cost":2,"ability":"For the rest of the game all Heroes have Steel Weapons.","dbs":15},{"id":"G---PL-17","release":"G","type":"PL","number":17,"name":"Overcommited","cost":2,"ability":"Next Battle, your opponent's Hero gets -5 for every Play they run.","dbs":15},{"id":"G---BPL-15","release":"G","type":"BPL","number":15,"name":"Play Pluck","cost":1,"ability":"Send 1 random Play from your opponent's hand to their Discard Pile.","dbs":15},{"id":"HTD-43","release":"HTD","type":"","number":43,"name":"Shooters Shoot - htd","cost":1,"ability":"Flip a coin 4 times; your opponent's Hero gets -5 each time the coin lands on tails.","dbs":15},{"id":"U---PL-18","release":"U","type":"PL","number":18,"name":"Steel Shield","cost":3,"ability":"For the rest of the game, Heroes with Steel weapons can't lose Power.","dbs":15},{"id":"HTD-45","release":"HTD","type":"","number":45,"name":"To Fight Another Day - htd","cost":1,"ability":"If you lost the previous Battle, your Hero in the active Battle gets +20.","dbs":15},{"id":"U---PL-39","release":"U","type":"PL","number":39,"name":"Contract Limitations","cost":1,"ability":"Your Hero gets +15 but you don't draw a Play at the start of next Battle.","dbs":14},{"id":"G---PL-19","release":"G","type":"PL","number":19,"name":"Emergency Shutdown","cost":0,"ability":"If you have 2 or fewer Hot Dogs, cancel all Plays affecting the rest of the game.","dbs":14},{"id":"U---PL-41","release":"U","type":"PL","number":41,"name":"Greedy Gamble","cost":3,"ability":"Flip a coin. If Heads, Recover 6 Hot Dogs.","dbs":14},{"id":"G---BPL-9","release":"G","type":"BPL","number":9,"name":"Rotten Dogs","cost":2,"ability":"At the start of the next Battle, your opponent loses 2 Hot Dogs.","dbs":14},{"id":"G---PL-15","release":"G","type":"PL","number":15,"name":"Running On Fumes","cost":0,"ability":"If you have 1 or 0 Hot Dogs left, your Hero gets +15.","dbs":14},{"id":"HTD-51","release":"HTD","type":"","number":51,"name":"Worth The Risk? - htd","cost":0,"ability":"Roll a dice: if you get a 1 or 6, your Hero's power drops to 0. If you roll a 2-5, you gain +25.","dbs":14},{"id":"A---BPL-25","release":"A","type":"BPL","number":25,"name":"Cheap Draw","cost":1,"ability":"Draw 3 Plays from your Playbook, but your opponent also draws 1 Play.","dbs":13},{"id":"U---PL-12","release":"U","type":"PL","number":12,"name":"Comeback Season","cost":2,"ability":"If your opponent has won more Battles than you so far, your Hero gets +30.","dbs":13},{"id":"G---BPL-7","release":"G","type":"BPL","number":7,"name":"Competitive Disadvantage","cost":2,"ability":"Your opponent's current Hero gets -10 for every Battle they've won.","dbs":13},{"id":"HTD-30","release":"HTD","type":"","number":30,"name":"Fire Comeback - htd","cost":1,"ability":"Swap your Hero with a Fire weapon Hero in your Discard Pile.","dbs":13},{"id":"A---PL-63","release":"A","type":"PL","number":63,"name":"Flip Ya For 2 Plays","cost":0,"ability":"Flip a coin: If heads, you draw 2 Plays. If tails, your opponent draws 2 Plays.","dbs":13},{"id":"HTD-31","release":"HTD","type":"","number":31,"name":"Gavel of Justice - htd","cost":3,"ability":"Lower the opponent's Hero by -30.","dbs":13},{"id":"HTD-32","release":"HTD","type":"","number":32,"name":"Heads I Win, Tails You Lose - htd","cost":0,"ability":"Flip a coin: If heads, your Hero gets +15. If tails, your opponent's Hero loses -5.","dbs":13},{"id":"U---PL-40","release":"U","type":"PL","number":40,"name":"High Fastball","cost":2,"ability":"Roll a dice; opponent's Hero gets -5x the number. (Ex. If you roll a 4, their Hero gets -20.)","dbs":13},{"id":"HTD-29","release":"HTD","type":"","number":29,"name":"Icy Comeback - htd","cost":1,"ability":"Swap your Hero with an Ice weapon Hero in your Discard Pile.","dbs":13},{"id":"A---BPL-4","release":"A","type":"BPL","number":4,"name":"Instant Refund","cost":0,"ability":"For every Play you used this Battle, Recover 1 Hot Dog from your Discard Pile. (Ex: If you ran 2 Plays, you get 2 Hot Dogs back.)","dbs":13},{"id":"HTD-59","release":"HTD","type":"","number":59,"name":"Make It, Take It - htd","cost":0,"ability":"For the rest of the game, whenever you win a Battle, your Hero in the next Battle gets +5.","dbs":13},{"id":"HTD-13","release":"HTD","type":"","number":13,"name":"Molten Steel - htd","cost":0,"ability":"For the rest of the game, if your Hero has a Steel weapon, it changes to a Fire weapon.","dbs":13},{"id":"G---PL-21","release":"G","type":"PL","number":21,"name":"Overextended","cost":2,"ability":"Your opponent's Hero gets -10. If your opponent has used 2 or more Plays this Battle, they also lose 1 Hot Dog.","dbs":13},{"id":"G---PL-53","release":"G","type":"PL","number":53,"name":"Overprepared","cost":3,"ability":"Your opponent's Hero gets -5 for every Play you have run this Battle.","dbs":13},{"id":"G---BPL-5","release":"G","type":"BPL","number":5,"name":"Plays Or Dogs?","cost":1,"ability":"Choose one of these options: Draw 2 Plays or Discard 2 Plays and Recover 3 Hot Dogs.","dbs":13},{"id":"HTD-28","release":"HTD","type":"","number":28,"name":"Radiant Comeback - htd","cost":1,"ability":"Swap your Hero with a Glow weapon Hero in your Discard Pile.","dbs":13},{"id":"HTD-57","release":"HTD","type":"","number":57,"name":"Rally Cap - htd","cost":1,"ability":"If your Hero in this Battle is losing by 15 or more it gets +20.","dbs":13},{"id":"A---BPL-3","release":"A","type":"BPL","number":3,"name":"The Heroes Favorite Hot Dogs","cost":0,"ability":"Recover a Hot Dog from your Discard Pile for every Hero in your Discard Pile.","dbs":13},{"id":"U---PL-67","release":"U","type":"PL","number":67,"name":"Burnout","cost":1,"ability":"Discard 1 Hero with a Fire weapon from your hand. Your opponent's Hero gets -15 this Battle.","dbs":12},{"id":"A---PL-60","release":"A","type":"PL","number":60,"name":"Curveball","cost":3,"ability":"Replace your Hero with any Hero from your hand and draw 1 Hero.","dbs":12},{"id":"G---PL-49","release":"G","type":"PL","number":49,"name":"Different Leagues","cost":1,"ability":"If your Hero's weapon type is different from your opponent's, their Hero gets -10.","dbs":12},{"id":"G---BPL-12","release":"G","type":"BPL","number":12,"name":"Fair Trade","cost":1,"ability":"Your opponent Recovers 1 Hot Dog. Draw 2 Plays.","dbs":12},{"id":"A---PL-62","release":"A","type":"PL","number":62,"name":"Going Back to Back","cost":3,"ability":"This Hero gets any extra Power your previous Hero had.","dbs":12},{"id":"A---PL-84","release":"A","type":"PL","number":84,"name":"Heads-Up!","cost":2,"ability":"Flip a coin 4 times; your Hero gets +5 each time the coin lands on heads.","dbs":12},{"id":"HTD-35","release":"HTD","type":"","number":35,"name":"Only Fire - htd","cost":2,"ability":"For the rest of the game all Heroes have Fire Weapons.","dbs":12},{"id":"HTD-36","release":"HTD","type":"","number":36,"name":"Only Ice - htd","cost":2,"ability":"For the rest of the game all Heroes have Ice Weapons.","dbs":12},{"id":"U---PL-11","release":"U","type":"PL","number":11,"name":"Plan Ahead","cost":4,"ability":"Choose a future Battle. When your Hero in that Battle is revealed, it gets +35.","dbs":12},{"id":"HTD-50","release":"HTD","type":"","number":50,"name":"Rebuild - htd","cost":1,"ability":"If you lost the previous Battle, Discard all Heroes in your hand and draw 4 new Heroes from your Hero Deck.","dbs":12},{"id":"A---PL-73","release":"A","type":"PL","number":73,"name":"Shooters Shoot","cost":2,"ability":"Flip a coin 4 times; your opponent's Hero gets -5 each time the coin lands on tails.","dbs":12},{"id":"A---PL-44","release":"A","type":"PL","number":44,"name":"Steel Flipper","cost":0,"ability":"Flip a coin: If heads, your Hero gets +10 power. If your Hero's weapon is Steel, draw 1 Play as well.","dbs":12},{"id":"A---PL-75","release":"A","type":"PL","number":75,"name":"To Fight Another Day","cost":2,"ability":"If you lost the previous Battle, your Hero in the active Battle gets +20.","dbs":12},{"id":"HTD-1","release":"HTD","type":"","number":1,"name":"Transfer Portal - htd","cost":2,"ability":"Your Hero loses -30. Your Hero in the next Battle gets +30.","dbs":12},{"id":"HTD-18","release":"HTD","type":"","number":18,"name":"Brothers In Arms - htd","cost":1,"ability":"If your opponent has played a Hero with the same weapon type as yours, your Hero gets +20.","dbs":11},{"id":"U---PL-88","release":"U","type":"PL","number":88,"name":"Cursed Coin","cost":2,"ability":"Flip a coin 3 times; opponent's Hero gets -10 each time the coin lands on heads.","dbs":11},{"id":"G---PL-70","release":"G","type":"PL","number":70,"name":"Good Guess","cost":1,"ability":"Name a weapon type. If your opponent's next Hero has that weapon type, that Hero gets -15.","dbs":11},{"id":"A---PL-20","release":"A","type":"PL","number":20,"name":"Leave It To Fate","cost":3,"ability":"Both players must send their Hero to the Discard Pile and replace them with the top card from their Hero Deck.","dbs":11},{"id":"U---PL-64","release":"U","type":"PL","number":64,"name":"Nasty Or Nada","cost":1,"ability":"Roll a dice 3 times. Your Hero gets +30 if you roll a 6.","dbs":11},{"id":"A---PL-54","release":"A","type":"PL","number":54,"name":"Only Steel","cost":3,"ability":"For the rest of the game all Heroes have Steel Weapons.","dbs":11},{"id":"A---PL-96","release":"A","type":"PL","number":96,"name":"Worth The Risk?","cost":1,"ability":"Roll a dice: if you get a 1 or 6, your Hero's power drops to 0. If you roll a 2-5, you gain +25.","dbs":11},{"id":"G---PL-67","release":"G","type":"PL","number":67,"name":"3-Dog-Special","cost":0,"ability":"If you have exactly 3 Hot Dogs left, your Hero gets +10.","dbs":10},{"id":"G---PL-33","release":"G","type":"PL","number":33,"name":"Comeback Time","cost":1,"ability":"If you lost the 2 previous Battles, your Hero gets +15.","dbs":10},{"id":"A---PL-38","release":"A","type":"PL","number":38,"name":"Fairweather Fan","cost":1,"ability":"Play this in Battle 5 or later. Your Hero gets +5 for each Battle you've won.","dbs":10},{"id":"A---PL-23","release":"A","type":"PL","number":23,"name":"Fire Boost","cost":2,"ability":"For the rest of the game, all Heroes with Fire weapons get +10.","dbs":10},{"id":"A---PL-37","release":"A","type":"PL","number":37,"name":"Heads I Win, Tails You Lose","cost":1,"ability":"Flip a coin: If heads, your Hero gets +15. If tails, your opponent's Hero loses -5.","dbs":10},{"id":"G---PL-24","release":"G","type":"PL","number":24,"name":"Hexvantage","cost":1,"ability":"Your Hero gets +5 Power. If it has a Hex weapon, it gets +20.","dbs":10},{"id":"G---BPL-1","release":"G","type":"BPL","number":1,"name":"Hot Dog Thief","cost":0,"ability":"Your opponent loses 1 Hot Dog. You gain 1 Hot Dog.","dbs":10},{"id":"A---PL-21","release":"A","type":"PL","number":21,"name":"Ice Boost","cost":2,"ability":"For the rest of the game, all Heroes with Ice weapons get +10.","dbs":10},{"id":"HTD-48","release":"HTD","type":"","number":48,"name":"Late Game Lockdown - htd","cost":1,"ability":"Your opponent cannot Substitute in Battle 7.","dbs":10},{"id":"A---PL-69","release":"A","type":"PL","number":69,"name":"Loan Sharked","cost":2,"ability":"For the rest of the Game if a coin is flipped, lower the opponent's Hero in the active Battle by -5.","dbs":10},{"id":"U---BPL-7","release":"U","type":"BPL","number":7,"name":"Lunch Break","cost":1,"ability":"Discard a Hero with a Glow weapon from your hand and Recover 3 Hot Dogs.","dbs":10},{"id":"A---PL-71","release":"A","type":"PL","number":71,"name":"Rally Cap","cost":2,"ability":"If your Hero in this Battle is losing by 15 or more it gets +20.","dbs":10},{"id":"A---BPL-20","release":"A","type":"BPL","number":20,"name":"Restricted List","cost":1,"ability":"Next Battle, your opponent can only run a maximum of 1 Play.","dbs":10},{"id":"U---PL-37","release":"U","type":"PL","number":37,"name":"Fire Comeback","cost":2,"ability":"Swap your Hero with a Fire weapon Hero in your Discard Pile.","dbs":9},{"id":"U---PL-46","release":"U","type":"PL","number":46,"name":"Frozen Flip","cost":1,"ability":"Discard a Hero with an Ice weapon from your hand and flip a coin. If it's heads, your Hero gets +20.","dbs":9},{"id":"U---PL-36","release":"U","type":"PL","number":36,"name":"Icy Comeback","cost":2,"ability":"Swap your Hero with an Ice weapon Hero in your Discard Pile.","dbs":9},{"id":"G---PL-7","release":"G","type":"PL","number":7,"name":"Lineup Pressure","cost":2,"ability":"Your opponent's Hero gets -5 for each Hero you've revealed so far.","dbs":9},{"id":"A---PL-36","release":"A","type":"PL","number":36,"name":"Make It, Take It","cost":1,"ability":"For the rest of the game, whenever you win a Battle, your Hero in the next Battle gets +5.","dbs":9},{"id":"U---PL-68","release":"U","type":"PL","number":68,"name":"Molten Steel","cost":1,"ability":"For the rest of the game, if your Hero has a Steel weapon, it changes to a Fire weapon.","dbs":9},{"id":"U---PL-35","release":"U","type":"PL","number":35,"name":"Radiant Comeback","cost":2,"ability":"Swap your Hero with a Glow weapon Hero in your Discard Pile.","dbs":9},{"id":"HTD-10","release":"HTD","type":"","number":10,"name":"Blind Substitution - htd","cost":2,"ability":"Discard your Hero. Replace it with the top card of your Hero Deck.","dbs":8},{"id":"G---BPL-3","release":"G","type":"BPL","number":3,"name":"Bonus Recovery","cost":0,"ability":"For the rest of the game, whenever a Player Recovers any Hot Dogs, they Recover an extra Hot Dog. (Ex. If you would Recover 3 Hot Dogs, you get 4.)","dbs":8},{"id":"U---PL-86","release":"U","type":"PL","number":86,"name":"Brothers In Arms","cost":2,"ability":"If your opponent has played a Hero with the same weapon type as yours, your Hero gets +20.","dbs":8},{"id":"HTD-15","release":"HTD","type":"","number":15,"name":"Burning Fever - htd","cost":1,"ability":"If your Hero has a Fire weapon, it can't drop below its current Power.","dbs":8},{"id":"U---PL-77","release":"U","type":"PL","number":77,"name":"Chrome Will","cost":1,"ability":"If your Hero has a Steel weapon, it can't drop below its current Power.","dbs":8},{"id":"U---PL-20","release":"U","type":"PL","number":20,"name":"Eternal Flame","cost":4,"ability":"For the rest of the game, Heroes with Fire weapons can't lose Power.","dbs":8},{"id":"U---BPL-11","release":"U","type":"BPL","number":11,"name":"Glow-Up","cost":0,"ability":"If your Hero has a Glow weapon, it gets +20.","dbs":8},{"id":"HTD-5","release":"HTD","type":"","number":5,"name":"Lost Plays - htd","cost":0,"ability":"Both Players Discard the top 3 Plays of their Playbook.","dbs":8},{"id":"U---PL-80","release":"U","type":"PL","number":80,"name":"Lucky Gum","cost":1,"ability":"If your Hero has a Gum weapon, flip a coin. If it's heads, your Hero gets +20.","dbs":8},{"id":"HTD-6","release":"HTD","type":"","number":6,"name":"One-And-One - htd","cost":0,"ability":"Flip a coin. If heads, your Hero gets +10. You may do this a second and final time if it lands on heads.","dbs":8},{"id":"A---PL-52","release":"A","type":"PL","number":52,"name":"Only Fire","cost":3,"ability":"For the rest of the game all Heroes have Fire Weapons.","dbs":8},{"id":"A---PL-53","release":"A","type":"PL","number":53,"name":"Only Ice","cost":3,"ability":"For the rest of the game all Heroes have Ice Weapons.","dbs":8},{"id":"A---PL-28","release":"A","type":"PL","number":28,"name":"Pick On Someone Your Own Size","cost":2,"ability":"Your Hero now has the same power as your Opponent's Hero's current power.","dbs":8},{"id":"A---PL-93","release":"A","type":"PL","number":93,"name":"Rebuild","cost":2,"ability":"If you lost the previous Battle, Discard all Heroes in your hand and draw 4 new Heroes from your Hero Deck.","dbs":8},{"id":"HTD-23","release":"HTD","type":"","number":23,"name":"Roster Cuts - htd","cost":2,"ability":"Discard the top 3 Heroes of your Hero Deck.","dbs":8},{"id":"G---PL-2","release":"G","type":"PL","number":2,"name":"The Closer","cost":4,"ability":"If this is used in Battle 7, your Hero gets +40. If it's used in any other Battle, your Hero gets +25.","dbs":8},{"id":"A---PL-79","release":"A","type":"PL","number":79,"name":"1-4-1 Hero","cost":1,"ability":"Draw a Hero from your Hero Deck.","dbs":7},{"id":"G---PL-72","release":"G","type":"PL","number":72,"name":"10 For A Sub","cost":1,"ability":"If you Substituted this Battle, your Hero gets +10.","dbs":7},{"id":"A---PL-26","release":"A","type":"PL","number":26,"name":"Bigger Steel Roll","cost":2,"ability":"If your Hero has a Steel weapon, roll a dice. If you roll a 5 or 6 your Hero gets +50.","dbs":7},{"id":"G---PL-51","release":"G","type":"PL","number":51,"name":"Dog Gone Flip","cost":0,"ability":"Flip a coin. If heads, you Recover 3 Hot Dogs. If tails, your opponent Recovers 3 Hot Dogs.","dbs":7},{"id":"U---PL-83","release":"U","type":"PL","number":83,"name":"Firework","cost":1,"ability":"If your Hero has a Fire weapon, flip a coin. If it's heads, your Hero gets +20.","dbs":7},{"id":"U---PL-81","release":"U","type":"PL","number":81,"name":"Flip & Glow","cost":1,"ability":"If your Hero has a Glow weapon, flip a coin. If it's heads, your Hero gets +20.","dbs":7},{"id":"A---PL-77","release":"A","type":"PL","number":77,"name":"Gavel of Justice","cost":4,"ability":"Lower the opponent's Hero by -30.","dbs":7},{"id":"U---PL-51","release":"U","type":"PL","number":51,"name":"Hollow Bat","cost":2,"ability":"Roll a dice. If it lands on 3-6, your Hero gets +25. If it lands on 1 or 2, your Hero gets -25.","dbs":7},{"id":"U---PL-84","release":"U","type":"PL","number":84,"name":"Ice Blast","cost":1,"ability":"If your Hero has an Ice weapon, flip a coin. If it's heads, your Hero gets +20.","dbs":7},{"id":"HTD-24","release":"HTD","type":"","number":24,"name":"Ice Climber - htd","cost":1,"ability":"If your Hero has an Ice weapon and your opponent has Steel, your Hero gets +35.","dbs":7},{"id":"U---PL-72","release":"U","type":"PL","number":72,"name":"Icevantage","cost":1,"ability":"If your opponent's Hero has an Ice weapon, your Hero gets +15.","dbs":7},{"id":"HTD-26","release":"HTD","type":"","number":26,"name":"Last-Minute Re-Org","cost":2,"ability":"Swap your Hero with another one of your face-down Heroes from a future Battle.","dbs":7},{"id":"A---PL-86","release":"A","type":"PL","number":86,"name":"Late Game Lockdown","cost":2,"ability":"Your opponent cannot Substitute in Battle 7.","dbs":7},{"id":"A---PL-43","release":"A","type":"PL","number":43,"name":"Recycle For 5","cost":2,"ability":"Your Hero gets +5 power for every card in your Discard Pile, except Hot Dogs.","dbs":7},{"id":"U---PL-70","release":"U","type":"PL","number":70,"name":"Rusted Edge","cost":1,"ability":"If your opponent's Hero has a Steel weapon, your Hero gets +15.","dbs":7},{"id":"A---BPL-18","release":"A","type":"BPL","number":18,"name":"Sacrificed Heroes","cost":0,"ability":"Discard 2 Heroes from your hand and Recover 1 Hot Dog from your Discard Pile.","dbs":7},{"id":"HTD-25","release":"HTD","type":"","number":25,"name":"Smitty - htd","cost":1,"ability":"If your Hero has a Fire weapon and your opponent has Steel, your Hero gets +35.","dbs":7},{"id":"HTD-22","release":"HTD","type":"","number":22,"name":"Stain-Less-Steel - htd","cost":1,"ability":"If your opponent's Hero has a Steel weapon, give it -15.","dbs":7},{"id":"U---PL-82","release":"U","type":"PL","number":82,"name":"Steel Smash","cost":1,"ability":"If your Hero has a Steel weapon, flip a coin. If it's heads, your Hero gets +20.","dbs":7},{"id":"G---BPL-16","release":"G","type":"BPL","number":16,"name":"Surging Power","cost":0,"ability":"This can only be played in Battle 5 or 6. Your Hero gets +20. If you lose this battle, Discard 2 Plays from your hand.","dbs":7},{"id":"G---PL-57","release":"G","type":"PL","number":57,"name":"Toss And Trade","cost":2,"ability":"Flip a coin. If heads, send your current Hero to the Discard Pile and replace it with one from your hand. If tails, Discard 1 Play from your hand.","dbs":7},{"id":"U---PL-33","release":"U","type":"PL","number":33,"name":"Transfer Portal","cost":3,"ability":"Your Hero loses -30. Your Hero in the next Battle gets +30.","dbs":7},{"id":"G---PL-74","release":"G","type":"PL","number":74,"name":"Weapon Mixer","cost":2,"ability":"Your Hero gets +5 for every different weapon type revealed this game.","dbs":7},{"id":"U---PL-75","release":"U","type":"PL","number":75,"name":"Burning Fever","cost":2,"ability":"If your Hero has a Fire weapon, it can't drop below its current Power.","dbs":6},{"id":"G---PL-65","release":"G","type":"PL","number":65,"name":"Discard Or 10","cost":0,"ability":"Flip a coin. If heads, your Hero gets +10. If tails, you must Discard a random Play from your hand.","dbs":6},{"id":"U---PL-71","release":"U","type":"PL","number":71,"name":"Fire Hose","cost":1,"ability":"If your opponent's Hero has a Fire weapon, your Hero gets +15.","dbs":6},{"id":"A---PL-24","release":"A","type":"PL","number":24,"name":"Fire Roll","cost":2,"ability":"If your Hero has a Fire weapon, roll a dice. If you roll a 4-6, your Hero gets +30.","dbs":6},{"id":"A---PL-25","release":"A","type":"PL","number":25,"name":"Ice Roll","cost":2,"ability":"If your Hero has an Ice weapon, roll a dice. If you roll a 4-6 your Hero gets +30.","dbs":6},{"id":"A---PL-98","release":"A","type":"PL","number":98,"name":"Immunity","cost":1,"ability":"This Hero can't be affected in any way by your opponent's Plays.","dbs":6},{"id":"U---PL-95","release":"U","type":"PL","number":95,"name":"Last-Minute Re-Org","cost":3,"ability":"Swap your Hero with another one of your face-down Heroes from a future Battle.","dbs":6},{"id":"U---PL-73","release":"U","type":"PL","number":73,"name":"Late Hit","cost":3,"ability":"This must be used in Battle 7, your opponent's Hero gets -35.","dbs":6},{"id":"U---PL-53","release":"U","type":"PL","number":53,"name":"Lost Plays","cost":1,"ability":"Both Players Discard the top 3 Plays of their Playbook.","dbs":6},{"id":"U---PL-54","release":"U","type":"PL","number":54,"name":"One-And-One","cost":1,"ability":"Flip a coin. If heads, your Hero gets +10. You may do this a second and final time if it lands on heads.","dbs":6},{"id":"A---PL-97","release":"A","type":"PL","number":97,"name":"Opps' Choice","cost":1,"ability":"Send your Hero to the Discard Pile. Reveal the top 2 Heroes from your deck. Your opponent picks 1 to join the battle, and the other goes to your Discard Pile.","dbs":6},{"id":"G---PL-62","release":"G","type":"PL","number":62,"name":"Play Surge","cost":1,"ability":"If your opponent uses 3 or more Plays this Battle, your Hero gets +15.","dbs":6},{"id":"A---BPL-19","release":"A","type":"BPL","number":19,"name":"Sacrifice it All to Win","cost":2,"ability":"Reduce your Hero's power to 0. In the next Battle, your first Play is free.","dbs":6},{"id":"U---PL-48","release":"U","type":"PL","number":48,"name":"Stainless Flip","cost":1,"ability":"Discard a Hero with a Steel weapon from your hand and flip a coin. If it's heads, your Hero gets +25.","dbs":6},{"id":"U---PL-60","release":"U","type":"PL","number":60,"name":"Steel Helmet","cost":0,"ability":"If your Hero has a Steel weapon, flip a coin. If heads, your Hero can't lose any more Power this Battle.","dbs":6},{"id":"U---PL-42","release":"U","type":"PL","number":42,"name":"Sticky Strength","cost":2,"ability":"If your Hero has a Gum weapon, your opponent can't Substitute for the next 2 Battles.","dbs":6},{"id":"A---BPL-6","release":"A","type":"BPL","number":6,"name":"3 Weapon Streak","cost":2,"ability":"If your Heroes in the 2 previous Battles had the same weapon type as this one, your Hero gets +25.","dbs":5},{"id":"G---BPL-18","release":"G","type":"BPL","number":18,"name":"A Game Of War","cost":0,"ability":"Both Players reveal the top card of their Hero Deck. Whichever Player reveals a Hero with higher Power Draws 1 Play. Both Players Discard their revealed Heroes.","dbs":5},{"id":"U---PL-30","release":"U","type":"PL","number":30,"name":"Another Man's Treasure","cost":3,"ability":"Swap your Hero with a Hero in your Discard Pile.","dbs":5},{"id":"G---PL-69","release":"G","type":"PL","number":69,"name":"Bench Scout","cost":1,"ability":"Reveal the top 4 Heroes of your Hero Deck. Add 1 to your hand. Shuffle the rest into your Hero Deck.","dbs":5},{"id":"U---PL-61","release":"U","type":"PL","number":61,"name":"Blind Substitution","cost":3,"ability":"Discard your Hero. Replace it with the top card of your Hero Deck.","dbs":5},{"id":"U---BPL-9","release":"U","type":"BPL","number":9,"name":"Cold Pressure","cost":2,"ability":"For the rest of the game, any time you have a Hero with an Ice weapon in the active Battle, your opponent's Hero loses -10.","dbs":5},{"id":"A---PL-82","release":"A","type":"PL","number":82,"name":"Crystal Ball","cost":0,"ability":"Pick a number 1-6, then your opponent picks a different number 1-6; roll a die; if it lands on either player's number their Hero gets +30.","dbs":5},{"id":"U---PL-32","release":"U","type":"PL","number":32,"name":"Double Replacement","cost":1,"ability":"Discard one Hero from your hand. Draw 2 new Heroes.","dbs":5},{"id":"HTD-20","release":"HTD","type":"","number":20,"name":"Fire Extinguisher - htd","cost":1,"ability":"If your opponent's Hero has a Fire weapon, give it -20.","dbs":5},{"id":"U---PL-47","release":"U","type":"PL","number":47,"name":"Flaming Flip","cost":1,"ability":"Discard a Hero with a Fire weapon from your hand and flip a coin. If it's heads, your Hero gets +20.","dbs":5},{"id":"U---PL-25","release":"U","type":"PL","number":25,"name":"Frozen Lineup","cost":0,"ability":"If your Hero has an Ice weapon, your opponent can't Substitute next Battle.","dbs":5},{"id":"HTD-16","release":"HTD","type":"","number":16,"name":"Frozen Resolve - htd","cost":1,"ability":"If your Hero has an Ice weapon, it can't drop below its current Power.","dbs":5},{"id":"U---BPL-4","release":"U","type":"BPL","number":4,"name":"Ghost Dog","cost":0,"ability":"This is now a Hot Dog. It can't be removed by your opponent's Plays. Discard this Play when you spend it.","dbs":5},{"id":"A---BPL-15","release":"A","type":"BPL","number":15,"name":"Glow Draw Play","cost":0,"ability":"If your Hero in this Battle has an Glow weapon, draw a Play.","dbs":5},{"id":"G---PL-4","release":"G","type":"PL","number":4,"name":"Hero Reset","cost":2,"ability":"Your Hero's Power returns to its starting Power.","dbs":5},{"id":"G---BPL-21","release":"G","type":"BPL","number":21,"name":"Hex Draw","cost":1,"ability":"If your Hero has a Hex weapon, Draw 2 Plays.","dbs":5},{"id":"U---BPL-15","release":"U","type":"BPL","number":15,"name":"Hot Dog Stock Exchange","cost":1,"ability":"This must be played in Battle 7. Your opponent switches their number of unused Hot Dogs with you.","dbs":5},{"id":"A---PL-47","release":"A","type":"PL","number":47,"name":"I Get Some, You Get Some.","cost":1,"ability":"Your Hero gets +10, but your opponent's Hero in the next Battle also gets +10.","dbs":5},{"id":"U---PL-93","release":"U","type":"PL","number":93,"name":"Ice Climber","cost":2,"ability":"If your Hero has an Ice weapon and your opponent has Steel, your Hero gets +35.","dbs":5},{"id":"HTD-21","release":"HTD","type":"","number":21,"name":"Ice Pick - htd","cost":1,"ability":"If your opponent's Hero has an Ice weapon, give it -20.","dbs":5},{"id":"HTD-53","release":"HTD","type":"","number":53,"name":"Indestructible - htd","cost":0,"ability":"This Hero can't have its power reduced by an opponent's Play.","dbs":5},{"id":"A---PL-85","release":"A","type":"PL","number":85,"name":"Jump Ball","cost":0,"ability":"Flip a coin; if heads, your Hero gets +10, if tails, your Hero gets -10.","dbs":5},{"id":"A---PL-34","release":"A","type":"PL","number":34,"name":"Luck Of The Draw","cost":0,"ability":"Both players roll a dice; whoever rolls the highest number gets to play the top card from their Playbook for free if able.","dbs":5},{"id":"A---PL-87","release":"A","type":"PL","number":87,"name":"Lucky 7","cost":0,"ability":"Roll a die two times; if the numbers add up to 7 your Hero gets +100; if any other number you must Discard a random Hero from your hand.","dbs":5},{"id":"U---BPL-25","release":"U","type":"BPL","number":25,"name":"Lunch Table","cost":2,"ability":"Give your Hero +20. All players get 2 Hot Dogs back from their Discard Pile at the start of next Battle.","dbs":5},{"id":"A---BPL-1","release":"A","type":"BPL","number":1,"name":"Member Bounce","cost":3,"ability":"All your Heroes get +10 for the rest of the game.","dbs":5},{"id":"U---PL-45","release":"U","type":"PL","number":45,"name":"Might Of The Underdog","cost":1,"ability":"Draw the top Hero of your Hero Deck and Reveal it to your opponent. If its Power is 120 or lower, your Hero gets +30.","dbs":5},{"id":"U---BPL-2","release":"U","type":"BPL","number":2,"name":"My Idol","cost":2,"ability":"Set your Hero's power to the same as your opponent's Hero's starting power.","dbs":5},{"id":"A---BPL-9","release":"A","type":"BPL","number":9,"name":"Power Drain","cost":2,"ability":"Your opponent's Hero loses -10, and your Hero gets +5 for each Hero in your opponent's Discard Pile.","dbs":5},{"id":"HTD-60","release":"HTD","type":"","number":60,"name":"QB Sneak - htd","cost":0,"ability":"If this Battle is tied, your Hero gets +1.","dbs":5},{"id":"A---BPL-5","release":"A","type":"BPL","number":5,"name":"Roller Dogs","cost":1,"ability":"Roll a dice to Recover Hot Dogs from your Discard Pile: 1 or 2 = 1 Hot Dog, 3 or 4 = 2 Hot Dogs, 5 or 6 = 3 Hot Dogs.","dbs":5},{"id":"U---PL-92","release":"U","type":"PL","number":92,"name":"Roster Cuts","cost":3,"ability":"Discard the top 3 Heroes of your Hero Deck.","dbs":5},{"id":"U---BPL-8","release":"U","type":"BPL","number":8,"name":"Scorching Pressure","cost":2,"ability":"For the rest of the game, any time you have a Hero with a Fire weapon in the active Battle, your opponent's Hero loses -10.","dbs":5},{"id":"U---PL-94","release":"U","type":"PL","number":94,"name":"Smitty","cost":2,"ability":"If your Hero has a Fire weapon and your opponent has Steel, your Hero gets +35.","dbs":5},{"id":"U---PL-91","release":"U","type":"PL","number":91,"name":"Stain-Less-Steel","cost":2,"ability":"If your opponent's Hero has a Steel weapon, give it -15.","dbs":5},{"id":"U---PL-27","release":"U","type":"PL","number":27,"name":"Steel Cage","cost":0,"ability":"If your Hero has a Steel weapon, your opponent can't Substitute next Battle.","dbs":5},{"id":"U---BPL-10","release":"U","type":"BPL","number":10,"name":"Steel Pressure","cost":2,"ability":"For the rest of the game, any time you have a Hero with a Steel weapon in the active Battle, your opponent's Hero loses -10.","dbs":5},{"id":"A---BPL-2","release":"A","type":"BPL","number":2,"name":"The 12th Man","cost":3,"ability":"All your Opponent's Heroes get -10 for the rest of the game.","dbs":5},{"id":"U---PL-98","release":"U","type":"PL","number":98,"name":"Three Strikes You're Out","cost":1,"ability":"Discard a Hero from your hand. Flip a coin 3 times. If it lands on heads 3 times in a row, set opponent's Hero's Power to 0.","dbs":5},{"id":"U---PL-19","release":"U","type":"PL","number":19,"name":"Unbreakable Ice","cost":4,"ability":"For the rest of the game, Heroes with Ice weapons can't lose Power.","dbs":5},{"id":"G---PL-32","release":"G","type":"PL","number":32,"name":"Big Time Recruit","cost":1,"ability":"Reveal the top 3 Heroes of your Hero Deck. Choose one to add to your hand, then shuffle the rest back into your Hero Deck.","dbs":4},{"id":"G---BPL-4","release":"G","type":"BPL","number":4,"name":"Called Shot","cost":3,"ability":"Declare the name of 1 Play. If your opponent has a Play in their hand with that name, they must Discard it.","dbs":4},{"id":"G---PL-34","release":"G","type":"PL","number":34,"name":"Dice Duel","cost":0,"ability":"Both Players roll a dice. Whoever rolls a higher number gets +25. If tied, both get -10.","dbs":4},{"id":"U---PL-97","release":"U","type":"PL","number":97,"name":"Discard Rebate","cost":0,"ability":"Shuffle a Hero from your Discard Pile back into your Hero Deck.","dbs":4},{"id":"U---PL-62","release":"U","type":"PL","number":62,"name":"Double Down","cost":0,"ability":"Flip a coin twice. If it lands on heads both times, your Hero gets +20. If both flips are tails, your Hero loses -40. (Nothing happens for any other result.)","dbs":4},{"id":"A---PL-83","release":"A","type":"PL","number":83,"name":"Double or Nothin'","cost":1,"ability":"Flip a coin twice; if both land on heads, play the top card from your Hero Deck and add its power to the active Hero in this Battle.","dbs":4},{"id":"U---PL-99","release":"U","type":"PL","number":99,"name":"Even Money","cost":0,"ability":"Flip a coin. If heads, your Hero gets +20. If tails, opponent's Hero gets +20.","dbs":4},{"id":"U---PL-89","release":"U","type":"PL","number":89,"name":"Fire Extinguisher","cost":2,"ability":"If your opponent's Hero has a Fire weapon, give it -20.","dbs":4},{"id":"U---PL-76","release":"U","type":"PL","number":76,"name":"Frozen Resolve","cost":2,"ability":"If your Hero has an Ice weapon, it can't drop below its current Power.","dbs":4},{"id":"U---PL-79","release":"U","type":"PL","number":79,"name":"Hex Flipper","cost":1,"ability":"If your Hero has a Hex weapon, flip a coin. If it's heads, your Hero gets +20.","dbs":4},{"id":"U---PL-90","release":"U","type":"PL","number":90,"name":"Ice Pick","cost":2,"ability":"If your opponent's Hero has an Ice weapon, give it -20.","dbs":4},{"id":"U---BPL-5","release":"U","type":"BPL","number":5,"name":"Incendiary Dog","cost":3,"ability":"This must be played on or after Battle 4. You and your opponent both lose 1 Hot Dog at the start of each Battle.","dbs":4},{"id":"A---PL-58","release":"A","type":"PL","number":58,"name":"Indestructible","cost":1,"ability":"This Hero can't have its power reduced by an opponent's Play.","dbs":4},{"id":"G---PL-58","release":"G","type":"PL","number":58,"name":"Lucky Shot","cost":1,"ability":"Flip a coin and roll a dice. If the coin lands on heads and you roll a 4-6 on the dice, your Hero gets +30. If not, Discard 2 Plays from your hand.","dbs":4},{"id":"U---PL-74","release":"U","type":"PL","number":74,"name":"Pre-Game Ritual","cost":1,"ability":"Flip a coin 3 times; your Hero gets +15 if the coin lands on heads 2 or more times.","dbs":4},{"id":"U---BPL-18","release":"U","type":"BPL","number":18,"name":"Pre-Game Spy","cost":2,"ability":"Look at 2 random Plays in your opponent's hand.","dbs":4},{"id":"A---PL-100","release":"A","type":"PL","number":100,"name":"QB Sneak","cost":1,"ability":"If this Battle is tied, your Hero gets +1.","dbs":4},{"id":"U---PL-56","release":"U","type":"PL","number":56,"name":"Risky Substitution","cost":1,"ability":"Flip a coin. If heads, you can replace the Hero in the active Battle with one from your hand.","dbs":4},{"id":"U---PL-26","release":"U","type":"PL","number":26,"name":"Torched","cost":0,"ability":"If your Hero has a Fire weapon, your opponent can't Substitute next Battle.","dbs":4},{"id":"G---BPL-25","release":"G","type":"BPL","number":25,"name":"Transparency Clause","cost":2,"ability":"Choose up to 2 Plays in your opponent's hand. Your opponent reveals them.","dbs":4},{"id":"A---PL-94","release":"A","type":"PL","number":94,"name":"Waiver Wire Pickup","cost":2,"ability":"Search your Hero Deck for any Hero with up to 100 power and add it to your hand.","dbs":4},{"id":"A---BPL-17","release":"A","type":"BPL","number":17,"name":"Bundle Deal","cost":0,"ability":"Your next Play costs 1 less Hot Dog.","dbs":3},{"id":"A---BPL-16","release":"A","type":"BPL","number":16,"name":"Gum Draw Play","cost":0,"ability":"If your Hero in this Battle has a Gum weapon, draw a Play.","dbs":3},{"id":"U---BPL-24","release":"U","type":"BPL","number":24,"name":"High Turnover","cost":2,"ability":"If you have 3 or more Heroes in your Discard Pile, give your Hero +25.","dbs":3},{"id":"G---BPL-17","release":"G","type":"BPL","number":17,"name":"Honorable","cost":1,"ability":"You get Honors next turn. Draw a Play.","dbs":3},{"id":"A---BPL-13","release":"A","type":"BPL","number":13,"name":"Strength in Numbers","cost":3,"ability":"Your current Hero gets +5 for every Hero and Play card in your Hand.","dbs":3},{"id":"G---BPL-14","release":"G","type":"BPL","number":14,"name":"Sub And Power-Up","cost":3,"ability":"Swap your current Hero with one from your hand. Your new Hero gets +10.","dbs":3},{"id":"U---BPL-16","release":"U","type":"BPL","number":16,"name":"Sweet Relish","cost":4,"ability":"Any of your opponent's plays which lower your Power this Battle now raise your Power by that amount.","dbs":3},{"id":"A---BPL-12","release":"A","type":"BPL","number":12,"name":"Tear a Page","cost":0,"ability":"Discard a Play from your hand and draw a new one.","dbs":3},{"id":"U---BPL-6","release":"U","type":"BPL","number":6,"name":"Ultimatum Dog","cost":5,"ability":"For the rest of the game, Players lose any Battle in which they have 0 Hot Dogs left at the end of their turn.","dbs":3},{"id":"A---BPL-22","release":"A","type":"BPL","number":22,"name":"Bench Lock","cost":1,"ability":"Your opponent can't Substitute next Battle.","dbs":2},{"id":"A---PL-99","release":"A","type":"PL","number":99,"name":"Change The Future","cost":2,"ability":"You can re-order your face-down Heroes in future Battles, but you can't look at them.","dbs":2},{"id":"U---BPL-22","release":"U","type":"BPL","number":22,"name":"Drop The Giant","cost":4,"ability":"If your opponent's Hero in the next Battle has a starting power above 160, it must be discarded and replaced with the top card of their Hero Deck.","dbs":2},{"id":"G---BPL-10","release":"G","type":"BPL","number":10,"name":"Dumpster Battle","cost":4,"ability":"If possible, both Players replace their Hero in the active Battle with a Hero from their Discard Pile.","dbs":2},{"id":"G---BPL-22","release":"G","type":"BPL","number":22,"name":"Gum Draw","cost":1,"ability":"If your Hero has a Gum weapon, Draw 2 Plays.","dbs":2},{"id":"A---PL-40","release":"A","type":"PL","number":40,"name":"Ha! Gotcha","cost":1,"ability":"Any Plays currently affecting your Hero's power now also affect your opponent's Hero in this Battle.","dbs":2},{"id":"G---BPL-11","release":"G","type":"BPL","number":11,"name":"Head Start","cost":3,"ability":"Both Heroes in this Battle return to their starting Power, then your Hero gets +10.","dbs":2},{"id":"A---BPL-10","release":"A","type":"BPL","number":10,"name":"Hero's Resolve","cost":2,"ability":"If you win this Battle, your Hero's power can't be reduced by an opponent's Play in the next 2 Battles.","dbs":2},{"id":"A---BPL-14","release":"A","type":"BPL","number":14,"name":"Hex Draw Play","cost":0,"ability":"If your Hero in this Battle has a Hex weapon, draw a Play.","dbs":2},{"id":"U---BPL-12","release":"U","type":"BPL","number":12,"name":"Lineup Randomizer","cost":5,"ability":"Your opponent must Discard their unrevealed Heroes in future Battles and replace them with the top cards from their Hero Deck in order.","dbs":2},{"id":"U---BPL-23","release":"U","type":"BPL","number":23,"name":"Low Turnover","cost":1,"ability":"If there are 0 Heroes in your Discard Pile, give your Hero +15.","dbs":2},{"id":"A---BPL-11","release":"A","type":"BPL","number":11,"name":"Return from the Depths","cost":0,"ability":"If you have 3 or more Heroes in your Discard Pile, shuffle them into your Hero Deck, then draw 2 new Heroes.","dbs":2},{"id":"U---BPL-20","release":"U","type":"BPL","number":20,"name":"Roll And Hope","cost":1,"ability":"Roll a dice. If you roll a 6, swap current Power with your opponent.","dbs":2},{"id":"U---PL-78","release":"U","type":"PL","number":78,"name":"Super Lucky","cost":1,"ability":"If your Hero has a Super weapon, flip a coin. If it's heads, your Hero gets +20.","dbs":2},{"id":"A---BPL-7","release":"A","type":"BPL","number":7,"name":"5 Weapon Streak","cost":3,"ability":"If your Heroes in the 5 previous Battles had the same weapon type as this one, your Hero gets +40.","dbs":1},{"id":"G---BPL-19","release":"G","type":"BPL","number":19,"name":"Big Spender Bonus","cost":2,"ability":"Discard the top 5 Plays of your Playbook. Your Hero gets +10 for any of those Plays with a cost of 3 or more.","dbs":1},{"id":"A---BPL-24","release":"A","type":"BPL","number":24,"name":"Risky Recovery","cost":0,"ability":"Flip a coin. If heads, Recover 3 Hot Dogs from your Discard Pile. Your opponent draws 2 Plays no matter the result.","dbs":1},{"id":"G---BPL-13","release":"G","type":"BPL","number":13,"name":"Storm The Field","cost":2,"ability":"Discard all Heroes and Plays from your hand. Your Hero gets +5 for every card discarded this way.","dbs":1},{"id":"G---BPL-20","release":"G","type":"BPL","number":20,"name":"Super Draw","cost":0,"ability":"If your Hero has a Super weapon, Draw 2 Plays.","dbs":1},{"id":"U---BPL-14","release":"U","type":"BPL","number":14,"name":"The Perfect Offense","cost":6,"ability":"Cancel every Play your opponent used this Battle.","dbs":1},{"id":"U---BPL-21","release":"U","type":"BPL","number":21,"name":"Turn the Tide","cost":4,"ability":"If you lost the first 3 Battles, give your Hero +60.","dbs":1}];

  // Build lookup indexes for O(1) search:
  // 1. By play name (normalized lowercase, no punctuation)  → array of entries
  // 2. By card number string (e.g. "PL-59", "BPL-23", "HTD-40") → array of entries
  const byName   = new Map();
  const byCardNum = new Map();

  for (const entry of raw) {
    // Derive card number string from type + number
    // HTD entries: type="" so card number = "HTD-" + number
    const cardNum = entry.type
      ? `${entry.type}-${entry.number}`           // PL-59, BPL-23
      : `HTD-${entry.number}`;                    // HTD-40

    entry._cardNum = cardNum;

    // Name index (strip punctuation, lowercase)
    const normName = entry.name.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    if (!byName.has(normName)) byName.set(normName, []);
    byName.get(normName).push(entry);

    // Card number index
    const normNum = cardNum.toLowerCase();
    if (!byCardNum.has(normNum)) byCardNum.set(normNum, []);
    byCardNum.get(normNum).push(entry);
  }

  return { raw, byName, byCardNum };
})();

// ── In-memory deck being built ─────────────────────────────────────────────
// Each entry: { card, dbsData: { dbs, cost, ability }, parallel: 'hero'|'play'|'bonus', imageBase64 }
window._deckBuilderQueue  = window._deckBuilderQueue  || [];
window._deckBuilderActive = window._deckBuilderActive || false;
// Config from setup modal: { name, tag, maxHeroes, maxPlays, maxBonus, totalTarget }
window._deckBuilderConfig = window._deckBuilderConfig || null;

// ── Ensure the Deck Building collection exists ─────────────────────────────
function ensureDeckBuildingCollection() {
  const cols = getCollections();
  if (!cols.find(c => c.id === DECK_BUILDING_COLLECTION_ID)) {
    cols.push({
      id:    DECK_BUILDING_COLLECTION_ID,
      name:  '🃏 Deck Building',
      cards: [],
      stats: { scanned: 0, free: 0, cost: 0, aiCalls: 0 }
    });
    saveCollections(cols);
    console.log('✅ Deck Building collection created');
  }
  return getCollections();
}
window.ensureDeckBuildingCollection = ensureDeckBuildingCollection;

// ── Identify parallel type ─────────────────────────────────────────────────
function getParallelType(match) {
  const p = (match.Parallel || match.pose || '').toLowerCase();
  if (p.includes('bonus')) return 'bonus';
  if (p.includes('play'))  return 'play';
  return 'hero'; // base cards and other parallels are heroes
}

// ── Local play card lookup (no external API needed) ───────────────────────
// Matches by card number first, then falls back to play name matching.
// Returns { dbs, cost, ability } or null if not found.
function lookupBobaCard(card) {
  const cardNum  = (card.cardNumber || card['Card Number'] || '').trim();
  const heroName = (card.hero       || card.Name          || '').trim();

  const normCardNum = cardNum
    .replace(/^[A-Z]+-(?=[A-Z]+-\d+$)/, '')
    .toUpperCase()
    .trim();

  const normName = heroName.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();

  let candidates = [];
  if (normCardNum) {
    candidates = BOBA_PLAY_DB.byCardNum.get(normCardNum.toLowerCase()) || [];
  }

  let match = null;
  if (candidates.length === 1) {
    match = candidates[0];
  } else if (candidates.length > 1 && normName) {
    match = candidates.find(e => {
      const eName = e.name.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
      return eName === normName ||
             normName.startsWith(eName.substring(0, Math.min(eName.length, 15)));
    }) || candidates[0];
  }

  if (!match && normName) {
    const nameMatches = BOBA_PLAY_DB.byName.get(normName);
    if (nameMatches && nameMatches.length) match = nameMatches[0];
    if (!match && normName.length >= 6) {
      const prefix = normName.substring(0, 12);
      for (const [key, entries] of BOBA_PLAY_DB.byName) {
        if (key.startsWith(prefix)) { match = entries[0]; break; }
      }
    }
  }

  if (!match) {
    console.warn('Local DB: no match for cardNum=' + normCardNum + ' name=' + heroName);
    return null;
  }

  console.log('Local DB match: ' + match.name + ' (' + match._cardNum + ') DBS:' + match.dbs);
  return { dbs: match.dbs, cost: match.cost, ability: match.ability };
}

// ── Open the Deck Builder — membership/tournament gate ──────────────────────
window.openDeckBuilder = function() {
  const hasAccess = typeof hasDeckBuilderAccess === 'function' && hasDeckBuilderAccess();

  if (!hasAccess) {
    // Non-member — show gate with tournament code option only
    if (typeof showDeckBuilderGate === 'function') {
      showDeckBuilderGate();
    } else {
      showToast('Deck Builder is a paid member feature', '🔒');
    }
    return;
  }

  // Paid/admin user — show choice: New Deck or Tournament Code
  showDeckBuilderChoice();
};

// ── Deck Builder Choice — New Deck vs Tournament Code ─────────────────────
function showDeckBuilderChoice() {
  document.getElementById('deckBuilderChoiceModal')?.remove();

  const html = `
  <div class="modal active" id="deckBuilderChoiceModal">
    <div class="modal-backdrop" id="deckBuilderChoiceBackdrop"></div>
    <div class="modal-content" style="max-width:380px;">
      <div class="modal-header">
        <h2>🃏 Deck Builder</h2>
        <button class="modal-close" id="deckBuilderChoiceClose">×</button>
      </div>
      <div class="modal-body" style="padding:24px;text-align:center;">
        <p style="font-size:13px;color:#9ca3af;margin:0 0 20px;">
          Create a new deck from scratch or enter a tournament code.
        </p>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <button id="deckChoiceNewDeck" style="
            padding:14px;border-radius:12px;border:none;cursor:pointer;
            font-size:15px;font-weight:700;font-family:inherit;
            background:linear-gradient(135deg,#f59e0b,#d97706);color:#0d1524;
            box-shadow:0 4px 14px rgba(245,158,11,0.3);">
            ✨ New Deck
          </button>
          <button id="deckChoiceTournament" style="
            padding:14px;border-radius:12px;border:1.5px solid #6366f1;cursor:pointer;
            font-size:15px;font-weight:700;font-family:inherit;
            background:transparent;color:#a5b4fc;">
            🏆 Enter Tournament Code
          </button>
        </div>
      </div>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', html);

  const closeModal = () => document.getElementById('deckBuilderChoiceModal')?.remove();
  document.getElementById('deckBuilderChoiceClose')?.addEventListener('click', closeModal);
  document.getElementById('deckBuilderChoiceBackdrop')?.addEventListener('click', closeModal);

  document.getElementById('deckChoiceNewDeck')?.addEventListener('click', () => {
    closeModal();
    window._deckBuilderActive = true;
    window._deckBuilderQueue  = [];
    window._deckBuilderConfig = null;
    window._activeTournament  = null;
    showDeckSetupModal();
  });

  document.getElementById('deckChoiceTournament')?.addEventListener('click', () => {
    closeModal();
    if (typeof showDeckBuilderGate === 'function') {
      showDeckBuilderGate();
    } else {
      showToast('Tournament module not loaded', '⚠️');
    }
  });
}

// ── Deck Setup Modal — collect name + composition before scanning ────────────
function showDeckSetupModal() {
  document.getElementById('deckSetupModal')?.remove();

  const html = `
  <div class="modal active" id="deckSetupModal">
    <div class="modal-backdrop" id="deckSetupBackdrop"></div>
    <div class="modal-content" style="max-width:420px;">
      <div class="modal-header">
        <h2>🃏 New Deck</h2>
        <button class="modal-close" id="deckSetupClose">×</button>
      </div>
      <div class="modal-body" style="padding:20px;">
        <p style="font-size:13px;color:#6b7280;margin:0 0 16px;">
          Name your deck and set how many cards you plan to add.
          The name will be applied as a tag to all cards in this deck.
        </p>

        <label for="deckSetupName" style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">Deck Name</label>
        <input type="text" id="deckSetupName"
               placeholder="e.g. Fire Deck v1, Tournament Build..."
               autocomplete="off" autocorrect="off" autocapitalize="words" spellcheck="false"
               style="width:100%;box-sizing:border-box;padding:11px 14px;border:1.5px solid #d1d5db;
                      border-radius:10px;font-size:15px;font-family:inherit;margin-bottom:4px;">
        <div id="deckSetupNameError" style="color:#ef4444;font-size:12px;margin-bottom:12px;display:none;"></div>

        <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:8px;">Deck Composition</div>
        <div style="display:flex;gap:10px;margin-bottom:6px;">
          <div style="flex:1;text-align:center;">
            <label for="deckSetupHeroes" style="font-size:12px;color:#6b7280;display:block;margin-bottom:3px;">🦸 Heroes</label>
            <input type="number" id="deckSetupHeroes" min="0" value="0"
                   style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #d1d5db;
                          border-radius:8px;font-size:16px;text-align:center;font-family:inherit;">
          </div>
          <div style="flex:1;text-align:center;">
            <label for="deckSetupPlays" style="font-size:12px;color:#6b7280;display:block;margin-bottom:3px;">▶ Plays</label>
            <input type="number" id="deckSetupPlays" min="0" value="30"
                   style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #d1d5db;
                          border-radius:8px;font-size:16px;text-align:center;font-family:inherit;">
          </div>
          <div style="flex:1;text-align:center;">
            <label for="deckSetupBonus" style="font-size:12px;color:#6b7280;display:block;margin-bottom:3px;">⭐ Bonus</label>
            <input type="number" id="deckSetupBonus" min="0" value="15"
                   style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #d1d5db;
                          border-radius:8px;font-size:16px;text-align:center;font-family:inherit;">
          </div>
        </div>
        <div style="font-size:11px;color:#9ca3af;text-align:center;margin-top:4px;">
          Total target: <strong id="deckSetupTotal">45</strong> cards
        </div>
      </div>
      <div class="modal-footer" style="gap:8px;">
        <button class="btn-secondary" id="deckSetupCancel" style="flex:1;">Cancel</button>
        <button class="btn-tag-add" id="deckSetupStart" style="flex:2;padding:12px;font-size:14px;">
          🃏 Start Building
        </button>
      </div>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', html);

  // Close handlers
  const closeSetup = () => {
    document.getElementById('deckSetupModal')?.remove();
    window._deckBuilderActive = false;
  };
  document.getElementById('deckSetupClose')?.addEventListener('click', closeSetup);
  document.getElementById('deckSetupBackdrop')?.addEventListener('click', closeSetup);
  document.getElementById('deckSetupCancel')?.addEventListener('click', closeSetup);

  // Live total update
  const updateTotal = () => {
    const h = Math.max(0, parseInt(document.getElementById('deckSetupHeroes')?.value) || 0);
    const p = Math.max(0, parseInt(document.getElementById('deckSetupPlays')?.value) || 0);
    const b = Math.max(0, parseInt(document.getElementById('deckSetupBonus')?.value) || 0);
    const el = document.getElementById('deckSetupTotal');
    if (el) el.textContent = h + p + b;
  };
  ['deckSetupHeroes', 'deckSetupPlays', 'deckSetupBonus'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updateTotal);
  });

  // Start building
  const startBuilding = () => {
    const nameInput = document.getElementById('deckSetupName');
    const name = (nameInput?.value || '').trim();
    const errEl = document.getElementById('deckSetupNameError');

    if (!name) {
      if (errEl) { errEl.textContent = 'Please enter a deck name.'; errEl.style.display = 'block'; }
      nameInput?.focus();
      return;
    }

    window._deckBuilderConfig = {
      name,
      tag:       name.replace(/[|,]/g, '-').trim(),
      maxHeroes: Math.max(0, parseInt(document.getElementById('deckSetupHeroes')?.value) || 0),
      maxPlays:  Math.max(0, parseInt(document.getElementById('deckSetupPlays')?.value) || 0),
      maxBonus:  Math.max(0, parseInt(document.getElementById('deckSetupBonus')?.value) || 0),
    };
    window._deckBuilderConfig.totalTarget =
      window._deckBuilderConfig.maxHeroes +
      window._deckBuilderConfig.maxPlays +
      window._deckBuilderConfig.maxBonus;

    document.getElementById('deckSetupModal')?.remove();
    renderDeckBuilderModal();
  };

  document.getElementById('deckSetupStart')?.addEventListener('click', startBuilding);
  document.getElementById('deckSetupName')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') startBuilding();
  });

  setTimeout(() => document.getElementById('deckSetupName')?.focus(), 80);
}

// ── Card scanned callback — registered on open, cleared on close ───────────
// scanner.js calls this when scanMode === 'deckbuilder' instead of addCard.
window.deckBuilderOnCardScanned = async function(match, imageUrl, fileName, imageBase64) {
  const cfg   = window._deckBuilderConfig;
  const pType = getParallelType(match);
  const queue = window._deckBuilderQueue;

  const heroes  = queue.filter(e => e.parallel === 'hero');
  const plays   = queue.filter(e => e.parallel === 'play');
  const bonuses = queue.filter(e => e.parallel === 'bonus');

  // Soft capacity warnings — inform user but don't block adding
  if (cfg) {
    if (pType === 'hero'  && cfg.maxHeroes > 0 && heroes.length  >= cfg.maxHeroes) {
      showToast(`Heroes target (${cfg.maxHeroes}) already reached`, '⚠️');
    }
    if (pType === 'play'  && cfg.maxPlays  > 0 && plays.length   >= cfg.maxPlays) {
      showToast(`Plays target (${cfg.maxPlays}) already reached`, '⚠️');
    }
    if (pType === 'bonus' && cfg.maxBonus  > 0 && bonuses.length >= cfg.maxBonus) {
      showToast(`Bonus target (${cfg.maxBonus}) already reached`, '⚠️');
    }
  }

  // ── Uniqueness check — same card number + set = duplicate ──────────────
  const isDupe = queue.some(e =>
    e.card.cardNumber === (match['Card Number'] || '') &&
    e.card.set        === (match.Set || '')
  );
  if (isDupe) {
    showToast(`${match.Name} (${match['Card Number']}) is already in this deck`, '⚠️');
    refreshDeckBuilderUI();
    return;
  }

  // ── Build card object (mirrors scanner.js addCard) ─────────────────────
  const card = {
    cardId:      String(match['Card ID']     || ''),
    hero:        match.Name                  || '',
    athlete:     (typeof getAthleteForHero === 'function') ? (getAthleteForHero(match.Name) || '') : '',
    year:        match.Year                  || '',
    set:         match.Set                   || '',
    cardNumber:  match['Card Number']        || '',
    pose:        match.Parallel              || '',
    weapon:      match.Weapon                || '',
    power:       match.Power                 || '',
    imageUrl:    imageUrl                    || '',
    fileName:    fileName                    || '',
    scanType:    'deck',
    scanMethod:  'Deck Builder',
    confidence:  null,
    timestamp:   new Date().toISOString(),
    tags:        [],
    condition:   '',
    notes:       '',
    readyToList: false,
    listingStatus: null,
    // DBS fields — populated after API call
    dbs:     null,
    dbsCost: null,
    ability: null,
  };

  // Add to queue immediately so UI feels responsive
  const entry = { card, dbsData: null, parallel: pType, imageBase64 };
  queue.push(entry);
  refreshDeckBuilderUI();
  const icon = pType === 'hero' ? '🦸' : pType === 'play' ? '🎴' : '⭐';
  showToast(`${icon} Added: ${card.hero} (${card.cardNumber})`, '✅');

  // Upload image async
  if (imageBase64 && typeof uploadWithRetry === 'function') {
    uploadWithRetry(imageBase64, fileName).then(url => {
      if (url) { entry.card.imageUrl = url; }
    }).catch(() => {});
  }

  // Local DBS lookup — instant, no network call needed
  const dbsData = lookupBobaCard(card);
  if (dbsData) {
    entry.dbsData      = dbsData;
    entry.card.dbs     = dbsData.dbs;
    entry.card.dbsCost = dbsData.cost;
    entry.card.ability = dbsData.ability;
  }

  // Check if all targets met
  if (cfg && cfg.totalTarget > 0) {
    const h2 = queue.filter(e => e.parallel === 'hero').length;
    const p2 = queue.filter(e => e.parallel === 'play').length;
    const b2 = queue.filter(e => e.parallel === 'bonus').length;
    const heroMet  = cfg.maxHeroes === 0 || h2 >= cfg.maxHeroes;
    const playMet  = cfg.maxPlays  === 0 || p2 >= cfg.maxPlays;
    const bonusMet = cfg.maxBonus  === 0 || b2 >= cfg.maxBonus;
    if (heroMet && playMet && bonusMet) {
      showToast('All deck targets reached!', '🎉');
    }
  }
};

// ── Render / re-render the modal ───────────────────────────────────────────
function renderDeckBuilderModal() {
  document.getElementById('deckBuilderModal')?.remove();

  const cfg     = window._deckBuilderConfig || { name: 'Deck', maxHeroes: 0, maxPlays: 30, maxBonus: 15, totalTarget: 45 };
  const queue   = window._deckBuilderQueue;
  const heroes  = queue.filter(e => e.parallel === 'hero');
  const plays   = queue.filter(e => e.parallel === 'play');
  const bonuses = queue.filter(e => e.parallel === 'bonus');
  const total   = queue.length;

  // Progress percentage based on total target
  const progressPct = cfg.totalTarget > 0
    ? Math.min(100, Math.round((total / cfg.totalTarget) * 100))
    : (total > 0 ? 100 : 0);

  // All targets met?
  const heroMet  = cfg.maxHeroes === 0 || heroes.length  >= cfg.maxHeroes;
  const playMet  = cfg.maxPlays  === 0 || plays.length   >= cfg.maxPlays;
  const bonusMet = cfg.maxBonus  === 0 || bonuses.length >= cfg.maxBonus;
  const allMet   = heroMet && playMet && bonusMet && total > 0;

  // Build status line for header
  const statusParts = [];
  if (cfg.maxHeroes > 0) statusParts.push(`${heroes.length}/${cfg.maxHeroes} heroes`);
  if (cfg.maxPlays  > 0) statusParts.push(`${plays.length}/${cfg.maxPlays} plays`);
  else statusParts.push(`${plays.length} plays`);
  if (cfg.maxBonus  > 0) statusParts.push(`${bonuses.length}/${cfg.maxBonus} bonus`);
  else statusParts.push(`${bonuses.length} bonus`);

  // Queue HTML — show each section that has cards or a target > 0
  const queueHtml = total === 0
    ? `<div style="text-align:center;padding:28px 16px;color:#9ca3af;font-size:14px;">
         <div style="font-size:32px;margin-bottom:8px;">🃏</div>
         No cards scanned yet. Start by scanning a card.
       </div>`
    : `
      ${heroes.length > 0 || cfg.maxHeroes > 0 ? `
        <div style="margin-bottom:12px;">
          <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">
            🦸 Heroes (${heroes.length}${cfg.maxHeroes > 0 ? '/' + cfg.maxHeroes : ''})${cfg.maxHeroes > 0 && heroes.length >= cfg.maxHeroes ? ' ✓' : ''}
          </div>
          ${heroes.length > 0
            ? heroes.map((e, i) => renderQueueRow(e, i, 'hero')).join('')
            : '<div style="font-size:12px;color:#d1d5db;padding:4px 10px;">No heroes added yet</div>'}
        </div>` : ''}
      ${plays.length > 0 || cfg.maxPlays > 0 ? `
        <div style="margin-bottom:12px;">
          <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">
            ▶ Plays (${plays.length}${cfg.maxPlays > 0 ? '/' + cfg.maxPlays : ''})${cfg.maxPlays > 0 && plays.length >= cfg.maxPlays ? ' ✓' : ''}
          </div>
          ${plays.length > 0
            ? plays.map((e, i) => renderQueueRow(e, i, 'play')).join('')
            : '<div style="font-size:12px;color:#d1d5db;padding:4px 10px;">No plays added yet</div>'}
        </div>` : ''}
      ${bonuses.length > 0 || cfg.maxBonus > 0 ? `
        <div>
          <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">
            ⭐ Bonus Plays (${bonuses.length}${cfg.maxBonus > 0 ? '/' + cfg.maxBonus : ''})${cfg.maxBonus > 0 && bonuses.length >= cfg.maxBonus ? ' ✓' : ''}
          </div>
          ${bonuses.length > 0
            ? bonuses.map((e, i) => renderQueueRow(e, i, 'bonus')).join('')
            : '<div style="font-size:12px;color:#d1d5db;padding:4px 10px;">No bonus plays added yet</div>'}
        </div>` : ''}`;

  const html = `
  <div class="modal active" id="deckBuilderModal">
    <div class="modal-backdrop" id="deckBuilderBackdrop"></div>
    <div class="modal-content" style="max-width:520px;max-height:92vh;display:flex;flex-direction:column;">
      <div class="modal-header">
        <div>
          <h2>${cfg.isTournament ? '🏆' : '🃏'} ${escapeHtml(cfg.name)}</h2>
          <div style="font-size:12px;color:#6b7280;margin-top:2px;">
            ${cfg.isTournament ? '<span style="background:#7c3aed;color:white;padding:1px 6px;border-radius:4px;font-size:10px;margin-right:6px;">TOURNAMENT</span>' : ''}${statusParts.join(' · ')}
          </div>
        </div>
        <button class="modal-close" id="deckBuilderClose">×</button>
      </div>

      <!-- Progress bar -->
      <div style="padding:0 24px 12px;border-bottom:1px solid #e5e7eb;">
        <div style="height:6px;background:#f1f5f9;border-radius:99px;overflow:hidden;">
          <div style="height:100%;background:linear-gradient(90deg,#2563eb,#7c3aed);border-radius:99px;
                      width:${progressPct}%;transition:width .3s ease;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#9ca3af;margin-top:4px;">
          <span>${total} card${total !== 1 ? 's' : ''} added</span>
          <span>${cfg.totalTarget > 0
            ? (cfg.totalTarget - total > 0 ? (cfg.totalTarget - total) + ' remaining' : 'target reached ✓')
            : ''}</span>
        </div>
      </div>

      <!-- Queue -->
      <div class="modal-body" style="flex:1;overflow-y:auto;padding:16px 20px;" id="deckQueueContainer">
        ${queueHtml}
      </div>

      <!-- Scan buttons -->
      <div style="padding:12px 20px;border-top:1px solid #f3f4f6;border-bottom:1px solid #f3f4f6;background:#fafafa;">
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
          <label id="deckScanPhotoLabel" style="
            display:inline-flex;align-items:center;gap:6px;
            padding:10px 18px;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;
            background:linear-gradient(135deg,#2563eb,#1d4ed8);color:white;
            box-shadow:0 4px 12px rgba(37,99,235,0.35);transition:all .15s;">
            📷 Take Photo
            <input type="file" id="deckScanPhoto" accept="image/*" capture="environment" style="display:none;">
          </label>
          <label id="deckScanUploadLabel" style="
            display:inline-flex;align-items:center;gap:6px;
            padding:10px 18px;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;
            background:linear-gradient(135deg,#7c3aed,#6d28d9);color:white;
            box-shadow:0 4px 12px rgba(124,58,237,0.35);transition:all .15s;">
            🖼️ Upload Image
            <input type="file" id="deckScanUpload" accept="image/*" style="display:none;">
          </label>
        </div>
        ${allMet ? `<p style="text-align:center;font-size:12px;color:#10b981;margin:8px 0 0;font-weight:600;">
            ✅ All targets reached! Click Finish Deck to save.
          </p>` : `<p style="text-align:center;font-size:11px;color:#9ca3af;margin:6px 0 0;">
            Scan any card to add it to your deck
          </p>`}
      </div>

      <!-- Footer -->
      <div class="modal-footer" style="gap:8px;">
        <button class="btn-secondary" id="deckBuilderCancel" style="flex:1;">Cancel</button>
        ${total > 0 ? (() => {
          // In tournament mode, check if exact requirements are met for button state
          const canFinish = !cfg.isTournament || (heroMet && playMet && bonuses.length <= (cfg.maxBonus || 0));
          const btnLabel = cfg.isTournament && !canFinish
            ? 'Requirements not met'
            : `Finish Deck (${total} card${total !== 1 ? 's' : ''})`;
          return `<button id="deckCompleteBtn" class="btn-tag-add" style="flex:2;padding:12px;font-size:14px;${!canFinish ? 'opacity:0.5;' : ''}"
            ${!canFinish ? 'disabled' : ''}>
            ${btnLabel}
          </button>`;
        })() : ''}
      </div>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  wireDeckBuilderEvents();
}

function renderQueueRow(entry, idx, type) {
  const { card, dbsData } = entry;
  const slotLabel = type === 'hero'
    ? `H${idx + 1}`
    : type === 'play'
    ? `Slot ${idx + 1}`
    : `B${idx + 1}`;
  const hasApiData = dbsData !== null;

  const colors = {
    hero:  { bg: '#f0fdf4', border: '#bbf7d0', badge: '#166534', badgeBg: '#dcfce7' },
    play:  { bg: '#eff6ff', border: '#bfdbfe', badge: '#1d4ed8', badgeBg: '#dbeafe' },
    bonus: { bg: '#f5f3ff', border: '#ddd6fe', badge: '#7c3aed', badgeBg: '#ede9fe' },
  };
  const c = colors[type] || colors.play;

  return `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;
                background:${c.bg};
                border-radius:10px;margin-bottom:6px;border:1px solid ${c.border};">
      <div style="flex-shrink:0;width:36px;height:36px;border-radius:8px;overflow:hidden;background:#e5e7eb;">
        ${card.imageUrl
          ? `<img src="${card.imageUrl}" style="width:100%;height:100%;object-fit:cover;">`
          : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:16px;">🎴</div>`}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:700;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${escapeHtml(card.hero)}
        </div>
        <div style="font-size:11px;color:#6b7280;display:flex;gap:6px;flex-wrap:wrap;">
          <span>${escapeHtml(card.cardNumber)}</span>
          <span>·</span>
          <span>${escapeHtml(card.set)}</span>
          ${hasApiData && dbsData.dbs   != null ? `<span>· DBS: <strong>${escapeHtml(String(dbsData.dbs))}</strong></span>` : ''}
          ${hasApiData && dbsData.cost  != null ? `<span>· Cost: <strong>${escapeHtml(String(dbsData.cost))}</strong></span>` : ''}
          ${!hasApiData ? `<span style="color:#d97706;">No DBS data in local DB</span>` : ''}
        </div>
        ${hasApiData && dbsData.ability ? `<div style="font-size:11px;color:#4b5563;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(dbsData.ability)}">${escapeHtml(dbsData.ability.substring(0, 60))}${dbsData.ability.length > 60 ? '…' : ''}</div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;">
        <span style="font-size:11px;font-weight:700;color:${c.badge};
                     background:${c.badgeBg};
                     padding:2px 7px;border-radius:99px;">${slotLabel}</span>
        <button data-remove-idx="${window._deckBuilderQueue.indexOf(entry)}"
                style="background:none;border:none;cursor:pointer;font-size:14px;color:#9ca3af;padding:2px;" title="Remove">✕</button>
      </div>
    </div>`;
}

// ── Wire events after every render ────────────────────────────────────────
function wireDeckBuilderEvents() {
  // Close / cancel
  document.getElementById('deckBuilderClose')?.addEventListener('click', closeDeckBuilder);
  document.getElementById('deckBuilderBackdrop')?.addEventListener('click', closeDeckBuilder);
  document.getElementById('deckBuilderCancel')?.addEventListener('click', closeDeckBuilder);

  // Complete deck — name already collected, go straight to finalize
  document.getElementById('deckCompleteBtn')?.addEventListener('click', finalizeDeck);

  // File inputs — delegate scan to the deck builder callback
  ['deckScanPhoto', 'deckScanUpload'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';
      await processDeckScan(file);
    });
  });

  // Remove buttons (event delegation on queue container)
  document.getElementById('deckQueueContainer')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove-idx]');
    if (!btn) return;
    const idx = parseInt(btn.dataset.removeIdx);
    if (!isNaN(idx)) removeDeckEntry(idx);
  });
}

// ── Process a scanned file through the normal scan pipeline ───────────────
async function processDeckScan(file) {
  if (!file.type.startsWith('image/')) { showToast('Not an image', '⚠️'); return; }
  if (file.size > 15 * 1024 * 1024)    { showToast('Image too large (max 15MB)', '⚠️'); return; }

  // Set scan mode so addCard routes back to us instead of saving to collection
  window.scanMode = 'deckbuilder';

  showLoading(true, 'Scanning card...');

  try {
    // Re-use the same compression + scan pipeline
    if (typeof compressImage !== 'function' || typeof _doProcessImage !== 'function') {
      showToast('Scanner not ready — please wait', '⚠️');
      showLoading(false);
      return;
    }
    const imageBase64 = await compressImage(file);
    const displayUrl  = URL.createObjectURL(file);
    await _doProcessImage(imageBase64, displayUrl, displayUrl, file.name, imageBase64);
  } catch (err) {
    console.error('Deck scan error:', err);
    showToast('Scan failed — try again', '❌');
  } finally {
    showLoading(false);
    // NOTE: Do NOT reset scanMode here. The manual search modal may still be
    // open and needs scanMode='deckbuilder' to route the selection correctly.
    // scanMode is reset when the deck builder is closed or finalized.
  }
}

// ── Remove a card from the queue ──────────────────────────────────────────
function removeDeckEntry(idx) {
  const entry = window._deckBuilderQueue[idx];
  if (!entry) return;
  window._deckBuilderQueue.splice(idx, 1);
  showToast(`Removed: ${entry.card.hero}`, '🗑️');
  refreshDeckBuilderUI();
}

// ── Refresh UI without closing the modal ─────────────────────────────────
function refreshDeckBuilderUI() {
  if (!document.getElementById('deckBuilderModal')) return;
  // Full re-render is simplest and most reliable
  renderDeckBuilderModal();
}

// ── Finalize: save all cards to Deck Building collection ──────────────────
// Deck name was collected in the setup modal — no second prompt needed.
async function finalizeDeck() {
  const cfg = window._deckBuilderConfig;
  if (!cfg || !cfg.tag) {
    showToast('Deck configuration missing — please try again', '❌');
    return;
  }

  const queue   = window._deckBuilderQueue;
  const heroes  = queue.filter(e => e.parallel === 'hero');
  const plays   = queue.filter(e => e.parallel === 'play');
  const bonuses = queue.filter(e => e.parallel === 'bonus');

  // Tournament mode — enforce exact hero + play counts, bonus 0..max
  if (cfg.isTournament) {
    if (cfg.maxHeroes > 0 && heroes.length !== cfg.maxHeroes) {
      showToast(`You must have exactly ${cfg.maxHeroes} heroes (currently ${heroes.length})`, '⚠️');
      return;
    }
    if (cfg.maxPlays > 0 && plays.length !== cfg.maxPlays) {
      showToast(`You must have exactly ${cfg.maxPlays} plays (currently ${plays.length})`, '⚠️');
      return;
    }
    if (bonuses.length > cfg.maxBonus) {
      showToast(`Maximum ${cfg.maxBonus} bonus plays allowed (currently ${bonuses.length})`, '⚠️');
      return;
    }
  }

  const deckTag  = cfg.tag;
  const deckName = cfg.name;

  // Disable button to prevent double-tap
  const btn = document.getElementById('deckCompleteBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  const cols    = ensureDeckBuildingCollection();
  const deckCol = cols.find(c => c.id === DECK_BUILDING_COLLECTION_ID);
  let added = 0, updated = 0;

  for (const entry of queue) {
    const { card } = entry;

    // Apply the deck tag and DBS data
    if (!Array.isArray(card.tags)) card.tags = [];
    if (!card.tags.includes(deckTag)) card.tags.push(deckTag);

    // Find existing card in Deck Building collection (same cardNumber + set)
    const existingIdx = deckCol.cards.findIndex(c =>
      c.cardNumber === card.cardNumber && c.set === card.set
    );

    if (existingIdx >= 0) {
      // Append the new deck tag only — don't duplicate the card
      const existing = deckCol.cards[existingIdx];
      if (!Array.isArray(existing.tags)) existing.tags = [];
      if (!existing.tags.includes(deckTag)) {
        existing.tags.push(deckTag);
        updated++;
      }
      // Also update DBS data if we now have it and didn't before
      if (!existing.dbs     && card.dbs)     existing.dbs     = card.dbs;
      if (!existing.dbsCost && card.dbsCost) existing.dbsCost = card.dbsCost;
      if (!existing.ability && card.ability) existing.ability = card.ability;
    } else {
      deckCol.cards.push(card);
      deckCol.stats.scanned++;
      added++;
    }
  }

  saveCollections(getCollections().map(c =>
    c.id === DECK_BUILDING_COLLECTION_ID ? deckCol : c
  ));

  // Close the modal
  document.getElementById('deckBuilderModal')?.remove();

  // Reset state
  window._deckBuilderQueue  = [];
  window._deckBuilderActive = false;
  window._deckBuilderConfig = null;
  window.scanMode = 'collection';

  showToast(
    `Deck "${deckName}" saved — ${added} new, ${updated} updated`,
    '🎉'
  );

  // Refresh UI
  if (typeof renderCards === 'function') renderCards();
  if (typeof updateCollectionNavCounts === 'function') updateCollectionNavCounts();

  // Tournament mode — track usage, auto-export, and offer "Add to My Collection"
  if (cfg.isTournament && cfg.tournamentId) {
    if (typeof incrementTournamentUsage === 'function') {
      incrementTournamentUsage(cfg.tournamentId);
    }
    // Auto-export the deck as CSV after a short delay so the save toast is visible
    setTimeout(() => {
      autoExportTournamentDeck(deckTag, deckName, queue);
    }, 500);

    // Prompt user to copy tournament cards to My Collection (bypasses card limit)
    const cardsCopied = queue.map(e => e.card);
    setTimeout(() => showAddToCollectionPrompt(cardsCopied, deckName), 1200);
  }

  // Clear tournament reference
  window._activeTournament = null;

  console.log(`🃏 Deck "${deckName}" saved: ${added} new cards, ${updated} tag updates`);
}

// ── Auto-export tournament deck as CSV ──────────────────────────────────────
function autoExportTournamentDeck(deckTag, deckName, queue) {
  const plays   = queue.filter(e => e.parallel === 'play');
  const bonuses = queue.filter(e => e.parallel === 'bonus');
  const heroes  = queue.filter(e => e.parallel === 'hero');

  const ec = val => `"${String(val ?? '').replace(/"/g, '""')}"`;
  const rows = [];

  // Header
  rows.push(['Slot','Card #','Name','Parallel','Cost','Ability','DBS'].map(ec).join(','));

  // Hero slots
  heroes.forEach((entry, i) => {
    const c = entry.card;
    const d = entry.dbsData;
    rows.push([
      ec(`Hero ${i + 1}`), ec(c.cardNumber), ec(c.hero), ec(c.pose),
      ec(d?.cost ?? ''), ec(d?.ability ?? ''), ec(d?.dbs ?? '')
    ].join(','));
  });

  // Play slots 1-N
  plays.forEach((entry, i) => {
    const c = entry.card;
    const d = entry.dbsData;
    rows.push([
      ec(i + 1), ec(c.cardNumber), ec(c.hero), ec(c.pose),
      ec(d?.cost ?? ''), ec(d?.ability ?? ''), ec(d?.dbs ?? '')
    ].join(','));
  });

  // Bonus slots B1-N
  bonuses.forEach((entry, i) => {
    const c = entry.card;
    const d = entry.dbsData;
    rows.push([
      ec(`B${i + 1}`), ec(c.cardNumber), ec(c.hero), ec(c.pose),
      ec(d?.cost ?? ''), ec(d?.ability ?? ''), ec(d?.dbs ?? '')
    ].join(','));
  });

  const csv   = rows.join('\n');
  const today = new Date().toISOString().split('T')[0];
  const name  = (deckName || 'tournament').replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').substring(0, 100);

  // Use the same download helper from export.js if available, otherwise inline
  if (typeof downloadFile === 'function') {
    downloadFile(csv, `BoBA_Tournament_${name}_${today}.csv`, 'text/csv');
  } else {
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: `BoBA_Tournament_${name}_${today}.csv` });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  showToast('Tournament deck exported as CSV', '📄');
}

// ── Close deck builder ─────────────────────────────────────────────────────
function closeDeckBuilder() {
  if (window._deckBuilderQueue.length > 0) {
    // Inline confirm — don't use native confirm() on mobile
    document.getElementById('deckAbandonModal')?.remove();
    const html = `
    <div class="modal active" id="deckAbandonModal" style="z-index:10002;">
      <div class="modal-backdrop" id="deckAbandonBackdrop"></div>
      <div class="modal-content" style="max-width:360px;">
        <div class="modal-header"><h2>⚠️ Abandon Deck?</h2></div>
        <div class="modal-body" style="padding:20px;text-align:center;">
          <p style="color:#374151;font-size:14px;">
            You have <strong>${window._deckBuilderQueue.length} card${window._deckBuilderQueue.length !== 1 ? 's' : ''}</strong> in the queue.
            Closing will discard them.
          </p>
        </div>
        <div class="modal-footer" style="gap:8px;">
          <button class="btn-secondary" id="deckAbandonCancel" style="flex:1;">Keep Editing</button>
          <button style="flex:1;padding:10px;border-radius:8px;border:none;background:#ef4444;color:white;font-weight:600;cursor:pointer;" id="deckAbandonConfirm">Discard</button>
        </div>
      </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    document.getElementById('deckAbandonCancel')?.addEventListener('click', () => document.getElementById('deckAbandonModal')?.remove());
    document.getElementById('deckAbandonBackdrop')?.addEventListener('click', () => document.getElementById('deckAbandonModal')?.remove());
    document.getElementById('deckAbandonConfirm')?.addEventListener('click', () => {
      document.getElementById('deckAbandonModal')?.remove();
      document.getElementById('deckBuilderModal')?.remove();
      window._deckBuilderQueue  = [];
      window._deckBuilderActive = false;
      window._deckBuilderConfig = null;
      window._activeTournament  = null;
      window.scanMode = 'collection';
    });
  } else {
    document.getElementById('deckBuilderModal')?.remove();
    window._deckBuilderActive = false;
    window._deckBuilderConfig = null;
    window._activeTournament  = null;
    window.scanMode = 'collection';
  }
}

// ── Get all deck tags from the Deck Building collection ────────────────────
// Used by export.js to populate the Deck Export dropdown.
window.getDeckTags = function() {
  const cols = getCollections();
  const deckCol = cols.find(c => c.id === DECK_BUILDING_COLLECTION_ID);
  if (!deckCol) return [];

  const tagSet = new Set();
  for (const card of deckCol.cards) {
    if (Array.isArray(card.tags)) {
      card.tags.forEach(t => t && tagSet.add(t));
    }
  }
  return [...tagSet].sort();
};

// ── Get all cards in the Deck Building collection for a specific deck tag ──
window.getDeckCards = function(deckTag) {
  const cols = getCollections();
  const deckCol = cols.find(c => c.id === DECK_BUILDING_COLLECTION_ID);
  if (!deckCol) return [];
  return deckCol.cards.filter(c =>
    Array.isArray(c.tags) && c.tags.includes(deckTag)
  );
};

console.log('✅ Deck Builder module loaded');

// ── Post-tournament: offer to copy cards to My Collection ───────────────────
function showAddToCollectionPrompt(cards, deckName) {
  document.getElementById('addToColModal')?.remove();
  if (!cards || cards.length === 0) return;

  const limit = (typeof userLimits !== 'undefined' && userLimits)
    ? userLimits.maxCards
    : (window.DEFAULT_LIMITS ? window.DEFAULT_LIMITS.authenticated.maxCards : 25);
  const currentTotal = (typeof getCollections === 'function')
    ? getCollections().reduce((s, c) => s + c.cards.length, 0) : 0;

  const html = `
    <div class="modal active" id="addToColModal" style="z-index:10002;">
      <div class="modal-backdrop" id="addToColBackdrop"></div>
      <div class="modal-content" style="max-width:420px;">
        <div class="modal-header">
          <h2>🎴 Add to My Collection?</h2>
          <button class="modal-close" id="addToColClose">×</button>
        </div>
        <div class="modal-body" style="padding:20px;text-align:center;">
          <p style="color:#374151;font-size:15px;margin:0 0 8px;">
            Your deck <strong>${typeof escapeHtml === 'function' ? escapeHtml(deckName) : deckName}</strong>
            has <strong>${cards.length}</strong> card${cards.length !== 1 ? 's' : ''}.
          </p>
          <p style="color:#6b7280;font-size:13px;margin:0 0 12px;">
            Copy them to <strong>My Collection</strong>?
          </p>
          <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:10px 14px;font-size:13px;color:#0c4a6e;">
            ${cards.length} cards will be added
            (${currentTotal} current + ${cards.length} = ${currentTotal + cards.length} total,
            limit: ${limit})
          </div>
        </div>
        <div class="modal-footer" style="gap:8px;">
          <button class="btn-secondary" id="addToColSkip" style="flex:1;">No Thanks</button>
          <button class="btn-tag-add" id="addToColConfirm" style="flex:1;">Add to Collection</button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);

  const close = () => document.getElementById('addToColModal')?.remove();
  document.getElementById('addToColClose')?.addEventListener('click', close);
  document.getElementById('addToColSkip')?.addEventListener('click', close);
  document.getElementById('addToColBackdrop')?.addEventListener('click', close);
  document.getElementById('addToColConfirm')?.addEventListener('click', () => {
    close();
    copyTournamentCardsToCollection(cards);
  });
}

function copyTournamentCardsToCollection(cards) {
  const cols = getCollections();
  let defaultCol = cols.find(c => c.id === 'default');
  if (!defaultCol) {
    defaultCol = { id: 'default', name: 'My Collection', cards: [], stats: { scanned: 0, free: 0, cost: 0, aiCalls: 0 } };
    cols.unshift(defaultCol);
  }

  let added = 0;
  for (const card of cards) {
    // Skip if already in default collection (same cardId + cardNumber)
    const exists = defaultCol.cards.some(c =>
      (card.cardId && c.cardId === card.cardId) ||
      (card.cardNumber && c.cardNumber === card.cardNumber && c.set === card.set)
    );
    if (exists) continue;

    defaultCol.cards.push({ ...card });
    defaultCol.stats.scanned++;
    added++;
  }

  saveCollections(cols);
  if (typeof renderCards === 'function') renderCards();
  if (typeof updateCollectionNavCounts === 'function') updateCollectionNavCounts();
  if (typeof updateCollectionSlider === 'function') updateCollectionSlider();

  showToast(`Added ${added} tournament card${added !== 1 ? 's' : ''} to My Collection`, '🎴');
}
