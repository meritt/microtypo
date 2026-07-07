#!/usr/bin/env node

import { MicroTypo, microtypo } from '../../src/index.js';
import { DEFAULT_GROUPS } from '../../src/rules/registry.js';
import { compactStats, measure } from './perf/measure.mjs';
import { SCANNERS } from './perf/scanners.mjs';
import { WORKLOADS } from './perf/workloads.mjs';

const GROUPS = DEFAULT_GROUPS.map(([name]) => name);
const PROFILES = new Set(['summary', 'groups', 'all', 'scanners']);

function parseArgs(argv) {
  const opts = {
    format: 'table',
    profile: 'summary',
    workload: null,
    priority: null,
    iterations: 50,
    samples: 9,
    warmup: 5
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--') {
      continue;
    } else if (arg === '--json') {
      opts.format = 'json';
    } else if (arg === '--table') {
      opts.format = 'table';
    } else if (arg === '--profile') {
      opts.profile = argv[++i] ?? opts.profile;
    } else if (arg === '--workload') {
      opts.workload = argv[++i] ?? null;
    } else if (arg === '--priority') {
      opts.priority = argv[++i] ?? null;
    } else if (arg === '--iterations') {
      opts.iterations = Number(argv[++i] ?? opts.iterations);
    } else if (arg === '--samples') {
      opts.samples = Number(argv[++i] ?? opts.samples);
    } else if (arg === '--warmup') {
      opts.warmup = Number(argv[++i] ?? opts.warmup);
    } else if (arg === '--help') {
      opts.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return opts;
}

function help() {
  return `Usage: node test/tools/perf-profile.mjs [options]

Options:
  --profile summary|groups|all|scanners
                                  profile set to run
  --workload <name>              run one workload only
  --priority P0|P1|P2|P3|P4      run workloads by priority
  --iterations <n>               iterations per sample
  --samples <n>                  sample count
  --warmup <n>                   warmup iterations
  --json                         emit JSON lines
  --table                        emit a compact table
`;
}

function validateNumber(name, value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function validateProfile(profile) {
  if (!PROFILES.has(profile)) {
    throw new Error(`Unknown profile: ${profile}`);
  }
}

function validatePriority(priority) {
  if (priority != null && !/^P[0-4]$/u.test(priority)) {
    throw new Error(`Unknown priority: ${priority}`);
  }
}

function filterLabel(opts) {
  return [
    opts.workload ? `workload=${opts.workload}` : null,
    opts.priority ? `priority=${opts.priority}` : null
  ]
    .filter(Boolean)
    .join(', ');
}

function rulesFor(activeGroups) {
  const active = new Set(activeGroups);

  return Object.fromEntries(GROUPS.map((name) => [name, active.has(name)]));
}

function makeRunner(workload, mode) {
  if (mode.kind === 'functional') {
    return () => microtypo(workload.text, workload.config);
  }

  const config = {
    ...workload.config,
    ...mode.config
  };

  if (mode.rules) {
    config.rules = mode.rules;
  }

  const typo = new MicroTypo(config);

  return () => typo.process(workload.text);
}

function modesFor(profile) {
  const modes = [
    { name: 'protect-only', kind: 'instance', config: { presets: false } },
    { name: 'full-instance', kind: 'instance' },
    { name: 'functional', kind: 'functional' }
  ];

  if (profile === 'summary') {
    return modes;
  }

  for (const group of GROUPS) {
    modes.push({ name: `group:${group}`, kind: 'instance', rules: rulesFor([group]) });
  }

  if (profile === 'groups') {
    return modes;
  }

  for (let i = 1; i <= GROUPS.length; i += 1) {
    const active = GROUPS.slice(0, i);
    modes.push({
      name: `cumulative:${active.at(-1)}`,
      kind: 'instance',
      rules: rulesFor(active)
    });
  }

  return modes;
}

function runProfile(opts) {
  validateNumber('iterations', opts.iterations);
  validateNumber('samples', opts.samples);
  validateNumber('warmup', opts.warmup);
  validateProfile(opts.profile);
  validatePriority(opts.priority);

  const byName = new Map(WORKLOADS.map((workload) => [workload.name, workload]));

  if (opts.workload && !byName.has(opts.workload)) {
    throw new Error(`Unknown workload: ${opts.workload}`);
  }

  const workloads = WORKLOADS.filter((workload) => {
    if (opts.workload && workload.name !== opts.workload) {
      return false;
    }

    return opts.priority == null || workload.priority === opts.priority;
  });

  if (workloads.length === 0) {
    throw new Error(`No workloads match filters: ${filterLabel(opts)}`);
  }

  if (opts.profile === 'scanners') {
    const names = new Set(workloads.map((workload) => workload.name));
    const scanners = SCANNERS.filter((scanner) => names.has(scanner.workload));

    if (scanners.length === 0) {
      if (opts.priority) {
        throw new Error(`No scanner profiles match filters: ${filterLabel(opts)}`);
      }

      throw new Error(`No scanner profile for workload: ${opts.workload}`);
    }

    return scanners.map((scanner) => {
      const workload = byName.get(scanner.workload);
      const result = compactStats(
        measure({
          fn: () => scanner.run(workload.text),
          warmup: opts.warmup,
          iterations: opts.iterations,
          samples: opts.samples
        })
      );

      const row = {
        profile: 'scanners',
        name: scanner.name,
        workload: workload.name,
        kind: workload.kind,
        priority: workload.priority,
        scenario: workload.scenario,
        tags: workload.tags,
        inputLength: workload.text.length
      };

      return Object.assign(row, result);
    });
  }

  const rows = [];

  for (const workload of workloads) {
    for (const mode of modesFor(opts.profile)) {
      const runner = makeRunner(workload, mode);
      const result = compactStats(
        measure({
          fn: runner,
          warmup: opts.warmup,
          iterations: opts.iterations,
          samples: opts.samples
        })
      );

      rows.push({
        workload: workload.name,
        kind: workload.kind,
        priority: workload.priority,
        scenario: workload.scenario,
        tags: workload.tags,
        inputLength: workload.text.length,
        mode: mode.name,
        ...result
      });
    }
  }

  return rows;
}

function printJson(rows) {
  for (const row of rows) {
    console.log(JSON.stringify(row));
  }
}

function printTable(rows) {
  if (rows[0]?.profile === 'scanners') {
    console.log('scanner\tworkload\tlen\tmedian_ms\tp95_ms\tmean_ms');

    for (const row of rows) {
      console.log(
        `${row.name}\t${row.workload}\t${row.inputLength}\t${row.medianMs}\t${row.p95Ms}\t${row.meanMs}`
      );
    }

    return;
  }

  console.log('workload\tmode\tlen\tmedian_ms\tp95_ms\tmean_ms');

  for (const row of rows) {
    console.log(
      `${row.workload}\t${row.mode}\t${row.inputLength}\t${row.medianMs}\t${row.p95Ms}\t${row.meanMs}`
    );
  }
}

try {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log(help());
    process.exit(0);
  }

  const rows = runProfile(opts);

  if (opts.format === 'json') {
    printJson(rows);
  } else {
    printTable(rows);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
