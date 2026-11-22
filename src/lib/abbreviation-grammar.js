import { vaultedReference } from '../protect/placeholders.js';
import { CONTENT_END_LOOKAHEAD } from './boundaries.js';
import { keptReferenceTo } from './character-reference.js';
import { FRACTION_GLYPHS, G } from './glyphs.js';
import { inlineTextEnd } from './inline-boundaries.js';
import {
  DATA_UNITS,
  FREQUENCY_UNITS,
  LENGTH_UNITS,
  SPEED_UNITS,
  TEMPERATURE_SCALES,
  TIME_UNITS,
  VOLUME_UNITS,
  WEIGHT_UNITS
} from './measurement-units.js';

// Abbreviations a late group writes with their own period. An earlier group meets that period on the
// next pass and has to read it the way its owner does: `punctuation.collapse_doubled` would otherwise
// take it for the first of a doubled mark and drop the sentence's own `?` or `!` after it.

// Each takes the gap and the dash it is read with: a reader meeting the owner's output in XML reads
// the references the engine writes there for them as well.

// Two dotted initials, and the surname they stand beside, as `nobr` reads them. A gap may run on, as
// `nobr.nbsp_single_initial` reads it before collapsing it to one no-break space. A reader meeting
// the owner's output also reads what may follow the first letter: `other.strip_nbsp_in_nowrap` draws
// that letter alone into the wrapper before it, `Сч С</span>.М.`.
const INITIAL_GAP = '\\s[ \\t\\u{00A0}]*';
const dottedInitials = (gap = INITIAL_GAP, letterEnd = '') =>
  `([А-ЯЁ])${letterEnd}\\.(${gap})?([А-ЯЁ])\\.`;
export const DOTTED_INITIALS = dottedInitials();
export const DOTTED_INITIAL_PAIR = `${DOTTED_INITIALS}(${INITIAL_GAP})?`;
export const SURNAME = '[А-ЯЁ][а-яё]+';
// At the start of an authored nowrap these spellings can name an organization in either order.
// A point after the abbreviation may close its sentence; neither letter is marked as an initial.
const COMPACT_NAME_RE = new RegExp(
  `(?:[А-ЯЁ]{2}${INITIAL_GAP}${SURNAME}|${SURNAME}${INITIAL_GAP}[А-ЯЁ]{2})(?=\\s|$|[.,;:?!)\\]»“<])`,
  'uy'
);

export function startsWithCompactName(text, at) {
  COMPACT_NAME_RE.lastIndex = at;
  return COMPACT_NAME_RE.test(text);
}
// Any space within a line, as `nobr` reads the gap of a name it later collapses to a no-break space:
// `От⟨thin⟩П.` reads as `От⍽П.` does.
const NAME_GAP = `(?:[^\\S\\r\\n]|${keptReferenceTo(G.NBSP)})`;
const NAME_GAP_END = new RegExp(`(?<=(${NAME_GAP}+))`, 'uy');
const SURNAME_END = new RegExp(`(?<=(${SURNAME}))`, 'uy');
const INITIALS_END = new RegExp(`(?<=(?:^|[\\s.,;:?!>])${dottedInitials(`${NAME_GAP}+`)})`, 'uy');

function beforeNameGap(ctx, source, at) {
  const end = inlineTextEnd(ctx, source, at, true);
  NAME_GAP_END.lastIndex = end;
  const gap = NAME_GAP_END.exec(source);
  return gap ? inlineTextEnd(ctx, source, end - gap[1].length, true) : end;
}

// Once two initials have claimed the surname, a following dotted capital belongs outside that
// name. Its closing inline tag, if already present, does not change the visible boundary.
export function followsCompleteName(ctx, source, at) {
  const end = beforeNameGap(ctx, source, at);
  SURNAME_END.lastIndex = end;
  const surname = SURNAME_END.exec(source);
  if (!surname) {
    return false;
  }
  INITIALS_END.lastIndex = beforeNameGap(ctx, source, end - surname[1].length);
  return INITIALS_END.test(source);
}

// A degree or a year suffix is set apart by a later rule, even when still joined to the digits.
const NUMBER_SET_APART = `(?:(?=${G.DEG}(?:${TEMPERATURE_SCALES})${CONTENT_END_LOOKAHEAD})(?<=(?<![\\p{L}\\d])\\d+)|(?=г\\.(?:[^a-zа-яё]|$))(?<=(?<![\\p{L}\\d])\\d{3,4}))`;
export const LABEL_NUMBER_END = `(?:${CONTENT_END_LOOKAHEAD}|${NUMBER_SET_APART})`;
const DOTTED_LOCATION_AHEAD = new RegExp(
  `\\.${NAME_GAP}*(?:[Дд]\\.${NAME_GAP}*\\d+|[ГгШш]\\.${NAME_GAP}*[а-яёa-z0-9][А-ЯЁа-яёA-Za-z0-9]*)${LABEL_NUMBER_END}`,
  'uy'
);

