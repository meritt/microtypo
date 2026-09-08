// Every glyph a rule emits goes through the frozen `G` map, so glyph normalization and entity
// conversion see one spelling. A raw glyph inside a regex *literal* is recognition and stays
// allowed; anywhere else — a replacement string, a template that builds a pattern, a comparison —
// it must be `G.*`, because that is what a reader greps for and what the entity table is keyed on.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CHARS_TABLE } from '../../src/lib/chars-table.js';
import { G, GLYPH_TO_ENTITY } from '../../src/lib/glyphs.js';

const RULES_DIR = join(import.meta.dirname, '../../src/rules');

// Rule `description` fields are Russian metadata, exempt from the English-comments rule and from
// this one: they name the glyph they are about.
const EXEMPT_LINE = /^(?:\/\/|\*|\/\*|description:)/;

const REGEX_LITERAL = /\/(?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+\/[gimsuyv]*/g;
const ESCAPE = /\\u\{?([0-9a-fA-F]{4,5})\}?/g;

const named = new Map(Object.entries(G).map(([key, value]) => [value, `G.${key}`]));

let scanned = 0;
const findings = [];

for (const file of readdirSync(RULES_DIR).toSorted()) {
  if (!file.endsWith('.js')) {
    continue;
  }

  scanned += 1;

  readFileSync(join(RULES_DIR, file), 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (EXEMPT_LINE.test(line.trim())) {
        return;
      }

      const code = line.replaceAll(REGEX_LITERAL, '__RE__');
      const hits = new Set();

      for (const char of code) {
        if (named.has(char)) {
          hits.add(`${JSON.stringify(char)} → ${named.get(char)}`);
        }
      }

      for (const [, hex] of code.matchAll(ESCAPE)) {
        const char = String.fromCodePoint(Number.parseInt(hex, 16));

        if (named.has(char)) {
          hits.add(`\\u{${hex}} → ${named.get(char)}`);
        }
      }

      if (hits.size > 0) {
        findings.push(`${file}:${index + 1}  ${[...hits].join(', ')}\n    ${line.trim()}`);
      }
    });
}

if (findings.length > 0) {
  console.error(findings.join('\n'));
  console.error(`\n${findings.length} hardcoded glyph(s) outside a regex literal. Use the G map.`);
  process.exit(1);
}

// The other half of the same contract: an entity the engine emits must decode back to its glyph, or
// the engine cannot read its own entity-mode output and a rule looking for the character sees a
// literal `&deg;` instead. The requirement is derived from the emit table, so a glyph cannot be
// added to it without an answer.
// The quote family folds within itself on purpose: which of its glyphs a quotation shows is the
// quote state machine's decision by depth, not normalisation's, so an entity that decodes to any
// member is readable back. The members are the canonical forms the table keeps for the family.
const QUOTE_FAMILY = ['"', G.LAQUO, G.RAQUO];
const FOLDS_INTO_QUOTE_FAMILY = new Set(QUOTE_FAMILY.flatMap((c) => CHARS_TABLE[c].html ?? []));

const undecodable = Object.entries(GLYPH_TO_ENTITY).filter(([glyph, entity]) => {
  if (FOLDS_INTO_QUOTE_FAMILY.has(entity)) {
    return false;
  }

  return !CHARS_TABLE[glyph]?.html?.includes(entity);
});

if (undecodable.length > 0) {
  console.error('Produced entities with no way back to their glyph in CHARS_TABLE:');

  for (const [glyph, entity] of undecodable) {
    console.error(`  ${entity} → ${JSON.stringify(glyph)}`);
  }

  process.exit(1);
}

console.log(
  `glyph-check: ${scanned} rule files scanned, 0 hardcoded glyphs; ` +
    `${Object.keys(GLYPH_TO_ENTITY).length} produced entities all decode back.`
);
