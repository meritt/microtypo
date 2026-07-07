export const HELP = `Usage: microtypo [options] [file...]

Russian typesetting for text. Reads stdin or files, writes to stdout.

Options:
  --html / --no-html            master switch for markup emission
  --entities / --no-entities    glyphs as HTML entities instead of raw Unicode
  --input <text|html|markdown|json|xml|yaml|toml|frontmatter>
                                input format (default: text)
  --hanging / --no-hanging      optical alignment of quotes and brackets
  --rule <id=bool>              enable/disable a typesetting rule (repeatable)
  --render <key=value>          set a render option, e.g. nowrap=span (repeatable)
  --max-input <n>               reject inputs longer than n characters
  --max-ms <n>                  wall-clock processing budget in ms
  --set <path=value>            set an arbitrary config path (repeatable)
  --config <path>               JSON config file (disables auto-discovery)
  -w, --write                   rewrite the given file(s) in place
  -o, --output-file <path>      write result to a file
  -h, --help                    show this help
  --version                     print version

Examples:
  echo '"Амбер" -- вечен' | microtypo
  microtypo --config config/microtypo.json < draft.md
  microtypo --write content/post.md
`;
