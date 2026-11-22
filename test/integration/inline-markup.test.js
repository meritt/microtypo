import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { microtypo, MicroTypo } from '../../src/index.js';

// Expectations are written with the signs of the brief: `⍽` a no-break space, `⎵` a narrow one.
const nb = (text) => text.replaceAll('⍽', '\u{A0}').replaceAll('⎵', '\u{202F}');
const NOWRAP = '<span style="white-space:nowrap;">';
const stripTags = (text) => text.replace(/<[^>]*>/gu, '');

const HTML = { input: 'html', html: false };
const TEXT = { input: 'text', html: false };
const WRAPPERS = { html: true, render: { paragraphs: false } };

const typeset = (config, text) => new MicroTypo(config).process(text);

// The output of one pass, and of a second pass over it.
const twice = (config, text) => {
  const typo = new MicroTypo(config);
  const once = typo.process(text);

  return [once, typo.process(once)];
};

describe('inline markup is transparent to the rules that bind words', () => {
  test('a dotted initial binds to a surname inside a generated nowrap or author emphasis', () => {
    const config = WRAPPERS;
    for (const [input, expected] of [
      ['С. Пушкин ГБ здесь', `С.⍽${NOWRAP}Пушкин ГБ</span> здесь`],
      ['С. <em>Пушкин ГБ здесь</em>', 'С.⍽<em>Пушкин⍽ГБ здесь</em>'],
      ['С. <em>Пушкин</em> ГБ здесь', `С.⍽${NOWRAP}<em>Пушкин</em> ГБ</span> здесь`],
      ['Дж. Толкин РР ушёл', `Дж.⍽${NOWRAP}Толкин РР ушёл</span>`],
      ['С. <code>Пушкин</code> здесь', 'С. <code>Пушкин</code> здесь']
    ]) {
      assert.deepEqual(twice(config, input), [nb(expected), nb(expected)]);
    }
  });

  test('a paragraph binds the same with its words in inline tags as without them', () => {
    assert.equal(
      typeset(HTML, '<p>Он в доме и саду, т.е. дома, 10 кг, А. С. Пушкин, 2024 г., и т.д.</p>'),
      nb('<p>Он⍽в⍽доме и⍽саду, т.⍽е. дома, 10⍽кг, А.⍽С.⍽Пушкин, 2024⍽г., и⍽т.⍽д.</p>')
    );
    assert.equal(
      typeset(
        HTML,
        '<p>Он в <em>доме</em> и <a href="/x">саду</a>, т.е. <b>дома</b>, 10 <b>кг</b>, А. С. <em>Пушкин</em>, <i>2024</i> г., и <i>т.д.</i></p>'
      ),
      nb(
        '<p>Он⍽в⍽<em>доме</em> и⍽<a href="/x">саду</a>, т.⍽е. <b>дома</b>, 10⍽<b>кг</b>, А.⍽С.⍽<em>Пушкин</em>, <i>2024</i>⍽г., и⍽<i>т.⍽д.</i></p>'
      )
    );
  });

  test('a tag stays against the same character, a space outside an element stays outside', () => {
    const cases = [
      ['<p><em>Он в</em> доме.</p>', '<p><em>Он⍽в</em>⍽доме.</p>'],
      ['<p>Он <em>в</em> доме.</p>', '<p>Он⍽<em>в</em>⍽доме.</p>'],
      [
        '<p>Он <em>в <b>доме</b></em> и <em><b>в</b> саду</em>.</p>',
        '<p>Он⍽<em>в⍽<b>доме</b></em> и⍽<em><b>в</b>⍽саду</em>.</p>'
      ],
      [
        '<p>Вот <em>же</em> он, что <b>бы</b> ни было.</p>',
        '<p>Вот⍽<em>же</em> он, что⍽<b>бы</b> ни⍽было.</p>'
      ]
    ];

    for (const [input, expected] of cases) {
      assert.equal(typeset(HTML, input), nb(expected), input);
    }

    assert.equal(
      typeset(HTML, '<p>Вот же он, что бы ни было.</p>'),
      nb('<p>Вот⍽же он, что⍽бы ни⍽было.</p>')
    );
  });

  test('tags in text are inline markup too', () => {
    assert.equal(
      typeset(
        TEXT,
        'Он в <em>доме</em> и <a href="/x">саду</a>, т.е. <b>дома</b>, 10 <b>кг</b>, А. С. <em>Пушкин</em>, <i>2024</i> г., и <i>т.д.</i>'
      ),
      nb(
        'Он⍽в⍽<em>доме</em> и⍽<a href="/x">саду</a>, т.⍽е. <b>дома</b>, 10⍽<b>кг</b>, А.⍽С.⍽<em>Пушкин</em>, <i>2024</i>⍽г., и⍽<i>т.⍽д.</i>'
      )
    );
    assert.equal(typeset(TEXT, '<em>Он в</em> доме.'), nb('<em>Он⍽в</em>⍽доме.'));
  });

  test('a protected inline element is one word', () => {
    assert.equal(typeset(HTML, '<p>Он в <code>x</code></p>'), nb('<p>Он⍽в⍽<code>x</code></p>'));
    assert.equal(typeset(TEXT, 'Он в <code>x</code>'), nb('Он⍽в⍽<code>x</code>'));
    assert.equal(
      typeset(HTML, '<p>Он в <kbd>Ctrl</kbd> доме</p>'),
      nb('<p>Он⍽в⍽<kbd>Ctrl</kbd>⍽доме</p>')
    );
  });

  test('a city after an index in a tag binds as after the bare index', () => {
    assert.equal(typeset(HTML, '125009 г. Москва'), nb('125009⍽г.⍽Москва'));
    assert.equal(typeset(HTML, '<b>125009</b> г. Москва'), nb('<b>125009</b>⍽г.⍽Москва'));
  });

  test('a rule that rewrites a word next to markup reads the markup as it did', () => {
    assert.equal(typeset(HTML, '5 руб.'), nb('5⍽₽.'));
    assert.equal(typeset(HTML, '5 <i>руб.</i>'), nb('5⍽<i>руб.</i>'));
    assert.equal(
      typeset(HTML, '<p>10 <b>кг</b> и 5 <i>руб.</i></p>'),
      nb('<p>10⍽<b>кг</b> и⍽5⍽<i>руб.</i></p>')
    );
    assert.equal(
      typeset(HTML, '<p>Он в <em>доме</em>, 5 <i>руб.</i></p>'),
      nb('<p>Он⍽в⍽<em>доме</em>, 5⍽<i>руб.</i></p>')
    );
  });

  test('away from a rewritten word, the same rule binds through markup', () => {
    assert.equal(
      typeset(HTML, '<p>в тч ¾ <i>начертать и</i> т.п.</p>'),
      nb('<p>в⍽тч⍽¾⍽<i>начертать и</i>⍽т.⍽п.</p>')
    );
  });

  test('once its word is rewritten, the rule binds through the markup beside it in one pass', () => {
    assert.deepEqual(twice(HTML, '(c) <s>Амбер</s>'), [nb('©⍽<s>Амбер</s>'), nb('©⍽<s>Амбер</s>')]);
    assert.equal(typeset(HTML, '(c) Амбер'), nb('©⍽Амбер'));
  });

  test('a rule that rewrites a word and wraps words through markup further on does both in one pass', () => {
    const config = { html: true, input: 'html' };

    assert.deepEqual(twice(config, 'и тд <strong>и</strong> т. п.'), [
      `<p>${NOWRAP}и т. д.</span> ${NOWRAP}<strong>и</strong> т. п.</span></p>`,
      `<p>${NOWRAP}и т. д.</span> ${NOWRAP}<strong>и</strong> т. п.</span></p>`
    ]);
    assert.equal(
      typeset(config, 'и тд и т. п.'),
      `<p>${NOWRAP}и т. д.</span> ${NOWRAP}и т. п.</span></p>`
    );
    assert.deepEqual(twice(config, 'и тд <b>Он и</b> т. п.'), [
      nb(`<p>${NOWRAP}и т. д.</span> <b>Он и</b>⍽т.⍽п.</p>`),
      nb(`<p>${NOWRAP}и т. д.</span> <b>Он и</b>⍽т.⍽п.</p>`)
    ]);
    assert.deepEqual(twice(config, nb('й⍽8.6.5.9⍽<span>чу</span>⍽л⍽ь⍽о')), [
      `<p>${NOWRAP}й 8.6.5.9 <span>чу</span> л ь о</span></p>`,
      `<p>${NOWRAP}й 8.6.5.9 <span>чу</span> л ь о</span></p>`
    ]);
    assert.equal(
      typeset(config, nb('й⍽8.6.5.9⍽чу⍽л⍽ь⍽о')),
      `<p>${NOWRAP}й 8.6.5.9 чу л ь о</span></p>`
    );
    assert.equal(
      typeset(config, 'и тд 5 <i>руб.</i>'),
      nb(`<p>${NOWRAP}и т. д.</span> 5⍽<i>руб.</i></p>`)
    );
  });

  test('a rule that keeps its wrapper off emphasis wraps the words through markup further on in the same pass', () => {
    const config = { html: true, input: 'html' };

    assert.deepEqual(twice(config, nb('<i>о</i>⍽16.06.27⍽р⍽9.8.6.7⍽<b><span>е</span></b>⍽е⍽x 6')), [
      nb(
        `<p><i>о</i>⍽${NOWRAP}16.06.27</span>⍽₽⍽${NOWRAP}9.8.6.7 <b><span>е</span></b> е x</span> 6</p>`
      ),
      nb(
        `<p><i>о</i>⍽${NOWRAP}16.06.27</span>⍽₽⍽${NOWRAP}9.8.6.7 <b><span>е</span></b> е x</span> 6</p>`
      )
    ]);
    assert.equal(
      typeset(config, nb('о⍽16.06.27⍽р⍽9.8.6.7⍽е⍽е⍽x 6')),
      nb(`<p>${NOWRAP}о 16.06.27</span>⍽₽⍽${NOWRAP}9.8.6.7 е е x</span> 6</p>`)
    );
  });

  test('a protected element beside a change of the rules holds on the second pass', () => {
    const fm = { html: true, input: 'frontmatter' };

    assert.deepEqual(twice(fm, nb('А⍽2F⍽<textarea>}</textarea>⍽г⍽с')), [
      nb(`${NOWRAP}А 2 °F</span>⍽<textarea>}</textarea>⍽г⍽с`),
      nb(`${NOWRAP}А 2 °F</span>⍽<textarea>}</textarea>⍽г⍽с`)
    ]);
    assert.equal(typeset(fm, nb('А⍽2F⍽слово⍽г⍽с')), `${NOWRAP}А 2 °F слово г с</span>`);
    assert.equal(
      typeset(fm, 'А 2F <code>x</code> г с'),
      nb(`А ${NOWRAP}2 °F</span> <code>x</code> г⍽с`)
    );
  });

  const HTML_ON = { html: true, input: 'html' };

  test('a particle after a code element stays apart from it', () => {
    assert.equal(
      typeset(HTML_ON, 'Тип <code>int</code> де факто'),
      nb('<p>Тип <code>int</code> де⍽факто</p>')
    );
    assert.equal(
      typeset(HTML_ON, 'Запусти <code>ls</code> ка'),
      nb('<p>Запусти <code>ls</code>⍽ка</p>')
    );
    assert.equal(
      typeset(HTML_ON, 'Нажми <kbd>Enter</kbd> кась'),
      nb('<p>Нажми <kbd>Enter</kbd>⍽кась</p>')
    );
    assert.equal(typeset(HTML_ON, 'Нажми Enter кась'), '<p>Нажми Enter кась</p>');
  });

  test('a code element at the end of the text takes no period after it', () => {
    const end = { ...HTML_ON, rules: { 'punctuation.period_at_end': true } };

    assert.equal(
      typeset(end, 'Пример: <code>exit 0.</code>'),
      '<p>Пример: <code>exit 0.</code></p>'
    );
    assert.equal(typeset(end, 'Пример: exit 0'), '<p>Пример: exit 0.</p>');
  });

  test('an ellipsis between code elements stays a range', () => {
    assert.equal(
      typeset({ input: 'markdown' }, 'Диапазон `1`..`5` и `a`...`z`'),
      nb('Диапазон `1`..`5` и⍽`a`…`z`')
    );
    assert.equal(
      typeset(HTML_ON, 'Диапазон <code>a</code>...<code>b</code> там'),
      nb('<p>Диапазон <code>a</code>…<code>b</code>⍽там</p>')
    );
  });

  test('the marks against a code element stay as written', () => {
    assert.equal(
      typeset(HTML_ON, 'Диапазон <code>a</code>..<code>b</code> там'),
      nb('<p>Диапазон <code>a</code>..<code>b</code>⍽там</p>')
    );
    assert.equal(typeset(HTML_ON, 'Он <var>x</var>.. ушёл'), nb('<p>Он⍽<var>x</var>.. ушёл</p>'));
    assert.deepEqual(twice(HTML_ON, 'Он сказал <code>x</code> !? и ушёл'), [
      nb('<p>Он⍽сказал <code>x</code>!? и⍽ушёл</p>'),
      nb('<p>Он⍽сказал <code>x</code>!? и⍽ушёл</p>')
    ]);
  });

  test('a quote mark against a code element turns and stays against it', () => {
    const md = { input: 'markdown' };

    for (const [config, text, expected] of [
      [md, 'Он `код`"о да"', 'Он `код`«о⍽да»'],
      [md, 'Он `код`"о да" и ушёл', 'Он `код`«о⍽да» и⍽ушёл'],
      [HTML, 'Он <code>код</code>"о да"', 'Он <code>код</code>«о⍽да»'],
      [HTML, 'Он <code>код</code>"о да" и ушёл', 'Он <code>код</code>«о⍽да» и⍽ушёл'],
      [HTML, 'Он <kbd>Enter</kbd>"о да" и ушёл', 'Он <kbd>Enter</kbd>«о⍽да» и⍽ушёл']
    ]) {
      assert.deepEqual(twice(config, text), [nb(expected), nb(expected)], text);
    }

    assert.equal(typeset(HTML, 'Он код"о да" и ушёл'), nb('Он⍽код «о⍽да» и⍽ушёл'));
  });

  test('a closing quote mark against a code element closes against it', () => {
    const md = { input: 'markdown' };

    for (const [config, text, expected] of [
      [HTML, 'Он "о да"<code>код</code> нет', 'Он «о⍽да»<code>код</code> нет'],
      [TEXT, 'Он "о да"<code>код</code> нет', 'Он «о⍽да»<code>код</code> нет'],
      [HTML_ON, 'Он "о да"<code>код</code> нет', '<p>Он «о⍽да»<code>код</code> нет</p>'],
      [md, 'Он "о да"`код` нет', 'Он «о⍽да»`код` нет'],
      [HTML, 'Он "о да"<kbd>Enter</kbd> нет', 'Он «о⍽да»<kbd>Enter</kbd> нет'],
      [HTML, 'Он "о да"<samp>out</samp> нет', 'Он «о⍽да»<samp>out</samp> нет'],
      [HTML_ON, '<p>Он "о да"<code>код</code></p>', '<p>Он «о⍽да»<code>код</code></p>'],
      [md, 'Он "о да"`код`\n\nЕщё', 'Он «о⍽да»`код`\n\nЕщё'],
      [HTML, 'Он "о да"<code>код</code>.', 'Он «о⍽да»<code>код</code>.'],
      [md, 'Он "о да"`код`, нет', 'Он «о⍽да»`код`, нет'],
      [HTML, 'Он "о <em>да</em>"<code>код</code> нет', 'Он «о <em>да</em>»<code>код</code> нет'],
      [HTML, 'Он "о"<code>код</code>"да" нет', 'Он «о»<code>код</code>«да» нет'],
      [md, 'Он "о да"`код`"ещё" нет', 'Он «о⍽да»`код`«ещё» нет'],
      [md, 'Он «вот "о"`код`» нет', 'Он «вот „о“`код`» нет']
    ]) {
      assert.deepEqual(twice(config, text), [nb(expected), nb(expected)], text);
    }

    assert.equal(typeset(HTML, 'Он в <code>x</code>, нет'), nb('Он⍽в⍽<code>x</code>, нет'));
  });

  test('quote marks around and between code elements turn as they did', () => {
    const md = { input: 'markdown' };

    for (const [config, text, expected] of [
      [md, '"`код`"', '«`код`»'],
      [HTML, 'Строка "<code>a</code>"x"', 'Строка «<code>a</code>«x»'],
      [md, 'Флаг `-f`" - нет', 'Флаг `-f`"⍽— нет'],
      [md, 'Он сказал: «вот "`код`"» и ушёл', 'Он⍽сказал: «вот „`код`“» и⍽ушёл']
    ]) {
      assert.deepEqual(twice(config, text), [nb(expected), nb(expected)], text);
    }
  });

  test('no no-break wrapper takes in a code element', () => {
    const html = HTML_ON;

    for (const element of [
      '<code>x = 5 - 3; y = 1</code>',
      '<kbd>Ctrl</kbd>',
      '<var>n</var>',
      '<samp>ok</samp>'
    ]) {
      assert.deepEqual(twice(html, nb(`й⍽8.6.5.9⍽${element}⍽л⍽ь⍽о`)), [
        nb(`<p>${NOWRAP}й 8.6.5.9</span>⍽${element}⍽л⍽ь⍽о</p>`),
        nb(`<p>${NOWRAP}й 8.6.5.9</span>⍽${element}⍽л⍽ь⍽о</p>`)
      ]);
    }

    assert.equal(
      typeset({ html: true, input: 'markdown' }, nb('й⍽8.6.5.9⍽`x = 5 - 3; y = 1`⍽л⍽ь⍽о')),
      nb(`${NOWRAP}й 8.6.5.9</span>⍽\`x = 5 - 3; y = 1\`⍽л⍽ь⍽о`)
    );
    assert.equal(
      typeset(html, nb('й⍽8.6.5.9⍽слово⍽л⍽ь⍽о')),
      `<p>${NOWRAP}й 8.6.5.9 слово л ь о</span></p>`
    );
    assert.equal(
      typeset(html, 'в <code>main</code> и т.д.'),
      nb(`<p>в⍽<code>main</code> ${NOWRAP}и т. д.</span></p>`)
    );
  });

  test('a rule that joins initials to the next line does so with a tag there too', () => {
    const flat = { render: { paragraphs: false } };

    assert.equal(
      microtypo('Письмо Л.И.\nСидорову отправлено', flat),
      nb('Письмо⍽Л.⍽И.⍽Сидорову отправлено')
    );
    assert.equal(
      microtypo('Письмо Л.И.\n<b>Сидорову</b> отправлено', flat),
      nb('Письмо⍽Л.⍽И.⍽<b>Сидорову</b> отправлено')
    );
    assert.equal(
      microtypo('Письмо Л.И.\n<b>Сидорову</b> отправлено', WRAPPERS),
      `Письмо ${NOWRAP}Л. И. <b>Сидорову</b></span> отправлено`
    );
  });

  test('a rule that joins lines in one place binds through markup in another', () => {
    const config = { html: 1, input: 'html' };
    const head = `<p>${NOWRAP}Н. М. Пр</span> ${NOWRAP}1 °F</span><br>\n`;

    assert.equal(
      typeset(
        config,
        'Н.М.\nПр 1F\nК о <em>те</em> лор…\nМы <strong><b>Рент</b></strong> Т.В. о оре 8:5—5'
      ),
      nb(
        `${head}К⍽о⍽<em>те</em> лор…<br>\n${NOWRAP}Мы <strong><b>Рент</b></strong> Т. В.</span> о⍽оре 8:5–5</p>`
      )
    );
    assert.equal(
      typeset(config, 'Н.М.\nПр 1F\nК о те лор…\nМы Рент Т.В. о оре 8:5—5'),
      nb(`${head}К⍽о⍽те лор…<br>\n${NOWRAP}Мы Рент Т. В.</span> о⍽оре 8:5–5</p>`)
    );

    const joined = `<p><a>и</a> ${NOWRAP}Н. М. Пи</span> ${NOWRAP}4 °F</span><br>\n рдами… ${NOWRAP}Мы <strong><b>Ре</b></strong> ТВ</span> 1</p>`;

    assert.deepEqual(
      twice(config, '<a>и</a> Н.М.\nПи 4F\n рдами…Мы <strong><b>Ре</b></strong> ТВ 1'),
      [joined, joined]
    );
  });

  test('a rule that leaves a mark beside a tag as it is binds its white space through the tag on the first pass', () => {
    const split = nb('©⍽<b>У (а (, (c)</b>');
    const short = nb('©⍽<b>У (c)</b>');

    assert.deepEqual(twice(HTML, '(C) <b>У(а(, (c)</b>'), [split, split]);
    assert.deepEqual(twice(HTML, '(C) <b>У (а (, (c)</b>'), [split, split]);
    assert.deepEqual(twice(HTML, '(C) <b>У (c)</b>'), [short, short]);
    assert.equal(typeset(HTML, '(C) У (c)'), nb('©⍽У (c)'));
  });
});

