import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { microtypo, MicroTypo } from '../../src/index.js';

const FLAT = { render: { paragraphs: false }, rules: { 'hanging.*': false } };
const PLAIN = { render: { paragraphs: false } };
const HTML = { html: true, render: { paragraphs: false } };

const ent = (text) => new MicroTypo({ ...FLAT, entities: true }).process(text);

describe('repeated marks: only one or three', () => {
  test('doubled mark collapses to one', () => {
    assert.equal(microtypo('Корвин!!', FLAT), 'Корвин!');
    assert.equal(microtypo('Амбер??', FLAT), 'Амбер?');
  });

  test('tripled mark is preserved', () => {
    assert.equal(microtypo('Корвин!!!', FLAT), 'Корвин!!!');
    assert.equal(microtypo('Амбер???', FLAT), 'Амбер???');
  });

  test('more than three collapses to three', () => {
    assert.equal(microtypo('Корвин!!!!', FLAT), 'Корвин!!!');
    assert.equal(microtypo('Амбер?????', FLAT), 'Амбер???');
  });

  test('single mark untouched', () => {
    assert.equal(microtypo('Корвин!', FLAT), 'Корвин!');
  });

  test('mixed ?! preserved', () => {
    assert.equal(microtypo('Эрик?!', FLAT), 'Эрик?!');
  });
});

describe('collapse repeated separators', () => {
  test('doubled comma collapses to one plus space', () => {
    assert.equal(microtypo('Корвин,,Эрик', PLAIN), 'Корвин, Эрик');
  });

  test('doubled semicolon collapses to one', () => {
    assert.equal(microtypo('Корвин;;Эрик', PLAIN), 'Корвин;Эрик');
  });

  test('mixed comma-semicolon run collapses', () => {
    assert.equal(microtypo('Корвин,;,;Эрик', PLAIN), 'Корвин,;Эрик');
  });

  // A doubled period is a slip of the finger only at a sentence boundary. Without one the rule took
  // a character out of every `..` it met, and a path, a range and a revision range each lost a dot.
  test('a doubled period at a sentence boundary collapses', () => {
    assert.equal(microtypo('Корвин ушёл.. Эрик остался', PLAIN), 'Корвин ушёл. Эрик остался');
    assert.equal(microtypo('Корвин ушёл..', PLAIN), 'Корвин ушёл.');
  });

  test('a doubled period inside a token keeps both', () => {
    for (const src of ['путь ../pattern.txt', 'диапазон 1..10', 'ревизии 1a2b3c4..5d6e7f8']) {
      assert.equal(microtypo(src, PLAIN), src);
    }
  });

  // `mark_ellipsis` writes this form one rule earlier; collapsing it would undo that.
  test('the question-ellipsis form survives', () => {
    assert.equal(microtypo('Кто там?...', PLAIN), 'Кто там?..');
  });
});

describe('punctuation.collapse_repeated — spaced comma repeats (PUNCT-1)', () => {
  const NOP = { html: true, render: { paragraphs: false } };

  test('comma space comma collapses to one comma', () => {
    assert.equal(microtypo('Раз, , два', NOP), 'Раз, два');
  });

  test('three spaced commas collapse to one', () => {
    assert.equal(microtypo('Раз, , , два', NOP), 'Раз, два');
  });

  test('adjacent double comma still collapses', () => {
    assert.equal(microtypo('Раз,, два', NOP), 'Раз, два');
  });

  test('double colon is preserved (code-safe)', () => {
    assert.ok(microtypo('путь std::vector дальше', NOP).includes('std::vector'));
  });
});

describe('period spacing keeps tech tokens glued', () => {
  test('pattern.js stays glued', () => {
    assert.equal(ent('pattern.js правит Амбером'), 'pattern.js правит Амбером');
  });

  test('amber.js stays glued', () => {
    assert.equal(ent('amber.js'), 'amber.js');
  });

  test('rebma.js stays glued', () => {
    assert.equal(ent('rebma.js'), 'rebma.js');
  });

  test('lowercase pattern.js stays glued', () => {
    assert.equal(ent('pattern.js + arden'), 'pattern.js + arden');
  });

  test('index.html stays glued', () => {
    assert.equal(ent('index.html'), 'index.html');
  });

  test('app.json stays glued', () => {
    assert.equal(ent('app.json'), 'app.json');
  });

  test('photo.png stays glued', () => {
    assert.equal(ent('photo.png'), 'photo.png');
  });

  test('example.com stays glued', () => {
    assert.equal(ent('example.com'), 'example.com');
  });

  test('example.io stays glued', () => {
    assert.equal(ent('example.io'), 'example.io');
  });

  test('sentence boundary gains a space', () => {
    assert.equal(ent('тень.дорога вьётся'), 'тень. дорога вьётся');
  });
});

describe('repeated marks in entity mode', () => {
  test('doubled bang collapses to one', () => {
    assert.equal(ent('Амбер!!'), 'Амбер!');
  });

  test('tripled bang preserved', () => {
    assert.equal(ent('Корвин жив!!!'), 'Корвин жив!!!');
  });

  test('four bangs drop to three', () => {
    assert.equal(ent('Вперёд!!!!'), 'Вперёд!!!');
  });

  test('doubled question collapses, trailing single stays', () => {
    assert.equal(ent('Кто?? Где?'), 'Кто? Где?');
  });

  test('bang-question swaps to question-bang', () => {
    assert.equal(ent('Кто!?'), 'Кто?!');
  });

  test('bang-question with a space before it swaps and closes up', () => {
    assert.equal(ent('Кто !?'), 'Кто?!');
  });

  test('multi-bang question with a space collapses and swaps', () => {
    assert.equal(ent('Кто !!?'), 'Кто?!');
  });

  // The swap needs a trailing terminator, so a doubled mid-string `!?` run never matches.
  test('doubled bang-question survives unchanged', () => {
    assert.equal(ent('Корвин!?!?'), 'Корвин!?!?');
  });
});

