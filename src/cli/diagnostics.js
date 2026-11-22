import { replacementEdits } from '../lib/diff.js';

export function processInput(engine, input, opts) {
  const result = engine.process(input, opts.explain ? { trace: true } : undefined);
  const text = opts.explain ? result.text : result;
  const output = keepFinalNewline(input, text);
  return {
    input,
    output,
    trace: opts.explain ? result.trace : undefined,
    edits: opts.check ? replacementEdits(input, output) : []
  };
}

export function report(target, opts, io) {
  const { file, input, output, trace, edits } = target;
  if (opts.explain) {
    io.stderr.write(`${JSON.stringify({ file, trace })}\n`);
  }
  if (opts.check) {
    let at = 0;
    let line = 1;
    let column = 1;
    for (const { start } of edits) {
      while (at < start) {
        if (input[at] === '\n' || (input[at] === '\r' && input[at + 1] !== '\n')) {
          line++;
          column = 1;
        } else {
          column++;
        }
        at++;
      }
      io.stdout.write(`${file}:${line}:${column}\n`);
    }
  }
  if (opts.diff && input !== output) {
    io.stdout.write(unifiedDiff(input, output, file));
  }
}

function lines(text) {
  if (text === '') {
    return [];
  }
  const result = text.split('\n');
  if (text.endsWith('\n')) {
    result.pop();
  }
  return result;
}

function unifiedDiff(before, after, file) {
  const oldLines = lines(before);
  const newLines = lines(after);
  const parts = [
    `--- ${diffPath(`a/${file}`)}\n+++ ${diffPath(`b/${file}`)}\n@@ -${oldLines.length === 0 ? 0 : 1},${oldLines.length} +${newLines.length === 0 ? 0 : 1},${newLines.length} @@\n`
  ];
  for (const [text, entries, prefix] of [
    [before, oldLines, '-'],
    [after, newLines, '+']
  ]) {
    for (const line of entries) {
      parts.push(`${prefix}${line}\n`);
    }
    if (entries.length > 0 && !text.endsWith('\n')) {
      parts.push('\\ No newline at end of file\n');
    }
  }
  return parts.join('');
}

function diffPath(path) {
  const escapes = {
    '\t': '\\t',
    '\n': '\\n',
    '\r': '\\r',
    '\b': '\\b',
    '\f': '\\f',
    '\v': '\\v',
    '"': '\\"',
    '\\': '\\\\'
  };
  let quoted = false;
  const escaped = [...path]
    .map((character) => {
      const code = character.codePointAt(0);
      if (code < 32 || code === 127 || character === '"' || character === '\\') {
        quoted = true;
        return escapes[character] ?? `\\${code.toString(8).padStart(3, '0')}`;
      }
      return character;
    })
    .join('');
  if (quoted) {
    return `"${escaped}"`;
  }
  return path.includes(' ') ? `${path}\t` : path;
}

// The engine trims by contract, but a filter that eats a file's final newline turns every rewrite
// into a diff and breaks composition with tools that expect a text file to end with one.
function keepFinalNewline(input, output) {
  if (!/\r?\n$/.test(input) || output.endsWith('\n')) {
    return output;
  }
  const carriesLf = /[^\r]\n/.test(output);
  return output + (input.endsWith('\r\n') && !carriesLf ? '\r\n' : '\n');
}