describe('what stays a boundary', () => {
  test('a block tag, a line break, a line ending', () => {
    assert.equal(
      typeset(HTML, '<p>Он в</p><p>доме и саду.</p>'),
      nb('<p>Он⍽в</p><p>доме и⍽саду.</p>')
    );
    assert.equal(
      typeset(HTML, '<div>Он в <div>доме</div></div>'),
      '<div>Он в <div>доме</div></div>'
    );
    assert.equal(
      typeset(HTML, '<p>Он в<br>доме, и<br>саду.</p>'),
      '<p>Он в<br>доме, и<br>саду.</p>'
    );
    assert.equal(typeset(TEXT, 'Он в\nдоме и саду.'), nb('Он в\nдоме и⍽саду.'));
  });

  test('a protected block, an image, a comment', () => {
    assert.equal(typeset(HTML, '<p>Он в <pre>доме</pre></p>'), '<p>Он в <pre>доме</pre></p>');
    assert.equal(typeset(HTML, 'Он в <script>x</script> доме'), 'Он в <script>x</script> доме');
    assert.equal(
      typeset(HTML, '<p>Он в <img src="/x"> доме</p>'),
      '<p>Он в <img src="/x"> доме</p>'
    );
    assert.equal(typeset(HTML, '<p>Он в <!-- x --> доме</p>'), '<p>Он в <!-- x --> доме</p>');
    assert.deepEqual(twice({ input: 'markdown' }, 'Он <img> , в <img>доме'), [
      'Он <img>, в <img>доме',
      'Он <img>, в <img>доме'
    ]);
  });

  test('a tag left without its pair', () => {
    assert.equal(typeset(HTML, '<p>Он <b>в доме</p>'), nb('<p>Он <b>в⍽доме</p>'));
    assert.equal(typeset(HTML, '<p>Он в</b> доме</p>'), '<p>Он в</b> доме</p>');
    assert.deepEqual(twice({ input: 'markdown' }, nb('Он⍽<b> , да')), [
      nb('Он⍽<b>, да'),
      nb('Он⍽<b>, да')
    ]);
    assert.deepEqual(twice(HTML, 'ё <i>ли<n></i> …'), ['ё <i>ли<n></i>…', 'ё <i>ли<n></i>…']);
  });

  test('a tag with white space or an edge inside it, a tag beside a quote or an inch mark', () => {
    assert.equal(typeset(HTML, '<p>Он <b> в</b> доме</p>'), '<p>Он <b> в</b> доме</p>');

    for (const text of ['С [ке<br>][1] , да', 'а [3"]() б']) {
      const [once, again] = twice({ input: 'markdown' }, text);

      assert.equal(again, once, text);
    }
  });

  test('a tag beside a dash that stands as a sign', () => {
    const cases = [
      ['<p>Москва <em>- столица</em> России.</p>', '<p>Москва <em>—⍽столица</em> России.</p>'],
      ['<p>Он <b>- врач</b>.</p>', '<p>Он <b>—⍽врач</b>.</p>'],
      ['<p>Он пришёл <em>- и</em> ушёл.</p>', '<p>Он⍽пришёл <em>—⍽и</em> ушёл.</p>'],
      ['<u>5 -</u>', '<u>5⍽—</u>']
    ];

    for (const [input, expected] of cases) {
      assert.equal(typeset(HTML, input), nb(expected), input);
    }

    assert.equal(typeset(TEXT, '<u>5 -</u>'), nb('<u>5⍽—</u>'));
    assert.equal(
      microtypo('{"a": "Москва <em>- столица</em> России."}', { input: 'json' }),
      nb('{"a": "Москва <em>—⍽столица</em> России."}')
    );
    assert.equal(
      typeset(HTML, '<p>Москва - <em>и</em> Россия.</p>'),
      nb('<p>Москва⍽— <em>и</em>⍽Россия.</p>')
    );
  });

  test('a dash outside an element binds the words inside it as without the tags', () => {
    const md = { input: 'markdown' };

    assert.deepEqual(twice(md, 'т [же]()—'), [nb('т⍽[же]()—'), nb('т⍽[же]()—')]);
    assert.deepEqual(twice(md, 'т *же* —'), [nb('т⍽*же*⍽—'), nb('т⍽*же*⍽—')]);
    assert.equal(typeset(md, 'т же—'), nb('т⍽же—'));
  });

  test('a quote mark the rules turn around binds the word before it through the tags', () => {
    assert.deepEqual(twice(TEXT, '<span>а</span> " ('), [
      nb('<span>а</span>⍽«('),
      nb('<span>а</span>⍽«(')
    ]);
    assert.deepEqual(twice(TEXT, '<abbr>с</abbr> ”.'), [
      nb('<abbr>с</abbr>⍽«.'),
      nb('<abbr>с</abbr>⍽«.')
    ]);
    assert.deepEqual(twice(HTML, 'й« <strong>п</strong> ио'), [
      nb('й" <strong>п</strong>⍽ио'),
      nb('й" <strong>п</strong>⍽ио')
    ]);
    assert.equal(typeset(TEXT, 'а " ('), nb('а⍽«('));
    assert.equal(
      typeset(HTML, '<p>«Он сказал <b>слово</b> »</p>'),
      nb('<p>«Он⍽сказал <b>слово</b>»</p>')
    );
  });

  test('a year mark after a tag settles as without it', () => {
    const fm = { input: 'frontmatter' };

    assert.deepEqual(twice(fm, '<span>19.10.06г.д</span>'), [
      nb('<span>19.10.06⍽г. д</span>'),
      nb('<span>19.10.06⍽г. д</span>')
    ]);
    assert.equal(typeset(fm, '19.10.06г.д'), nb('19.10.06⍽г. д'));
    assert.deepEqual(twice(fm, '<b>19.10.06г</b> там'), [
      '<b>19.10.06г</b> там',
      '<b>19.10.06г</b> там'
    ]);
  });

  test('a tag that white space the rules take away parts from what keeps it in place', () => {
    const nobr = { html: '1', render: { nowrap: 'nobr' }, rules: { 'nobr.nowrap_hyphen': 1 } };
    const cases = [
      [HTML, '<p>- Да, <q>- ответил он.</q></p>', '<p>—⍽Да, <q>—⍽ответил он.</q></p>'],
      [HTML, '<p>» <strong>— а</strong></p>', '<p>«<strong>—⍽а</strong></p>'],
      [HTML, '- ,<a>- л</a>', '—⍽,<a>—⍽л</a>'],
      [HTML, 'Он сказал <em> , что</em> в доме', 'Он⍽сказал <em>, что</em> в⍽доме'],
      [HTML, '<i> ) и</i> de', '<i>) и</i> de'],
      [nobr, '&laquo; <small>е-ммае в</small>', '<p>«<small><nobr>е-ммае</nobr> в</small></p>'],
      [
        { html: 1, input: 'html' },
        'Н.М.\nПи 4F\n рдами…Мы <strong><b>Рт</b></strong> ТВ 1',
        `<p>${NOWRAP}Н. М. Пи</span> ${NOWRAP}4 °F</span><br>\n рдами… ${NOWRAP}Мы <strong><b>Рт</b></strong> ТВ</span> 1</p>`
      ]
    ];

    for (const [config, input, expected] of cases) {
      assert.deepEqual(twice(config, input), [nb(expected), nb(expected)], input);
    }

    assert.equal(
      typeset(HTML, '<p>Он сказал , <em>что</em> в доме</p>'),
      nb('<p>Он⍽сказал, <em>что</em> в⍽доме</p>')
    );
    assert.equal(typeset(HTML, '<p>«Да» <em>в</em> доме.</p>'), nb('<p>«Да» <em>в</em>⍽доме.</p>'));
  });

  test('a value of a data format ends where it ends', () => {
    assert.equal(
      microtypo('{"a": "Он в <em>доме</em>", "b": ["Он в", "доме"]}', { input: 'json' }),
      nb('{"a": "Он⍽в⍽<em>доме</em>", "b": ["Он⍽в", "доме"]}')
    );
    assert.equal(
      microtypo('a: Он в <em>доме</em>\nb: Он в\nc: доме', { input: 'yaml' }),
      nb('a: Он⍽в⍽<em>доме</em>\nb: Он⍽в\nc: доме')
    );
  });
});

