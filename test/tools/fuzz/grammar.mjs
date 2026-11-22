// Russian prose as the engine meets it: typed by hand, with straight quotes, hyphens for dashes and
// plain spaces, interleaved with the markup, numbers and identifiers a document carries.
//
// Every construct the engine must return byte for byte goes through `guard`, which records it on
// the context. The record is what the protection invariant looks for in the output, so a guarded
// piece is never mutated and is always set off from its neighbours by a boundary the engine reads
// as one: white space or punctuation outside the construct's own syntax.

// Brackets around a guarded piece while the prose is assembled, stripped before the document is
// handed out. Both are noncharacters: neither occurs in generated text.
const OPEN = '\u{FDD0}';
const CLOSE = '\u{FDD1}';
const MARKS_RE = /[\u{FDD0}\u{FDD1}]/gu;
const SEGMENT_RE = /[^\u{FDD0}\u{FDD1}]+|\u{FDD0}[^\u{FDD0}\u{FDD1}]*\u{FDD1}/gu;

const pad2 = (n) => String(n).padStart(2, '0');

export const ADDED_RULE_PROSE = [
  ['magnitude', '5 тыс. руб.; 1,5 млн рублей; 1 млн чел.'],
  ['count', '12 шт.; 3 экз.; 4 чел.; 5 сек; 6 с; 7 мес.; 8 нед.; 9 дн.; 10 коп.'],
  ['si', '5 Вт; 2 кВт; 3 кВт·ч; 4 А; 6 га; 7 ‰; 2 кв. м; 3 куб. м; 100 л. с.'],
  ['currency-code', '100 USD; 200 EUR; 300 RUB'],
  ['title', 'проф. Иванов, акад. Петров, доц. Сидоров, д-р Живаго, тов. Корвин, св. Пётр'],
  ['part', 'т. 1, ч. 2, табл. 3, разд. 4, пп. 5, стст. 6'],
  ['because', 'т. к., т. н., т. о., и др., и пр.'],
  [
    'organization',
    'ПАО Банк, АО Завод, НКО Фонд, ИП Иванов, ФГУП Почта, МУП Вода, ГК Мир, НПО Космос, АНО Тень'
  ],
  ['initial', 'А. Пушкин; Дж. Р. Р. Толкин'],
  ['after-number', '12 человек, 2024 год'],
  ['last-word', 'Это мой дом.'],
  ['phone', '+7 (999) 123 45 67; 8-800-555-35-35; +7-999-123-45-67'],
  ['century', 'XXI век, XX в., 5 в. до н. э.'],
  ['minus', 'Температура -5 градусов; -10; 1-5; 10 - 5; x-5'],
  ['fraction', '1/3, 2/3, 1/8, 3/8, 5/8, 7/8'],
  ['prime', 'Рост 5\' 10"'],
  ['arrows', 'Туда <-> обратно => вывод <=> равенство'],
  ['plus-minus', 'Погрешность +/-5'],
  ['triple-hyphen', 'Корвин --- принц']
];
const escapeXml = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// A context is one stretch of prose: what it may contain and where its guarded pieces go.
// `comments` is whether the format reads an HTML comment as one: a data format's value is a
// fragment where only elements are markup.
function context({
  markup = false,
  markdown = false,
  xml = false,
  comments = true,
  template = null,
  placeholders = 'off',
  eol,
  lines
}) {
  return {
    markup,
    markdown,
    xml,
    comments,
    template: template === 'off' ? null : template,
    placeholders,
    eol,
    lines,
    protect: []
  };
}

// `before` and `after` are what must surround the piece for it to be the construct at all, as
// patterns: a shrunk case that drops them no longer holds the construct, and the check skips it.
function guard(ctx, kind, text, { before = '', after = '' } = {}) {
  const plain = text.replaceAll(MARKS_RE, '');

  ctx.protect.push({
    kind,
    text: plain,
    context:
      before === '' && after === ''
        ? null
        : new RegExp(`(?=${RegExp.escape(plain)})${before}${RegExp.escape(plain)}${after}`, 'u')
  });

  return `${OPEN}${plain}${CLOSE}`;
}

const nl = (ctx) => (typeof ctx.eol === 'function' ? ctx.eol() : ctx.eol);

