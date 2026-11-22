import { decodeSpecialChars, readScalarAt } from './clear-special.js';
import { normaliseOptions, isOn, canonicalGroupName, wildcardToRegex } from './core/options.js';
import { MicroTypoConfigError, MicroTypoInputError, MicroTypoBudgetError } from './errors/index.js';
import { typesetAttributes } from './input/attributes.js';
import { scanLeadingHeader, splitFrontmatter } from './input/frontmatter.js';
import { compileSpanSelectors, scanJson, selectValueSpans } from './input/json.js';
import { localizationScanner } from './input/localization.js';
import {
  documentCodeSpanReader,
  markdownAddressSyntax,
  markdownCommentCloser,
  opaqueInline,
  scanFences,
  scanIndentedCode,
  scanLinePrefix,
  scanTableDelimiters,
  scanLinkDestinations,
  scanMarkdownComments,
  scanReferenceDefinitions,
  isMarkdownDividerAt,
  scanUnclosedHtmlBlock
} from './input/markdown.js';
import { scanMath } from './input/math.js';
import { esmReader, mdxLineReader, opaqueMdx, paragraphEndReader } from './input/mdx.js';
import { scanPragmas } from './input/pragmas.js';
import { scannerFor, templateReader } from './input/template.js';
import { scanToml } from './input/toml.js';
import {
  scanDoctype,
  scanXmlSpacePreserve,
  validateXml,
  xmlBlocks,
  xmlConstructReader
} from './input/xml.js';
import { scanYaml } from './input/yaml.js';
import { BLOCK_TAG_NAMES, VOID_BLOCK_TAG_NAMES, DEFAULT_SAFE_TAGS } from './lib/block-tags.js';
import {
  CHARACTER_REFERENCE_HEAD,
  characterReferenceEndingAt,
  readCharacterReferenceAt,
  quoteBoundaryGlyph
} from './lib/character-reference.js';
import { changedRanges, replacementEdits } from './lib/diff.js';
import { G, unicodeToEntities, unicodeToXmlEntities } from './lib/glyphs.js';
import { bindInlineBoundaries } from './lib/inline-boundaries.js';
import { fileLineStyle, restoreFileEndings, restoreFileTail } from './lib/line-endings.js';
import { SourceMap, jsonSourceMap, representedMap } from './lib/provenance.js';
import { bindRuleBudget } from './lib/rule-budget.js';
import { F, holdsAnyFeature } from './lib/rule-features.js';
import { RuleTrace, bindRuleTrace, ruleTraceOf, unbindRuleTrace } from './lib/rule-trace.js';
import { releaseSession } from './lib/session-maps.js';
import { edgeWhitespace, leadingIndent, trimBlankLines } from './lib/strings.js';
import { SafeBlocks, scanHtmlComments, scanLineIndent } from './protect/blocks.js';
import { TokenBudget } from './protect/forgery.js';
import {
  BLOCK_KIND,
  OPEN,
  PARAGRAPH_OPEN,
  PLACEHOLDER_TOKEN,
  dropParagraphs,
  restoreParagraphs,
  stripReservedPua
} from './protect/placeholders.js';
import { escapeReserved, hasReserved } from './protect/reserved.js';
import { SafeSequences } from './protect/sequences.js';
import { DOCUMENT_READING, FRAGMENT_READING, tagSpans } from './protect/tag-spans.js';
import { assertTagName, SafeTags } from './protect/tags.js';
import {
  compileRuleGroup,
  canRunRuleGroup,
  describeRuleGroup,
  enabledRule,
  isRuleOn,
  runRuleGroup,
  runStep
} from './rule-runner.js';
import { SOURCE_YEAR_RANGE_RE, YEAR_MARKS } from './rules/date.js';
import { bindNowrapRules } from './rules/etc.js';
import {
  bindQuoteBlockEdges,
  bindQuoteLineBlocks,
  bindQuoteInlinePadding,
  bindQuoteParagraphs,
  bindReferenceGlyph,
  canonicalQuoteRoles
} from './rules/quote-state.js';
import { bindQuoteRules, bindQuotePaddingStrip, prepareAuthoredQuotes } from './rules/quote.js';
import { DEFAULT_GROUPS } from './rules/registry.js';
import { bindBoundaryActivity, punctuationAfterInlineGap } from './rules/space.js';
import { markdownSources, paragraphEdgeReader } from './rules/text.js';
import { UNSAFE_PREFIX_RE, validateConfig } from './schemas/config.js';

const trimEdges = (text) => text.trim();

// MathML is foreign content in HTML, where `<math/>` closes itself as it does in XML.
const FOREIGN_TAGS = new Set(['math']);

// Of those, the two whose content a reader never sees. `abbr.currency` is the reader of the
// difference: a sentence in front of a `<script>` has ended, while the words in a `<code>` span go
// on with it, and both arrive as the same shape once the content is vaulted.
const NON_RENDERING_TAGS = new Set(['script', 'style', 'noembed', 'title']);

// The elements HTML parses as raw or escapable-raw text. Their content is text and nothing else, so
// a tag written inside one is those bytes rather than a nested element.
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'xmp', 'noembed', 'title']);

// What the HTML tokenizer opens a tag, a closing tag, a comment or a declaration on.
const TAG_START_RE = /<[A-Za-z/!?]/u;

