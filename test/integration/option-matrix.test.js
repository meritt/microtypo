import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import * as TOML from 'smol-toml';
import YAML from 'yaml';

import { microtypo } from '../../src/index.js';
import { splitFrontmatter } from '../../src/input/frontmatter.js';
import { validateXml } from '../../src/input/xml.js';

// Cross-product matrix asserting the data-safe contract holds across every axis, with structured output re-parsed by a real parser.

// One payload reused across formats: a straight-quote pair, a hyphen, and an ampersand-bearing URL.
const PAYLOAD = '"Амбер" - истинный, см. http://amber.example/a?x=1&y=2';
const JSON_PAYLOAD = PAYLOAD.replaceAll('"', '\\"');

// YAML/TOML use single-quoted scalars: a double-quoted backslash escape would make the value ineligible.
const CORPUS = {
  text: PAYLOAD,
  html: `<em>${PAYLOAD}</em>`,
  markdown: `# Хроники\n\n${PAYLOAD}`,
  json: `{"t":"${JSON_PAYLOAD}"}`,
  xml: `<x>${PAYLOAD}</x>`,
  yaml: `title: '${PAYLOAD}'`,
  toml: `title = '${PAYLOAD}'`,
  frontmatter: `---\ntitle: "Корвин - Эрик"\n---\n\n${PAYLOAD}`
};

const FORMATS = Object.keys(CORPUS);

// render.hanging emits markup only once hanging.quote/bracket is opted in, so those axes are bundled with the rule toggle.
const RENDER_PROFILES = [
  { name: 'default', render: { paragraphs: true, autolink: true }, rules: {} },
  { name: 'no-paragraphs-no-autolink', render: { paragraphs: false, autolink: false }, rules: {} },
  {
    name: 'hanging-style',
    render: { paragraphs: false, autolink: false, hanging: 'style' },
    rules: { 'hanging.quote': true }
  },
  {
    name: 'hanging-class-prefixed',
    render: { paragraphs: false, autolink: false, hanging: 'class', prefix: 'mt-' },
    rules: { 'hanging.quote': true }
  }
];

const NAMED_ENTITY_RE = /&[a-zA-Z]+;/;
const ANY_ENTITY_RE = /&#?\w+;/;

function assertUnstructuredWellFormed(out) {
  // Any <p>/<a> this run emitted must be balanced; author-supplied markup is not checked.
  const opens = (out.match(/<(p|a)\b[^>]*>/g) ?? []).length;
  const closes = (out.match(/<\/(p|a)>/g) ?? []).length;
  assert.equal(opens, closes, `unbalanced <p>/<a> markup: ${out}`);
}

describe('option matrix: format × html × entities × render cross-product', () => {
  for (const format of FORMATS) {
    for (const html of [true, false]) {
      for (const entities of [true, false]) {
        for (const profile of RENDER_PROFILES) {
          test(`${format} html=${html} entities=${entities} render=${profile.name}`, () => {
            const cfg = {
              input: { format },
              html,
              entities,
              render: profile.render,
              rules: profile.rules
            };
            const out = microtypo(CORPUS[format], cfg);

            if (format === 'json') {
              const parsed = JSON.parse(out);
              assert.ok(!parsed.t.includes('<'), `JSON value gained a tag: ${parsed.t}`);
              assert.ok(!ANY_ENTITY_RE.test(parsed.t), `JSON value gained an entity: ${parsed.t}`);
            } else if (format === 'xml') {
              assert.doesNotThrow(() => validateXml(out), `XML no longer well-formed: ${out}`);
              assert.ok(!out.includes('<a ') && !out.includes('<p>'), `XML gained markup: ${out}`);
              assert.ok(!NAMED_ENTITY_RE.test(out), `XML gained a named entity: ${out}`);
            } else if (format === 'yaml') {
              const parsed = YAML.parse(out);
              assert.ok(!parsed.title.includes('<'), `YAML value gained a tag: ${parsed.title}`);
              assert.ok(
                !ANY_ENTITY_RE.test(parsed.title),
                `YAML value gained an entity: ${parsed.title}`
              );
            } else if (format === 'toml') {
              const parsed = TOML.parse(out);
              assert.ok(!parsed.title.includes('<'), `TOML value gained a tag: ${parsed.title}`);
              assert.ok(
                !ANY_ENTITY_RE.test(parsed.title),
                `TOML value gained an entity: ${parsed.title}`
              );
            } else if (format === 'frontmatter') {
              const fm = splitFrontmatter(out);
              assert.ok(fm && !fm.malformed, `frontmatter header no longer re-splits: ${out}`);
              assert.ok(!fm.header.includes('<'), `frontmatter header gained a tag: ${fm.header}`);
              assert.ok(
                !ANY_ENTITY_RE.test(fm.header),
                `frontmatter header gained an entity: ${fm.header}`
              );
              assertUnstructuredWellFormed(fm.body);
            } else {
              assertUnstructuredWellFormed(out);
            }
          });
        }
      }
    }
  }
});

describe('option matrix: structured formats ignore render.* entirely (no leakage)', () => {
  for (const format of ['json', 'xml', 'yaml', 'toml']) {
    test(`${format}: output identical across every render profile for a fixed html/entities pair`, () => {
      const outputs = RENDER_PROFILES.map((profile) =>
        microtypo(CORPUS[format], {
          input: { format },
          html: true,
          entities: true,
          render: profile.render,
          rules: profile.rules
        })
      );

      for (const out of outputs.slice(1)) {
        assert.equal(out, outputs[0], `render.* leaked into ${format} output`);
      }
    });
  }
});

test('json data mode normalizes entity spellings (documented, consistent with entities axis)', () => {
  const out = microtypo('{"t":"Амбер &copy; Корвин - Эрик"}', { input: 'json' });
  // Prose NBSP-binding rules apply inside the value; the NBSPs are ordinary output, not a data-mode artifact.
  assert.equal(JSON.parse(out).t, 'Амбер © Корвин — Эрик');
});

test('json fields opt-out preserves untargeted values byte-for-byte', () => {
  const src = '{"id":"Амбер &copy; Корвин","title":"Оберон - Дворкин"}';
  const out = microtypo(src, { input: { format: 'json', fields: ['title'] } });
  const p = JSON.parse(out);
  assert.equal(p.id, 'Амбер &copy; Корвин');
  assert.equal(p.title, 'Оберон — Дворкин');
});