describe("the engine's wrappers and the author's elements, html: true", () => {
  test('a wrapper goes around a whole element of the author', () => {
    assert.equal(
      microtypo('Он в <em>доме</em> и <i>т.д.</i>', WRAPPERS),
      nb(`Он⍽в⍽<em>доме</em> ${NOWRAP}и <i>т. д.</i></span>`)
    );
    assert.equal(
      microtypo('Он <b>и т.</b>д. там', WRAPPERS),
      `Он ${NOWRAP}<b>и т.</b> д.</span> там`
    );
  });

  test('where a wrapper would cross an element, the words bind with no-break spaces', () => {
    assert.equal(microtypo('<b>Он и</b> т.д. там', WRAPPERS), nb('<b>Он и</b>⍽т.⍽д. там'));
    assert.equal(microtypo('<b>Он 10</b> кг', WRAPPERS), nb('<b>Он⍽10</b>⍽кг'));
  });

  test('an element that holds exactly the words of a wrapper keeps them with no-break spaces', () => {
    assert.equal(microtypo('<b>и т.д.</b> там', WRAPPERS), nb('<b>и⍽т.⍽д.</b> там'));
  });

  test('a wrapper the rules nest in one around an element collapses as without the element', () => {
    const config = { html: 1, input: 'html' };

    assert.deepEqual(twice(config, '<a>до</a> н.э. и тд'), [
      `<p>${NOWRAP}<a>до</a> н. э.</span> ${NOWRAP}и т. д.</span></p>`,
      `<p>${NOWRAP}<a>до</a> н. э.</span> ${NOWRAP}и т. д.</span></p>`
    ]);
    assert.equal(
      typeset(config, 'до н.э. и тд'),
      `<p>${NOWRAP}до н. э.</span> ${NOWRAP}и т. д.</span></p>`
    );
    assert.equal(
      typeset(config, '<b>до н.э.</b> и тд'),
      nb(`<p><b>до⍽н.⍽э.</b> ${NOWRAP}и т. д.</span></p>`)
    );
  });

  test("an author's no-break element that holds them keeps them as it is", () => {
    for (const open of ['<span style="white-space:nowrap">', '<span class="nowrap">']) {
      assert.equal(microtypo(`${open}и т.д.</span> там`, WRAPPERS), `${open}и т. д.</span> там`);
    }
  });

  test('a name in a no-break wrapper takes no second one beside an element with a class, pass after pass', () => {
    const bare = { html: true, rules: { other: false } };
    const nobr = { ...bare, render: { nowrap: 'nobr' } };
    const markdown = { ...bare, input: 'markdown' };

    for (const [config, text, expected] of [
      [
        { ...markdown, render: { nowrap: 'nobr' } },
        'К.Б.Кй<tt class=>.</tt> Ка С.С.',
        '<nobr>К.⍽Б.⍽Кй</nobr><tt class=>.</tt> <nobr>Ка С. С.</nobr>'
      ],
      [
        markdown,
        '<d class=><small>с</small> Т.Б.От Кашфы П.К.',
        `<d class=><small>с</small> ${NOWRAP}Т.⍽Б.⍽От</span> ${NOWRAP}Кашфы П. К.</span>`
      ],
      [
        { ...bare, input: 'html' },
        '<d class=""> Может А.И. <mark>ь Г.Л.Фа</mark>',
        `<p><d class=""> ${NOWRAP}Может А. И.</span> <mark>ь Г.⍽Л.⍽Фа</mark></p>`
      ],
      [
        nobr,
        '<i class="x">а</i> Т.Б.От <nobr>Кашфы П.К.</nobr>',
        '<p><i class="x">а</i> <nobr>Т.⍽Б.⍽От</nobr> <nobr>Кашфы П. К.</nobr></p>'
      ],
      [
        bare,
        `<b class="x">Т.Б.От</b> ${NOWRAP}Кашфы П.К.</span>`,
        `<p><b class="x">Т.⍽Б.⍽От</b> ${NOWRAP}Кашфы П. К.</span></p>`
      ],
      [
        bare,
        `Т.Б.От ${NOWRAP}Кашфы <b class="x">П.К.</b></span>`,
        `<p>${NOWRAP}Т.⍽Б.⍽От</span> ${NOWRAP}Кашфы <b class="x">П. К.</b></span></p>`
      ],
      [
        bare,
        `${NOWRAP}Т.Б.От <b class="x">и</b> Кашфы П.К.</span>`,
        `<p>${NOWRAP}Т.⍽Б.⍽От <b class="x">и</b>⍽Кашфы П. К.</span></p>`
      ],
      [
        bare,
        `Т.Б.От ${NOWRAP}<b class="x">Кашфы П.К.</b></span>`,
        `<p>${NOWRAP}Т.⍽Б.⍽От</span> ${NOWRAP}<b class="x">Кашфы⍽П.⍽К.</b></span></p>`
      ]
    ]) {
      assert.deepEqual(twice(config, text), [nb(expected), nb(expected)], text);
    }
  });

  test('a word glued to the end of a wrapper stays apart from the next one with markup further on, as without it', () => {
    for (const tail of ['<strong>Да</strong>', 'Да']) {
      const settled = nb(`<p>ё⍽ж?.. ${NOWRAP}ГОСТ 76</span>x гончая⍽${tail}</p>`);

      assert.deepEqual(twice({ html: true }, `ё ж?..Гост76x гончая ${tail}`), [settled, settled]);
    }
  });

  test('a short word after a word glued to the end of a wrapper binds to the next one', () => {
    const config = { html: true };
    const wrapped = `${NOWRAP}ГОСТ 76</span>`;

    for (const [text, expected] of [
      [
        'ё ж?..Гост76x x г-о <strong>Да</strong>',
        `<p>ё⍽ж?.. ${wrapped}x x⍽г-о <strong>Да</strong></p>`
      ],
      ['ё ж?..Гост76x x г-о Да', `<p>ё⍽ж?.. ${wrapped}x x⍽г-о Да</p>`],
      ['Гост76x и <b>доме</b> там', `<p>${wrapped}x и⍽<b>доме</b>⍽там</p>`],
      ['Гост76x гончая там', `<p>${wrapped}x гончая⍽там</p>`],
      ['Гост 76 и доме', `<p>${wrapped} и⍽доме</p>`]
    ]) {
      assert.deepEqual(twice(config, text), [nb(expected), nb(expected)], text);
    }
  });

  test('a label before a label keeps its gap inside a wrapper and binds it outside, with markup before, between and after', () => {
    const config = { html: true, input: 'html' };

    for (const [text, expected] of [
      [
        `<i>а</i> ${NOWRAP}в г. пр. Ленина</span> ул. пр. Мира`,
        `<p><i>а</i> ${NOWRAP}в г. пр. Ленина</span> ул.⍽пр.⍽Мира</p>`
      ],
      ['<i>а</i> в г. пр. Ленина ул. пр. Мира', '<p><i>а</i> в г.⍽пр.⍽Ленина ул.⍽пр.⍽Мира</p>'],
      [
        `${NOWRAP}в г. <b>пр.</b> Ленина</span> и в г. <b>пр.</b> Мира`,
        `<p>${NOWRAP}в г. <b>пр.</b> Ленина</span> и в г.⍽<b>пр.</b>⍽Мира</p>`
      ],
      [
        `<b>а</b> ${NOWRAP}ул. пр. <i>Мира</i></span> г. пр. <u>Ленина</u>`,
        `<p><b>а</b> ${NOWRAP}ул. пр. <i>Мира</i></span> г.⍽пр.⍽<u>Ленина</u></p>`
      ]
    ]) {
      assert.deepEqual(twice(config, text), [nb(expected), nb(expected)], text);
    }
  });

  test('an earlier wrapper of the engine on a line the rule wraps again keeps the element transparent', () => {
    const config = { input: 'html', html: true };
    const marked = 'EUR 6/3 Бт М.К.\n<strong>Вадения</strong> начертать Б.А.\nСп 2.4.8.2 Д.Н.Аб';

    assert.equal(
      microtypo(marked, config),
      nb(
        `<p>EUR 6/3 Бт ${NOWRAP}М. К. <strong>Вадения</strong></span> начертать ${NOWRAP}Б. А. Сп</span>⍽${NOWRAP}2.4.8.2</span> ${NOWRAP}Д. Н. Аб</span></p>`
      )
    );
    assert.equal(
      stripTags(microtypo(marked, config)),
      stripTags(microtypo(stripTags(marked), config))
    );
  });
});

