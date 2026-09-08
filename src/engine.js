import { clearSpecialChars } from './clear-special.js';
import { normaliseOptions, isOn, canonicalGroupName, wildcardToRegex } from './core/options.js';
import { MicroTypoConfigError, MicroTypoInputError, MicroTypoBudgetError } from './errors/index.js';
import { splitFrontmatter } from './input/frontmatter.js';
import { compileSpanSelectors, scanJson, selectValueSpans } from './input/json.js';
import {
  codeSpanReader,
  opaqueInline,
  scanCodeSpans,
  scanFences,
  scanIndentedCode,
  scanLinePrefix,
  scanLinkDestinations,
  scanReferenceDefinitions
} from './input/markdown.js';
import { scannerFor, templateReader } from './input/template.js';
import { scanToml } from './input/toml.js';
import { scanDoctype, scanXmlSpacePreserve, validateXml, xmlBlocks } from './input/xml.js';
import { scanYaml } from './input/yaml.js';
import { BLOCK_TAG_NAMES, VOID_BLOCK_TAG_NAMES } from './lib/block-tags.js';
import { G, unicodeToEntities, unicodeToXmlEntities } from './lib/glyphs.js';
import { edgeWhitespace, trimBlankLines } from './lib/strings.js';
import { SafeBlocks } from './protect/blocks.js';
import { TokenBudget } from './protect/forgery.js';
import { dropParagraphs, restoreParagraphs, stripReservedPua } from './protect/placeholders.js';
import { SafeSequences } from './protect/sequences.js';
import { tagSpans } from './protect/tag-spans.js';
import { assertTagName, SafeTags } from './protect/tags.js';
import { compileRuleGroup, describeRuleGroup, runRuleGroup } from './rule-runner.js';
import { DEFAULT_GROUPS } from './rules/registry.js';
import { UNSAFE_PREFIX_RE, validateConfig } from './schemas/config.js';

// Raw-text tags whose content is not typeset; block-level tags are excluded, since their content is.
// `textarea` belongs here for a different reason: its content is the form's value, not display prose.
// prettier-ignore
const DEFAULT_SAFE_TAGS = [
  'pre',
  'code',
  'script',
  'style',
  'kbd',
  'samp',
  'var',
  'tt',
  'textarea',
];

// Of those, the two whose content a reader never sees. `abbr.currency` is the reader of the
// difference: a sentence in front of a `<script>` has ended, while the words in a `<code>` span go
// on with it, and both arrive as the same shape once the content is vaulted.
const NON_RENDERING_TAGS = new Set(['script', 'style']);

// The elements HTML parses as raw or escapable-raw text. Their content is text and nothing else, so
// a tag written inside one is those bytes rather than a nested element.
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea']);