describe('comma before conjunction', () => {
  test('off by default', () => {
    const out = microtypo('Корвин знает но молчит', HTML);
    assert.equal(out.includes('знает,'), false, out);
  });

  test('opt-in inserts the comma', () => {
    const out = microtypo('Корвин знает но молчит', {
      ...HTML,
      rules: { 'punctuation.comma_before_conjunction': true }
    });
    assert.ok(out.includes('знает,'), out);
  });
});

describe('punctuation.drop_terminal_garbage (PUNCT-2)', () => {
  const NOP = { html: true, render: { paragraphs: false } };

  test('comma-bang garbage after a terminal bang is dropped', () => {
    assert.equal(microtypo('Нет!,!', NOP), 'Нет!');
  });

  test('redundant period inside closing quote moves out', () => {
    assert.equal(microtypo('"слово.".', NOP), '«слово».');
  });

  test('interrobang ?! survives', () => {
    assert.ok(microtypo('Что?!', NOP).includes('?!'));
  });

  test('triple bang survives', () => {
    assert.ok(microtypo('Ура!!!', NOP).includes('!!!'));
  });

  test('bare comma after a terminal mark is preserved (no over-fire)', () => {
    assert.equal(microtypo('Да!, нет', NOP), 'Да!, нет');
  });
});

describe('punctuation presets', () => {
  test('ellipsis default converts three dots', () => {
    assert.ok(microtypo('Корвин...', HTML).includes('…'));
  });

  test('ellipsis off keeps the dots', () => {
    const out = microtypo('Корвин...', { ...HTML, rules: { 'punctuation.ellipsis': false } });
    assert.ok(!out.includes('…'));
  });

  test('repeat limit caps four bangs at three', () => {
    const out = microtypo('Слава Амберу!!!!', HTML);
    assert.ok(!out.includes('!!!!'));
    assert.ok(out.includes('!!!'));
  });

  test('repeat limit off leaves four bangs', () => {
    const out = microtypo('Слава Амберу!!!!', {
      ...HTML,
      rules: { 'punctuation.repeat_limit': false }
    });
    assert.ok(out.includes('!!!!'));
  });

  test('ellipsis: 3+ dots collapse to a single …', () => {
    assert.equal(microtypo('Тень......'), 'Тень…');
    assert.equal(microtypo('Тень...'), 'Тень…');
  });
});

describe('punctuation.bracket_spaces spares emoticons', () => {
  test('bracket_spaces spares emoticons but still trims real brackets', () => {
    assert.equal(
      microtypo('Корвин помрачнел :( Эрик молчал', PLAIN),
      'Корвин помрачнел :( Эрик молчал'
    );
    assert.equal(microtypo('Амбер ( столица)', PLAIN), 'Амбер (столица)');
  });

  test('other emoticon eyes are also spared', () => {
    assert.equal(
      microtypo('Эрик усмехнулся :) Рэндом ждал', PLAIN),
      'Эрик усмехнулся :) Рэндом ждал'
    );
    assert.equal(
      microtypo('Бенедикт кивнул ;) Джулиан отвернулся', PLAIN),
      'Бенедикт кивнул ;) Джулиан отвернулся'
    );
    assert.equal(
      microtypo('Дворкин пожал плечами =) Флора промолчала', PLAIN),
      'Дворкин пожал плечами =) Флора промолчала'
    );
  });
});

describe('punctuation bracket terminal cleanup (EF4)', () => {
  const NOP = { html: true, render: { paragraphs: false } };

  test('removes accidental comma before a closing parenthesis', () => {
    assert.equal(microtypo('Корвин вернулся (Рэбма,)', NOP), 'Корвин вернулся (Рэбма)');
  });

  test('removes accidental semicolon before a closing parenthesis', () => {
    assert.equal(microtypo('Корвин увидел (Лабиринт;)', NOP), 'Корвин увидел (Лабиринт)');
  });

  test('removes colon only in a leading-ellipsis parenthetical', () => {
    assert.equal(microtypo('Корвин ждал ( ... Паттерн : )', NOP), 'Корвин ждал (…Паттерн)');
  });

  test('keeps ordinary colons before a closing parenthesis', () => {
    assert.equal(microtypo('Корвин нашёл (Козырь:)', NOP), 'Корвин нашёл (Козырь:)');
  });

  test('keeps ordinary emoticons intact', () => {
    assert.equal(microtypo('Рэндом усмехнулся :)', NOP), 'Рэндом усмехнулся :)');
  });
});

describe('punctuation.mark_ellipsis: ?… / !… drop a dot', () => {
  // nobr.nbsp_short_word would glue "Ты" to the next word, masking the assertion; disabled to isolate mark_ellipsis.
  const NO_NBSP_GLUE = { rules: { 'nobr.nbsp_short_word': false } };

  test('mark_ellipsis: ?… → ?.. and !… → !..', () => {
    assert.equal(microtypo('Ты видел Амбер?...', NO_NBSP_GLUE), 'Ты видел Амбер?..');
    assert.equal(microtypo('Это Лабиринт!...', NO_NBSP_GLUE), 'Это Лабиринт!..');
    assert.equal(microtypo('Ты видел Амбер?..', NO_NBSP_GLUE), 'Ты видел Амбер?..'); // idempotent
  });
});
