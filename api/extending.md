# Расширение

## Методы экземпляра

Методы, кроме `process()`, `getRuleGroup()` и `listRuleGroups()`, возвращают `this`.

- `addSafeTag(tag)` — не типографировать содержимое элемента `tag`. Имя — `/^[a-zA-Z][a-zA-Z0-9-]*$/`, иначе `TypeError`. Дополняет [встроенный список](configuration.md#input-строка-и-объект); удалить имя из списка нельзя.
- `addSafeBlock({ id, open, close, unsafeRegex = false })` — не типографировать текст между `open` и `close`. Разделители — литералы, с `unsafeRegex: true` — исходник регулярного выражения (см. [Безопасность](security.md#пользовательские-образцы)). Пустой разделитель или некорректное выражение — `MicroTypoConfigError`.
- `setLayout('style' | 'class' | 'both')` — то же, что `render.hanging`; другое значение — `MicroTypoConfigError`.
- `setPrefix(prefix | true)` — префикс генерируемых классов (`true` = `mt_`); кавычка, `<`, `>`, `&` или пробельный символ — `MicroTypoConfigError`.
- `applyOptions(config)` — дополнить конфигурацию; проверка как в конструкторе. `input`, `presets` и `ruleGroups` задаёт только конструктор: другое значение `input` или `presets` и любое `ruleGroups` — `MicroTypoConfigError`, прежние `input` и `presets` допустимы.
- `registerRuleGroup(group, { name, position })` — см. [ниже](#пользовательские-группы-правил).
- `getRuleGroup(name)` / `listRuleGroups()` — замороженные дескрипторы `{ name, title, builtin, rules: [{ id, defaultEnabled }] }`, а не живые группы; `listRuleGroups()` — в порядке выполнения.
- `onCycleLimit` — свойство: `(ruleId, iterations) => void`, вызывается, если правило с `cycled: true` не стабилизировалось за 100 итераций (остаётся результат последней). Читается в начале `process()`; заданная функция отключает отсев правил.
- `process(text, { changes?, edits?, trace? })` — без опций строка, с любой включённой — `{ text, changes?, edits?, trace? }`. `changes` — места правок в координатах вывода, см. [Использование](../readme.md#использование). `edits` — `[{ start, end, text }]` в координатах входа (UTF-16): отсортированы, не пересекаются, не делят суррогатные пары; применённые к входу справа налево дают `text`. `trace` — см. [Диагностику](#диагностика). Значение опции, кроме булева и `undefined`, — `MicroTypoConfigError`; прочие поля игнорируются.

```js
import { MicroTypo } from 'microtypo';

const typo = new MicroTypo({ html: true });
typo.addSafeTag('trump').setPrefix('mt_');
typo.process('<trump>"Козыри"</trump> и "Амбер"');
// '<p><trump>"Козыри"</trump> и «Амбер»</p>'
```

## Диагностика

`trace` — массив `{ rule, kind, count, ranges }`: `rule` — `группа.правило`, `ranges` — диапазоны `[start, end)` исходного входа в UTF-16, включая BOM, разметку и escape-последовательности JSON.

- `kind: 'regex'`: `count` — совпадения, замена которых меняет текст; диапазон — полное совпадение, включая захваченный контекст; соседние совпадения не сливаются.
- `kind: 'handler'`: `count` — вызовы обработчика, изменившие текст; диапазоны — изменённые участки. Внутренние операции обработчика, включая общий сканер nowrap, отдельно не считаются. Предварительный шаг года — `date.settle_year_marks`, `handler`.
- Пробные запуски при подъёме разметки не считаются. Правка текста, созданного предыдущим правилом, указывает на исходный участок, из которого он получен (может охватить весь заменённый участок); вставка — пустой диапазон.
- Нормализация, защита, сериализация и восстановление сдвигают координаты, но в `trace` не попадают: полный набор преобразований — `edits`.
- Если `process()` вернул вход как есть (прагма пропуска файла или невосстановленный адрес), `trace` пуст.
- Учёт происхождения ведётся только с `trace: true`, ограничен размером текущего текста и входит в бюджет `maxProcessingMs`.

## `<notg>`

`<notg>…</notg>` защищает фрагмент от правил (во всех форматах, кроме `plain`). Теги заменяются пустыми маркерами, которые видят соседние правила; уберите или оформите их в шаблоне.

```js
microtypo('<notg>"Амбер"</notg> и "Амбер"');
// '<span class="_notg_start"></span>"Амбер"<span class="_notg_end"></span> и «Амбер»'
```

## Пользовательские группы правил

`defineRuleGroup` из `microtypo/define-rule` замораживает определение группы `{ title?, rules, classes? }`. `registerRuleGroup(group, { name, position = 'end' })` компилирует и регистрирует её: имя — `name`, `group.name` или `group.title`; `position` — `'start'`, `'end'`, `'after:X'` или `'before:X'`. Неизвестная позиция или ссылка на незарегистрированную группу — `MicroTypoConfigError`, экземпляр не меняется. Регистрация под занятым именем заменяет группу; под именем встроенной группы она становится пользовательской.

```js
import { defineRuleGroup } from 'microtypo/define-rule';

const group = defineRuleGroup({
  title: 'Козыри',
  rules: [{ id: 'trump', pattern: /Козырь/g, replacement: 'Козырь Амбера' }]
});
```

Правило:

- `{ id, pattern, replacement }`: `pattern` — `RegExp`, `{ source, flags }` или массив; флаг `g` добавляется сам. `replacement` — строка, функция `(matchArgs, ctx) => string` или массив той же длины, что `pattern`.
- `{ id, handler(ctx) }`: возвращает новый текст (не строка — остаётся `ctx.text`); с `pattern`/`replacement` не сочетается.
- Флаги: `enabled: false` — выключено по умолчанию; `cycled: true` — повторять до стабилизации, не больше 100 итераций; `htmlOnly: true` — пропускать при `html: false`.

Ошибка формы группы или правила — `TypeError`; некорректный `{ source, flags }` или нестроковая замена при нём — `MicroTypoConfigError`.

`classes` — `{ класс: стиль }`: `ctx.tag(content, tag, { class })` с классом из словаря пишет `style`, `class` с префиксом или оба, по `setLayout`. `defineRuleGroup` не замораживает переданный `classes`; `registerRuleGroup` хранит его копию, так что последующие изменения на вывод не влияют.

### Правила как данные

Конфигурация `ruleGroups` регистрирует группы после встроенных — JSON-форма для JS, wasm, Swift и C. Группа: `name`, `rules`, необязательные `title` и `position`; правило: `id`, `pattern: { source, flags }`, строка `replacement`, необязательные булевы `enabled`, `cycled`, `htmlOnly`. Другие ключи и некорректный образец — `MicroTypoConfigError`.

```json
{
  "ruleGroups": [
    {
      "name": "terms",
      "rules": [
        {
          "id": "amber",
          "pattern": { "source": "(amber)", "flags": "gi" },
          "replacement": "[$1]"
        }
      ]
    }
  ]
}
```

Замена — синтаксис JavaScript (`$1`, `$&`, именованные группы). После создания такие группы регистрирует `registerRuleGroup`. Пользовательские образцы на ReDoS не проверяются — см. [Безопасность](security.md#пользовательские-образцы).

### Контекст обработчика

Пользовательская группа исполняется с правами вызывающего кода; `ctx` защищает не от неё, а от её ошибок. Экземпляра движка, хранилищ и учёта подделок в `ctx` нет.

- `text` — текущий текст; `html` — выводится ли HTML в текущем фрагменте.
- `group` — замороженный `{ name, title, settings, raw }`; `settings` — живые настройки этой группы.
- `tag(content, tag, attributes = {})` — обернуть в тег. Имена тега и атрибутов — `/^[a-zA-Z][a-zA-Z0-9-]*$/`, иначе `MicroTypoConfigError`; значения экранируются. При `html: false` возвращает `content` (у `class: 'nowrap'` пробелы становятся неразрывными).
- `iblock(s)` — спрятать `s` в хранилище, вернуть заполнитель.
- `isOn(key, scope?)` — `scope.settings[key]`, иначе настройка движка.
- `tags.findByTagName(name)` — `[{ prefix, id }]` защищённых тегов; `name` — строка, `RegExp` или `(name, selfClosing) => boolean`.
- `layout`, `engineSettings` — копии; `onCycleLimit` — снимок на начало `process()`.
- `checkBudget(stage)` — бросает `MicroTypoBudgetError`, если бюджет исчерпан.

Возвращённый текст и всё, что передано в `tag()` и `iblock()`, проходят общий счёт: вхождений каждого заполнителя не больше, чем во входе группы, плюс созданные для неё движком. Лишние удаляются до восстановления.

## Пустой движок

`new MicroTypo({ presets: false })` — основа для собственного набора групп: встроенных групп нет, защита и восстановление (URL/email, защищённые теги, экранирование зарезервированных символов PUA, нормализация глифов) работают.

```js
const typo = new MicroTypo({ presets: false });
typo.listRuleGroups(); // []
typo.process('"Амбер" остаётся как есть'); // '"Амбер" остаётся как есть'
```
