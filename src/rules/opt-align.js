export const optAlignGroup = {
  title: 'Оптическое выравнивание',
  classes: {
    oa_obracket_sp_s: 'margin-right:0.3em;',
    oa_obracket_sp_b: 'margin-left:-0.3em;',
    oa_obracket_nl_b: 'margin-left:-0.3em;',
    oa_comma_b: 'margin-right:-0.2em;',
    oa_comma_e: 'margin-left:0.2em;',
    oa_oquote_nl: 'margin-left:-0.44em;',
    oa_oquote_sp_s: 'margin-right:0.44em;',
    oa_oquote_sp_q: 'margin-left:-0.44em;'
  },
  rules: [
    {
      id: 'quote',
      description: 'Оптическое выравнивание открывающей кавычки',
      enabled: false,
      pattern: [/([a-zа-яё-]{3,})( |\u{00A0}|\t)(«)/giu, /(\n|\r|^)(«)/gu],
      replacement: [
        (m, ctx) => {
          const [, p1, p2, p3] = m;

          return `${p1}${ctx.tag(p2, 'span', { class: 'oa_oquote_sp_s' })}${ctx.tag(p3, 'span', { class: 'oa_oquote_sp_q' })}`;
        },
        (m, ctx) => `${m[1]}${ctx.tag(m[2], 'span', { class: 'oa_oquote_nl' })}`
      ]
    },
    {
      id: 'bracket',
      description: 'Оптическое выравнивание скобок',
      enabled: false,
      pattern: [/( |\u{00A0}|\t)\(/gu, /(\n|\r|^)\(/g],
      replacement: [
        (m, ctx) =>
          `${ctx.tag(m[1], 'span', { class: 'oa_obracket_sp_s' })}${ctx.tag('(', 'span', { class: 'oa_obracket_sp_b' })}`,
        (m, ctx) => `${m[1]}${ctx.tag('(', 'span', { class: 'oa_obracket_nl_b' })}`
      ]
    }
  ]
};