const NOTG_START = '<span class="_notg_start"></span>';
const NOTG_END = '<span class="_notg_end"></span>';
// Quoted-attribute alternation so a `>` inside an attribute value doesn't truncate the opener.
const NOTG_RE = /<notg(?:\s(?:[^<>"']|"[^"]*"|'[^']*')*)?>([\s\S]*?)<\/notg>/gi;

const DEFAULT_LAYOUT = { style: true, class: false };

// Readers whose context a later builtin group creates, under the last group that creates it. Each
// enabled reader runs once right after that group, whose rules may be off, so it sees every such
// boundary in the pass that creates it, as a repeated pass does.
const DEPENDENT_READS = new Map([
  // Trimmed gaps and stripped quote padding bring punctuation marks together; a collapsed run of
  // spaces leaves the one gap before a conjunction.
  [
    'space',
    [
      ['punctuation', 'drop_terminal_garbage'],
      ['punctuation', 'collapse_doubled'],
      ['punctuation', 'comma_before_conjunction']
    ]
  ],
  // Units, currency and initials expose the end of an abbreviated reference, numeric notation and a
  // new word start, `т.е.и т. д.` included, and change what stands before a dash. The word start
  // `,5л.т «` gets from a unit is a short word before a quote. A unit's power and a fraction leave a
  // currency sign with no number in front, `5 м² € 0`, `⅝ ₽ 5`, so it binds to the number after it.
  [
    'abbr',
    [
      ['space', 'space_after_period'],
      ['space', 'space_after_punctuation'],
      ['space', 'nbsp_before_quote'],
      ['abbr', 'nbsp_location'],
      ['number', 'sup'],
      ['number', 'sub'],
      ['abbr', 'nbsp_short_acronym'],
      ['abbr', 'nbsp_currency_prefix'],
      // A currency prefix can replace a thin gap with the word boundary a glued year reads.
      ['space', 'space_after_year'],
      ['dash', 'emphatic_particle'],
      ['dash', 'em']
    ]
  ],
  // A run of spaces bound after a short word leaves one gap before a conjunction; a wrapper written
  // around words this group bound gives them back their spaces. Initials parted before a surname
  // start the `т. н.` their second one was glued to, `За М.Т. н.`.
  [
    'nobr',
    [
      ['punctuation', 'comma_before_conjunction'],
      ['nobr', 'nbsp_short_word']
    ]
  ],
  // A year mark ends the number `и т. д.` binds, as the abbreviations before it end the reference,
  // `т.е.и т. д.`.
  ['date', [['abbr', 'nowrap_etc']]],
  // Year marks change what stands before a dash; a wrapper around a time, an address or a phone, a
  // currency sign in place of a glued letter end a digit chain the triads left whole.
  [
    'other',
    [
      ['dash', 'em_after_sentence'],
      ['number', 'thin_space_triads']
    ]
  ],
  // A wrapper's end or a paragraph's start before a comma is neither a decimal digit nor the start
  // of the text; the number after the comma it parts is no decimal part either, `ГОСТ 6</span>, 4 и`.
  // The dash of a year range starts a number bound to the word after it.
  ['text', [['space', 'space_after_comma']]]
]);

const BOM = '\u{FEFF}';

// Formats whose document is Markdown source; frontmatter is here because its body is one.
const BLOCK_RENDER_FORMATS = new Set(['markdown', 'frontmatter', 'mdx']);
const FILE_FORMATS = new Set(['markdown', 'frontmatter', 'mdx', 'yaml', 'toml', 'json', 'xml']);

const sameList = (a, b) =>
  a === b || (a?.length === b?.length && a.every((value, i) => value === b[i]));

// Whether two validated `input` configurations ask for the same thing. `validateConfig` fills the
// default in, so an absent `input` arrives here spelled out as `text`, and comparing the objects is
// the only way to tell "no input given" from "a different one asked for".
const sameInputConfig = (a, b) =>
  a.format === b.format &&
  a.template === b.template &&
  a.placeholders === b.placeholders &&
  a.pragmas === b.pragmas &&
  a.math === b.math &&
  sameList(a.attributes, b.attributes) &&
  sameList(a.fields, b.fields) &&
  sameList(a.exclude, b.exclude);

// 30K cap: some rules backtrack quadratically and the budget is only checked between groups.
export const DEFAULT_MAX_INPUT_LENGTH = 30_000;

export class MicroTypo {
  #groups = new Map();
  #order = [];
  #safeBlocks;
  #safeSequences;
  #markdownAddressSyntax;
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
  #ignoredFile = false;
  #pragmaDocument = false;
  #attributeNames = null;
  #customProtection = false;
  // Whether a fragment of the current document can carry a reserved character. Only a JSON value
  // can hold one its document does not spell, since `JSON.parse` decodes ``; elsewhere one look
  // at the document spares a structured format the check on every value.
  #reservedPossible = false;
  #trace = null;
  onCycleLimit = null;

  constructor(config = {}) {
    const validated = validateConfig(config);

    // Frozen clones, so later external mutation can't change which values get typeset.
    this.#input = validated.input;
    if (
      this.#input.attributes.length > 0 &&
      ['text', 'html', 'markdown', 'frontmatter'].includes(this.#input.format)
    ) {
      this.#attributeNames = new Set(this.#input.attributes);
    }
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

    for (const group of validated.ruleGroups ?? []) {
      this.registerRuleGroup(group, { name: group.name, position: group.position });
    }

    // A string-aware scan, so a delimiter inside a quoted expression does not close the span early.
    const readTemplates =
      this.#input.template === 'off' ? null : templateReader(this.#input.template);
    const scanTemplate = scannerFor(readTemplates);
    const readElements = (text, checkBudget, mdx = null) =>
      this.#safeBlocks.elementReader(
        text,
        checkBudget,
        this.#input.format !== 'plain',
        mdx,
        readTemplates,
        this.#input.format === 'markdown' || this.#input.format === 'frontmatter'
          ? paragraphEndReader
          : null
      );
    const htmlOwners = [readElements];
    if (this.#input.format === 'xml') {
      htmlOwners.unshift(xmlConstructReader, (text, checkBudget) => {
        const spans = scanXmlSpacePreserve(text, checkBudget, true);
        let cursor = 0;
        return (from) => {
          while (cursor < spans.length && spans[cursor][0] < from) {
            cursor += 1;
          }
          const span = spans[cursor];
          return span === undefined ? null : [span[0], span[1], span[1]];
        };
      });
    }

    const markdown = BLOCK_RENDER_FORMATS.has(this.#input.format);
    const addPragmas = () => {
      if (
        this.#input.pragmas === 'microtypo' &&
        (markdown || this.#input.format === 'text' || this.#input.format === 'html')
      ) {
        this.#safeBlocks.addScanner('microtypo-pragma', (text, checkBudget) =>
          this.#pragmaDocument
            ? scanPragmas(text, checkBudget, {
                markdown,
                restore: (content) => this.#safeBlocks.restore(content),
                ignoreFile: () => {
                  this.#ignoredFile = true;
                }
              })
            : []
        );
      }
    };
    if (!markdown && readTemplates !== null) {
      this.#safeBlocks.addScanner(
        'template-bodies',
        opaqueInline(null, templateReader(this.#input.template, true), htmlOwners)
      );
    }

    // Registration order is load-bearing: an earlier block's placeholder hides its content from every
    // later block's regex.
    if (!markdown && this.#input.format !== 'plain') {
      this.#addSafeElements();
    }

    if (markdown) {
      const mdx = this.#input.format === 'mdx';
      const readMdxLines =
        mdx || readTemplates !== null
          ? mdxLineReader(documentCodeSpanReader, readTemplates, [readElements], mdx)
          : null;
      // Every block scanner asks one question of where an HTML block opens: a template expression
      // stays opaque to it.
      const boundaryOpaque = (mdx ? opaqueMdx : opaqueInline)(
        documentCodeSpanReader,
        readTemplates,
        [readElements],
        false
      );
      const templatesIn = (text, checkBudget) => () => boundaryOpaque(text, checkBudget);

      // Before every other block, so no line of the header opens one. The front-matter format reads
      // its header as data and its body has none.
      if (this.#input.format === 'markdown' || this.#input.format === 'mdx') {
        this.#safeBlocks.addScanner('md-leading-header', scanLeadingHeader);
      }

      // Line-oriented scanner: a same-length fence run mid-line can't close the block early. The
      // lines of an HTML block open no fence.
      this.#safeBlocks.addScanner(
        'md-fence',
        (text, checkBudget) =>
          scanFences(
            text,
            checkBudget,
            templatesIn(text, checkBudget),
            this.#input.format === 'mdx' ? esmReader : null,
            readMdxLines
          ),
        true
      );

      // Block-level constructs first: their interiors must be opaque to every inline scanner below.
      // A backtick inside a reference definition is part of that block and must not pair with one in
      // the prose around it, which is why definitions are taken before code spans — and why the
      // reference scanner resolves code spans itself before deciding which labels are uses.
      this.#safeBlocks.addScanner(
        'md-indented-code',
        (text, checkBudget) =>
          scanIndentedCode(
            text,
            checkBudget,
            templatesIn(text, checkBudget),
            this.#input.format === 'mdx',
            readMdxLines
          ),
        true
      );

      // An HTML block is block structure too: read after code blocks, so a tag written in one opens
      // nothing, and before every inline construct, whose backticks inside the block are its own
      // bytes and may hold the end tag that closes it. The code-block scanners skip the lines it
      // owns, so a fence or indent inside it hides no end tag.
      this.#safeBlocks.addScanner(
        'md-html-block',
        (text, checkBudget) =>
          scanUnclosedHtmlBlock(
            text,
            checkBudget,
            templatesIn(text, checkBudget),
            this.#input.format === 'mdx',
            readMdxLines
          ),
        true
      );

      // One answer about the opaque inline constructs, shared by the reader that needs it early and
      // the pass that applies it: the reference scanner decides which labels are uses by where the
      // code spans fall, and templates move where they fall. An element or comment that opened first
      // owns the backticks inside it.
      const scanInline = (this.#input.format === 'mdx' ? opaqueMdx : opaqueInline)(
        documentCodeSpanReader,
        readTemplates,
        [readElements]
      );
      this.#markdownAddressSyntax = (source, checkBudget) =>
        markdownAddressSyntax(
          source,
          scanInline,
          readElements,
          checkBudget,
          this.#input.format === 'mdx'
        );

      this.#safeBlocks.addScanner('md-reference-definition', (text, checkBudget, resolve) =>
        scanReferenceDefinitions(text, checkBudget, resolve, scanInline)
      );

      // Backtick runs of any length, matched closer-first, so a 3+ span isn't mistaken for prose.
      // A template expression is the other opaque inline construct, and which of the two a stretch
      // belongs to is settled by which opened first, never by which pass ran first. Both stay behind
      // the block constructs, whose interiors are already opaque here: read before them, an
      // expression could span a fence boundary and take the fence apart.
      this.#safeBlocks.addInlineScanner('md-inline-opaque', scanInline);

      // A tag written in code is text, so elements are paired once every kind of code is out of
      // sight.
      this.#addSafeElements();

      // Balanced scanner: a literal ) inside the destination doesn't end the span early.
      this.#safeBlocks.addScanner('md-link-destination', scanLinkDestinations);

      if (this.#input.math) {
        this.#safeBlocks.addScanner('md-math', scanMath);
      }

      // Indent, blockquote chain and list or heading marker in one span, so `> -` stays a list
      // rather than becoming an em dash and the spaces that set a content column survive.
      // Prefix protection removes real `>` boundaries. Read pragma comments after opaque code
      // and elements, while those original tag boundaries still exist.
      addPragmas();

      this.#safeBlocks.addScanner('md-table-delimiter', scanTableDelimiters);
      this.#safeBlocks.addScanner('md-line-prefix', scanLinePrefix);

      // Two or more trailing spaces before a line ending of any of the three kinds; the zero-width
      // open and close vault the spaces rather than the text in front of them.
      this.addSafeBlock({
        id: 'md-hard-break',
        open: '(?=[ ]{2,}[\\r\\n])',
        close: '(?<=[ ]{2,})(?=[\\r\\n])',
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
      // reference head, `&#X` included, which XML does not spell but the decoder reads, and requires
      // the terminating `;` right after (lookahead), so a bare `&` never matches and a bogus head
      // fails outright.
      this.addSafeBlock({
        id: 'xml-entity',
        open: `${CHARACTER_REFERENCE_HEAD}(?=;)`,
        close: ';',
        unsafeRegex: true
      });
    }

    const html = this.#input.format === 'text' || this.#input.format === 'html';

    // TAG_RE would otherwise split `<!-- … -->` at the first bare `>`. Markdown passes raw HTML
    // through, comments included.
    if (html || markdown) {
      this.#safeBlocks.addScanner(
        'html-comment',
        markdown ? scanMarkdownComments : scanHtmlComments
      );
    }

    if (!markdown && scanTemplate) {
      this.#safeBlocks.addScanner(
        `tmpl-${this.#input.template}`,
        opaqueInline(null, readTemplates, htmlOwners)
      );
    }

    if (!markdown) {
      addPragmas();
    }

    const localization = localizationScanner(
      this.#input.placeholders,
      this.#input.format === 'xml'
    );
    if (localization !== null) {
      this.#safeBlocks.addScanner('localization', localization);
    }

    // Only an HTML document is markup to its end. Markdown reads an element left open as text unless
    // it opens an HTML block, which `scanUnclosedHtmlBlock` takes; a value of a data format is a
    // fragment, and XML closes every element or is rejected.
    if (html) {
      this.#safeBlocks.setTail({ opaque: NOTG_RE });
    }

    if (html || this.#input.format === 'plain') {
      this.#safeBlocks.setIndents(scanLineIndent);
    }

    this.#applyValidatedOptions(validated);
  }

  // Construction-only: compiles the block/tag regexes once per instance.
  #initVaults() {
    this.#safeBlocks = new SafeBlocks(
      this.#input.format === 'mdx',
      BLOCK_RENDER_FORMATS.has(this.#input.format) ? markdownCommentCloser : null,
      this.#input.format === 'text' || this.#input.format === 'html'
        ? DOCUMENT_READING
        : FRAGMENT_READING,
      this.#input.format === 'markdown' || this.#input.format === 'frontmatter'
        ? paragraphEndReader
        : null,
      this.#input.format === 'xml'
    );
    this.#safeSequences = new SafeSequences();
    this.#safeTags = new SafeTags({
      xmlNames: this.#input.format === 'xml',
      document: this.#input.format === 'text' || this.#input.format === 'html',
      readComments: BLOCK_RENDER_FORMATS.has(this.#input.format) ? markdownCommentCloser : null
    });
  }

  #addSafeElements() {
    const xml = this.#input.format === 'xml';

    const tags =
      this.#input.format === 'html' || this.#input.format === 'text'
        ? [...DEFAULT_SAFE_TAGS, 'xmp', 'noembed', 'title']
        : DEFAULT_SAFE_TAGS;
    for (const tag of tags) {
      this.#safeBlocks.addTag(tag, {
        renders: !NON_RENDERING_TAGS.has(tag),
        // Raw text is an HTML parsing mode. In XML the same element nests like any other, and a
        // `<script>` inside a `<script>` is a real element whose first close is not the outer one.
        nests: xml || !RAW_TEXT_TAGS.has(tag),
        // HTML allows a form feed among the space before a closing `>`; XML's S production does not.
        formFeed: !xml,
        slashOpens: !xml && !FOREIGN_TAGS.has(tag),
        typeset: tag === 'title'
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

  #builtinRule(group, id) {
    const owner = this.#groups.get(group);
    return owner?.builtin === true ? enabledRule(owner, id) : null;
  }

  #builtinRuleOn(group, id) {
    return this.#builtinRule(group, id) !== null;
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
    this.#customProtection = true;

    return this;
  }

  addSafeBlock({ id, open, close, unsafeRegex = false }) {
    this.#safeBlocks.add({ id, open, close, unsafeRegex });
    this.#customProtection = true;

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
    const catalogue = new Map(
      DEFAULT_GROUPS.map(([name, def]) => [name, def.rules.map((rule) => rule.id)])
    );
    for (const [name, group] of this.#groups) {
      catalogue.set(
        name,
        group.compiledRules.map((rule) => rule.id)
      );
    }
    const validated = validateConfig(options, catalogue);
    // What the caller wrote, not what validation filled in: an absent `input` arrives here spelled
    // out as `text`, and comparing that against the real format would read every partial update as a
    // request to become a plain-text engine.
    const asked = Object(options ?? {});

    if (asked.ruleGroups !== undefined) {
      throw new MicroTypoConfigError(
        'ruleGroups is settled by the constructor; use registerRuleGroup',
        {
          details: { option: 'ruleGroups' }
        }
      );
    }

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
    const intent = normaliseOptions(validated, new Set(this.#groups.keys()));

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

  process(text, options) {
    if (typeof text !== 'string') {
      throw new MicroTypoInputError(`process() expects string, got ${typeof text}`, {
        details: { receivedType: typeof text }
      });
    }

    const diagnostics = readProcessOptions(options);

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

    const checkBudget = budgetCheck(this.#maxProcessingMs, performance.now());
    const trace = diagnostics.trace ? [] : null;
    this.#trace = trace;
    let result;
    let asGiven = false;

    // A byte-order mark tells how the file is encoded, not what it says: it goes back first, and no
    // format reads it as part of the document.
    const bom = text.startsWith(BOM) ? BOM : '';

    try {
      this.#reservedPossible = this.#input.format === 'json' || hasReserved(text);
      result = bom + this.#typeset(text.slice(bom.length), checkBudget, bom.length);
      // A placeholder still standing after the restore is an address the engine cannot give back.
      // The text returns as it came: the one output known to hold no string of the engine's own.
      asGiven = this.#ignoredFile || this.#safeSequences.leftIn(result);
      if (asGiven) {
        result = text;
      }
      if (FILE_FORMATS.has(this.#input.format)) {
        result = restoreFileTail(text, result);
      }
      checkBudget('restore');
    } finally {
      this.#processing = false;
      this.#trace = null;
    }

    if (!diagnostics.changes && !diagnostics.edits && !diagnostics.trace) {
      return result;
    }

    return {
      text: result,
      ...(diagnostics.trace ? { trace: asGiven ? [] : trace } : {}),
      ...(diagnostics.changes ? { changes: changedRanges(text, result, checkBudget) } : {}),
      ...(diagnostics.edits ? { edits: replacementEdits(text, result, checkBudget) } : {})
    };
  }

  #typeset(text, checkBudget, offset) {
    // Reserved PUA in the input is escaped per fragment in `#runPipeline`, where placeholders live.
    // Snapshot the hook so a rule callback can't swap it mid-process.
    const hook = this.onCycleLimit;
    this.#ignoredFile = false;
    this.#resetVaults();

    const session = this.#makeSession(hook, checkBudget);

    try {
      return this.#typesetIn(session, text, checkBudget, offset);
    } finally {
      for (const worker of session.workers?.values() ?? []) {
        worker.state.release();
      }
      session.release();
    }
  }

  #typesetIn(session, text, checkBudget, offset) {
    session.lineStyle =
      FILE_FORMATS.has(this.#input.format) && this.#input.format !== 'json' && text.includes('\r')
        ? fileLineStyle(text, checkBudget)
        : null;

    if (this.#input.format === 'json') {
      return this.#processJson(text, session, checkBudget, offset);
    }

    if (this.#input.format === 'toml') {
      return this.#typesetStructured(text, scanToml, session, checkBudget, offset);
    }

    if (this.#input.format === 'yaml') {
      return this.#typesetStructured(text, scanYaml, session, checkBudget, offset);
    }

    if (this.#input.format === 'xml') {
      validateXml(text, checkBudget);

      // XML edge whitespace is spliced out and back, so interior rules and the newline collapse
      // never mangle it.
      const { start, end } = edgeWhitespace(text);
      const core = text.slice(start, end);

      return (
        text.slice(0, start) +
        this.#runPipeline(core, session, checkBudget, {
          destination: 'xml',
          sourceMap: this.#sourceMap(core, offset + start, checkBudget)
        }) +
        text.slice(end)
      );
    }

    if (this.#input.format === 'frontmatter') {
      return this.#typesetFrontmatter(text, session, checkBudget, offset);
    }

    // Markdown trims edge-aware, keeping the leading indent of indented code; text and HTML trim
    // as `String.prototype.trim` does, all but the indent of the first line with content.
    if (this.#input.format === 'markdown' || this.#input.format === 'mdx') {
      return this.#typesetMarkdown(text, session, checkBudget, offset);
    }

    // Spliced out rather than lifted onto a line of its own, which would put a line break in front of
    // content the rules read at the start of the document; the blank lines before it stay for the
    // trim.
    const [from, to] = leadingIndent(text, readScalarAt, checkBudget);
    const spliced = text.slice(0, from) + text.slice(to);
    return this.#runPipeline(spliced, session, checkBudget, {
      destination: this.#input.format === 'plain' ? 'plain' : 'html',
      trim: trimEdges,
      indents: true,
      firstIndent: to < text.length ? text.slice(from, to) : '',
      sourceMap: this.#sourceMap(text, offset, checkBudget)?.fork(spliced) ?? null
    });
  }

  #sourceMap(text, offset, checkBudget) {
    return this.#trace === null ? null : new SourceMap(text, offset, checkBudget);
  }

  #typesetMarkdown(text, session, checkBudget, offset) {
    return this.#runPipeline(text, session, checkBudget, {
      trim: this.#trimBlankLines,
      sourceMap: this.#sourceMap(text, offset, checkBudget)
    });
  }

  // `null` is no header, the whole document being a Markdown body; MALFORMED is an opening delimiter
  // with no close, which is rejected rather than reparsed.
  #typesetFrontmatter(text, session, checkBudget, offset) {
    const fm = splitFrontmatter(text);

    if (fm === null) {
      return this.#typesetMarkdown(text, session, checkBudget, offset);
    }

    if (fm.malformed) {
      throw new MicroTypoInputError(
        'Malformed frontmatter: opening delimiter has no matching closing delimiter',
        { details: {} }
      );
    }

    const typedHeader = this.#typesetStructured(
      fm.header,
      fm.open === '+++' ? scanToml : scanYaml,
      session,
      checkBudget,
      offset + fm.headerStart
    );
    const boundary = /^(?:[ \t]*(?:\r\n?|\n))+/u.exec(fm.body)?.[0] ?? '';
    const typedBody = this.#typesetMarkdown(fm.body, session, checkBudget, offset + fm.bodyStart);

    // Delimiter lines come straight from the original text, so they stay byte-exact.
    return (
      text.slice(0, fm.headerStart) +
      typedHeader +
      text.slice(fm.headerStart + fm.header.length, fm.bodyStart) +
      boundary +
      typedBody
    );
  }

  // Splices right-to-left so earlier offsets stay valid; no doc-level trim.
  #processJson(text, session, checkBudget, offset) {
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
    const selected = selectValueSpans(spans, this.#select, checkBudget);

    return this.#spliceSpans(text, selected, ({ start, end }) => {
      let decoded;

      try {
        decoded = JSON.parse(text.slice(start, end));
      } catch (error) {
        throw new MicroTypoInputError(`Malformed JSON string literal: ${error.message}`, {
          details: { start, end }
        });
      }

      return JSON.stringify(
        this.#typesetValue(
          decoded,
          session,
          checkBudget,
          this.#trace === null
            ? null
            : jsonSourceMap(text.slice(start, end), offset + start, decoded, checkBudget)
        )
      );
    });
  }

  // A structured value keeps its own edge whitespace: the pipeline trims what it is handed, so only
  // the core goes through it and the edges are put back around the result. A value that is nothing
  // but whitespace has no core and is returned as it came.
  #typesetValue(value, session, checkBudget, sourceMap) {
    const { start, end } = edgeWhitespace(value);

    if (start === end) {
      return value;
    }

    const core = value.slice(start, end);
    if (session.canSkipValue(core)) {
      checkBudget('data-value');
      return value;
    }

    return (
      value.slice(0, start) +
      trimEdges(
        this.#runPipeline(core, session, checkBudget, {
          destination: 'data-value',
          sourceTrim: trimEdges,
          sourceMap: sourceMap?.slice(start, end)
        })
      ) +
      value.slice(end)
    );
  }

  // Eligibility is decided up front by the scanner, so the raw interior is the value and needs no
  // decode: `scanToml` reports escape-free strings only, and `scanYaml` reports quoted scalars,
  // block-scalar content lines and plain scalars that resolve to a string.
  #typesetStructured(text, scan, session, checkBudget, offset) {
    // Keys are dropped by `selectValueSpans`, which every format goes through, so filtering them
    // here would copy the whole span array for a predicate already known false.
    const spans = scan(text, checkBudget).filter((span) => span.eligible);
    const selected = selectValueSpans(spans, this.#select, checkBudget);

    return this.#spliceQuotedSpans(text, selected, session, checkBudget, offset);
  }

  // Each span's raw interior is the value, so it is re-wrapped in the original delimiter with the
  // value's edge whitespace preserved.
  #spliceQuotedSpans(text, spans, session, checkBudget, offset) {
    return this.#spliceSpans(text, spans, (span) => {
      // Every span states its own wrapper — one character, three for a TOML multi-line string, none
      // for a YAML block or plain scalar — rather than the engine re-deriving it from the source.
      const { start, end, delim: quote } = span;
      const interior = text.slice(start + quote.length, end - quote.length);
      const traceStart = this.#trace?.map(({ count, ranges }) => [count, ranges.length]);
      const typed = this.#typesetValue(
        interior,
        session,
        checkBudget,
        this.#sourceMap(interior, offset + start + quote.length, checkBudget)
      );

      // The scanner guarantees the input interior holds no bare wrapper quote, but glyph folding can
      // produce one (a typographic `”` or a `&#34;` reference lands as ASCII `"`), and re-wrapping
      // that closes the scalar early and hands the rest of the value to the parser as structure.
      // TOML literal strings have no escape at all, so the only universally correct answer is to
      // leave the scalar untypeset rather than change what the document means. A YAML block scalar
      // line has no wrapper at all, so there is nothing it could close early; a plain scalar has no
      // wrapper either and carries its own guard, because what ends it is a token inside the value.
      if ((quote !== '' && typed.includes(quote)) || (span.guard && !span.guard(typed))) {
        if (traceStart !== undefined) {
          this.#trace.length = traceStart.length;
          for (let i = 0; i < traceStart.length; i++) {
            this.#trace[i].count = traceStart[i][0];
            this.#trace[i].ranges.length = traceStart[i][1];
          }
        }
        return text.slice(start, end);
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
  // Every fragment a document is typeset in passes through here, so this is the one place the
  // reserved characters are escaped: a JSON value carries them only once `JSON.parse` decodes it.
  #typesetAttributes(text, session, checkBudget) {
    if (!text.includes('<')) {
      return text;
    }
    const { engine, state, inherited } = this.#attributeWorker(session, checkBudget);
    let sourceMap = null;
    const transform = (value, sourceStart, sourceEnd) => {
      const { start, end } = edgeWhitespace(value);
      if (start === end) {
        return value;
      }
      if (sourceMap === null && session.traceFrame !== null) {
        sourceMap = representedMap(session.traceFrame.map, text, session.traceFrame.render);
      }
      return this.#typesetWithWorker(engine, state, inherited, value, start, end, checkBudget, {
        trace: this.#trace,
        sourceMap: sourceMap?.slice(sourceStart, sourceEnd).slice(start, end)
      });
    };
    return typesetAttributes(
      text,
      this.#attributeNames,
      transform,
      (name) => this.#safeBlocks.protectsTag(name),
      checkBudget,
      session.traceFrame === null
        ? undefined
        : (output, edits) => {
            if (sourceMap !== null) {
              session.traceFrame.map = sourceMap.edited(output, edits);
            }
          }
    );
  }

  // The text of a document title is typeset as a text value is: HTML reads it as RCDATA, so its
  // character references stay as written and nothing in it becomes markup, a no-break wrapper
  // included. Its glyphs are spelled as the rest of the document's are. The trace keeps to the
  // document's own offsets, which a vaulted body has none of. Inside `<svg>` the same element holds
  // real markup, so a body with a tag in it goes to a worker that keeps tags and comments as the
  // document does, and their attribute quotes are never read as prose.
  #typesetTextBody(body, session, checkBudget) {
    const { start, end } = edgeWhitespace(body);
    if (start === end) {
      return body;
    }
    const { engine, state, inherited } = this.#attributeWorker(
      session,
      checkBudget,
      TAG_START_RE.test(body) ? 'text' : 'plain'
    );
    const typeset = this.#typesetWithWorker(
      engine,
      state,
      inherited,
      body,
      start,
      end,
      checkBudget,
      {
        trace: null
      }
    );
    return this.#entities ? unicodeToEntities(typeset) : typeset;
  }

  #typesetWithWorker(
    engine,
    state,
    inherited,
    value,
    start,
    end,
    checkBudget,
    { trace, sourceMap }
  ) {
    // The groups and settings are shared objects the worker took at birth; only the order is
    // replaced when a group registers.
    engine.#trace = trace;
    engine.#order = this.#order;
    engine.#resetVaults();
    state.lineStyle = value.includes('\r') ? fileLineStyle(value, checkBudget) : null;
    // A worker built while tracing carries the rule trace on its context; a value typeset untraced
    // opens no trace frame for it to record into.
    const ruleTrace = trace === null ? ruleTraceOf(state.ctx) : undefined;
    if (ruleTrace !== undefined) {
      unbindRuleTrace(state.ctx);
    }
    try {
      return (
        value.slice(0, start) +
        trimEdges(
          engine.#runPipeline(value.slice(start, end), state, checkBudget, {
            destination: 'data-value',
            sourceTrim: trimEdges,
            inherited,
            sourceMap
          })
        ) +
        value.slice(end)
      );
    } finally {
      if (ruleTrace !== undefined) {
        bindRuleTrace(state.ctx, ruleTrace);
      }
    }
  }

  #attributeWorker(session, checkBudget, format = 'plain') {
    session.workers ??= new Map();
    let worker = session.workers.get(format);
    if (worker === undefined) {
      const engine = new MicroTypo({
        presets: false,
        html: false,
        entities: false,
        maxProcessingMs: this.#maxProcessingMs,
        input: {
          format,
          template: this.#input.template,
          placeholders: this.#input.placeholders
        }
      });
      engine.#groups = this.#groups;
      engine.#order = this.#order;
      engine.#engineSettings = this.#engineSettings;
      engine.addSafeBlock({
        id: 'attribute-entity',
        open: `${CHARACTER_REFERENCE_HEAD}(?=;)`,
        close: ';',
        unsafeRegex: true
      });
      engine.#trace = this.#trace;
      const state = engine.#makeSession(session.ctx.onCycleLimit, checkBudget);
      const foreign = new RegExp(
        [
          PLACEHOLDER_TOKEN,
          ...this.#safeSequences.restoreRegexes.map((pattern) => pattern.source)
        ].join('|'),
        'g'
      );
      const inherited = (value, sequences) =>
        sequences.protectTokens(value, foreign, (token) => this.#restoreProtected(token) !== token);
      worker = { engine, state, inherited };
      session.workers.set(format, worker);
    }
    return worker;
  }

  #runPipeline(text, session, checkBudget, options) {
    const escaped = this.#reservedPossible ? escapeReserved(text) : null;
    const previous = session.traceFrame;
    if (this.#trace !== null) {
      session.traceFrame = {
        map: options?.sourceMap ?? new SourceMap(text, 0, checkBudget),
        render: (value, mapping) => {
          const restored = this.#restoreProtected(
            restoreParagraphs(value, mapping),
            false,
            mapping
          );
          return escaped === null ? restored : escaped.unescape(restored, mapping);
        }
      };
    }
    try {
      const result = this.#typesetFragment(
        escaped === null ? text : escaped.text,
        session,
        checkBudget,
        options
      );
      return escaped === null ? result : escaped.unescape(result);
    } finally {
      session.traceFrame = previous;
    }
  }

  #typesetFragment(
    text,
    session,
    checkBudget,
    {
      destination = 'html',
      trim,
      sourceTrim = trim,
      indents = false,
      firstIndent = '',
      inherited
    } = {}
  ) {
    const effHtml = destination === 'html' && this.#html;
    session.ctx.html = effHtml;
    this.#pragmaDocument = destination === 'html';

    // Per-call vault frame so an id minted for an earlier scalar can't be referenced by a later one.
    this.#safeSequences.resetFrame();
    const source = inherited === undefined ? text : inherited(text, this.#safeSequences);

    // A front-matter header's values are data; only the body is Markdown.
    const quote = this.#groups.get('quote');
    const nested = this.#builtinRuleOn('quote', 'nested');
    const readsInches = nested && quote.settings.convertInches !== false;
    const addressSyntax = destination === 'html' ? this.#markdownAddressSyntax : undefined;
    const protectSequences = (value, codeCuts) => {
      const protectedText = this.#safeSequences.protect(
        value,
        addressSyntax,
        checkBudget,
        readsInches,
        codeCuts
      );
      checkBudget('safeSequences.protect');
      return protectedText;
    };
    // An email local part may contain a backtick. Only the Markdown inline reader knows
    // which delimiters belong to complete code after fenced blocks and templates take their spans.
    const inlineFirst = addressSyntax && source.includes('@') && source.includes('`');
    let result = inlineFirst
      ? this.#safeSequences.protectAddressLinks(source)
      : protectSequences(source);

    // A block scanner comparing source content can resolve addresses already vaulted.
    result = this.#safeBlocks.protect(
      result,
      checkBudget,
      (value) => this.#safeSequences.restore(value),
      inlineFirst ? protectSequences : undefined,
      destination === 'html' ? (body) => this.#typesetTextBody(body, session, checkBudget) : null
    );
    checkBudget('safeBlocks.protect');
    if (this.#ignoredFile) {
      return text;
    }

    if (this.#input.format !== 'plain') {
      result = this.#protectNotg(result);
    }
    checkBudget('protectNotg');

    if (destination === 'html' && this.#attributeNames !== null) {
      result = this.#typesetAttributes(result, session, checkBudget);
    }

    if (this.#input.format !== 'plain') {
      result = this.#safeTags.protect(result);
    }
    checkBudget('safeTags.protect');

    const lineSource = session.lineStyle === null ? null : result;
    // Unconditional so it survives html:false disabling the text group.
    result = result.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n');
    checkBudget('newlineInvariant');

    const quoteTags =
      destination === 'html' && this.#input.format !== 'plain' ? session.ctx.tags : null;
    bindQuoteParagraphs(session.ctx, quoteTags);
    if (
      effHtml &&
      quoteTags !== null &&
      markdownSources.has(session.ctx) &&
      this.#builtinRuleOn('text', 'paragraphs')
    ) {
      bindQuoteBlockEdges(quoteTags, paragraphEdgeReader(session.ctx));
    }
    const nameOf = (prefix, id) => this.#safeTags.nameOf(prefix, id);
    bindInlineBoundaries(
      session.ctx,
      destination === 'xml' ? null : nameOf,
      (prefix, id) => this.#safeTags.rawOf(prefix, id),
      nameOf
    );
    result = decodeSpecialChars(result);
    if (this.#builtinRuleOn('quote', 'open')) {
      result = prepareAuthoredQuotes(result, session.ctx, isRuleOn(quote, 'close'), readsInches);
    }
    result = canonicalQuoteRoles(result, quoteTags, checkBudget, session.ctx, nested);
    checkBudget('clearSpecialChars');

    if (sourceTrim !== undefined) {
      result = this.#safeBlocks.trimSource(result, sourceTrim, checkBudget);
      checkBudget('sourceEdges');
    }

    if (indents) {
      result = this.#safeBlocks.liftIndents(result);
    }

    session.beginFragment({
      yearRange: this.#builtinRuleOn('date', 'year_range') ? SOURCE_YEAR_RANGE_RE : null,
      transparent: destination !== 'xml',
      markdown: destination === 'html' && BLOCK_RENDER_FORMATS.has(this.#input.format)
    });

    if (this.#builtinRuleOn('date', 'nowrap_date')) {
      result = session.runStep(this.#groups.get('date'), YEAR_MARKS, result);
    }

    const etc = this.#groups.get('other');
    const wrapperSpaces =
      etc?.builtin === true
        ? etc.compiledRules.filter(
            (rule) =>
              (rule.id === 'strip_nbsp_in_nowrap' || rule.id === 'nbsp_in_nowrap') &&
              isRuleOn(etc, rule.id)
          )
        : [];
    let etcRan = false;
    const reread = (owner, step, before) => {
      const next = session.runStep(owner, step, before);
      return etcRan && next !== before
        ? wrapperSpaces.reduce((written, rule) => session.runStep(etc, rule, written), next)
        : next;
    };

    for (const groupName of this.#order) {
      const group = this.#groups.get(groupName);

      // The text group lays out lines and paragraphs, and to it an indent is the white space at the
      // start of a line, which it keeps or drops with the line break in front of it.
      if (indents && groupName === 'text') {
        result = this.#safeBlocks.settleIndents(result);
      }

      if (groupName === 'abbr') {
        // Grouping a genuine quantity can expose its unit boundary. The source-role guards
        // remain those of the actual split reader; units themselves are not replayed.
        const triads = this.#builtinRule('other', 'split_triads');
        if (triads !== null) {
          result = session.runStep(etc, triads, result);
        }
      }
      result = session.runGroup(group, result);
      etcRan ||= group === etc;

      for (const [name, id] of DEPENDENT_READS.get(groupName) ?? []) {
        const step = this.#builtinRule(name, id);
        if (step !== null && (!step.htmlOnly || effHtml)) {
          result = reread(this.#groups.get(name), step, result);
        }
      }

      checkBudget(`group:${groupName}`);
    }

    if (indents) {
      result = this.#safeBlocks.settleIndents(result);
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

    if (lineSource !== null) {
      result = restoreFileEndings(lineSource, result, session.lineStyle, checkBudget);
    }

    result = this.#safeTags.restoreIblocks(result);

    const generatedFirstParagraph =
      result.startsWith(PARAGRAPH_OPEN) &&
      !result.startsWith(`${PARAGRAPH_OPEN}${OPEN}${BLOCK_KIND}`);

    result = restoreParagraphs(result);

    result = this.#safeTags.restore(result);

    // The text group never puts a block in a `<p>` of its own, but a plain `<p>` the author wrapped
    // around one is taken off: HTML forbids a block inside an inline. Only under html:true: without
    // the text group the markup is the author's, and a protected body is still a placeholder here.
    if (effHtml && this.#input.format !== 'plain') {
      result = unwrapBlocks(result);
    }

    // While protected bodies are still placeholders, so a tag or comment left open to the end keeps
    // the white space it ends with: that is its content, not the edge of the prose.
    if (trim !== undefined) {
      result = trim(result);
    }

    result = this.#safeBlocks.restore(result);

    result = this.#safeSequences.restore(result);

    if (firstIndent !== '' && result !== '') {
      return generatedFirstParagraph && result.startsWith('<p>')
        ? `<p>${firstIndent}${result.slice(3)}`
        : firstIndent + result;
    }
    return result;
  }

  // Whole blank edge lines, judged by what a line shows once restored: the Markdown layer vaults a
  // line of white space too, while a body left open to the end keeps the white space it ends with.
  #trimBlankLines = (text) =>
    trimBlankLines(text, (line) => this.#restoreProtected(line).trim() === '');

  // The same chain the pipeline ends with, minus the paragraph markers: a `<p>` belongs to the
  // document, never inside an attribute. Used where content has to be readable before the last thing
  // that could read it — attribute escaping — rather than after it.
  #restoreProtected(text, href = false, mapping) {
    // Every vault placeholder opens with OPEN; a text without one has none of them to restore.
    if (mapping === undefined && typeof text === 'string' && !text.includes(OPEN)) {
      return this.#safeSequences.restore(text, href);
    }

    let result = this.#safeTags.restoreIblocks(text, mapping);

    result = this.#safeTags.restore(result, mapping);
    result = this.#safeBlocks.restore(result, mapping);

    return this.#safeSequences.restore(result, href, mapping);
  }

  // One session per `process()`: the narrowed `ctx` a rule handler sees, and the group runner that
  // keeps the accounting behind it. The accounting is closed over rather than hung on `ctx` — on
  // `ctx` a handler could clear the credit, credit itself a forged token, or switch tracking off.
  #makeSession(hook, checkBudget) {
    const self = this;
    const ruleBudget = this.#maxProcessingMs > 0 ? checkBudget : null;
    // What the running custom group may keep, and null while a builtin one runs — those are trusted
    // and neither budgeted nor scrubbed.
    let budget = null;
    // The fragment's lifting of inline markup (see `inline-lift.js`), closed over for the same reason
    // as the accounting: a handler that could reach it could hand a builtin group forged tokens.
    let inline = null;
    const features =
      typeof hook !== 'function' && [...this.#groups.values()].every((group) => group.builtin)
        ? { text: null, scan: null, previousText: null, previousScan: null }
        : null;

    // A wrapper a builtin group minted keeps its place when the markup around it is lifted, and the
    // rule that minted it on the lifted text is checked for crossing the author's tags. A custom
    // group's tag is read like the author's.
    const note = ({ tokens }, nowrap) => {
      if (inline !== null && budget === null) {
        const open = `<${tokens[0]}>`;
        const close = `</${tokens[1]}>`;

        inline.engineOpeners.set(open, nowrap);
        inline.engineTags.add(open).add(close);
        inline.mints?.add(open).add(close);
      }
    };

    // A placeholder the engine minted for the group, which its input could not have carried.
    const credit = (token) => budget?.mint(token);

    // Credit only the wrapper tokens `makeTag` just minted, never rescanning caller-supplied content.
    const record = ({ html, tokens }) => {
      for (const token of tokens) {
        credit(token);
      }

      return html;
    };

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
            : stripReservedPua(
                dropParagraphs(self.#restoreProtected(guard(String(value)), name === 'href'))
              );
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

        const { group } = this;
        const groupClasses = group?.raw?.classes ?? {};
        const attrs = { ...attributes };

        if (attrs.class) {
          let cls = attrs.class;
          // nowrap emits a `<span>` by default; `render.nowrap: 'nobr'` opts into the legacy element.
          if (cls === 'nowrap' && self.#engineSettings.nowrap === 'nobr') {
            const made = self.#safeTags.makeTag({
              content,
              tag: 'nobr',
              attributes: {},
              layout: self.#layout
            });

            note(made, true);

            return record(made);
          }

          if (groupClasses[cls]) {
            attrs.__style = groupClasses[cls];
          }

          if (self.#prefix) {
            cls = self.#prefix + cls;
          }

          attrs.class = cls;
        }

        const made = self.#safeTags.makeTag({
          content,
          tag,
          attributes: settleAttributes(attrs),
          layout: self.#layout
        });

        note(made, attributes.class === 'nowrap');

        return record(made);
      },
      layout: { ...self.#layout },
      isOn: (key, scope) => isOn(scope?.settings?.[key] ?? self.#engineSettings[key]),
      engineSettings: { ...self.#engineSettings },
      onCycleLimit: hook,
      checkBudget: checkBudget ?? null
    };

    const bindBoundaryOwner = (group) =>
      bindBoundaryActivity(ctx, () => ({
        periods: isRuleOn(group, 'space_after_period'),
        punctuation: isRuleOn(group, 'space_after_punctuation')
      }));

    const builtinRuleOn = (group, id) => self.#builtinRuleOn(group, id);
    const spaceRuleOn = (id) => builtinRuleOn('space', id);

    if (BLOCK_RENDER_FORMATS.has(self.#input.format)) {
      bindQuoteLineBlocks(ctx, {
        blockAt: (text, at, afterBreak) =>
          self.#safeBlocks.lineBlockAt(text, at, afterBreak) ||
          (afterBreak && isMarkdownDividerAt(text, at)),
        spaceEnd: (text, at) => self.#safeBlocks.horizontalSpaceEnd(text, at)
      });
    }
    bindQuotePaddingStrip(ctx, () => spaceRuleOn('strip_quote_padding'));
    bindQuoteInlinePadding(ctx, (text, at) => punctuationAfterInlineGap(text, at, spaceRuleOn));
    bindQuoteRules(
      ctx,
      (rule) => builtinRuleOn('quote', rule),
      BLOCK_RENDER_FORMATS.has(self.#input.format)
        ? (text, at) => self.#safeBlocks.labelAddressBefore(text, at)
        : null
    );
    bindNowrapRules(ctx, builtinRuleOn);
    bindReferenceGlyph(
      ctx,
      (text, semicolonAt) => quoteBoundaryGlyph(characterReferenceEndingAt(text, semicolonAt)),
      (text, at) => quoteBoundaryGlyph(readCharacterReferenceAt(text, at))
    );

    bindRuleBudget(ctx, ruleBudget);

    const reject = this.#trace === null ? undefined : () => ruleTraceOf(ctx).discard();
    const keep = (before, after, rerun) =>
      self.#safeSequences.keep(
        before,
        after,
        rerun,
        reject,
        reject === undefined ? undefined : ruleTraceOf(ctx)
      );

    if (BLOCK_RENDER_FORMATS.has(self.#input.format)) {
      markdownSources.set(ctx, {
        header: self.#input.format === 'markdown' || self.#input.format === 'mdx',
        mdx: self.#input.format === 'mdx',
        restore: (line) => self.#restoreProtected(restoreParagraphs(line))
      });
    }

    const session = {
      ctx,
      traceFrame: null,

      // Once the call ends: the rules' per-call state is keyed by `ctx` and by its `tags`.
      release() {
        releaseSession(ctx, ctx.tags);
      },

      canSkipValue(value) {
        if (
          self.#customProtection ||
          features === null ||
          holdsAnyFeature(value, features, F.SOURCE)
        ) {
          return false;
        }

        for (const name of self.#order) {
          if (canRunRuleGroup(self.#groups.get(name), value, features, false)) {
            return false;
          }
        }
        return true;
      },

      // Inline markup is lifted for the rules of a fragment typeset for a document; an XML
      // destination reads its elements by a vocabulary of its own, and stays as it is.
      beginFragment({ transparent, markdown, yearRange }) {
        inline = transparent
          ? {
              markdown,
              yearRange,
              collapsesSpaces: () => spaceRuleOn('collapse_spaces'),
              nameOf: (prefix, id) => self.#safeTags.nameOf(prefix, id),
              rawOf: (prefix, id) => self.#safeTags.rawOf(prefix, id),
              restoreSequences: (s) => self.#safeSequences.restore(s),
              engineOpeners: new Map(),
              engineTags: new Set(),
              // Every wrapper a builtin group writes by a class, minted once for a fragment with
              // markup: a second pass finds the ones the first wrote, and they keep their place.
              // A form is its class and that class's style, all a group adds to the wrapper.
              mintForms() {
                const minted = new Map();
                for (const group of self.#groups.values()) {
                  for (const name of group.builtin ? Object.keys(group.raw.classes ?? {}) : []) {
                    const styles = minted.get(name) ?? minted.set(name, new Set()).get(name);
                    const style = group.raw.classes[name];
                    if (!styles.has(style)) {
                      styles.add(style);
                      ctx.tag.call({ html: true, group }, '', 'span', { class: name });
                    }
                  }
                }
              },
              mints: null,
              mintLog: new Set(),
              near: null,
              loose: null,
              cache: null,
              bare: false
            }
          : null;
      },

      // A step the engine takes for builtin `group` before the groups run reads the text as the
      // group's rules do.
      runStep(group, step, text) {
        bindBoundaryOwner(group);
        ctx.group = group.view;

        return runStep(step, text, ctx, keep, inline, features, ruleBudget);
      },

      // A custom group's return value is untrusted and is scrubbed against its own input; a builtin
      // group is trusted and skips both the scrub and the accounting.
      runGroup(group, text) {
        bindBoundaryOwner(group);
        if (group.builtin) {
          return runRuleGroup(group, text, ctx, keep, inline, features, ruleBudget);
        }

        // One budget per run: opened on the text this group was handed and dropped after it, so no
        // credit survives into a run that did not earn it.
        budget = new TokenBudget(text, self.#safeSequences.restoreRegexes);

        try {
          const after = runRuleGroup(group, text, ctx, null, null, null, ruleBudget);

          // A group that minted nothing, handed nothing in and changed nothing has nothing to scrub,
          // and the scrub is six passes over the whole text.
          return after === text && budget.untouched ? after : budget.scrub(after);
        } finally {
          budget = null;
        }
      }
    };
    if (this.#trace !== null) {
      bindRuleTrace(ctx, new RuleTrace(() => session.traceFrame, this.#trace));
    }
    return session;
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

function budgetCheck(budget, start) {
  return (where) => {
    if (budget > 0 && performance.now() - start > budget) {
      throw new MicroTypoBudgetError(
        `Processing exceeded ${budget}ms budget at ${where} — likely adversarial input`,
        { details: { budgetMs: budget, where } }
      );
    }
  };
}

function readProcessOptions(options) {
  const result = {};
  for (const option of ['changes', 'edits', 'trace']) {
    const value =
      options !== null && typeof options === 'object' && Object.hasOwn(options, option)
        ? options[option]
        : undefined;
    if (value !== undefined && typeof value !== 'boolean') {
      throw new MicroTypoConfigError(`process() option "${option}" must be a boolean`, {
        details: { option, receivedType: typeof value }
      });
    }
    result[option] = value === true;
  }
  return result;
}

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
