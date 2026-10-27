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

- Чистый JavaScript, только ESM, без зависимостей.
- Node.js 26.12.1 и новее.
- По умолчанию — обычный текст в Unicode. Разметку `<p>`, `<span>`, `<a>` включает флаг `html: true`, глифы в виде HTML-сущностей — флаг `entities: true`.

## Установка

```bash
pnpm add microtypo
# или: npm install microtypo
```

## Использование

`microtypo(text, config)` собирает движок на один вызов. Для потока документов — цикла, пакетной обработки, серверного обработчика — создайте `MicroTypo` один раз: экземпляр компилирует правила при создании и использует их в каждом `process()`.

```js
import { MicroTypo } from 'microtypo';

const typo = new MicroTypo({ html: true });

for (const post of feed) {
  post.body = typo.process(post.body);
}
```

Экземпляр создаётся за доли миллисекунды, поэтому для каждого формата ввода заводите свой.

`process(text, { changes: true })` возвращает вместе с результатом места правок — например, чтобы подсветить их. Интервалы `[start, end)` отсортированы, не пересекаются и задаются в позициях UTF-16 результата, включая разметку; удаление без замены даёт пустой интервал в месте удаления. Без `changes: true` `process()` возвращает строку.

```js
new MicroTypo().process('Корвин сказал: "Привет"', { changes: true });
// { text: 'Корвин сказал: «Привет»', changes: [[15, 16], [22, 23]] }
```

Формат ввода задаёт `input`: Markdown, HTML, JSON, XML, YAML, TOML и front-matter разбираются по своей грамматике, типографируется только текст, а структура документа сохраняется байт-в-байт.

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

Корвин спросил: «Амбер?! Рэндом (без карты, но с Козырем) всё равно идёт…»

- Оберон правил в 2012–2015 гг., а совет назначили на 12–15 января.
- Рэндом вёл 100–500 всадников и 12 345 теней.
- Фиона отметила 3 кг серебра, ½ меры воды и 40 ₽ монет.
- Блейз нашёл § 12, карту № 7, зал 10×12 м и клинок длиной 5″.
- В Ардене было -5 °C; шанс пройти Лабиринт — 50%.
- Дворкин сверил: 2 ≠ 3, 2 ≤ 3, 4 ≥ 1.
- Дворкин записал: т. е. Лабиринт, и т. д.
- Знак © Оберон, метка ™ Козыри.
- Дворкин оставил знак: `Лабиринт -- Отражение`.

[Рэбма](https://amber.example/rebma?path=arden-shadow)
*/
```

Пакет устанавливает одноимённую команду — фильтр stdin→stdout с теми же опциями, см. [CLI](api/cli.md).

## В браузере

`microtypo/browser` — экспорты `microtypo`, `microtypo/define-rule` и `microtypo/errors` в одном ES-модуле без импортов. Сборщик подключает его по имени; без сборщика файл `node_modules/microtypo/dist/microtypo.browser.js` копируют в статические файлы сайта как есть.

```js
import { MicroTypo } from 'microtypo/browser';
```

Нужен браузер с `RegExp.escape`: Chrome 136, Firefox 134, Safari 18.2 и новее.

## Безопасность

Microtypo типографирует текст, но не очищает HTML: разметка сохраняется байт-в-байт, включая `<script>`. Недоверенный ввод, который выводится как HTML, очищайте отдельно (Sanitizer, DOMPurify). Движок защищает собственную целостность: экранирует во вводе символы своих внутренних маркеров, ограничивает длину ввода (`maxInputLength`, по умолчанию 30 000) и время обработки, выбрасывает типизированные ошибки. Модель угроз и лимиты — в разделе [Безопасность](api/security.md).

## Политика версий

Набор правил, включённых по умолчанию, меняется только в мажорных версиях. Правило, добавленное в минорной или патч-версии, выходит выключенным: его включают через `rules`, а по умолчанию оно заработает со следующей мажорной версии. Исправления существующих правил выходят в любой версии и меняют вывод только там, где правило ошибалось. Набор правил по умолчанию не меняется в диапазоне `>=0.3.0 <1.0.0`, а после 1.0 — в диапазоне `^1`.

## Документация

- [Конфигурация](api/configuration.md) — три уровня настройки и форматы ввода.
- [Правила](api/rules-reference.md) — двенадцать групп правил и их идентификаторы.
- [CLI](api/cli.md) — фильтр stdin→stdout.
- [Безопасность](api/security.md) — модель угроз, лимиты, ошибки.
- [Расширение](api/extending.md) — методы экземпляра, пользовательские группы правил, типизированные ошибки.

## Автор

[Алексей Симоненко](https://github.com/meritt)

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