export const RESERVED = ['\u{E000}', '\u{E001}', '\u{E100}', '\u{E101}'];
const ASTRAL = ['😀', '👍🏽', '𝔸', '𠀀', '🇷🇺', '𝟙', '🙂'];
const SHORT = [
  'а',
  'и',
  'в',
  'во',
  'к',
  'ко',
  'с',
  'со',
  'о',
  'об',
  'у',
  'но',
  'да',
  'не',
  'ни',
  'же',
  'ли',
  'бы',
  'за',
  'на',
  'по',
  'до',
  'из',
  'от',
  'он',
  'мы',
  'вы',
  'я',
  'ты',
  'то',
  'их'
];
const STARTERS = [
  'И',
  'А',
  'В',
  'Но',
  'Он',
  'Я',
  'Мы',
  'С',
  'К',
  'О',
  'У',
  'Не',
  'На',
  'По',
  'Вот'
];
const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря'
];
const MONTH_NAMES = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август'];
const ADDRESS_ABBR = ['г.', 'ул.', 'пер.', 'просп.', 'пл.', 'бул.', 'наб.', 'пр.', 'ш.'];
const NUMBER_ABBR = ['д.', 'кв.', 'эт.', 'стр.', 'с.', 'рис.', 'табл.', 'гл.', 'п.', 'пп.', 'ч.'];
const NUMBER_ABBR_MORE = ['т.', 'разд.', 'ст.', 'стст.', '§', '№', '№№'];
const TITLE_ABBR = ['проф.', 'акад.', 'доц.', 'д-р', 'тов.', 'св.', 'им.', 'г-н', 'г-жа'];
const FREE_ABBR = [
  ['т', 'е'],
  ['т', 'д'],
  ['т', 'п'],
  ['т', 'к'],
  ['т', 'н'],
  ['т', 'о'],
  ['т', 'ч'],
  ['н', 'э']
];
const TAIL_ABBR = [
  'и др.',
  'и пр.',
  'и т.д.',
  'и т. д.',
  'и т.п.',
  'и т. п.',
  'и проч.',
  'и мн. др.'
];
const UNITS = [
  'кг',
  'г',
  'мг',
  'т',
  'м',
  'км',
  'см',
  'мм',
  'м²',
  'м2',
  'км/ч',
  'м/с',
  'л',
  'мл',
  '°C',
  '°',
  '°F',
  '%',
  '‰',
  'ГБ',
  'МБ',
  'Кб',
  'Мбит/с',
  'ГГц',
  'МГц',
  'Гц',
  'px',
  'em',
  'rem',
  'В',
  'кВт',
  'кВт·ч',
  'Вт',
  'А',
  'га',
  'мин',
  'ч',
  'сек',
  'с',
  'мес.',
  'кв. м',
  'куб. м',
  'л. с.',
  'шт.',
  'экз.',
  'чел.',
  'дн.',
  'нед.'
];
const CURRENCY_AFTER = [
  'руб.',
  'руб',
  'р.',
  '₽',
  'рублей',
  'рубля',
  'коп.',
  'долл.',
  'долл. США',
  'USD',
  'EUR',
  'RUB',
  '€',
  '$',
  'у. е.'
];
const CURRENCY_BEFORE = ['$', '€', '£', 'EUR', 'USD', '₽'];
const MAGNITUDE = ['тыс.', 'тыс', 'млн', 'млн.', 'млрд', 'трлн'];
const MAGNITUDE_UNIT = ['руб.', 'рублей', '₽', 'долл.', 'чел.', 'шт.', 'км', 'т'];
const ID_WORDS = [
  'ИНН',
  'КПП',
  'ОГРН',
  'БИК',
  'счёт',
  'счет',
  'р/с',
  'к/с',
  'индекс',
  'код',
  'арт.'
];
const ORG_FORMS = ['ООО', 'ПАО', 'АО', 'ЗАО', 'НКО', 'ИП', 'ФГУП', 'МУП', 'ГК', 'НПО', 'АНО'];
const OPERATORS = [
  '-',
  '--',
  '->',
  '<-',
  '<->',
  '<=>',
  '=>',
  '<=',
  '>=',
  '!=',
  '+-',
  '+/-',
  '=',
  'x',
  '*',
  '/',
  '==',
  '-->',
  '<--',
  '<<',
  '>>',
  '~',
  '^'
];
// A `<` and a letter open a tag that runs to the next `>`, so a tag right after one is only its
// attribute text: a shrunk case that leaves such a `<` in front no longer holds the tag. The letter
// is an ASCII one, as HTML names a tag; a quoted attribute value and a template expression are read
// through whole, their `>` ending nothing, and a value left open runs on.
const TAG_ATOM = String.raw`[^>"'{<]|"[^"]*"|'[^']*'|<%[^]*?%>|\{%[^]*?%\}|\{\{[^]*?\}\}|[{<]`;
export const OUTSIDE_TAG = String.raw`(?<!<[A-Za-z](?:${TAG_ATOM})*(?:"[^"]*|'[^']*)?)`;
const TAG_START_RE = /<(?=[A-Za-z/!?])/gu;
// A UUID or an IPv6 address glued to more hex digits or colons is a different token or none.
const HEX_EDGE_BEFORE = String.raw`(?<![\p{L}\p{N}:\-])`;
const HEX_EDGE_AFTER = String.raw`(?![\p{L}\p{N}:\-])`;
// Delimiters must be maximal runs; the invariant independently checks their actual pairing.
const CODE_EDGE = { before: '(?<!`)', after: '(?!`)' };
const ROMAN = ['I', 'II', 'IV', 'V', 'IX', 'X', 'XIV', 'XIX', 'XX', 'XXI'];
const DASHES = [
  [8, ' - '],
  [3, '-'],
  [2, ' -'],
  [2, '- '],
  [2, ' -- '],
  [1, '--'],
  [2, ' — '],
  [1, '—'],
  [1, ' – '],
  [1, '–'],
  [1, ' --- '],
  [1, '---'],
  [1, '\u{A0}- '],
  [1, ' -\u{A0}'],
  [1, '\u{A0}— ']
];
const ELLIPSES = ['...', '..', '....', '…', '?..', '!..', '?!', '!?', '!!!', '???', '!!', '??'];
const QUOTE_STYLES = [
  [10, ['"', '"']],
  [2, ["'", "'"]],
  [3, ['«', '»']],
  [2, ['„', '“']],
  [2, ['“', '”']],
  [1, ['«', '"']],
  [1, ['"', '»']]
];
const ENTITY_QUOTES = [
  ['&quot;', '&quot;'],
  ['&#34;', '&#34;'],
  ['&#x22;', '&#x22;'],
  ['&laquo;', '&raquo;'],
  ['&#171;', '&#187;']
];
const ENTITIES = [
  '&nbsp;',
  '&#160;',
  '&#xA0;',
  '&#x00A0;',
  '&quot;',
  '&#34;',
  '&#x22;',
  '&amp;',
  '&lt;',
  '&gt;',
  '&mdash;',
  '&ndash;',
  '&hellip;',
  '&laquo;',
  '&raquo;',
  '&copy;',
  '&#8212;',
  '&shy;',
  '&thinsp;'
];
export const INLINE_TAGS = [
  'b',
  'i',
  'em',
  'strong',
  'span',
  'a',
  'abbr',
  'small',
  'sup',
  'sub',
  'mark'
];
export const SAFE_TAGS = [
  'pre',
  'code',
  'script',
  'style',
  'kbd',
  'samp',
  'var',
  'tt',
  'textarea',
  'math'
];
const HOSTS = [
  'example.com',
  'amber.ru',
  'www.example.com',
  'xn--80aswg.xn--p1ai',
  'sub.domain.co.uk',
  'arden.technology',
  'localhost:8080',
  '127.0.0.1'
];
const LETTER_HOSTS = ['example.com', 'amber.ru', 'sub.domain.co.uk', 'arden.technology'];
const PATHS = [
  '',
  '/',
  '/a-b',
  '/path/to/file--name.html',
  '/search?q=a-b&x=1',
  '/?a=1&amp;b=2',
  '/wiki/Амбер',
  '/~user/',
  '/a...b/c',
  '/docs/v1.2/api#section-1',
  '/t?n=100000',
  '/img/2024-01-01.png'
];
const SCHEMES = [
  [4, 'http://'],
  [4, 'https://'],
  [1, 'ftp://'],
  [2, 'www.'],
  [2, '']
];
const IDENTIFIERS = [
  ['f', 'c'],
  ['f', 'r'],
  ['g', 'C'],
  ['render', ''],
  ['printf', 'x'],
  ['init', ''],
  ['max', 'a, b'],
  ['len', 's']
];
const PRINTF = ['%s', '%d', '%1$s', '%2$d', '%@', '%.2f', '%%', '%5s'];
const TEMPLATE_BITS = {
  handlebars: [
    '{{ name }}',
    '{{{ body }}}',
    '{{#if user}}',
    '{{/if}}',
    '{{! заметка - "x" }}',
    '{{!-- a -- "b" --}}',
    '{{ t "a - b" }}',
    '{{~ trim ~}}'
  ],
  mustache: ['{{ name }}', '{{{ raw }}}', '{{! заметка - "x" }}', '{{#items}}', '{{/items}}'],
  twig: [
    '{{ user.name|upper }}',
    '{% if a - b > 0 %}',
    '{% endif %}',
    '{# "c" - d #}',
    '{{ "a - b" ~ x }}'
  ],
  liquid: ['{{ x | default: "a - b" }}', '{% if a %}', '{% endif %}', '{% comment %}', '{{ "c" }}'],
  erb: ['<%= "a" - b %>', '<% if x %>', '<% end %>', '<%# c - "d" %>', '<%- t("x - y") %>']
};
TEMPLATE_BITS.jinja = TEMPLATE_BITS.twig;
TEMPLATE_BITS.nunjucks = TEMPLATE_BITS.twig;