describe("a second pass reads the engine's own markup as the pass that wrote it", () => {
  test('a link whose text is its own address, a superscript, a subscript', () => {
    for (const text of ['http://1 т', '$ http://example.com', 'ы<sup> 3^3', 'n_8 л <small>ле']) {
      const [once, again] = twice({ html: true, render: { paragraphs: false } }, text);

      assert.equal(again, once, text);
    }

    assert.equal(
      twice(WRAPPERS, 'http://1 т')[0],
      '<a href="http://1">1</a> т',
      'a link the engine wrote keeps the next word off it'
    );
  });

  test('a protected block next to a wrapper, a declaration next to a space', () => {
    const [once, again] = twice(
      { html: true, input: 'html', render: { paragraphs: false } },
      '<p>О <pre>9</pre> 1.2.2.7'
    );

    assert.equal(once, `<p>О <pre>9</pre> ${NOWRAP}1.2.2.7</span>`);
    assert.equal(again, once);
    assert.deepEqual(twice({ input: 'markdown' }, '0 <!> &hellip;'), ['0 <!>…', '0 <!>…']);
  });

  test('a wrapper an attribute left open takes into its tag', () => {
    const fm = { html: true, input: 'frontmatter' };

    assert.deepEqual(twice(fm, `<span style="'>XIX ек те.</span>`), [
      `<span style="'>XIX ек ${NOWRAP}т. е.</span></span>`,
      `<span style="'>XIX ек ${NOWRAP}т. е.</span></span>`
    ]);
    assert.equal(
      typeset(fm, '<span style="x">XIX ек те.</span>'),
      `<span style="x">XIX ек ${NOWRAP}т. е.</span></span>`
    );
  });
});

