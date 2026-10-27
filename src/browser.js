// The entry of `microtypo/browser`: the whole public API in one file, so a page needs no import map
// and no module graph — the three subpath exports a Node consumer reaches separately.
export * from './define-rule.js';
export * from './errors/index.js';
export * from './index.js';
