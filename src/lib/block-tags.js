// Block-level tags HTML5 forbids nesting inside <p>.
export const BLOCK_TAG_NAMES = Object.freeze([
  'blockquote',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'caption',
  'figure',
  'figcaption',
  'aside',
  'section',
  'article',
  'header',
  'footer',
  'nav',
  'main',
  'menu',
  'dialog',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'div',
  'form',
  'fieldset',
  'address',
  'details',
  'summary',
  'pre'
]);

// Void (self-closing, no closing tag) block-level tags.
export const VOID_BLOCK_TAG_NAMES = Object.freeze(['hr']);

// Every void element HTML has, inline or block.
export const VOID_TAG_NAMES = Object.freeze([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr'
]);

// The open elements a start tag closes when the author left their end tags out, as far as the
// block-level tags go.
export const IMPLIED_END_TAGS = Object.freeze({
  li: Object.freeze(['li']),
  dt: Object.freeze(['dt', 'dd']),
  dd: Object.freeze(['dt', 'dd']),
  td: Object.freeze(['td', 'th']),
  th: Object.freeze(['td', 'th']),
  tr: Object.freeze(['td', 'th', 'tr']),
  thead: Object.freeze(['td', 'th', 'tr', 'thead', 'tbody', 'tfoot']),
  tbody: Object.freeze(['td', 'th', 'tr', 'thead', 'tbody', 'tfoot']),
  tfoot: Object.freeze(['td', 'th', 'tr', 'thead', 'tbody', 'tfoot'])
});
