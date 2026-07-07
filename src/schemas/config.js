import {
  BUNDLE_NAMES,
  KNOWN_GROUPS,
  SETTING_SELECTORS,
  canonicalGroupName,
  wildcardToRegex
} from '../core/options.js';
import { MicroTypoConfigError } from '../errors/index.js';
import { DEFAULT_GROUPS } from '../rules/registry.js';

const RULE_IDS = new Map(DEFAULT_GROUPS.map(([name, def]) => [name, def.rules.map((r) => r.id)]));

function selectorMatchesRule(group, selector) {
  if (selector === '*') {
    return true;
  }

  const ids = RULE_IDS.get(group) ?? [];
  const re = wildcardToRegex(selector);

  return ids.some((id) => re.test(id));
}

const TOP_LEVEL_KEYS = new Set([
  'entities',
  'maxInputLength',
  'maxProcessingMs',
  'input',
  'presets',
  'html',
  'rules',
  'render'
]);

const RENDER_KEYS = new Set(['paragraphs', 'autolink', 'breakline', 'nowrap', 'hanging', 'prefix']);

// Reject prefix characters unsafe in a CSS class token or HTML attribute (defense in depth).
export const UNSAFE_PREFIX_RE = /["<>&\s]/;

// Ceiling on maxInputLength: an unbounded cap is a DoS footgun (memory + per-group work).
const MAX_INPUT_LENGTH = 5_000_000;

const INPUT_FORMATS = new Set([
  'text',
  'html',
  'markdown',
  'json',
  'xml',
  'toml',
  'yaml',
  'frontmatter'
]);
const INPUT_TEMPLATES = new Set([
  'off',
  'handlebars',
  'mustache',
  'twig',
  'jinja',
  'nunjucks',
  'liquid',
  'erb'
]);
const INPUT_KEYS = new Set(['format', 'fields', 'exclude', 'template']);
const INPUT_FORMAT_MESSAGE = `expected one of ${[...INPUT_FORMATS].join('|')}`;

function isBooleanish(value) {
  return (
    typeof value === 'boolean' || ['on', 'off', '1', '0', 'true', 'false', 0, 1].includes(value)
  );
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function normaliseInput(input, issues) {
  if (input === undefined) {
    return { format: 'text', template: 'off' };
  }

  if (typeof input === 'string') {
    if (!INPUT_FORMATS.has(input)) {
      issues.push(`input: ${INPUT_FORMAT_MESSAGE}`);
    }

    return { format: input, template: 'off' };
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    issues.push('input: expected a string or an object');

    return { format: 'text', template: 'off' };
  }

  for (const key of Object.keys(input)) {
    if (!INPUT_KEYS.has(key)) {
      issues.push(`input: unknown key "${key}"`);
    }
  }

  const format = input.format ?? 'text';
  if (!INPUT_FORMATS.has(format)) {
    issues.push(`input.format: ${INPUT_FORMAT_MESSAGE}`);
  }

  const template = input.template ?? 'off';
  if (!INPUT_TEMPLATES.has(template)) {
    issues.push(`input.template: expected one of ${[...INPUT_TEMPLATES].join('|')}`);
  }

  const normalised = { format, template };

  if (input.fields !== undefined) {
    if (isStringArray(input.fields)) {
      // Freeze a clone so caller-side mutation can't later change which fields get typeset.
      normalised.fields = Object.freeze([...input.fields]);
    } else {
      issues.push('input.fields: expected an array of strings');
    }
  }

  if (input.exclude !== undefined) {
    if (isStringArray(input.exclude)) {
      normalised.exclude = Object.freeze([...input.exclude]);
    } else {
      issues.push('input.exclude: expected an array of strings');
    }
  }

  return normalised;
}

export function validateConfig(config) {
  if (
    config !== undefined &&
    config !== null &&
    (typeof config !== 'object' || Array.isArray(config))
  ) {
    throw new MicroTypoConfigError(
      `invalid config: expected an object, got ${Array.isArray(config) ? 'an array' : typeof config}`,
      { details: { issues: ['config: expected an object'] } }
    );
  }

  const cfg = config ?? {};
  const issues = [];

  for (const key of Object.keys(cfg)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      issues.push(`unknown option: ${key}`);
    }
  }

  if (cfg.entities !== undefined && !isBooleanish(cfg.entities)) {
    issues.push('entities: expected a boolean');
  }
  if (cfg.maxInputLength !== undefined) {
    const value = cfg.maxInputLength;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      issues.push('maxInputLength: expected a non-negative integer');
    } else if (value > MAX_INPUT_LENGTH) {
      issues.push(`maxInputLength: exceeds ceiling ${MAX_INPUT_LENGTH}`);
    }
  }
  if (cfg.maxProcessingMs !== undefined) {
    const value = cfg.maxProcessingMs;
    // 0 disables the budget and must stay finite; Infinity is rejected.
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      issues.push('maxProcessingMs: expected a non-negative, finite number');
    }
  }
  if (cfg.presets !== undefined && typeof cfg.presets !== 'boolean') {
    issues.push('presets: expected a boolean');
  }
  const input = normaliseInput(cfg.input, issues);

  if (cfg.html !== undefined && !isBooleanish(cfg.html)) {
    issues.push('html: expected a boolean');
  }

  if (cfg.render !== undefined) {
    if (!cfg.render || typeof cfg.render !== 'object' || Array.isArray(cfg.render)) {
      issues.push('render: expected an object');
    } else {
      for (const key of Object.keys(cfg.render)) {
        if (!RENDER_KEYS.has(key)) {
          issues.push(`render: unknown key "${key}"`);
        }
      }

      if (cfg.render.paragraphs !== undefined && !isBooleanish(cfg.render.paragraphs)) {
        issues.push('render.paragraphs: expected a boolean');
      }
      if (cfg.render.autolink !== undefined && !isBooleanish(cfg.render.autolink)) {
        issues.push('render.autolink: expected a boolean');
      }
      if (cfg.render.breakline !== undefined && !isBooleanish(cfg.render.breakline)) {
        issues.push('render.breakline: expected a boolean');
      }
      if (cfg.render.nowrap !== undefined && !['nobr', 'span'].includes(cfg.render.nowrap)) {
        issues.push('render.nowrap: expected "nobr" or "span"');
      }
      if (
        cfg.render.hanging !== undefined &&
        !['style', 'class', 'both'].includes(cfg.render.hanging)
      ) {
        issues.push('render.hanging: expected "style", "class", or "both"');
      }
      if (
        cfg.render.prefix !== undefined &&
        cfg.render.prefix !== false &&
        typeof cfg.render.prefix !== 'string'
      ) {
        issues.push('render.prefix: expected false or a string');
      } else if (
        typeof cfg.render.prefix === 'string' &&
        UNSAFE_PREFIX_RE.test(cfg.render.prefix)
      ) {
        issues.push('render.prefix: must not contain a quote, angle bracket, "&", or whitespace');
      }
    }
  }

  if (cfg.rules !== undefined) {
    if (!cfg.rules || typeof cfg.rules !== 'object' || Array.isArray(cfg.rules)) {
      issues.push('rules: expected an object');
    } else {
      for (const [key, value] of Object.entries(cfg.rules)) {
        if (!isBooleanish(value)) {
          issues.push(`rules: "${key}" expected a boolean`);
        }

        if (BUNDLE_NAMES.has(key)) {
          continue;
        }

        const dot = key.indexOf('.');
        if (dot === -1) {
          if (!KNOWN_GROUPS.has(canonicalGroupName(key))) {
            issues.push(`rules: unknown key "${key}"`);
          }
          continue;
        }

        const groupRaw = key.slice(0, dot);
        const group = canonicalGroupName(groupRaw);
        if (!KNOWN_GROUPS.has(group)) {
          issues.push(`rules: unknown group "${groupRaw}"`);
          continue;
        }

        // quote.nested/quote.inch route to a group setting, not a rule id.
        if (SETTING_SELECTORS.has(key)) {
          continue;
        }

        if (!selectorMatchesRule(group, key.slice(dot + 1))) {
          issues.push(`rules: "${key}" does not match any rule id in group "${groupRaw}"`);
        }
      }
    }
  }

  if (issues.length > 0) {
    throw new MicroTypoConfigError(`invalid config: ${issues.join('; ')}`, { details: { issues } });
  }

  return { ...cfg, input };
}
