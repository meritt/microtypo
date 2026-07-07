# Расширение

Экземпляр `MicroTypo` можно донастроить после создания. Все методы, кроме дескрипторов, возвращают `this` и допускают цепочки.

## Методы экземпляра

- `addSafeTag(tag)` — защитить содержимое пользовательского HTML-тега (имя обязано совпадать с `/^[a-zA-Z][a-zA-Z0-9-]*$/`): такое содержимое не типографируется.
- `addSafeBlock({ id, open, close, unsafeRegex? })` — защитить содержимое между пользовательскими разделителями. По умолчанию разделители экранируются как литералы; `unsafeRegex: true` трактует их как регулярные выражения (см. [Безопасность](security.md)).
- `setLayout('style' | 'class' | 'both')` — режим выдачи оптического выравнивания (то же, что `render.hanging`).
- `setPrefix(prefix | true)` — префикс для генерируемых CSS-классов (`true` = `mt_`). Небезопасное значение выбрасывает `MicroTypoConfigError`.
- `applyOptions(config)` — применить дополнительную конфигурацию после создания; валидируется как конфиг конструктора.
- `getRuleGroup(name)` / `listRuleGroups()` — интроспекция: возвращают замороженные дескрипторы `{ name, title, builtin, rules: [{ id, defaultEnabled }] }`, а не живые группы.

```js
import { MicroTypo } from 'microtypo';

const typo = new MicroTypo({ html: true });
typo.addSafeTag('kbd').setPrefix('mt_');
typo.process('<kbd>"Козыри"</kbd> и "Амбер"');
// '<p><kbd>"Козыри"</kbd> и «Амбер»</p>'
```

## Пользовательские группы правил

Подпуть `microtypo/define-rule` экспортирует `defineRuleGroup` для сборки собственной группы; она регистрируется через `registerRuleGroup(group, { name, position })`, где `position` — `'start'`, `'end'`, `'after:X'` или `'before:X'`. Обработчики правил получают только суженный `ctx` и не могут дотянуться до внутренностей движка.

```js
import { defineRuleGroup } from 'microtypo/define-rule';
```

## Типизированные ошибки

Подпуть `microtypo/errors` экспортирует классы иерархии ошибок для проверок через `instanceof` — эквивалент проверке префикса `err.code?.startsWith('ERR_MICROTYPO')` (см. [Безопасность](security.md)):

```js
import { MicroTypoInputError } from 'microtypo/errors';

try {
  typo.process(input);
} catch (err) {
  if (err instanceof MicroTypoInputError) return input;
  throw err;
}
```

## Пустой движок

`new MicroTypo({ presets: false })` не регистрирует встроенные группы правил. Слой защиты и восстановления (URL/email, safe-теги, удаление зарезервированного PUA, нормализация глифов) продолжает работать, но типографика групп не выполняется — удобная основа для конвейера с нуля.

```js
const typo = new MicroTypo({ presets: false });
typo.listRuleGroups(); // []
typo.process('"Амбер" остаётся как есть'); // '"Амбер" остаётся как есть'
```
