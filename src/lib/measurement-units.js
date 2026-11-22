import { CONTENT_END_LOOKAHEAD, CONTENT_START_GROUP } from './boundaries.js';
import { G } from './glyphs.js';

export const LENGTH_UNITS = 'м|мм|см|дм|км|гм|km|dm|cm|mm';
export const SPEED_UNITS = '(?:мм|см|дм|км|гм|м)\\/(?:с|ч|мин|сут)';
export const WEIGHT_UNITS = 'г|кг|мг|т';
export const VOLUME_UNITS = 'мл|л';
export const TIME_UNITS = 'мин|ч';
export const DATA_UNITS =
  '(?:Кбит|кбит|Мбит|мбит|Гбит|гбит|Тбит|kbit|Mbit|Gbit|Tbit|Kbps|Mbps|Gbps|kbps|mbps|gbps|KiB|MiB|GiB|TiB|кБ|КБ|МБ|Мб|ГБ|Гб|ТБ|Тб|ПБ|kB|KB|MB|GB|TB|PB|бит|Б|B)(?:\\/[сs])?';
export const FREQUENCY_UNITS = '(?:к|М|Г|Т)?Гц|(?:k|M|G|T)?Hz';
// The letter after the degree sign, Cyrillic `С` included: `nobr.nbsp_celsius` sets it apart from its
// number, so a reader of that number takes `4°C` the way it takes the `4 °C` it becomes.
export const TEMPERATURE_SCALES = 'C|С|F';
// The signs `abbr.nbsp_currency_prefix` sets apart from the amount after them, as class content: the
// amount starts a word there, as it does behind the no-break space that rule writes.
export const CURRENCY_PREFIX_SIGNS = `${G.EURO}$${G.RUB}`;
// Decimal units keep the existing anchored number grammar and case-sensitive vocabulary. A number
// has a digit: `.5` is one, the bare point of `p.s.` is not.
export const DECIMAL_UNIT = { number: '(?<![\\d.,])((?=[.,]*\\d)[\\d.,]+)', flags: 'gu' };
const voltBind = (gap) => new RegExp(`(?<!\\d)(\\d+)([вВ]|${gap}В)${CONTENT_END_LOOKAHEAD}`, 'gu');
export const VOLT_UNIT_RE = voltBind(`[ ${G.NBSP}]`);

// Shared content boundaries and the non-consuming right edge are identical for all bindings.
// The actual binding grammar also answers whether a word before an emphatic particle is a unit.
export const unitBind = (
  units,
  { number = '(\\d+)', flags = 'giu', gap = `( |${G.NBSP})?` } = {}
) => new RegExp(`${CONTENT_START_GROUP}${number}${gap}(${units})${CONTENT_END_LOOKAHEAD}`, flags);

const QUANTITY_GAP = `([ \t${G.NBSP}]+)`;
const QUANTITY_VOLT_RE = voltBind(`[ \t${G.NBSP}]+`);
const MEASUREMENT_READERS = [
  ...[LENGTH_UNITS, WEIGHT_UNITS, VOLUME_UNITS, TIME_UNITS].map((units) =>
    unitBind(units, { gap: QUANTITY_GAP })
  ),
  unitBind(DATA_UNITS, { flags: 'gu', gap: QUANTITY_GAP }),
  unitBind(FREQUENCY_UNITS, { ...DECIMAL_UNIT, gap: QUANTITY_GAP }),
  QUANTITY_VOLT_RE
].map((re) => ({
  re: new RegExp(re.source, re.flags.replace('g', 'y')),
  leading: re !== QUANTITY_VOLT_RE
}));

export function measurementBeforeParticle(source, start, end) {
  let number = start;
  while (
    source[number - 1] === ' ' ||
    source[number - 1] === '\t' ||
    source[number - 1] === G.NBSP
  ) {
    number -= 1;
  }
  while (number > 0 && /[\d.,]/u.test(source[number - 1])) {
    number -= 1;
  }
  if (number === start) {
    return false;
  }
  for (const { re, leading } of MEASUREMENT_READERS) {
    // unitBind consumes one leading boundary; the volt rule starts at the number itself.
    re.lastIndex = leading ? Math.max(0, number - 1) : number;
    const m = re.exec(source);
    if (m !== null && m.index + m[0].length === end) {
      return true;
    }
  }
  return false;
}
