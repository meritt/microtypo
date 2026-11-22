# Microtypo

[![NPM version][npm-image]][npm-url]
[![Build status][github-actions-image]][github-actions-url]
[![Coverage status][coveralls-image]][coveralls-url]
[![Dependency status][libraries-image]][libraries-url]

Движок русской типографики для Node.js и браузера. Приводит текст к нормам набора: кавычки-«ёлочки», длинное и среднее тире, неразрывные пробелы, знаки валют, оптическое выравнивание, абзацы.

```js
import { microtypo } from 'microtypo';

microtypo('Он сказал: "Я -- Корвин", и замолчал.');
// 'Он сказал: «Я — Корвин», и замолчал.'
```

- Чистый JavaScript, только ESM, без зависимостей; Node.js 26.13 и новее.
- По умолчанию — обычный текст в Unicode. `html: true` включает вывод разметки (`<p>`, `<span>`, `<a>`), `entities: true` — глифы HTML-сущностями.
- Слова связываются сквозь [строчную разметку](api/rules-reference.md#строчная-разметка): предлог в `в <em>доме</em>` получает тот же неразрывный пробел, что в `в доме`.

## Установка

```bash
pnpm add microtypo
# или: npm install microtypo
```

## Использование

`microtypo(text, config)` собирает движок на один вызов. Для потока документов создайте `MicroTypo` один раз: правила компилируются при создании. Формат ввода задаётся конфигурацией экземпляра, поэтому на каждый формат — свой экземпляр.

```js
import { MicroTypo } from 'microtypo';

const typo = new MicroTypo({ html: true });

for (const post of feed) {
  post.body = typo.process(post.body);
}
```

`process(text, { changes: true })` возвращает `{ text, changes }`: отсортированные непересекающиеся интервалы правок `[start, end)` в единицах UTF-16 результата, включая разметку. Границы не разрезают суррогатную пару, удаление даёт пустой интервал. Без флагов диагностики (`changes`, `edits`, `trace`) `process()` возвращает строку.

```js
new MicroTypo().process('Корвин сказал: "Привет"', { changes: true });
// { text: 'Корвин сказал: «Привет»', changes: [[15, 16], [22, 23]] }
```

`edits: true` добавляет те же правки как замены в координатах входа, `trace: true` — сработавшие правила; флаги совместимы, см. [диагностику](api/extending.md#диагностика).

```js
new MicroTypo().process('Корвин сказал: "Привет"', { edits: true });
// { text: 'Корвин сказал: «Привет»', edits: [{ start: 15, end: 16, text: '«' }, { start: 22, end: 23, text: '»' }] }
```

`input` задаёт формат документа: в Markdown, MDX, HTML, JSON, XML, YAML, TOML и Frontmatter движок типографирует текст, найденный по грамматике формата, см. [настройки ввода](api/configuration.md#input-строка-и-объект).

```markdown
## Донесение из Амбера

Корвин спросил : "Амбер ?! Рэндом ( без карты , но с Козырем ) всё равно идёт..."

- Оберон правил в 2012-2015 г., а совет назначили на 12-15 января.
- Рэндом вёл 100-500 всадников и 12345 теней.
- Фиона отметила 3 кг серебра, 1/2 меры воды и 40 руб. монет.
- Блейз нашёл § 12, карту № 7, зал 10x12 м и клинок длиной 5".
- В Ардене было -5 °С; шанс пройти Лабиринт -- 50 %.
- Дворкин сверил: 2 != 3, 2 <= 3, 4 >= 1.
- Дворкин записал: т.е. Лабиринт, и т.д.
- Знак (c) Оберон, метка (tm) Козыри.
- Дворкин оставил знак: `Лабиринт -- Отражение`.

[Рэбма](https://amber.example/rebma?path=arden-shadow)
```

```js
microtypo(markdown, { input: 'markdown' });
/*
## Донесение из Амбера

Корвин спросил: «Амбер?! Рэндом (без карты, но с Козырем) всё равно идёт…»

- Оберон правил в 2012–2015 гг., а совет назначили на 12–15 января.
- Рэндом вёл 100–500 всадников и 12 345 теней.
- Фиона отметила 3 кг серебра, ½ меры воды и 40 ₽ монет.
- Блейз нашёл § 12, карту № 7, зал 10×12 м и клинок длиной 5″.
- В Ардене было −5 °C; шанс пройти Лабиринт — 50%.
- Дворкин сверил: 2 ≠ 3, 2 ≤ 3, 4 ≥ 1.
- Дворкин записал: т. е. Лабиринт, и т. д.
- Знак © Оберон, метка ™ Козыри.
- Дворкин оставил знак: `Лабиринт -- Отражение`.

[Рэбма](https://amber.example/rebma?path=arden-shadow)
*/
```

Правила, выключенные по умолчанию, включают по идентификатору, включённые так же выключают:

```js
microtypo('Корвин ушёл', {
  rules: { 'punctuation.period_at_end': true, 'nobr.nbsp_last_word': false }
});
// 'Корвин ушёл.'
```

Команда `microtypo` — фильтр stdin→stdout с теми же опциями, а для файлов, каталогов и масок — запись на месте, проверка и разница, см. [CLI](api/cli.md).

## В браузере

`microtypo/browser` — экспорты `microtypo`, `microtypo/define-rule` и `microtypo/errors` в одном ES-модуле без импортов. Без сборщика файл `node_modules/microtypo/dist/microtypo.browser.js` копируют в статические файлы сайта как есть.

```js
import { MicroTypo } from 'microtypo/browser';
```

Нужен браузер с `RegExp.escape` и `Uint8Array.prototype.toHex`: Chrome 140, Firefox 134, Safari 18.2 и новее.

## Безопасность

Microtypo пропускает HTML из исходного текста, в том числе `<script>` с содержимым: недоверенный ввод, который будет показан как HTML, очищайте отдельно. Лимиты и модель угроз — в [api/security.md](api/security.md).

## Документация

- [Конфигурация](api/configuration.md) — опции, форматы ввода, наборы правил.
- [Правила](api/rules-reference.md) — группы и идентификаторы правил с примерами.
- [CLI](api/cli.md)
- [Безопасность](api/security.md) — модель угроз, лимиты, ошибки.
- [Расширение](api/extending.md) — методы экземпляра, диагностика, пользовательские правила.
- [Архитектура](docs/architecture.md) — устройство движка для контрибьюторов.

## Автор

[Алексей Симоненко](https://simonenko.xyz)

## Лицензия

MIT. Смотрите файл `LICENSE`.

[npm-image]: https://img.shields.io/npm/v/microtypo.svg?style=flat
[npm-url]: https://www.npmjs.com/package/microtypo
[github-actions-image]: https://github.com/meritt/microtypo/actions/workflows/ci.yml/badge.svg
[github-actions-url]: https://github.com/meritt/microtypo/actions/workflows/ci.yml
[coveralls-image]: https://coveralls.io/repos/github/meritt/microtypo/badge.svg?branch=main
[coveralls-url]: https://coveralls.io/github/meritt/microtypo?branch=main
[libraries-image]: https://img.shields.io/librariesio/release/npm/microtypo.svg?style=flat
[libraries-url]: https://libraries.io/npm/microtypo
