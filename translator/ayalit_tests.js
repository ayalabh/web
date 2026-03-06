#!/usr/bin/env node
const fs = require('fs');

// Extract JS from ayalit.html
const html = fs.readFileSync('/tmp/ayalit.html', 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) { console.error('Could not find <script> in ayalit.html'); process.exit(1); }

// Remove DOM references and eval the translator code
let js = scriptMatch[1];
js = js.replace(/let updating[\s\S]*$/, '');
// Stub stripPunct's regex relies on unicode ranges which work fine in Node
eval(js);

// ---- Test cases ----
const heb2aya = [
  // Basic words
  ['שלום', 'טיקם'],
  ['תודה', 'אישמלד'],
  ['בבקשה', 'פטשדק'],
  ['כן', 'טק'],
  ['לא', 'מן'],

  // Pronouns
  ['אני', 'נו'],
  ['אתה', 'טמון'],
  ['היא', 'דיק'],
  ['אנחנו', 'דק'],

  // Possessives
  ['שלי', 'נומט'],
  ['שלו', 'מטום'],
  ['שלנו', 'דקמט'],

  // Numbers
  ['אחד', 'מק'],
  ['שלוש', 'אירק'],
  ['עשר', 'אקם'],

  // Nouns
  ['כלב', 'גם'],
  ['חתול', 'ביש'],
  ['ילדה', 'עריד'],
  ['אמא', 'ממי'],
  ['ים', 'דקש'],
  ['מים', 'שאקר'],

  // Punctuation preserved
  ['שלום!', 'טיקם!'],
  ['שלי.', 'נומט.'],

  // Prefix ה (the)
  ['הכלב', 'איק גם'],
  ['הילד', 'איק נמט'],

  // Prefix ו (and)
  ['וגם', 'שמג קרדם'],

  // Double prefix וה (and the)
  ['והכלב', 'שמג איק גם'],

  // Phrase: חוף ים
  ['חוף ים', 'נקשבי מט דקש'],

  // Phrase with prefix: חוף הים
  ['חוף הים', 'איק נקשבי מט דקש'],

  // Plural (consonant ending → יד)
  ['כלבים', 'גמיד'],

  // Plural (vowel ending → שיד)
  ['ילדות', 'ערידיד'],

  // Irregular plural
  ['אחיות', 'דודאקריד'],

  // Plural with double prefix
  ['והאחיות', 'שמג איק דודאקריד'],

  // Construct plural phrase: חופי ים
  ['חופי ים', 'נקשבישיד מט דקש'],

  // Verb - present tense
  ['אני נוסע', 'נו שרשופ ריק'],
  ['אני הולך', 'נו שרשופ שלל'],

  // Verb - past tense (pronoun auto-added)
  ['הלכתי', 'נו שרשיפ שלל'],
  ['שיחקנו', 'דק שרקפיפ פשט'],

  // Verb - future tense
  ['אני אלך', 'נו שרשיט שלל'],

  // Pronoun dedup (explicit pronoun + verb)
  ['אני שיחקתי', 'נו שרשיפ פשט'],

  // Noun subject suppresses pronoun
  ['אח שלי ייסע', 'איקרנם נומט שרשיט ריק'],

  // Adverb before verb keeps pronoun
  ['היום הלכתי', 'אמגשא נו שרשיפ שלל'],

  // Copula: הוא as "is" after subject
  ['חוף הים הוא נחמד', 'איק נקשבי מט דקש שרשוט מובק'],

  // Copula: הוא as pronoun before verb
  ['הוא הולך', 'מיק שרשופ שלל'],

  // Accusative את skipped before ה+noun
  ['אני שותה את המים', 'נו שרשופ גרומל איק שאקר'],

  // Question with האם
  ['האם אני שיחקתי?', 'פשט טיפ נו שרש?'],

  // Question with ?
  ['אני שיחקתי?', 'פשט טיפ נו שרש?'],

  // Statement with period (no reorder)
  ['אני שיחקתי.', 'נו שרשיפ פשט.'],
];

const aya2heb = [
  // Basic words
  ['טיקם', 'שלום'],
  ['אישמלד', 'תודה'],
  ['נו', 'אני'],
  ['טמון', 'אתה'],

  // Punctuation
  ['טיקם.', 'שלום.'],
  ['נומט!', 'שלי!'],

  // Phrase
  ['נקשבי מט דקש', 'חוף ים'],

  // Prefix + phrase (ה before last word)
  ['איק נקשבי מט דקש', 'חוף הים'],

  // Prefix + word
  ['איק גם', 'הכלב'],

  // Plural
  ['גמיד', 'כלבים'],

  // Feminine plural
  ['ערידיד', 'ילדות'],

  // Feminine plural agreement (adjective follows feminine noun)
  ['ערידיד מובקיד', 'ילדות נחמדות'],

  // Prefix + feminine plural + agreement
  ['איק ערידיד איק מובקיד', 'הילדות הנחמדות'],

  // Verb - past with pronoun
  ['נו שרשיפ פשט', 'אני שיחקתי'],

  // Verb - present
  ['נו שרשופ ריק', 'אני נוסע'],

  // Verb - 3rd person plural past (no pronoun, noun subject)
  ['ערידיד שרקפיפ פשט טקדוק.', 'ילדות שיחקו אתמול.'],

  // Feminine present verb agreement
  ['ערידיד מובקיד שרקפופ פשט אמגשא', 'ילדות נחמדות משחקות היום'],

  // Question reorder
  ['פשט טיפ נו שרש?', 'אני שיחקתי?'],
];

// ---- Run tests ----
let pass = 0, fail = 0, failures = [];

console.log('עברית → אילית');
console.log('='.repeat(60));
for (const [input, expected] of heb2aya) {
  const got = translate(input);
  if (got === expected) {
    pass++;
  } else {
    fail++;
    failures.push({ dir: 'heb→aya', input, expected, got });
    console.log(`  ✗ "${input}"`);
    console.log(`    expected: "${expected}"`);
    console.log(`    got:      "${got}"`);
  }
}

console.log('');
console.log('אילית → עברית');
console.log('='.repeat(60));
for (const [input, expected] of aya2heb) {
  const got = reverseTranslate(input);
  if (got === expected) {
    pass++;
  } else {
    fail++;
    failures.push({ dir: 'aya→heb', input, expected, got });
    console.log(`  ✗ "${input}"`);
    console.log(`    expected: "${expected}"`);
    console.log(`    got:      "${got}"`);
  }
}

console.log('');
console.log('='.repeat(60));
if (fail === 0) {
  console.log(`✓ All ${pass} tests passed!`);
} else {
  console.log(`✗ ${fail} failed, ${pass} passed (${pass + fail} total)`);
}
process.exit(fail > 0 ? 1 : 0);
