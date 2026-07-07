import { abbrGroup } from './abbr.js';
import { dashGroup } from './dash.js';
import { dateGroup } from './date.js';
import { etcGroup } from './etc.js';
import { nobrGroup } from './nobr.js';
import { numberGroup } from './number.js';
import { optAlignGroup } from './opt-align.js';
import { punctmarkGroup } from './punctmark.js';
import { quoteGroup } from './quote.js';
import { spaceGroup } from './space.js';
import { symbolGroup } from './symbol.js';
import { textGroup } from './text.js';

// Load-bearing order: the engine runs the groups in exactly this sequence.
export const DEFAULT_GROUPS = [
  ['quote', quoteGroup],
  ['dash', dashGroup],
  ['symbol', symbolGroup],
  ['punctuation', punctmarkGroup],
  ['number', numberGroup],
  ['space', spaceGroup],
  ['abbr', abbrGroup],
  ['nobr', nobrGroup],
  ['date', dateGroup],
  ['hanging', optAlignGroup],
  ['other', etcGroup],
  ['text', textGroup]
];