export function createGrammar(lexicon, d) {
  const { int, pick, chance, weighted } = d;

  const word = () => pick(lexicon.words);
  const capital = () => pick(lexicon.capital);
  const short = () => (chance(0.8) ? pick(SHORT) : pick(lexicon.short));
  const latin = () => pick(lexicon.latin);
  const digits = (n) => {
    let s = String(int(1, 9));

    while (s.length < n) {
      s += String(int(0, 9));
    }

    return s;
  };
  const tightSpace = () => pick(['', ' ', ' ', '\u{A0}']);
  const initialSpace = () => pick([' ', ' ', '', '\u{A0}']);
  const unitSpace = () => pick(['', ' ', ' ', ' ', '\u{A0}']);
  const initial = () =>
    pick(['А', 'Б', 'В', 'Г', 'Д', 'Е', 'И', 'К', 'Л', 'М', 'Н', 'П', 'Р', 'С', 'Т']);

  const year = () => int(1700, 2030);
  const time = () => `${int(0, 23)}:${pad2(int(0, 11) * 5)}`;
  const roman = () => `${pick(ROMAN)}-${pick(ROMAN)}`;

  function gap() {
    return weighted([
      [40, ' '],
      [2, '  '],
      [1, '\t'],
      [2, '\u{A0}'],
      [1, '\u{202F}'],
      [1, '\u{2009}'],
      [1, ' \u{A0}']
    ]);
  }

  function number() {
    return weighted([
      [6, () => String(int(1, 99))],
      [4, () => digits(int(3, 4))],
      [3, () => String(int(1900, 2030))],
      [2, () => digits(int(5, 9))],
      [1, () => digits(int(10, 20))],
      [2, () => `0${digits(int(1, 9))}`],
      [2, () => `${int(1, 99)} ${digits(3)}`],
      [1, () => `${int(1, 9)} ${digits(3)} ${digits(3)}`],
      [3, () => `${int(0, 99)}${pick([',', '.'])}${digits(int(1, 10))}`],
      [1, () => `${pick(['-', '−', '+', '±'])}${int(1, 999)}`],
      [1, () => `${pick(['-', '−'])}${int(0, 9)},${digits(int(1, 3))}`],
      [1, () => `.${digits(int(1, 3))}`],
      [1, () => `${int(1, 9)}/${int(2, 9)}`],
      [1, () => `${int(1, 99)}${pick(["'", '"', '′', '″'])}`],
      [1, () => `${int(2, 10)}^${int(2, 3)}`],
      [1, () => `${int(1, 9)}${pick(['x', 'х', '*', '×'])}${int(1, 9)}`]
    ])();
  }

  function date() {
    const dd = pad2(int(1, 31));
    const mm = pad2(int(1, 12));
    const yyyy = String(int(1900, 2030));
    const y2 = String(int(Number(yyyy), 2035));
    const suffix = pick(['', 'г.', ' г.', 'г', ' г', ' года', '\u{A0}г.']);

    return weighted([
      [4, () => `${dd}.${mm}.${yyyy}${suffix}`],
      [1, () => `${dd}.${mm}.${yyyy.slice(2)}${suffix}`],
      [3, () => `${yyyy}${pick(['г.', ' г.', ' год', ' году', 'г', '-й'])}`],
      [
        2,
        () =>
          `${yyyy}${pick(['-', '—', '–', ' - '])}${y2}${pick(['', ' гг.', 'гг.', ' г.г.', ' г.', 'г.'])}`
      ],
      [
        1,
        () =>
          `${pick(['с', 'по', 'в', 'между', 'начала', 'конца'])} ${yyyy}-${y2} ${pick(['гг.', 'г.', 'годов'])}`
      ],
      [
        2,
        () =>
          `${int(1, 31)} ${pick(MONTHS)}${pick(['', ` ${yyyy}`, ` ${yyyy} г.`, ` ${yyyy}г.`, ` ${yyyy} года`])}`
      ],
      [1, () => `${int(1, 15)}-${int(16, 31)} ${pick(MONTHS)}`],
      [1, () => `${int(1, 15)} ${pick(MONTHS)}-${int(1, 28)} ${pick(MONTHS)}`],
      [1, () => `${pick(MONTH_NAMES)}-${pick(MONTH_NAMES)}`],
      [1, () => `${pick(ROMAN)} ${pick(['век', 'в.', 'вв.', 'веке', 'в. до н. э.', 'в. н.э.'])}`],
      [1, () => `${int(1, 9)} ${pick(['в.', 'век'])} до н. э.`]
    ])();
  }

  // A date that ends its sentence and so takes the sentence's full stop as its own.
  function closingDate() {
    const dd = pad2(int(1, 28));
    const mm = pad2(int(1, 12));
    const yyyy = String(int(1900, 2030));

    return pick([
      `${dd}.${mm}.${yyyy}г.`,
      `${dd}.${mm}.${yyyy} г.`,
      `${yyyy}г.`,
      `${yyyy} г.`,
      `${int(1990, 2000)}-${int(2001, 2030)} гг.`
    ]);
  }

  function abbreviation() {
    return weighted([
      [3, () => `${pick(ADDRESS_ABBR)}${tightSpace()}${chance(0.7) ? capital() : word()}`],
      [3, () => `${pick(NUMBER_ABBR)}${tightSpace()}${int(1, 120)}`],
      [2, () => `${pick(NUMBER_ABBR_MORE)}${tightSpace()}${int(1, 40)}`],
      [2, () => `${pick(TITLE_ABBR)}${tightSpace()}${capital()}`],
      [
        3,
        () => {
          const [a, b] = pick(FREE_ABBR);
          return `${a}.${tightSpace()}${b}.`;
        }
      ],
      [2, () => pick(TAIL_ABBR)],
      [
        1,
        () => `${pick(['см.', 'ср.', 'напр.', 'англ.', 'лат.', 'букв.', 'др.-греч.'])} ${word()}`
      ],
      [1, () => `${pick(['в т. ч.', 'в т.ч.', 'т. к.', 'т.к.', 'т. н.', 'т.н.'])} ${word()}`]
    ])();
  }

  function initials() {
    return weighted([
      [3, () => `${initial()}.${initialSpace()}${initial()}.${initialSpace()}${capital()}`],
      [3, () => `${capital()}${initialSpace()}${initial()}.${initialSpace()}${initial()}.`],
      [2, () => `${initial()}. ${capital()}`],
      [1, () => `${pick(['Дж', 'Ш', 'Ж'])}. ${initial()}. ${initial()}. ${capital()}`]
    ])();
  }

  function quantity() {
    return weighted([
      [4, () => `${number()}${unitSpace()}${pick(UNITS)}`],
      [3, () => `${number()}${unitSpace()}${pick(CURRENCY_AFTER)}`],
      [2, () => `${pick(CURRENCY_BEFORE)}${unitSpace()}${number()}`],
      [
        2,
        () =>
          `${int(1, 999)}${pick([',5', '', ' '])}${unitSpace()}${pick(MAGNITUDE)}${unitSpace()}${pick(MAGNITUDE_UNIT)}`
      ],
      [1, () => `${int(1, 99)} руб. ${int(1, 99)} коп.`],
      [1, () => `${int(1, 99)} ${pick(['долл. США', 'тыс. руб.', 'млн рублей', 'млн чел.'])}`],
      [1, () => `${int(1, 999)} ${pick(['USD', 'EUR', 'RUB'])}`],
      [1, () => `${int(1, 99)}%${pick(['', '-', '–'])}${int(1, 99)}%`],
      [
        1,
        () =>
          `${int(1, 100)}${unitSpace()}${pick(UNITS)}${pick(['-', ' - ', '–'])}${int(100, 999)}${unitSpace()}${pick(UNITS)}`
      ]
    ])();
  }

  function identifier() {
    return weighted([
      [3, () => `№${pick(['', ' ', ' ', '\u{A0}'])}${digits(int(1, 8))}`],
      [
        3,
        () =>
          `${pick(ID_WORDS)} ${pick([digits(int(6, 13)), `0${digits(int(5, 12))}`, digits(20)])}`
      ],
      [1, () => `${digits(6)}, ${capital()}`],
      [
        1,
        () =>
          `${pick(['заказ', 'артикул', 'договор'])} ${pick(['№ ', ''])}${pick([`000${digits(5)}`, digits(10)])}`
      ],
      [1, () => `СНИЛС ${digits(3)}-${digits(3)}-${digits(3)} ${digits(2)}`],
      [
        2,
        () =>
          weighted([
            [2, () => `+7 (${digits(3)}) ${digits(3)}-${digits(2)}-${digits(2)}`],
            [2, () => `8-800-${digits(3)}-${digits(2)}-${digits(2)}`],
            [1, () => `+7-${digits(3)}-${digits(3)}-${digits(2)}-${digits(2)}`],
            [1, () => `+7 ${digits(3)} ${digits(3)} ${digits(2)} ${digits(2)}`],
            [1, () => `8 (${digits(4)}) ${digits(2)}-${digits(2)}-${digits(2)}`]
          ])()
      ],
      [1, () => `${pick(ORG_FORMS)} ${pick(['«', '"'])}${capital()}${pick(['»', '"'])}`]
    ])();
  }

  function code() {
    return weighted([
      [
        3,
        () => {
          const [name, arg] = pick(IDENTIFIERS);
          return `${chance(0.5) ? name : latin()}(${arg})`;
        }
      ],
      [1, () => `${latin()}.${latin()}.${latin()}()`],
      [
        2,
        () =>
          `${pick(['x', 'a', 'n', latin(), 'utf', 'file', 'log'])}_${pick([int(1, 12), latin(), 2, 8])}`
      ],
      [1, () => `file_${int(1, 9)}.txt`],
      [2, () => pick(PRINTF)],
      [2, () => `{${pick(['count', 'name', 'n', latin()])}}`],
      [1, () => `{count, plural, one {# ${word()}} other {# ${word()}}}`],
      [1, () => `\${${latin()}}`],
      [1, () => `$${pick(['a', 'x'])} - ${pick(['b', 'y'])}$`],
      [1, () => `:::${pick(['note', 'warning', 'tip'])}`],
      [1, () => pick(['(c)', '(C)', '(r)', '(R)', '(tm)', '(TM)', '(p)', '(P)'])],
      [1, () => `${pick(['(c)', '(C)', '©'])} ${int(1990, 2030)}`],
      [1, () => `${latin()}${pick(['(R)', '(r)', '(TM)'])}`],
      [1, () => `${pick(['(a)', '(а)'])}, ${pick(['(b)', '(б)'])}, ${pick(['(c)', '(в)'])}`],
      [
        2,
        () => {
          const operand = () => pick(['a', 'b', 'x', 'y', 'n', String(int(0, 99)), word()]);
          return `${operand()}${pick([' ', '', ' '])}${pick(OPERATORS)}${pick([' ', '', ' '])}${operand()}`;
        }
      ],
      [1, () => `${pick(['x', 'y'])} = ${int(1, 99)} - ${int(1, 99)}`],
      [1, () => `${int(1, 99)} - ${int(1, 99)} = ${int(1, 99)}`]
    ])();
  }

  function url() {
    const scheme = weighted(SCHEMES);
    // Without a scheme only a host ending in a letter zone and followed by a slash is an address.
    const host = scheme === 'www.' || scheme === '' ? pick(LETTER_HOSTS) : pick(HOSTS);
    let path = pick(PATHS);

    if (scheme === '' && !path.startsWith('/')) {
      path = '/a-b';
    }

    return `${scheme}${host}${path}`;
  }

  function email() {
    const local = pick(['oberon', 'corwin.amber', 'r+tag', 'fiona_x', 'dvorkin-1', 'info']);
    const domain = pick(['amber.ru', 'example.com', 'rebma.co.uk', 'почта.рф', 'mail.example.org']);

    return `${local}@${domain}`;
  }

  function address(ctx) {
    const text = url();

    return ctx.xml ? text.replaceAll('&amp;', '').replaceAll('&', '') : text;
  }

  // An address and an e-mail with one sign between them: each is read where the other already is a
  // placeholder, and either holds characters the other may hold. The signs are those that leave no
  // doubt where one ends: a `-` or a `.` after an e-mail goes on with its domain.
  function glued(ctx) {
    const pair = [guard(ctx, 'url', address(ctx)), guard(ctx, 'email', email())];

    if (pick([true, false])) {
      pair.reverse();
    }

    return pair.join(pick(["'", '`', '"', '|', '(', ')', ',', ';', ':', '/', "'`"]));
  }

  function sequence(ctx) {
    const kind = weighted([
      [5, 'url'],
      [3, 'email'],
      [1, 'uuid'],
      [1, 'ipv6'],
      [1, 'glued']
    ]);
    let text;

    if (kind === 'glued') {
      return glued(ctx);
    }

    if (kind === 'url') {
      text = address(ctx);
    } else if (kind === 'email') {
      text = email();
    } else if (kind === 'uuid') {
      text = `${digits(8)}-ab${digits(2)}-4${digits(3)}-a${digits(3)}-${digits(12)}`;
    } else {
      text = pick(['[2001:db8::1]:8080', 'fe80::1', '2001:db8:85a3::8a2e:370:7334']);
    }

    return kind === 'uuid' || kind === 'ipv6'
      ? guard(ctx, kind, text, { before: HEX_EDGE_BEFORE, after: HEX_EDGE_AFTER })
      : guard(ctx, kind, text);
  }

  // Content for a code-like element: everything the rules would change if they saw it.
  function bait(ctx) {
    const parts = [];

    for (let n = int(1, 4); n > 0; n--) {
      parts.push(
        pick([
          () => `a - b "c" 'd' -- e`,
          () => `x = 5 - 3; y = "a" + 'b'`,
          () => `(c) (r) (tm) 1/2 ... ?! !!`,
          () => `${number()} ${pick(UNITS)}`,
          () => date(),
          () => `${word()} - ${word()}`,
          () => `"${short()} "${word()}" ${short()}"`,
          () => `if (a <= b && c != d) { f(x) }`,
          () => `т.е. г. Москва ${initials()}`,
          () => `  ${word()}  ${word()}\t${word()}`,
          () => code()
        ])()
      );
    }

    return parts.join(ctx.lines ? pick([' ', nl(ctx)]) : ' ');
  }

  function safeTag(ctx) {
    const tag = pick(SAFE_TAGS);
    const attrs = chance(0.3)
      ? pick([' class="lang-js"', ' data-x="a - b"', ' title=\'"q"\''])
      : '';
    let inner = bait(ctx);

    if (tag === 'textarea' || tag === 'script' || tag === 'style') {
      inner = inner.replaceAll('<', ' ');
    } else {
      inner = inner.replaceAll(TAG_START_RE, '< ');
    }

    return guard(ctx, `<${tag}>`, `<${tag}${attrs}>${inner}</${tag}>`, { before: OUTSIDE_TAG });
  }

  function attributeValue() {
    return pick([
      `a - b`,
      `"${word()}" - ${word()}`,
      `${url()}`,
      `x--y (c)`,
      `${word()} ... ${word()}`,
      `1/2`
    ]);
  }

  function inlineTag(ctx, inner) {
    const tag = pick(INLINE_TAGS);
    let attrs = '';

    if (tag === 'a') {
      attrs = ` href="${url().replaceAll('"', '')}"`;
    }

    if (chance(0.4)) {
      const value = attributeValue();
      const quote = value.includes('"') ? "'" : '"';

      attrs += ` ${pick(['title', 'class', 'data-note', 'alt'])}=${quote}${value}${quote}`;
    }

    const open = guard(ctx, 'tag', `<${tag}${attrs}>`, { before: OUTSIDE_TAG });
    const close = guard(ctx, 'tag', `</${tag}>`, { before: OUTSIDE_TAG });

    return `${open}${inner}${close}`;
  }

  function voidTag(ctx) {
    return guard(
      ctx,
      'tag',
      pick([
        '<br>',
        '<br/>',
        '<br />',
        `<img src="a-b.png" alt="${word()} - ${word()}">`,
        `<input value="a - b" disabled>`,
        `<wbr>`,
        `<hr class="x--y">`
      ])
    );
  }

  function comment(ctx) {
    const text = `<!--${pick([' ', ''])}${pick([`${word()} - "${word()}"`, 'a -- b', bait({ lines: false }).replaceAll('>', ''), ''])} -->`;

    return ctx.comments ? guard(ctx, 'comment', text) : text;
  }

  function templateBit(ctx) {
    return guard(ctx, 'template', pick(TEMPLATE_BITS[ctx.template]));
  }

  function localizationBit(ctx) {
    const mode =
      ctx.placeholders === 'all' ? pick(['icu', 'printf', 'interpolation']) : ctx.placeholders;
    if (mode === 'printf') {
      return guard(ctx, 'printf', pick(['%s', '%1$s', '%@', '%d', '%05d', '%2$.*3$f']));
    }
    if (mode === 'interpolation') {
      return guard(ctx, 'interpolation', pick([`\${name}`, `\${total}`, `\${user.name}`]));
    }
    if (chance(0.4)) {
      return guard(ctx, 'icu', pick(['{name}', '{amount, number, ::currency/USD}']));
    }
    const syntax = (part) =>
      guard(
        ctx,
        'icu-syntax',
        part,
        part === '#' ? { before: String.raw`(?<=\{n, plural, one \{|\} other \{)` } : {}
      );
    return `${syntax('{n, plural, one {')}${syntax('#')} ${word()} - "${word()}"${syntax('} other {')}${syntax('#')} ${word()} - "${word()}"${syntax('}}')}`;
  }

  // A quotation nests up to three levels deep; the inner ones like a short word in front of them.
  function quoted(ctx, depth) {
    const [open, close] = ctx.markup && chance(0.15) ? pick(ENTITY_QUOTES) : weighted(QUOTE_STYLES);
    const parts = [];

    if (chance(0.7)) {
      parts.push(chance(0.5) ? short() : word());
    }

    if (depth < 3 && chance(depth === 1 ? 0.45 : 0.4)) {
      parts.push(quoted(ctx, depth + 1));
    } else {
      parts.push(word());
    }

    if (chance(0.6)) {
      parts.push(chance(0.4) ? short() : word());
    }

    if (chance(0.25)) {
      parts.push(chunk(ctx, depth + 1));
    }

    const inside = parts.join(chance(0.9) ? ' ' : gap());
    const pad = chance(0.05) ? ' ' : '';

    return `${open}${pad}${inside}${pad}${chance(0.97) ? close : ''}`;
  }

  function dashed(ctx) {
    const left = chance(0.7) ? word() : number();
    const right = chance(0.7) ? word() : number();

    return weighted([
      [6, () => `${left}${weighted(DASHES)}${right}`],
      [2, () => `${word()}-${pick(['то', 'либо', 'нибудь', 'таки', 'ка', 'де'])}`],
      [1, () => `${pick(['из-за', 'из-под', 'по-русски', 'по-моему', 'кое-как', 'а-ля'])}`],
      [1, () => `${number()}${pick(['-', ' - ', '–', '—', '...'])}${number()}`],
      [1, () => `${short()}${weighted(DASHES)}${word()}`],
      [1, () => `${word()} ${pick(['что бы', 'вот же', 'как бы', 'всё же', 'то ли'])}`],
      [1, () => quoted(ctx, 1)]
    ])();
  }

  function parenthesised(ctx) {
    const inside = [word(), chance(0.5) ? chunk(ctx, 2) : word()].join(' ');

    return weighted([
      [5, () => `(${inside})`],
      [1, () => `( ${inside} )`],
      [1, () => `[${int(1, 30)}]`],
      [1, () => `(${inside}`],
      [1, () => `${inside})`],
      [1, () => `(${number()} ${pick(UNITS)})`]
    ])();
  }

  // Constructs only a rule or two read: without them those rules see no input the fuzzer checks.
  function rare(ctx) {
    const choices = [
      () => `${int(72, 1200)}${pick([' ', ''])}${pick(['dpi', 'lpi', 'DPI'])}`,
      () => `${pick(['P.S.', 'P. S.', 'p.s.', 'P.P.S.', 'P.p.s.'])} ${capital()}`,
      () => `${int(10, 255)}.${int(0, 255)}.${int(0, 255)}.${int(1, 254)}`,
      () => `+7${pick([' ', ''])}(${digits(3)})${pick([' ', ''])}${digits(7)}`,
      () => `${roman()} ${pick(['вв.', 'в.', 'вв', 'в. в.'])}`,
      () => `${pick(['главы', 'тома', 'части', 'века'])} ${roman()}`,
      () => `${time()}${pick(['-', '—', '–'])}${time()}`,
      () => `(${word()} ${word()}${pick(['.', ',', ';', ':', '!.'])})`,
      () => `${word()}${pick(['?..', '!..'])}${word()}`,
      () => `${year()}${pick(['год', 'году', 'года', 'годом'])}`,
      () => `${pick(['½', '¼', '¾'])} ${pick(['кг', 'г', 'м', 'см', 'км', 'т'])}`,
      () => `${word()}"${year()}г.`,
      () => pick(["rock'n'roll", "д'Артаньян", "О'Коннор", "don't", "it''s", "Жанна д'Арк"]),
      () => `как то: ${word()}, ${word()}`,
      () => `${int(-40, 120)}F`,
      () => `${word()}« ${word()}`,
      () => `(${word()} ${pick(['…', '...'])})`,
      () => `${pick(['(', '«'])}${pick(['… ', '…', ' … '])}${word()}`,
      () =>
        `${pick(['-', '−'])}${int(1, 40)}${pick(['...', '…'])}${pick(['', '+', ' '])}${int(1, 40)}`,
      () => `${word()}${pick([',«', ' ,'])}${word()}`,
      () => `${pad2(int(0, 23))}${pick([' : ', ' :', ': '])}${pad2(int(0, 59))}`,
      () => `${word()}${pick(['!,!?', '?;?', '!,,!', '?,!'])}`,
      () => `${capital()}.».`,
      () => {
        const w = word();
        return chance(0.5) ? `${w} ${w}` : `${w[0].toUpperCase()}${w.slice(1)} ${w}`;
      },
      // A backtick opens code in Markdown.
      ...(ctx.markdown ? [] : [() => word().replace(/([аеёиоуыэюя])(?=\p{L})/u, '$1`')]),
      ...(ctx.markup && !ctx.xml
        ? [
            () => `${word()} ^${pick(['2', '3', 'th', 'нд', '-1', 'n'])}`,
            () =>
              `<span style="white-space:nowrap;">${pick([date(), initials(), `${date()} и т. д.`])} ${pick(['и т. д.', 'т. е.', 'до н. э.'])}</span>`,
            () => {
              const open = guard(ctx, 'tag', `<a href="${url().replaceAll('"', '')}">`, {
                before: OUTSIDE_TAG
              });
              const close = guard(ctx, 'tag', '</a>', { before: OUTSIDE_TAG });

              return `${open}"${word()} ${word()}"${close}`;
            }
          ]
        : [])
    ];

    return pick(choices)();
  }

  function markup(ctx) {
    return weighted([
      [4, () => inlineTag(ctx, chance(0.7) ? word() : `${word()} ${chunk(ctx, 2)}`)],
      [3, () => safeTag(ctx)],
      [2, () => comment(ctx)],
      [3, () => pick(ENTITIES)],
      [1, () => voidTag(ctx)],
      [1, () => `${word()}${pick(ENTITIES)}${word()}`]
    ])();
  }

  function markdownInline(ctx) {
    return weighted([
      [
        3,
        () => guard(ctx, 'md-code', `\`${bait({ lines: false }).replaceAll('`', "'")}\``, CODE_EDGE)
      ],
      [1, () => guard(ctx, 'md-code', `\`\` ${word()} \` ${word()} - "x" \`\``, CODE_EDGE)],
      [
        3,
        () => {
          const target = pick(
            [url(), './docs/a-b--c.md', '../x/y.md#раздел-1', '#якорь-2', '/img/a - b.png'].map(
              (t) => (t.includes(' ') ? `<${t}>` : t)
            )
          );
          const title = chance(0.4) ? ` "${word()} - ${word()}"` : '';
          return `${chance(0.2) ? '!' : ''}[${word()} ${chunk(ctx, 2)}${guard(ctx, 'md-link', `](${target}`, { before: String.raw`\[[^\[\]\r\n]*`, after: String.raw`(?: "[^"\r\n]*")?\)` })}${title})`;
        }
      ],
      [
        1,
        () => {
          const label = pick(['ref', 'a-b', '1', 'a - b', 'Глава "1"', '']);
          return `[${word()} ${chunk(ctx, 2)}][${label === '' || ctx.data ? label : guard(ctx, 'md-label', label, { before: String.raw`\[[^\[\]\r\n]*\]\[`, after: String.raw`\](?!\()` })}]`;
        }
      ],
      [
        2,
        () =>
          `${pick(['*', '**', '_', '__', '~~'])}${word()}${chance(0.3) ? ` ${word()}` : ''}${pick(['*', '**', '_', '__', '~~'])}`
      ],
      [
        1,
        () =>
          guard(
            ctx,
            'md-autolink',
            `<${pick(['https://example.com/a-b', 'mailto:oberon@amber.ru'])}>`
          )
      ]
    ])();
  }

  function xmlAtom(ctx) {
    return weighted([
      [
        3,
        () =>
          guard(
            ctx,
            'xml-entity',
            pick([
              '&amp;',
              '&lt;',
              '&gt;',
              '&quot;',
              '&apos;',
              '&#34;',
              '&#x22;',
              '&#8212;',
              '&#xA0;'
            ])
          )
      ],
      [
        1,
        () => guard(ctx, 'xml-cdata', `<![CDATA[${bait({ lines: false }).replaceAll(']]>', '')}]]>`)
      ],
      [1, () => guard(ctx, 'comment', `<!-- ${word()} - "${word()}" -->`)],
      [1, () => guard(ctx, 'xml-pi', `<?note ${word()} - "${word()}"?>`)]
    ])();
  }

  function chunk(ctx, depth = 1) {
    const choices = [
      [20, () => pick(ADDED_RULE_PROSE)[1]],
      [30, word],
      [10, () => `${short()} ${word()}`],
      [6, () => pick(lexicon.phrases).toLowerCase()],
      [6, capital],
      [2, () => pick(lexicon.caps)],
      [2, latin],
      [5, number],
      [5, date],
      [5, abbreviation],
      [2, initials],
      [6, quantity],
      [3, identifier],
      [4, code],
      [depth < 3 ? 7 : 0, () => quoted(ctx, depth)],
      [depth < 3 ? 3 : 0, () => parenthesised(ctx)],
      [6, () => dashed(ctx)],
      [2, () => sequence(ctx)],
      [3, () => rare(ctx)],
      [0.4, () => pick(RESERVED)],
      [0.6, () => pick(ASTRAL)],
      [ctx.markup ? 5 : 0, () => markup(ctx)],
      [ctx.markdown ? 5 : 0, () => markdownInline(ctx)],
      [ctx.xml ? 3 : 0, () => xmlAtom(ctx)],
      [ctx.template ? 3 : 0, () => templateBit(ctx)],
      [ctx.placeholders !== 'off' ? 3 : 0, () => localizationBit(ctx)]
    ];

    return weighted(choices)();
  }

  function sentence(ctx) {
    const parts = [];
    const opener = weighted([
      [10, () => capital()],
      [6, () => pick(STARTERS)],
      [2, () => `${pick(['- ', '— ', '-', '– '])}${capital()}`],
      [1, () => quoted(ctx, 1)],
      [1, () => number()]
    ])();

    parts.push(opener);

    for (let n = int(1, 9); n > 0; n--) {
      let piece = chunk(ctx);

      if (chance(0.12)) {
        piece += weighted([
          [6, ','],
          [1, ' ,'],
          [1, ';'],
          [1, ':'],
          [1, ',,'],
          [1, pick(ELLIPSES)]
        ]);
      }

      parts.push(piece);
    }

    let text = parts.join(gap());

    text += weighted([
      [8, () => '.'],
      [2, () => pick(['!', '?', '...', '?!', '!..', '?..', '…', '!!!'])],
      [1, () => ''],
      [2, () => `${gap()}${closingDate()}`],
      [1, () => `${gap()}${pick(TAIL_ABBR)}`],
      [
        1,
        () => `${gap()}${pick(['- ', '— '])}${pick(['сказал', 'ответил', 'спросил'])} ${capital()}.`
      ]
    ])();

    return text;
  }

  function paragraph(ctx) {
    const sentences = [];

    for (let n = int(1, 4); n > 0; n--) {
      sentences.push(sentence(ctx));
    }

    return sentences.join(
      ctx.lines && chance(0.1)
        ? nl(ctx)
        : weighted([
            [10, ' '],
            [1, '  '],
            [1, '\u{A0}']
          ])
    );
  }

  const MUTATIONS = [
    (s, i) => s.slice(0, i) + s[i] + s.slice(i),
    (s, i) =>
      s[i] === ' '
        ? s.slice(0, i) + pick(['\u{A0}', '\t', '  ', '\u{202F}', '\u{2009}', '']) + s.slice(i + 1)
        : s,
    (s, i) => s.slice(0, i) + pick(RESERVED) + s.slice(i),
    (s, i) => s.slice(0, i) + pick(ASTRAL) + s.slice(i),
    (s, i) =>
      s[i] === '"' ? s.slice(0, i) + pick(['«', '»', '„', '“', '”', "'"]) + s.slice(i + 1) : s,
    (s, i) =>
      s[i] === '-' ? s.slice(0, i) + pick(['--', '—', '–', ' - ', '-\u{A0}']) + s.slice(i + 1) : s,
    (s, i) =>
      /[.,!?;:]/u.test(s[i]) ? s.slice(0, i) + s[i].repeat(int(2, 4)) + s.slice(i + 1) : s,
    (s, i) => (/[\s.,]/u.test(s[i]) ? s.slice(0, i) + s.slice(i + 1) : s),
    (s, i) => s.slice(0, i) + s.slice(i).toUpperCase()
  ];

  // Mutations touch prose only, and never the character next to a guarded piece, which would move
  // the piece's own boundary.
  function mutate(text) {
    return text.replaceAll(SEGMENT_RE, (segment) => {
      if (segment.startsWith(OPEN) || segment.length < 3 || !chance(0.15)) {
        return segment;
      }

      let s = segment;

      for (let n = int(1, 3); n > 0; n--) {
        const i = int(1, s.length - 2);

        if (i >= 1 && i < s.length - 1 && !/[\uD800-\uDFFF]/u.test(s.slice(i - 1, i + 2))) {
          s = pick(MUTATIONS)(s, i);
        }
      }

      return s;
    });
  }

  // The prose as the document will hold it: mutated, escaped where XML asks for it, and with the
  // guard marks gone.
  function finish(ctx, text) {
    let out = mutate(text);

    if (ctx.xml) {
      out = out.replaceAll(SEGMENT_RE, (segment) =>
        segment.startsWith(OPEN) ? segment : escapeXml(segment)
      );
    }

    return out.replaceAll(MARKS_RE, '');
  }

  return {
    context,
    guard,
    nl,
    sentence,
    paragraph,
    chunk,
    bait,
    word,
    capital,
    latin,
    number,
    url,
    finish,
    strip: (text) => text.replaceAll(MARKS_RE, '')
  };
}
