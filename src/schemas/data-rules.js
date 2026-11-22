import { MicroTypoConfigError } from '../errors/index.js';

export function dataPattern(pattern) {
  if (
    pattern === null ||
    typeof pattern !== 'object' ||
    Array.isArray(pattern) ||
    typeof pattern.source !== 'string' ||
    typeof pattern.flags !== 'string' ||
    Object.keys(pattern).some((key) => key !== 'source' && key !== 'flags')
  ) {
    throw new MicroTypoConfigError('pattern: expected { source: string, flags: string }', {
      details: { issues: ['pattern: expected { source: string, flags: string }'] }
    });
  }
  try {
    return new RegExp(pattern.source, pattern.flags);
  } catch (cause) {
    throw new MicroTypoConfigError(`invalid rule pattern: ${cause.message}`, {
      cause,
      details: { source: pattern.source, flags: pattern.flags }
    });
  }
}

export function validateDataGroups(groups, issues) {
  if (!Array.isArray(groups)) {
    issues.push('ruleGroups: expected an array');
    return;
  }
  for (const group of groups) {
    if (
      !group ||
      typeof group !== 'object' ||
      Array.isArray(group) ||
      typeof group.name !== 'string' ||
      !group.name ||
      !Array.isArray(group.rules) ||
      Object.keys(group).some((key) => !['name', 'title', 'position', 'rules'].includes(key)) ||
      (group.title !== undefined && typeof group.title !== 'string') ||
      (group.position !== undefined && typeof group.position !== 'string')
    ) {
      issues.push('ruleGroups: expected groups with name, rules, optional title and position');
      continue;
    }
    for (const rule of group.rules) {
      if (
        !rule ||
        typeof rule !== 'object' ||
        Array.isArray(rule) ||
        typeof rule.id !== 'string' ||
        !rule.id ||
        typeof rule.replacement !== 'string' ||
        Object.keys(rule).some(
          (key) => !['id', 'pattern', 'replacement', 'enabled', 'cycled', 'htmlOnly'].includes(key)
        ) ||
        ['enabled', 'cycled', 'htmlOnly'].some(
          (key) => rule[key] !== undefined && typeof rule[key] !== 'boolean'
        )
      ) {
        issues.push(
          `ruleGroups.${group.name}: expected data rules with id, pattern and string replacement`
        );
        continue;
      }
      dataPattern(rule.pattern);
    }
  }
}
