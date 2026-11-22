import { globSync, readFileSync } from 'node:fs';

const ROOT = new URL('../../../', import.meta.url);

const WORD_RE = /[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)?/gu;
const LATIN_RE = /\b[A-Za-z]{2,}\b/gu;
const PHRASE_RE = /^[А-Яа-яЁё]+(?:,? [А-Яа-яЁё-]+){1,7}$/u;

function sources() {
  const corpus = JSON.parse(readFileSync(new URL('test/fixtures/corpus.json', ROOT), 'utf8')).map(
    (c) => c.text
  );
  // Sorted: `globSync` returns directory order, and the seeded picks index into these lists.
  const big = globSync('test/fixtures/big-text/*.input.txt', { cwd: ROOT })
    .toSorted()
    .map((f) => readFileSync(new URL(f, ROOT), 'utf8'));

  return [...corpus, ...big];
}

const unique = (items) => [...new Set(items)].toSorted();

// The raw material the grammar builds prose from: the words and plain phrases of the project's own
// fixtures, with every piece of markup, number and punctuation left to the grammar.
export function loadLexicon() {
  const texts = sources();
  const words = unique(texts.flatMap((t) => t.match(WORD_RE) ?? []));
  const latin = unique(texts.flatMap((t) => t.match(LATIN_RE) ?? []));
  const phrases = unique(
    texts
      .flatMap((t) => t.replaceAll(/<[^>]*>/gu, ' ').split(/[.!?…:;"«»()\n\t]+/u))
      .map((s) => s.trim().replaceAll(/\s+/gu, ' '))
      .filter((s) => PHRASE_RE.test(s))
  );

  const lower = words.filter((w) => w === w.toLowerCase() && w.length > 2);
  const capital = words.filter((w) => /^[А-ЯЁ][а-яё]/u.test(w));

  return {
    words: lower,
    capital,
    short: unique(words.filter((w) => w.length <= 2).map((w) => w.toLowerCase())),
    caps: words.filter((w) => w.length >= 2 && w === w.toUpperCase()),
    latin,
    phrases
  };
}
