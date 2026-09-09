import { MicroTypoConfigError } from '../errors/index.js';

const MAX_SELECTOR_LEN = 64;
const MAX_SELECTOR_STARS = 4;

export function wildcardToRegex(pattern) {
  if (pattern.length > MAX_SELECTOR_LEN) {
    throw new MicroTypoConfigError(`selector too long (max ${MAX_SELECTOR_LEN})`, {
      details: { selector: pattern }
    });
  }

  const parts = pattern.split('*');

  if (parts.length - 1 > MAX_SELECTOR_STARS) {
    throw new MicroTypoConfigError(`selector has too many '*' (max ${MAX_SELECTOR_STARS})`, {
      details: { selector: pattern }
    });
  }

  const body = parts.map(RegExp.escape).join('[a-z0-9_-]*');

  return new RegExp(`^${body}$`, 'i');
}

export function canonicalGroupName(name) {
  if (!name) {
    return name;
  }

  return String(name).toLowerCase();
}

export function isOn(value) {
  if (value === true) {
    return true;
  }

  if (value === 1) {
    return true;
  }

  if (typeof value === 'string') {
    const v = value.toLowerCase();

    return v === 'on' || v === '1' || v === 'true';
  }

  return false;
}

export function isOff(value) {
  if (value === false) {
    return true;
  }

  if (value === 0) {
    return true;
  }

  if (value == null) {
    return true;
  }

  if (typeof value === 'string') {
    const v = value.toLowerCase();

    return v === 'off' || v === '0' || v === 'false' || v === '';
  }

  return false;
}

function emptyIntent() {
  return {
    engineSettings: {},
    overrides: [],
    settings: []
  };
}

// prettier-ignore
const ENGINE_KEYS = new Set([
  'entities',
  'html',
  'maxInputLength',
  'maxProcessingMs',
]);

export function normaliseOptions(input) {
  const out = emptyIntent();

  if (!input || typeof input !== 'object') {
    return out;
  }

  for (const key of ENGINE_KEYS) {
    if (Object.hasOwn(input, key) && input[key] !== undefined) {
      out.engineSettings[key] = input[key];
    }
  }

  if (Object.hasOwn(input, 'rules')) {
    applyRules(input.rules, out);
  }

  if (Object.hasOwn(input, 'render')) {
    applyRender(input.render, out);
  }

  return out;
}

function pushOverride(out, group, selector, value) {
  out.overrides.push({ group: canonicalGroupName(group), selector, value });
}

function pushSetting(out, group, key, value) {
  out.settings.push({ group: canonicalGroupName(group), key, value });
}

// hanging sets the emission layout only; it does not enable the hanging rules.
function applyRender(opts, out) {
  if (!opts || typeof opts !== 'object') {
    return;
  }

  if (Object.hasOwn(opts, 'paragraphs')) {
    pushOverride(out, 'text', 'paragraphs', isOn(opts.paragraphs));
  }

  if (Object.hasOwn(opts, 'autolink')) {
    pushOverride(out, 'text', 'autolink', isOn(opts.autolink));
    pushOverride(out, 'text', 'email', isOn(opts.autolink));
  }

  if (Object.hasOwn(opts, 'breakline')) {
    pushOverride(out, 'text', 'breakline', isOn(opts.breakline));
  }

  if (Object.hasOwn(opts, 'nowrap')) {
    out.engineSettings.nowrap = opts.nowrap;
  }

  if (Object.hasOwn(opts, 'hanging')) {
    out.engineSettings.layout = opts.hanging;
  }

  if (Object.hasOwn(opts, 'prefix')) {
    out.engineSettings.prefix = opts.prefix;
  }
}

export const KNOWN_GROUPS = new Set([
  'quote',
  'dash',
  'symbol',
  'punctuation',
  'number',
  'space',
  'abbr',
  'nobr',
  'date',
  'hanging',
  'other',
  'text'
]);

// emdash MUST stay ids em/em_*, not em*: em* would also match emphatic_particle.
const BUNDLES = {
  nbsp: ['nobr.nbsp_*', 'space.nbsp_*', 'abbr.nbsp_*', 'number.nbsp_*'],
  emdash: ['dash.em', 'dash.em_*'],
  endash: ['dash.en_range', 'number.en_range'],
  triads: ['number.thin_space_triads', 'other.split_triads'],
  units: [
    'abbr.nbsp_unit',
    'abbr.nbsp_weight_unit',
    'abbr.nbsp_volume_unit',
    'abbr.nbsp_time_unit',
    'abbr.nbsp_data_unit',
    'abbr.nbsp_frequency_unit',
    'abbr.nbsp_css_unit',
    'abbr.nbsp_volt'
  ],
  currency: ['abbr.currency', 'abbr.nbsp_money_magnitude', 'abbr.nbsp_currency_prefix']
};

export const BUNDLE_NAMES = new Set(Object.keys(BUNDLES));

// Dotted `rules` keys routing to a quote group setting rather than a rule id, and so exempt from
// the rule-id-match check.
export const SETTING_SELECTORS = new Set(['quote.nested', 'quote.inch']);

function pushDotted(out, key, value) {
  const dotIdx = key.indexOf('.');

  pushOverride(out, key.slice(0, dotIdx), key.slice(dotIdx + 1), value);
}

function applyRules(rulesObj, out) {
  if (!rulesObj || typeof rulesObj !== 'object') {
    return;
  }

  for (const [key, value] of Object.entries(rulesObj)) {
    const bundle = BUNDLES[key];

    if (bundle) {
      for (const override of bundle) {
        pushDotted(out, override, isOn(value));
      }

      continue;
    }

    // `quote.nested` and `quote.inch` route before the generic dotted path: they are settings, not
    // rule ids.
    if (SETTING_SELECTORS.has(key)) {
      if (key === 'quote.nested') {
        pushSetting(out, 'quote', 'allowNested', isOn(value));
      } else {
        pushSetting(out, 'quote', 'convertInches', isOn(value));
      }
      continue;
    }

    if (key.includes('.')) {
      pushDotted(out, key, isOn(value));
      continue;
    }

    if (KNOWN_GROUPS.has(canonicalGroupName(key))) {
      pushOverride(out, key, '*', isOn(value));
    }
  }
}
