import assert from 'node:assert/strict';
import test from 'node:test';

import { parse } from '../../src/cli/args.js';
import { CliUsageError } from '../../src/cli/errors.js';

test('bare invocation: empty config, no files', () => {
  const opts = parse([]);
  assert.deepEqual(opts.config, {});
  assert.deepEqual(opts.files, []);
  assert.equal(opts.write, false);
  assert.equal(opts.help, false);
});

test('--entities / --no-entities set config.entities', () => {
  assert.equal(parse(['--entities']).config.entities, true);
  assert.equal(parse(['--no-entities']).config.entities, false);
});

test('--output is removed', () => {
  assert.throws(() => parse(['--output', 'entities']), CliUsageError);
});

test('--markdown and --md are removed', () => {
  assert.throws(() => parse(['--markdown']), CliUsageError);
  assert.throws(() => parse(['--md']), CliUsageError);
});

test('--input sets config.input', () => {
  assert.equal(parse(['--input', 'markdown']).config.input, 'markdown');
  assert.equal(parse(['--input', 'html']).config.input, 'html');
});

test('--html / --no-html set config.html', () => {
  assert.equal(parse(['--html']).config.html, true);
  assert.equal(parse(['--no-html']).config.html, false);
});

test('--hanging enables hanging.quote and hanging.bracket rules', () => {
  const cfg = parse(['--hanging']).config;
  assert.equal(cfg.rules['hanging.quote'], true);
  assert.equal(cfg.rules['hanging.bracket'], true);
});

test('--no-hanging disables hanging.quote and hanging.bracket rules', () => {
  const cfg = parse(['--no-hanging']).config;
  assert.equal(cfg.rules['hanging.quote'], false);
  assert.equal(cfg.rules['hanging.bracket'], false);
});

test('--max-input coerces to a number', () => {
  assert.equal(parse(['--max-input', '50000']).config.maxInputLength, 50000);
});

test('--max-ms coerces to a number', () => {
  assert.equal(parse(['--max-ms', '100']).config.maxProcessingMs, 100);
});

test('--rule builds a rules map with coerced booleans', () => {
  assert.deepEqual(parse(['--rule', 'quote.*=false']).config.rules, { 'quote.*': false });
});

test('--render builds a render map with coerced scalars (repeatable)', () => {
  assert.deepEqual(parse(['--render', 'nowrap=span']).config.render, { nowrap: 'span' });
  assert.deepEqual(
    parse(['--render', 'paragraphs=true', '--render', 'hanging=class']).config.render,
    { paragraphs: true, hanging: 'class' }
  );
});

test('--set writes an arbitrary nested path', () => {
  assert.deepEqual(parse(['--set', 'rules.quote=false']).config.rules, { quote: false });
});

test('positionals become files; -w and -o are read', () => {
  const opts = parse(['-w', '-o', 'out.txt', 'a.md', 'b.md']);
  assert.deepEqual(opts.files, ['a.md', 'b.md']);
  assert.equal(opts.write, true);
  assert.equal(opts.outputFile, 'out.txt');
});

test('unknown flag throws CliUsageError', () => {
  assert.throws(() => parse(['--nope']), CliUsageError);
});

test('--rule without = throws CliUsageError', () => {
  assert.throws(() => parse(['--rule', 'quote']), CliUsageError);
});

test('--render without = throws CliUsageError', () => {
  assert.throws(() => parse(['--render', 'nowrap']), CliUsageError);
});
