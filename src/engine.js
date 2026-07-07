import { clearSpecialChars } from './clear-special.js';
import { normaliseOptions, isOn, canonicalGroupName, wildcardToRegex } from './core/options.js';
import { MicroTypoConfigError, MicroTypoInputError, MicroTypoBudgetError } from './errors/index.js';
import { splitFrontmatter } from './input/frontmatter.js';
import { compileSpanSelectors, scanJson, selectValueSpans } from './input/json.js';
import { scanFences, scanLinkDestinations } from './input/markdown.js';
import { templateScanner } from './input/template.js';
import { scanToml } from './input/toml.js';
import { scanDoctype, scanXmlSpacePreserve, validateXml, xmlBlocks } from './input/xml.js';
import { scanYaml } from './input/yaml.js';
import { BLOCK_TAG_NAMES, VOID_BLOCK_TAG_NAMES } from './lib/block-tags.js';
import { G, unicodeToEntities, unicodeToXmlEntities } from './lib/glyphs.js';
import { edgeWhitespace, trimBlankLines } from './lib/strings.js';
import { SafeBlocks } from './protect/blocks.js';
import { scrubForgedTokens } from './protect/forgery.js';
import { restoreParagraphs, stripReservedPua } from './protect/placeholders.js';
import { SafeSequences } from './protect/sequences.js';
import { tagSpans } from './protect/tag-spans.js';
import { SafeTags } from './protect/tags.js';
import { compileRuleGroup, describeRuleGroup, runRuleGroup } from './rule-runner.js';
import { DEFAULT_GROUPS } from './rules/registry.js';
import { UNSAFE_PREFIX_RE, validateConfig } from './schemas/config.js';

// Raw-text tags whose content is not typeset; block-level tags are excluded (their content IS typeset).
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
];