export function hasDottedLocationAfter(source, at) {
  DOTTED_LOCATION_AHEAD.lastIndex = at;
  return DOTTED_LOCATION_AHEAD.test(source);
}

// A range of centuries in Roman numerals and the marker after it, as `other.en_century_range` reads
// them. The trailing letter lookaheads stop the marker from matching into the next word, and a marker
// written without its period that is glued to a letter of either case is the start of a word.
const centuryRange = (dash = '[-—–]') => `([XIV]{1,5})(${dash})([XIV]{1,5})`;
export const CENTURY_RANGE = centuryRange();
const centuryMarker = (gap = ' |\\u{00A0}') =>
  `((${gap})?((?:в\\.в\\.|вв\\.|в\\.)(?![а-яёa-z])|(?:вв|в)(?![а-яёА-ЯЁa-zA-Z])))`;
export const CENTURY_MARKER = centuryMarker();

export const DOCUMENT_LABEL = 'гл|стр|рис|илл?|ст|п|с';
export const DOCUMENT_PART = 'т|ч|[Тт]абл|[Рр]азд|пп|стст';
export const STREET_LABEL = 'ул|пер|просп|пл|бул|наб|пр|ш|туп';
export const BUILDING_LABEL = 'д|кв|эт';
export const TITLE = '[Пп]роф|[Аа]кад|[Дд]оц|[Тт]ов|[Сс]в';
export const CURRENCY_CODE = 'USD|EUR|RUB';
export const MAGNITUDE = 'млрд|трлн|млн|тыс';
export const ORGANIZATION = 'ООО|ЗАО|ОАО|НИИ|ПБОЮЛ';
export const OTHER_ORGANIZATION = 'ПАО|АО|НКО|ИП|ФГУП|МУП|ГК|НПО|АНО';
export const postscript = (gap) => `([Pp]\\.${gap})([Pp]\\.${gap})?([Ss]\\.)`;
export const horsepower = (gap) => `л\\.${gap}с\\.`;
export const currencyUnit = (gap) => `у\\.?${gap}е`;

// Early punctuation reads both the author's spelling and the spelling a later binding produces.
export function abbreviationPeriod(inlineEnd) {
  const nbsp = vaultedReference(G.NBSP);
  const gap = `(?:\\s|${nbsp})`;
  const tag = `(?:${inlineEnd})?`;
  const wordStart = '(?<![\\p{L}\\d])';
  const labels = [
    DOCUMENT_LABEL,
    DOCUMENT_PART,
    STREET_LABEL,
    BUILDING_LABEL,
    TITLE,
    ORGANIZATION,
    OTHER_ORGANIZATION,
    'см|им|[гГ]-(?:н|жа)|проц'
  ].join('|');
  const units = [
    LENGTH_UNITS,
    SPEED_UNITS,
    WEIGHT_UNITS,
    VOLUME_UNITS,
    TIME_UNITS,
    DATA_UNITS,
    FREQUENCY_UNITS,
    CURRENCY_CODE,
    MAGNITUDE,
    'сек|шт|экз|чел|мес|нед|дн|коп|руб|р|долл|евро|В|кВт|Вт|га'
  ].join('|');
  // A fraction the engine writes ends the number as a digit does, `½ у.е.!`.
  const number = `[\\d${FRACTION_GLYPHS}]${tag}${gap}?`;
  const forms = [
    `(?:[\\s(]|^|${nbsp})${centuryRange(`[-${G.MDASH}${G.NDASH}]|${vaultedReference(G.NDASH)}`)}${centuryMarker(` |${G.NBSP}|${nbsp}`)}`,
    `(?:\\s|^|[.,;:?!])${SURNAME}${tag}${gap}${dottedInitials(gap, tag)}`,
    `${wordStart}(?:[Тт]${tag}\\.${gap}?[дпчекно]|н${tag}\\.${gap}?э|[Ии]${tag}${gap}(?:др|пр))\\.`,
    `(?:\\d(?:-[а-яё]{1,3})?|${wordStart}[IVXLCDM]{1,7})${tag}${gap}?(?:гг?|вв?)\\.`,
    `${number}(?:(?:${MAGNITUDE})\\.?${gap}?)?(?:${units}|${currencyUnit(`${gap}?`)})\\.`,
    `${number}(?:${horsepower(`${gap}+`)}|(?:кв|куб)\\.${gap}+м\\.)`,
    `${wordStart}(?:${labels})\\.`,
    `${wordStart}${postscript(`${gap}?`)}`
  ];
  return new RegExp(`(?<=${forms.join('|')})`, 'uy');
}
