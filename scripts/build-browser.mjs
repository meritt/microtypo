import { fileURLToPath } from 'node:url';

import { build } from 'rolldown';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

const BROWSER_ENTRY = `${ROOT}src/browser.js`;
const BROWSER_FILE = `${ROOT}dist/microtypo.browser.js`;

// One readable ES module with no imports and no comments: sites copy it as a file and serve it as is.
export async function buildBrowser(file = BROWSER_FILE) {
  await build({
    input: BROWSER_ENTRY,
    platform: 'browser',
    logLevel: 'warn',
    // Otherwise every module starts with a `// src/…` path comment.
    experimental: { attachDebugInfo: 'none' },
    output: {
      file,
      format: 'esm',
      comments: { legal: false, annotation: false, jsdoc: false },
      minify: { compress: false, mangle: false, codegen: { removeWhitespace: false } }
    }
  });
}

if (process.argv[1] === import.meta.filename) {
  await buildBrowser();
}