const NOTG_START = '<span class="_notg_start"></span>';
const NOTG_END = '<span class="_notg_end"></span>';
// Quoted-attribute alternation so a `>` inside an attribute value doesn't truncate the opener.
const NOTG_RE = /<notg(?:\s(?:[^<>"']|"[^"]*"|'[^']*')*)?>([\s\S]*?)<\/notg>/gi;

const DEFAULT_LAYOUT = { style: true, class: false };

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
  #select;
  #processing = false; // reentrancy guard
  onCycleLimit = null;

  constructor(config = {}) {
    const validated = validateConfig(config);

    // Frozen clones, so later external mutation can't change which values get typeset.
    this.#input = validated.input;
    this.#select = compileSpanSelectors(this.#input);

    if (validated.presets !== false) {
      for (const [name, def] of DEFAULT_GROUPS) {
        this.registerRuleGroup(def, { name });
        // Only groups from this trusted list are builtin (exempt from the forgery scrub); a
        // later re-registration of a canonical name stays custom.
        this.#groups.get(name).builtin = true;
      }
    }

    this.#initVaults();

    // Registration order is load-bearing: an earlier block's placeholder hides its content from every later block's regex.
    if (this.#input.format === 'markdown' || this.#input.format === 'frontmatter') {
      // Line-oriented scanner: a same-length fence run mid-line can't close the block early.
      this.#safeBlocks.addScanner('md-fence', scanFences);

      // Double-backtick before single, so a `` span isn't partially consumed by the single-backtick pattern.
      this.addSafeBlock({
        id: 'md-span-double',
        open: '(?<!`)``(?!`)',
        close: '(?<!`)``(?!`)',
        unsafeRegex: true
      });

      this.addSafeBlock({
        id: 'md-span-single',
        open: '(?<!`)`(?!`)',
        close: '(?<!`)`(?!`)',
        unsafeRegex: true
      });

      // Balanced scanner: a literal ) inside the destination doesn't end the span early.
      this.#safeBlocks.addScanner('md-link-destination', scanLinkDestinations);

      // Zero-width lookaround vaults only the marker; the lookahead avoids swallowing preceding paragraphs (no m flag).
      this.addSafeBlock({
        id: 'md-list-marker-unordered',
        open: '(?:^|\\n)(?=[ \\t]{0,3}[-*+] )',
        close: '(?<=[ \\t]{0,3}[-*+] )',
        unsafeRegex: true
      });

      this.addSafeBlock({
        id: 'md-list-marker-ordered',
        open: '(?:^|\\n)(?=[ \\t]{0,3}\\d{1,9}[.)] )',
        close: '(?<=[ \\t]{0,3}\\d{1,9}[.)] )',
        unsafeRegex: true
      });

      // 4+ spaces or a tab = indented code; the whole line is vaulted, so close is end-of-line.
      this.addSafeBlock({
        id: 'md-indented-code',
        open: '(?:^|\\n)(?=[ ]{4}|\\t)',
        close: '(?=\\n|$)',
        unsafeRegex: true
      });

      // 2+ trailing spaces before \n; zero-width open/close vault the spaces, not the preceding text.
      this.addSafeBlock({
        id: 'md-hard-break',
        open: '(?=[ ]{2,}\\n)',
        close: '(?<=[ ]{2,})(?=\\n)',
        unsafeRegex: true
      });
    }

    if (this.#input.format === 'xml') {
      // Preserve subtrees vaulted whole, before the blocks below, so nothing downstream sees their interior.
      this.#safeBlocks.addScanner('xml-space-preserve', scanXmlSpacePreserve);
      // Before the comment/CDATA/PI blocks: a DOCTYPE internal subset can carry its own `<!--`/`<?`;
      // vaulting the DOCTYPE whole here prevents a block scanner from splitting it in two.
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

    // text/html need only comment protection; TAG_RE would otherwise split `<!-- … -->` at the first bare `>`.
    if (this.#input.format === 'text' || this.#input.format === 'html') {
      this.addSafeBlock({ id: 'html-comment', open: '<!--', close: '-->' });
    }

    // String-aware scan: a delimiter inside a quoted expression string doesn't close the span early.
    if (this.#input.template !== 'off') {
      const scanTemplate = templateScanner(this.#input.template);

      if (scanTemplate) {
        this.#safeBlocks.addScanner(`tmpl-${this.#input.template}`, scanTemplate);
      }
    }

    this.#applyValidatedOptions(validated);
  }

  // Construction-only: compiles the block/tag regexes once per instance.
  #initVaults() {
    this.#safeBlocks = new SafeBlocks();
    this.#safeSequences = new SafeSequences();
    this.#safeTags = new SafeTags();

    for (const tag of DEFAULT_SAFE_TAGS) {
      this.#safeBlocks.addTag(tag);
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
      throw new Error('Rule group must have a name');
    }

    const canonical = canonicalGroupName(groupName);
    const compiled = compileRuleGroup(group, canonical);
    this.#groups.set(canonical, compiled);
    this.#insertIntoOrder(canonical, position);

    return this;
  }

  #insertIntoOrder(name, position) {
    this.#order = this.#order.filter((n) => n !== name);

    if (position === 'end' || !position) {
      this.#order.push(name);

      return;
    }

    if (position === 'start') {
      this.#order.unshift(name);

      return;
    }

    const m = position.match(/^(after|before):(.+)$/);

    if (m) {
      const [, side, refRaw] = m;
      const ref = canonicalGroupName(refRaw);
      const idx = this.#order.indexOf(ref);

      if (idx === -1) {
        this.#order.push(name);
      } else {
        this.#order.splice(side === 'after' ? idx + 1 : idx, 0, name);
      }

      return;
    }

    this.#order.push(name);
  }

  // Read-only descriptors; never hand out the live compiled group (engine-mutable).
  getRuleGroup(name) {
    const g = this.#groups.get(canonicalGroupName(name));

    return g ? describeRuleGroup(g) : undefined;
  }

  listRuleGroups() {
    return Object.freeze(this.#order.map((n) => describeRuleGroup(this.#groups.get(n))));
  }

  addSafeTag(tag) {
    this.#safeBlocks.addTag(tag);

    return this;
  }

  addSafeBlock({ id, open, close, unsafeRegex = false }) {
    this.#safeBlocks.add({ id, open, close, unsafeRegex });

    return this;
  }

  setLayout(layout) {
    if (layout === 'style') {
      this.#layout = { style: true, class: false };
    } else if (layout === 'class') {
      this.#layout = { style: false, class: true };
    } else if (layout === 'both') {
      this.#layout = { style: true, class: true };
    }

    return this;
  }

  setPrefix(p) {
    const prefix = p === true ? 'mt_' : p || '';

    // prefix is prepended raw to a generated `class`; reject anything that could break out of the attribute quotes.
    if (UNSAFE_PREFIX_RE.test(prefix)) {
      throw new MicroTypoConfigError(
        `prefix must not contain a quote, angle bracket, "&", or whitespace: ${JSON.stringify(prefix)}`,
        { details: { prefix } }
      );
    }

    this.#prefix = prefix;

    return this;
  }

  applyOptions(options) {
    return this.#applyValidatedOptions(validateConfig(options));
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
      if (value === 'style' || value === 'class' || value === 'both') {
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

      const ctx = this.#makeContext(hook, checkBudget);

      if (this.#input.format === 'json') {
        return this.#processJson(result, ctx, checkBudget);
      }

      if (this.#input.format === 'toml') {
        return this.#typesetToml(result, ctx, checkBudget);
      }

      if (this.#input.format === 'yaml') {
        return this.#typesetYaml(result, ctx, checkBudget);
      }

      if (this.#input.format === 'xml') {
        validateXml(result, checkBudget);

        // XML edge whitespace is spliced out and back so interior rules and the newline-collapse invariant never mangle it.
        const lead = /^\s*/.exec(result)[0];
        const rest = result.slice(lead.length);
        const trail = /\s*$/.exec(rest)[0];
        const core = trail.length > 0 ? rest.slice(0, -trail.length) : rest;

        return lead + this.#runPipeline(core, ctx, checkBudget, { destination: 'xml' }) + trail;
      }

      if (this.#input.format === 'frontmatter') {
        return this.#typesetFrontmatter(result, ctx, checkBudget);
      }

      result = this.#runPipeline(result, ctx, checkBudget, { destination: 'html' });

      // Markdown uses edge-aware trim (preserves leading indented-code indent); text/HTML use String.trim().
      return this.#input.format === 'markdown' ? trimBlankLines(result) : result.trim();
    } finally {
      this.#processing = false;
    }
  }

  // null = no header (whole doc is a Markdown body); malformed = opening delimiter with no close, rejected not reparsed.
  #typesetFrontmatter(text, ctx, checkBudget) {
    const fm = splitFrontmatter(text);

    if (fm === null) {
      return trimBlankLines(this.#runPipeline(text, ctx, checkBudget));
    }

    if (fm.malformed) {
      throw new MicroTypoInputError(
        'Malformed frontmatter: opening delimiter has no matching closing delimiter',
        { details: {} }
      );
    }

    const typedHeader =
      fm.open === '+++'
        ? this.#typesetToml(fm.header, ctx, checkBudget)
        : this.#typesetYaml(fm.header, ctx, checkBudget);
    const typedBody = trimBlankLines(this.#runPipeline(fm.body, ctx, checkBudget));

    // Delimiter lines come straight from the original text, so they stay byte-exact.
    return (
      text.slice(0, fm.headerStart) +
      typedHeader +
      text.slice(fm.headerStart + fm.header.length, fm.bodyStart) +
      typedBody
    );
  }

  // Splices right-to-left so earlier offsets stay valid; no doc-level trim.
  #processJson(text, ctx, checkBudget) {
    // JSON.parse is the ground truth for malformation scanJson can't catch (trailing comma, garbage tail).
    try {
      JSON.parse(text);
    } catch (error) {
      throw new MicroTypoInputError(`Malformed JSON document: ${error.message}`, {
        details: { message: error.message }
      });
    }

    const spans = scanJson(text);
    const selected = selectValueSpans(spans, this.#select);

    return this.#spliceSpans(text, selected, ({ start, end }) => {
      let decoded;

      try {
        // JSON.parse can decode \uXXXX back into reserved PUA the raw strip never saw; strip again post-decode.
        decoded = stripReservedPua(JSON.parse(text.slice(start, end)));
      } catch (error) {
        throw new MicroTypoInputError(`Malformed JSON string literal: ${error.message}`, {
          details: { start, end }
        });
      }

      const { start: coreStart, end: coreEnd } = edgeWhitespace(decoded);
      let typed;

      if (coreStart === coreEnd) {
        typed = decoded;
      } else {
        typed =
          decoded.slice(0, coreStart) +
          this.#runPipeline(decoded.slice(coreStart, coreEnd), ctx, checkBudget, {
            destination: 'data-value'
          }).trim() +
          decoded.slice(coreEnd);
      }

      return JSON.stringify(typed);
    });
  }

  // Eligibility is decided up front by scanToml (escape-free strings only): the raw interior IS the value, no decode needed.
  #typesetToml(text, ctx, checkBudget) {
    const spans = scanToml(text).filter((span) => !span.isKey && span.eligible);
    const selected = selectValueSpans(spans, this.#select);

    return this.#spliceQuotedSpans(text, selected, ctx, checkBudget);
  }

  // scanYaml restricts spans to flow-quoted scalars only (bare/block/anchored scalars never produce a span).
  #typesetYaml(text, ctx, checkBudget) {
    const spans = scanYaml(text).filter((span) => !span.isKey && span.eligible);
    const selected = selectValueSpans(spans, this.#select);

    return this.#spliceQuotedSpans(text, selected, ctx, checkBudget);
  }

  // Each span's raw interior IS the value; re-wrap in the original quote char, preserving the value's edge whitespace.
  #spliceQuotedSpans(text, spans, ctx, checkBudget) {
    return this.#spliceSpans(text, spans, ({ start, end }) => {
      const quote = text[start];
      const interior = text.slice(start + 1, end - 1);
      const { start: coreStart, end: coreEnd } = edgeWhitespace(interior);
      let typed;

      if (coreStart === coreEnd) {
        typed = interior;
      } else {
        typed =
          interior.slice(0, coreStart) +
          this.#runPipeline(interior.slice(coreStart, coreEnd), ctx, checkBudget, {
            destination: 'data-value'
          }).trim() +
          interior.slice(coreEnd);
      }

      return quote + typed + quote;
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

  // Runs after safeBlocks.protect (a <notg> inside a vaulted region is already hidden) and before
  // safeTags.protect (the marker spans become ordinary vaulted tags). tagSpans() guards a <notg>
  // inside another tag's attribute value: a match starting inside a tag span stays literal so
  // safeTags vaults the whole outer tag verbatim.
  #protectNotg(text) {
    const spans = tagSpans(text);
    let s = 0;

    return text.replace(NOTG_RE, (match, inner, offset) => {
      while (s < spans.length && spans[s][1] <= offset) {
        s++;
      }

      if (s < spans.length && spans[s][0] < offset) {
        return match;
      }

      return `${NOTG_START}${this.#safeTags.iblock(inner)}${NOTG_END}`;
    });
  }

  // ctx.html is mutated (ctx is reused across calls); it must reflect the current call's destination.
  #runPipeline(text, ctx, checkBudget, { destination = 'html' } = {}) {
    const effHtml = destination === 'html' && this.#html;
    ctx.html = effHtml;

    // Per-call vault frame so an id minted for an earlier scalar can't be referenced by a later one.
    this.#safeSequences.resetFrame();

    let result = this.#safeSequences.protect(text);
    checkBudget('safeSequences.protect');

    result = this.#safeBlocks.protect(result, checkBudget);
    checkBudget('safeBlocks.protect');

    result = this.#protectNotg(result);
    checkBudget('protectNotg');

    result = this.#safeTags.protect(result);
    checkBudget('safeTags.protect');

    result = clearSpecialChars(result);
    checkBudget('clearSpecialChars');

    // Unconditional so it survives html:false disabling the text group.
    result = result
      .replaceAll('\r\n', '\n')
      .replaceAll('\r', '\n')
      .replace(/\n{3,}/g, '\n\n');
    checkBudget('newlineInvariant');

    for (const groupName of this.#order) {
      if (!effHtml && (groupName === 'text' || groupName === 'hanging')) {
        continue;
      }

      const group = this.#groups.get(groupName);

      if (!group) {
        continue;
      }

      if (group.builtin) {
        result = runRuleGroup(group, result, ctx);
      } else {
        // A custom group's return value is untrusted: scrub it against its own input. Builtin groups are trusted and skip this.
        const before = result;

        // Mint credit scoped to this group's run; cleared before it starts so stale credit can't be spent.
        ctx.mintedTokens.clear();
        ctx.trackMinted = true;
        result = runRuleGroup(group, result, ctx);
        ctx.trackMinted = false;
        result = scrubForgedTokens(
          before,
          result,
          ctx.mintedTokens,
          this.#safeSequences.restoreRegexes
        );
      }

      checkBudget(`group:${groupName}`);
    }

    // Entity-encode before restore, on rule-produced glyphs only: vault placeholders are opaque, so restored bodies aren't re-encoded.
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

    // text group wraps in <p> indiscriminately; unwrap block-level tags (HTML5 forbids block-in-inline).
    result = unwrapBlocks(result);

    return result;
  }

  #makeContext(hook, checkBudget) {
    const self = this;
    // Security boundary: never expose the engine instance to custom rule groups.
    return {
      text: '',
      group: null,
      tags: {
        findByTagName: (nameOrRegex) => self.#safeTags.findByTagName(nameOrRegex)
      },
      // Placeholders the engine mints during a non-builtin group's run are counted here, so the forgery scrub doesn't mistake them for forged ones.
      mintedTokens: new Map(),
      trackMinted: false,

      iblock(s) {
        const ph = self.#safeTags.iblock(s);

        if (this.trackMinted) {
          this.mintedTokens.set(ph, (this.mintedTokens.get(ph) ?? 0) + 1);
        }

        return ph;
      },

      tag(content, tag, attributes = {}) {
        // this.html (not self.#html) reflects the current call's destination — forced false for xml.
        if (!this.html) {
          return attributes.class === 'nowrap' ? content.replaceAll(' ', G.NBSP) : content;
        }

        // Credit only the wrapper tokens makeTag just minted, never rescanning caller-supplied content.
        const record = ({ html, tokens }) => {
          if (this.trackMinted) {
            for (const token of tokens) {
              this.mintedTokens.set(token, (this.mintedTokens.get(token) ?? 0) + 1);
            }
          }

          return html;
        };

        const { group } = this;
        const groupClasses = group?.raw?.classes ?? {};
        const attrs = { ...attributes };

        // Resolve the still-opaque URL/email placeholder to real bytes before escapeAttr and before
        // makeTag vaults it, or the restored `&` would land in the attribute unescaped.
        if (attrs.href) {
          attrs.href = self.#safeSequences.restore(String(attrs.href));
        }

        if (attrs.class) {
          let cls = attrs.class;
          // nowrap emits <span> by default; render.nowrap:'nobr' opts into the legacy <nobr> element.
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
            attributes: attrs,
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
  }
}

const BLOCK_TAG_RE = new RegExp(
  `<p>(\\s*)(<(?:${BLOCK_TAG_NAMES.join('|')})\\b[^>]*>[\\s\\S]*?<\\/(?:${BLOCK_TAG_NAMES.join('|')})>)(\\s*)<\\/p>`,
  'gi'
);

// Void block tags have no closing tag, so BLOCK_TAG_RE (needs a pair) misses them.
const VOID_BLOCK_RE = new RegExp(
  `<p>(\\s*)(<(?:${VOID_BLOCK_TAG_NAMES.join('|')})\\b[^>]*\\/?>)(\\s*)<\\/p>`,
  'gi'
);

function unwrapBlocks(text) {
  // Loop until stable so nested <p>-wrapped blocks are fully unwrapped.
  let result = text;
  let prev;

  do {
    prev = result;
    result = result.replace(BLOCK_TAG_RE, '$2').replace(VOID_BLOCK_RE, '$2');
  } while (prev !== result);

  return result;
}
