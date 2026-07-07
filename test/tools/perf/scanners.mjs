import { scanJson } from '../../../src/input/json.js';
import { scanFences, scanLinkDestinations } from '../../../src/input/markdown.js';
import { templateScanner } from '../../../src/input/template.js';
import { scanToml } from '../../../src/input/toml.js';
import { scanDoctype, scanXmlSpacePreserve, validateXml } from '../../../src/input/xml.js';
import { scanYaml } from '../../../src/input/yaml.js';

const scanHandlebars = templateScanner('handlebars');

export const SCANNERS = Object.freeze([
  {
    name: 'json.scan',
    workload: 'json-many-values',
    run: (text) => scanJson(text)
  },
  {
    name: 'yaml.scan',
    workload: 'yaml-many-values',
    run: (text) => scanYaml(text)
  },
  {
    name: 'toml.scan',
    workload: 'toml-many-values',
    run: (text) => scanToml(text)
  },
  {
    name: 'markdown.fences',
    workload: 'markdown-template',
    run: (text) => scanFences(text)
  },
  {
    name: 'markdown.product.fences',
    workload: 'markdown-prose-original',
    run: (text) => scanFences(text)
  },
  {
    name: 'markdown.links',
    workload: 'markdown-template',
    run: (text) => scanLinkDestinations(text)
  },
  {
    name: 'markdown.product.links',
    workload: 'markdown-prose-original',
    run: (text) => scanLinkDestinations(text)
  },
  {
    name: 'xml.validate',
    workload: 'xml-preserve',
    run: (text) => validateXml(text)
  },
  {
    name: 'xml.doctype',
    workload: 'xml-preserve',
    run: (text) => scanDoctype(text)
  },
  {
    name: 'xml.space-preserve',
    workload: 'xml-preserve',
    run: (text) => scanXmlSpacePreserve(text)
  },
  {
    name: 'template.handlebars',
    workload: 'markdown-template',
    run: (text) => scanHandlebars(text)
  },
  {
    name: 'template.product.handlebars',
    workload: 'markdown-prose-original',
    run: (text) => scanHandlebars(text)
  }
]);