const NOTG_START = '<span class="_notg_start"></span>';
const NOTG_END = '<span class="_notg_end"></span>';
// Quoted-attribute alternation so a `>` inside an attribute value doesn't truncate the opener.
const NOTG_RE = /<notg(?:\s(?:[^<>"']|"[^"]*"|'[^']*')*)?>([\s\S]*?)<\/notg>/gi;

const DEFAULT_LAYOUT = { style: true, class: false };

// Formats whose document is Markdown source; frontmatter is here because its body is one.
const BLOCK_RENDER_FORMATS = new Set(['markdown', 'frontmatter']);

const sameList = (a, b) =>
  a === b || (a?.length === b?.length && a.every((value, i) => value === b[i]));

// Whether two validated `input` configurations ask for the same thing. `validateConfig` fills the
// default in, so an absent `input` arrives here spelled out as `text`, and comparing the objects is
// the only way to tell "no input given" from "a different one asked for".
const sameInputConfig = (a, b) =>
  a.format === b.format &&
  a.template === b.template &&
  sameList(a.fields, b.fields) &&
  sameList(a.exclude, b.exclude);

// 30K cap: some rules backtrack quadratically and the budget is only checked between groups.
export const DEFAULT_MAX_INPUT_LENGTH = 30_000;

export class MicroTypo {
  #groups = new Map();
  #order = [];
  #safeBlocks;
  #safeSequences;
  #safeTags;
  #engineSettings = {};
  #layout = { ...DEFAULT_LAYOUT };
  #prefix = '';
  #maxInputLength = DEFAULT_MAX_INPUT_LENGTH;
  #maxProcessingMs = 5_000; // not enforceable mid-regex, so it pairs with maxInputLength
  #entities = false;
  #html = false;
  #input;
  #presets;
  #select;
  #processing = false; // reentrancy guard
  onCycleLimit = null;

  constructor(config = {}) {
    const validated = validateConfig(config);

    // Frozen clones, so later external mutation can't change which values get typeset.
    this.#input = validated.input;
    this.#presets = validated.presets !== false;
    this.#select = compileSpanSelectors(this.#input);

    if (this.#presets) {
      for (const [name, def] of DEFAULT_GROUPS) {
        this.registerRuleGroup(def, { name });
        // Only groups from this trusted list are builtin (exempt from the forgery scrub); a
        // later re-registration of a canonical name stays custom.
        this.#groups.get(name).builtin = true;
      }
    }

    this.#initVaults();

    // A string-aware scan, so a delimiter inside a quoted expression does not close the span early.
    const readTemplates =
      this.#input.template === 'off' ? null : templateReader(this.#input.template);
    const scanTemplate = scannerFor(readTemplates);
    const addTemplate = () => {
      if (scanTemplate) {
        this.#safeBlocks.addScanner(`tmpl-${this.#input.template}`, scanTemplate);
      }
    };

    // Registration order is load-bearing: an earlier block's placeholder hides its content from every
    // later block's regex.
    if (BLOCK_RENDER_FORMATS.has(this.#input.format)) {
      // Line-oriented scanner: a same-length fence run mid-line can't close the block early.
      this.#safeBlocks.addScanner('md-fence', scanFences);

      // Block-level constructs first: their interiors must be opaque to every inline scanner below.
      // A backtick inside a reference definition is part of that block and must not pair with one in
      // the prose around it, which is why definitions are taken before code spans — and why the
      // reference scanner resolves code spans itself before deciding which labels are uses.
      this.#safeBlocks.addScanner('md-indented-code', scanIndentedCode);

      // One answer about the opaque inline constructs, shared by the reader that needs it early and
      // the pass that applies it: the reference scanner decides which labels are uses by where the
      // code spans fall, and templates move where they fall.
      const scanInline = readTemplates
        ? opaqueInline(codeSpanReader, readTemplates)
        : scanCodeSpans;

      this.#safeBlocks.addScanner('md-reference-definition', (text, checkBudget, resolve) =>
        scanReferenceDefinitions(text, checkBudget, resolve, scanInline)
      );

      // Backtick runs of any length, matched closer-first, so a 3+ span isn't mistaken for prose.
      // A template expression is the other opaque inline construct, and which of the two a stretch
      // belongs to is settled by which opened first, never by which pass ran first. Both stay behind
      // the block constructs, whose interiors are already opaque here: read before them, an
      // expression could span a fence boundary and take the fence apart.
      this.#safeBlocks.addScanner('md-inline-opaque', scanInline);

      // Balanced scanner: a literal ) inside the destination doesn't end the span early.
      this.#safeBlocks.addScanner('md-link-destination', scanLinkDestinations);

      // Indent, blockquote chain and list or heading marker in one span, so `> -` stays a list
      // rather than becoming an em dash and the spaces that set a content column survive.
      this.#safeBlocks.addScanner('md-line-prefix', scanLinePrefix);

      // Two or more trailing spaces before a `\n`; the zero-width open and close vault the spaces
      // rather than the text in front of them.
      this.addSafeBlock({
        id: 'md-hard-break',
        open: '(?=[ ]{2,}\\n)',
        close: '(?<=[ ]{2,})(?=\\n)',
        unsafeRegex: true
      });

      // Markdown source keeps its own block syntax: <p> and <br> belong to the renderer downstream,
      // and emitting them here wraps the heading, the list and the fence in one paragraph that is
      // neither Markdown nor HTML. Inline markup under html:true is unaffected — Markdown allows it.
      // Set from the format, which only the constructor takes, and before the caller's own config,
      // which can still turn both rules back on.
      this.#applyOverride('text', 'paragraphs', false);
      this.#applyOverride('text', 'breakline', false);
    }

    if (this.#input.format === 'xml') {
      // Preserve subtrees are vaulted whole, before the blocks below, so nothing downstream sees
      // their interior.
      this.#safeBlocks.addScanner('xml-space-preserve', scanXmlSpacePreserve);
      // Before the comment, CDATA and PI blocks: a DOCTYPE internal subset can carry its own `<!--`
      // or `<?`, and vaulting the DOCTYPE whole keeps a block scanner from splitting it in two.
      this.#safeBlocks.addScanner('xml-doctype', scanDoctype);

      for (const block of xmlBlocks) {
        this.addSafeBlock(block);
      }

      // Entity/char references are XML syntax, not text — must not decode to `&`. Open anchors a
      // real reference head and requires the terminating `;` right after (lookahead), so a bare
      // `&` never matches and a bogus head fails outright.
      this.addSafeBlock({
        id: 'xml-entity',
        open: '&(?:#[0-9]+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*)(?=;)',
        close: ';',
        unsafeRegex: true
      });
    }

    // text and html need only comment protection; TAG_RE would otherwise split `<!-- … -->` at the
    // first bare `>`.
    if (this.#input.format === 'text' || this.#input.format === 'html') {
      this.addSafeBlock({ id: 'html-comment', open: '<!--', close: '-->' });
    }

    if (!BLOCK_RENDER_FORMATS.has(this.#input.format)) {
      addTemplate();
    }

    this.#applyValidatedOptions(validated);
  }

  // Construction-only: compiles the block/tag regexes once per instance.
  #initVaults() {
    this.#safeBlocks = new SafeBlocks();
    this.#safeSequences = new SafeSequences();
    this.#safeTags = new SafeTags();

    const xml = this.#input.format === 'xml';

    for (const tag of DEFAULT_SAFE_TAGS) {
      this.#safeBlocks.addTag(tag, {
        renders: !NON_RENDERING_TAGS.has(tag),
        // Raw text is an HTML parsing mode. In XML the same element nests like any other, and a
        // `<script>` inside a `<script>` is a real element whose first close is not the outer one.
        nests: xml || !RAW_TEXT_TAGS.has(tag),
        // HTML allows a form feed among the space before a closing `>`; XML's S production does not.
        formFeed: !xml
      });
    }

    this.#safeBlocks.add({
      id: 'span-notg',
      open: NOTG_START,
      close: NOTG_END
    });
  }

  // Clears vault entry state per process() so placeholder ids never leak across calls.
  #resetVaults() {
    this.#safeBlocks.reset();
    this.#safeSequences.reset();
    this.#safeTags.reset();
  }

  registerRuleGroup(group, { name, position = 'end' } = {}) {
    const groupName = name || group.name || group.title;

    if (!groupName) {
      throw new TypeError('Rule group must have a name');
    }

    const canonical = canonicalGroupName(groupName);
    const compiled = compileRuleGroup(group, canonical);
    // Both are settled before either is stored, so a rejected position leaves the instance as it was.
    const order = this.#orderWith(canonical, position);

    this.#groups.set(canonical, compiled);
    this.#order = order;

    return this;
  }

  // Group order is load-bearing, so a position that cannot be honoured is an error rather than a
  // silent append.
  #orderWith(name, position) {
    const order = this.#order.filter((n) => n !== name);

    if (position === 'end' || !position) {
      return [...order, name];
    }

    if (position === 'start') {
      return [name, ...order];
    }

    const m = /^(after|before):(.+)$/.exec(position);
    const idx = m ? order.indexOf(canonicalGroupName(m[2])) : -1;

    if (idx === -1) {
      throw new MicroTypoConfigError(
        `position must be "start", "end", or "after:"/"before:" an already registered group: ${JSON.stringify(position)}`,
        { details: { position } }
      );
    }

    order.splice(m[1] === 'after' ? idx + 1 : idx, 0, name);

    return order;
  }

  // Read-only descriptors; never hand out the live compiled group (engine-mutable).
  getRuleGroup(name) {
    const g = this.#groups.get(canonicalGroupName(name));

    return g ? describeRuleGroup(g) : undefined;
  }

  listRuleGroups() {
    return Object.freeze(this.#order.map((n) => describeRuleGroup(this.#groups.get(n))));
  }

  // Which white space may precede a closing `>` is a fact about the document's markup language, not
  // about who registered the tag.
  addSafeTag(tag) {
    this.#safeBlocks.addTag(tag, { formFeed: this.#input.format !== 'xml' });

    return this;
  }

  addSafeBlock({ id, open, close, unsafeRegex = false }) {
    this.#safeBlocks.add({ id, open, close, unsafeRegex });

    return this;
  }

  setLayout(layout) {
    if (layout !== 'style' && layout !== 'class' && layout !== 'both') {
      throw new MicroTypoConfigError(
        `layout must be "style", "class", or "both": ${JSON.stringify(layout)}`,
        { details: { layout } }
      );
    }

    this.#layout = { style: layout !== 'class', class: layout !== 'style' };

    return this;
  }

  setPrefix(p) {
    const prefix = p === true ? 'mt_' : p || '';

    // The prefix is prepended raw to a generated `class`, so anything that could break out of the
    // attribute quotes is refused.
    if (UNSAFE_PREFIX_RE.test(prefix)) {
      throw new MicroTypoConfigError(
        `prefix must not contain a quote, angle bracket, "&", or whitespace: ${JSON.stringify(prefix)}`,
        { details: { prefix } }
      );
    }

    this.#prefix = prefix;

    return this;
  }

  // Which scanners protect a document, and which rule groups exist at all, are decided when the
  // instance is built, so a later call naming another format cannot take effect. A field that cannot
  // take effect is refused rather than ignored; naming the format the instance already has is still
  // a no-op and still passes.
  applyOptions(options) {
    const validated = validateConfig(options);
    // What the caller wrote, not what validation filled in: an absent `input` arrives here spelled
    // out as `text`, and comparing that against the real format would read every partial update as a
    // request to become a plain-text engine.
    const asked = Object(options ?? {});

    if (
      Object.hasOwn(asked, 'input') &&
      asked.input !== undefined &&
      !sameInputConfig(validated.input, this.#input)
    ) {
      throw new MicroTypoConfigError(
        `input is settled by the constructor; build a MicroTypo for "${validated.input.format}" instead of changing this one`,
        { details: { format: validated.input.format, current: this.#input.format } }
      );
    }

    if (validated.presets !== undefined && validated.presets !== this.#presets) {
      throw new MicroTypoConfigError('presets is settled by the constructor', {
        details: { presets: validated.presets, current: this.#presets }
      });
    }

    return this.#applyValidatedOptions(validated);
  }

  #applyValidatedOptions(validated) {
    const intent = normaliseOptions(validated);

    for (const [key, value] of Object.entries(intent.engineSettings)) {
      this.#applyEngineSetting(key, value);
    }

    for (const { group, key, value } of intent.settings) {
      const g = this.#groups.get(canonicalGroupName(group));

      if (g) {
        g.settings[key] = value;
      }
    }

    for (const { group, selector, value } of intent.overrides) {
      this.#applyOverride(canonicalGroupName(group), selector, value);
    }

    return this;
  }

  #applyEngineSetting(key, value) {
    if (key === 'entities') {
      this.#entities = isOn(value);

      return;
    }

    if (key === 'html') {
      this.#html = isOn(value);

      return;
    }

    if (key === 'layout') {
      // An absent `render.hanging` reaches here as undefined and means "keep the default";
      // anything else is validated once, by setLayout.
      if (value !== undefined) {
        this.setLayout(value);
      }

      return;
    }

    if (key === 'prefix') {
      this.setPrefix(value);

      return;
    }

    if (key === 'maxInputLength') {
      if (typeof value === 'number') {
        this.#maxInputLength = value;
      }

      return;
    }

    if (key === 'maxProcessingMs') {
      if (typeof value === 'number') {
        this.#maxProcessingMs = value;
      }

      return;
    }
    this.#engineSettings[key] = value;
  }

  #applyOverride(group, selector, value) {
    if (group === '*') {
      for (const g of this.#groups.values()) {
        this.#overrideGroup(g, selector, value);
      }

      return;
    }

    const g = this.#groups.get(group);

    if (g) {
      this.#overrideGroup(g, selector, value);
    }
  }

  #overrideGroup(group, selector, value) {
    if (selector === '*') {
      for (const r of group.compiledRules) {
        group.enabledOverride.set(r.id, value);
      }

      return;
    }

    const re = wildcardToRegex(selector);

    for (const r of group.compiledRules) {
      if (re.test(r.id)) {
        group.enabledOverride.set(r.id, value);
      }
    }
  }

  process(text) {
    if (typeof text !== 'string') {
      throw new MicroTypoInputError(`process() expects string, got ${typeof text}`, {
        details: { receivedType: typeof text }
      });
    }

    // A recursive call would reset vaults mid-pipeline and corrupt the outer call's restore chain.
    if (this.#processing) {
      throw new MicroTypoInputError(
        'process() called reentrantly on the same MicroTypo instance; recursive process() calls are not supported',
        { details: {} }
      );
    }

    if (text.length > this.#maxInputLength) {
      throw new MicroTypoInputError(
        `Input length ${text.length} exceeds maxInputLength (${this.#maxInputLength})`,
        { details: { length: text.length, max: this.#maxInputLength } }
      );
    }

    this.#processing = true;

    try {
      // Strip reserved PUA first; otherwise crafted input could forge placeholders.
      let result = stripReservedPua(text);
      // Snapshot the hook so a rule callback can't swap it mid-process.
      const hook = this.onCycleLimit;
      this.#resetVaults();

      // Small input can still burn CPU, so budget wall-clock between groups.
      const budget = this.#maxProcessingMs;
      const start = performance.now();

      const checkBudget = (where) => {
        if (budget > 0 && performance.now() - start > budget) {
          throw new MicroTypoBudgetError(
            `Processing exceeded ${budget}ms budget at ${where} — likely adversarial input`,
            { details: { budgetMs: budget, where } }
          );
        }
      };

      const session = this.#makeSession(hook, checkBudget);

      if (this.#input.format === 'json') {
        return this.#processJson(result, session, checkBudget);
      }

      if (this.#input.format === 'toml') {
        return this.#typesetStructured(result, scanToml, session, checkBudget);
      }

      if (this.#input.format === 'yaml') {
        return this.#typesetStructured(result, scanYaml, session, checkBudget);
      }

      if (this.#input.format === 'xml') {
        validateXml(result, checkBudget);

        // XML edge whitespace is spliced out and back, so interior rules and the newline collapse
        // never mangle it.
        const lead = /^\s*/.exec(result)[0];
        const rest = result.slice(lead.length);
        const trail = /\s*$/.exec(rest)[0];
        const core = trail.length > 0 ? rest.slice(0, -trail.length) : rest;

        return lead + this.#runPipeline(core, session, checkBudget, { destination: 'xml' }) + trail;
      }

      if (this.#input.format === 'frontmatter') {
        return this.#typesetFrontmatter(result, session, checkBudget);
      }

      result = this.#runPipeline(result, session, checkBudget, { destination: 'html' });

      // Markdown trims edge-aware, keeping the leading indent of indented code; text and HTML trim
      // as `String.prototype.trim` does.
      return this.#input.format === 'markdown' ? trimBlankLines(result) : result.trim();
    } finally {
      this.#processing = false;
    }
  }

  // `null` is no header, the whole document being a Markdown body; MALFORMED is an opening delimiter
  // with no close, which is rejected rather than reparsed.
  #typesetFrontmatter(text, session, checkBudget) {
    const fm = splitFrontmatter(text);

    if (fm === null) {
      return trimBlankLines(this.#runPipeline(text, session, checkBudget));
    }

    if (fm.malformed) {
      throw new MicroTypoInputError(
        'Malformed frontmatter: opening delimiter has no matching closing delimiter',
        { details: {} }
      );
    }

    const typedHeader =
      fm.open === '+++'
        ? this.#typesetStructured(fm.header, scanToml, session, checkBudget)
        : this.#typesetStructured(fm.header, scanYaml, session, checkBudget);
    const typedBody = trimBlankLines(this.#runPipeline(fm.body, session, checkBudget));

    // Delimiter lines come straight from the original text, so they stay byte-exact.
    return (
      text.slice(0, fm.headerStart) +
      typedHeader +
      text.slice(fm.headerStart + fm.header.length, fm.bodyStart) +
      typedBody
    );
  }

  // Splices right-to-left so earlier offsets stay valid; no doc-level trim.
  #processJson(text, session, checkBudget) {
    // `JSON.parse` is the ground truth for malformation `scanJson` cannot catch — a trailing comma,
    // a garbage tail. The native parse cannot be interrupted, so `maxInputLength` is its only bound
    // and the budget is read once it returns.
    try {
      JSON.parse(text);
    } catch (error) {
      throw new MicroTypoInputError(`Malformed JSON document: ${error.message}`, {
        details: { message: error.message }
      });
    }

    checkBudget('json-parse');

    const spans = scanJson(text, checkBudget);
    const selected = selectValueSpans(spans, this.#select);

    return this.#spliceSpans(text, selected, ({ start, end }) => {
      let decoded;

      try {
        // `JSON.parse` can decode `\uXXXX` back into reserved PUA the raw strip never saw, so the
        // decoded value is stripped again.
        decoded = stripReservedPua(JSON.parse(text.slice(start, end)));
      } catch (error) {
        throw new MicroTypoInputError(`Malformed JSON string literal: ${error.message}`, {
          details: { start, end }
        });
      }

      return JSON.stringify(this.#typesetValue(decoded, session, checkBudget));
    });
  }

  // A structured value keeps its own edge whitespace: the pipeline trims what it is handed, so only
  // the core goes through it and the edges are put back around the result. A value that is nothing
  // but whitespace has no core and is returned as it came.
  #typesetValue(value, session, checkBudget) {
    const { start, end } = edgeWhitespace(value);

    if (start === end) {
      return value;
    }

    return (
      value.slice(0, start) +
      this.#runPipeline(value.slice(start, end), session, checkBudget, {
        destination: 'data-value'
      }).trim() +
      value.slice(end)
    );
  }

  // Eligibility is decided up front by the scanner, so the raw interior is the value and needs no
  // decode: `scanToml` reports escape-free strings only, and `scanYaml` reports quoted scalars,
  // block-scalar content lines and plain scalars that resolve to a string.
  #typesetStructured(text, scan, session, checkBudget) {
    // Keys are dropped by `selectValueSpans`, which every format goes through, so filtering them
    // here would copy the whole span array for a predicate already known false.
    const spans = scan(text, checkBudget).filter((span) => span.eligible);
    const selected = selectValueSpans(spans, this.#select);

    return this.#spliceQuotedSpans(text, selected, session, checkBudget);
  }

  // Each span's raw interior is the value, so it is re-wrapped in the original delimiter with the
  // value's edge whitespace preserved.
  #spliceQuotedSpans(text, spans, session, checkBudget) {
    return this.#spliceSpans(text, spans, (span) => {
      // Every span states its own wrapper — one character, three for a TOML multi-line string, none
      // for a YAML block or plain scalar — rather than the engine re-deriving it from the source.
      const { start, end, delim: quote } = span;
      const interior = text.slice(start + quote.length, end - quote.length);
      const typed = this.#typesetValue(interior, session, checkBudget);

      // The scanner guarantees the input interior holds no bare wrapper quote, but glyph folding can
      // produce one (a typographic `”` or a `&#34;` reference lands as ASCII `"`), and re-wrapping
      // that closes the scalar early and hands the rest of the value to the parser as structure.
      // TOML literal strings have no escape at all, so the only universally correct answer is to
      // leave the scalar untypeset rather than change what the document means. A YAML block scalar
      // line has no wrapper at all, so there is nothing it could close early; a plain scalar has no
      // wrapper either and carries its own guard, because what ends it is a token inside the value.
      if (quote !== '' && typed.includes(quote)) {
        return text.slice(start, end);
      }

      return span.guard && !span.guard(typed) ? text.slice(start, end) : quote + typed + quote;
    });
  }

  #spliceSpans(text, spans, replacementFor) {
    if (spans.length === 0) {
      return text;
    }

    const parts = [];
    let cursor = 0;

    for (const span of spans) {
      parts.push(text.slice(cursor, span.start), replacementFor(span));
      cursor = span.end;
    }

    parts.push(text.slice(cursor));

    return parts.join('');
  }

  // Runs after `safeBlocks.protect`, where a `<notg>` inside a vaulted region is already hidden, and
  // before `safeTags.protect`, where the marker spans become ordinary vaulted tags. `tagSpans()`
  // guards a `<notg>` inside another tag's attribute value: a match starting inside a tag span stays
  // literal, so `safeTags` vaults the whole outer tag verbatim. It is built only once a `<notg>` is
  // found, because a document typeset value by value would otherwise pay that scan per value.
  #protectNotg(text) {
    let spans;
    let s = 0;

    return text.replace(NOTG_RE, (match, inner, offset) => {
      spans ??= tagSpans(text);

      while (s < spans.length && spans[s][1] <= offset) {
        s++;
      }

      if (s < spans.length && spans[s][0] < offset) {
        return match;
      }

      return `${NOTG_START}${this.#safeTags.iblock(inner)}${NOTG_END}`;
    });
  }

  // `ctx` is reused across calls, so `ctx.html` is mutated to reflect this call's destination.
  #runPipeline(text, session, checkBudget, { destination = 'html' } = {}) {
    const effHtml = destination === 'html' && this.#html;
    session.ctx.html = effHtml;

    // Per-call vault frame so an id minted for an earlier scalar can't be referenced by a later one.
    this.#safeSequences.resetFrame();

    let result = this.#safeSequences.protect(text);
    checkBudget('safeSequences.protect');

    // The sequence layer ran a step ago, so a scanner that has to compare source content sees
    // placeholders where the document had a URL or an address. It gets a way back to the bytes.
    result = this.#safeBlocks.protect(result, checkBudget, (value) =>
      this.#safeSequences.restore(value)
    );
    checkBudget('safeBlocks.protect');

    result = this.#protectNotg(result);
    checkBudget('protectNotg');

    result = this.#safeTags.protect(result);
    checkBudget('safeTags.protect');

    result = clearSpecialChars(result);
    checkBudget('clearSpecialChars');

    // Unconditional so it survives html:false disabling the text group.
    result = result.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n');
    checkBudget('newlineInvariant');

    for (const groupName of this.#order) {
      if (!effHtml && (groupName === 'text' || groupName === 'hanging')) {
        continue;
      }

      const group = this.#groups.get(groupName);

      if (!group) {
        continue;
      }

      result = session.runGroup(group, result);

      checkBudget(`group:${groupName}`);
    }

    // Entity-encoding runs before restore, on rule-produced glyphs only: vault placeholders are
    // opaque, so restored bodies are not re-encoded.
    if (this.#entities) {
      if (destination === 'xml') {
        result = unicodeToXmlEntities(result);
      } else if (destination === 'html') {
        result = unicodeToEntities(result);
      }
      // destination === 'data-value': suppressed — structured values stay raw Unicode.
    }

    result = this.#safeTags.restoreIblocks(result);

    result = restoreParagraphs(result);

    result = this.#safeTags.restore(result);

    result = this.#safeBlocks.restore(result);

    result = this.#safeSequences.restore(result);

    // The text group wraps in `<p>` indiscriminately, so block-level tags are unwrapped again: HTML
    // forbids a block inside an inline.
    result = unwrapBlocks(result);

    return result;
  }

  // The same chain the pipeline ends with, minus the paragraph markers: a `<p>` belongs to the
  // document, never inside an attribute. Used where content has to be readable before the last thing
  // that could read it — attribute escaping — rather than after it.
  #restoreProtected(text) {
    let result = this.#safeTags.restoreIblocks(text);

    result = this.#safeTags.restore(result);
    result = this.#safeBlocks.restore(result);

    return this.#safeSequences.restore(result);
  }

  // One session per `process()`: the narrowed `ctx` a rule handler sees, and the group runner that
  // keeps the accounting behind it. The accounting is closed over rather than hung on `ctx` — on
  // `ctx` a handler could clear the credit, credit itself a forged token, or switch tracking off.
  #makeSession(hook, checkBudget) {
    const self = this;
    // What the running custom group may keep, and null while a builtin one runs — those are trusted
    // and neither budgeted nor scrubbed.
    let budget = null;

    // A placeholder the engine minted for the group, which its input could not have carried.
    const credit = (token) => budget?.mint(token);

    // `tag()` and `iblock()` vault what they are handed, so the scrub of the returned text never
    // reads it: a forged token hidden in an attribute value would expand at restore time into
    // content the group was never given. What comes in draws on the same budget as what goes out.
    const guard = (value) => (budget === null ? value : budget.scrub(value));

    // Every attribute value is settled here, once, at the last moment before `makeTag` escapes it
    // and vaults it with the tag head, and the two steps happen in this order and nowhere else.
    //
    // Coerced to a string first, because the budget reads strings and `makeTag` would otherwise
    // stringify a `String` object or a number after the check. The class mapping runs before this
    // point, so a style named through `classes` is settled like any other value.
    //
    // Then what is still opaque is brought back to its real bytes, because escaping is the last
    // thing that can see them: a placeholder escapes to itself, and the quote inside it would come
    // back past the escaping and close the attribute it was written into.
    const settleAttributes = (attrs) => {
      const settled = {};

      for (const name of Object.keys(attrs)) {
        const value = attrs[name];

        // A paragraph marker cannot become a `<p>` inside an attribute, so it is dropped whole
        // rather than stripped down to its letters.
        settled[name] =
          value === undefined
            ? value
            : stripReservedPua(dropParagraphs(self.#restoreProtected(guard(String(value)))));
      }

      return settled;
    };

    // Security boundary: never expose the engine instance to custom rule groups.
    const ctx = {
      text: '',
      group: null,
      tags: {
        findByTagName: (nameOrRegex) => self.#safeTags.findByTagName(nameOrRegex)
      },

      iblock(s) {
        const ph = self.#safeTags.iblock(guard(s));

        credit(ph);

        return ph;
      },

      tag(content, tag, attributes = {}) {
        // Before the mode branch: a rule group is either well-formed or not, and a name that would
        // write unescaped markup must be refused whether or not this call emits one.
        assertTagName('tag', tag);

        for (const name of Object.keys(attributes)) {
          if (name !== 'class' && name !== '__style') {
            assertTagName('attribute', name);
          }
        }

        // `this.html`, never `self.#html`: it reflects this call's destination, forced false for XML.
        if (!this.html) {
          return attributes.class === 'nowrap' ? content.replaceAll(' ', G.NBSP) : content;
        }

        // Credit only the wrapper tokens `makeTag` just minted, never rescanning caller-supplied
        // content.
        const record = ({ html, tokens }) => {
          for (const token of tokens) {
            credit(token);
          }

          return html;
        };

        const { group } = this;
        const groupClasses = group?.raw?.classes ?? {};
        const attrs = { ...attributes };

        if (attrs.class) {
          let cls = attrs.class;
          // nowrap emits a `<span>` by default; `render.nowrap: 'nobr'` opts into the legacy element.
          if (cls === 'nowrap' && self.#engineSettings.nowrap === 'nobr') {
            return record(
              self.#safeTags.makeTag({
                content,
                tag: 'nobr',
                attributes: {},
                layout: self.#layout
              })
            );
          }

          if (groupClasses[cls]) {
            attrs.__style = groupClasses[cls];
          }

          if (self.#prefix) {
            cls = self.#prefix + cls;
          }

          attrs.class = cls;
        }

        return record(
          self.#safeTags.makeTag({
            content,
            tag,
            attributes: settleAttributes(attrs),
            layout: self.#layout
          })
        );
      },
      layout: { ...self.#layout },
      isOn: (key, scope) => isOn(scope?.settings?.[key] ?? self.#engineSettings[key]),
      engineSettings: { ...self.#engineSettings },
      onCycleLimit: hook,
      checkBudget: checkBudget ?? null
    };

    return {
      ctx,

      // A custom group's return value is untrusted and is scrubbed against its own input; a builtin
      // group is trusted and skips both the scrub and the accounting.
      runGroup(group, text) {
        if (group.builtin) {
          return runRuleGroup(group, text, ctx);
        }

        // One budget per run: opened on the text this group was handed and dropped after it, so no
        // credit survives into a run that did not earn it.
        budget = new TokenBudget(text, self.#safeSequences.restoreRegexes);

        try {
          const after = runRuleGroup(group, text, ctx);

          // A group that minted nothing, handed nothing in and changed nothing has nothing to scrub,
          // and the scrub is six passes over the whole text.
          return after === text && budget.untouched ? after : budget.scrub(after);
        } finally {
          budget = null;
        }
      }
    };
  }
}

// The body may not cross a paragraph boundary: with a bare `[\s\S]*?` an opening `<table>` pairs
// with a `</table>` several paragraphs later and the match swallows every `</p>` and `<p>` between
// them.
const BLOCK_TAG_RE = new RegExp(
  `<p>(\\s*)(<(?:${BLOCK_TAG_NAMES.join('|')})\\b[^>]*>(?:(?!<\\/p>)[\\s\\S])*?<\\/(?:${BLOCK_TAG_NAMES.join('|')})>)(\\s*)<\\/p>`,
  'gi'
);

// Void block tags have no closing tag, so BLOCK_TAG_RE (needs a pair) misses them.
const VOID_BLOCK_RE = new RegExp(
  `<p>(\\s*)(<(?:${VOID_BLOCK_TAG_NAMES.join('|')})\\b[^>]*\\/?>)(\\s*)<\\/p>`,
  'gi'
);

function unwrapBlocks(text) {
  // Both patterns anchor on a literal <p>, so without one there is nothing to unwrap — and a
  // structured document typesets one short value at a time, where the two scans are the whole cost.
  if (!/<p>/i.test(text)) {
    return text;
  }

  // Loop until stable so nested <p>-wrapped blocks are fully unwrapped.
  let result = text;
  let prev;

  do {
    prev = result;
    result = result.replace(BLOCK_TAG_RE, '$2').replace(VOID_BLOCK_RE, '$2');
  } while (prev !== result);

  return result;
}