// The Yamb client's cases, verbatim, `{ input: 'html', html: false }`.
describe('the client cases', () => {
  const NB = '\u{00A0}';
  const cases = [
    ['space-baseline', '<p>Он в доме и саду.</p>', `<p>Он${NB}в${NB}доме и${NB}саду.</p>`],
    [
      'space-em-a',
      '<p>Он в <em>доме</em> и <a href="/x">саду</a>.</p>',
      `<p>Он${NB}в${NB}<em>доме</em> и${NB}<a href="/x">саду</a>.</p>`
    ],
    [
      'quote-baseline',
      '<p>"<em>слово</em> и <a href="/x">другое</a>"</p>',
      '<p>«<em>слово</em> и <a href="/x">другое</a>»</p>'
    ],
    [
      'quote-code',
      '<p>"<em>слово</em> и <a href="/x">другое</a>"</p>\n<p><code>"x" -- a  b</code></p>',
      '<p>«<em>слово</em> и <a href="/x">другое</a>»</p>\n<p><code>"x" -- a  b</code></p>'
    ],
    [
      'caption-baseline',
      '<figure><img src="/x"><figcaption>"Подпись"</figcaption></figure>',
      '<figure><img src="/x"><figcaption>«Подпись»</figcaption></figure>'
    ],
    [
      'quote-caption',
      '<p>"<em>слово</em> и <a href="/x">другое</a>"</p>\n<figure><img src="/x"><figcaption>"Подпись"</figcaption></figure>',
      '<p>«<em>слово</em> и <a href="/x">другое</a>»</p>\n<figure><img src="/x"><figcaption>«Подпись»</figcaption></figure>'
    ],
    [
      'quote-trailing-newline',
      '<p>"<em>слово</em> и <a href="/x">другое</a>"</p>\n',
      '<p>«<em>слово</em> и <a href="/x">другое</a>»</p>'
    ]
  ];

  for (const [id, source, expected] of cases) {
    test(id, () => {
      assert.equal(new MicroTypo(HTML).process(source), expected);
    });
  }
});
