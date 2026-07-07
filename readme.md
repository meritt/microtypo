# Microtypo

[![NPM version][npm-image]][npm-url]
[![Build status][github-actions-image]][github-actions-url]
[![Coverage status][coveralls-image]][coveralls-url]
[![Dependency status][libraries-image]][libraries-url]

Движок русской типографики для Node.js. Приводит обычный текст к типографским правилам: угловые кавычки «», длинное и среднее тире, неразрывные пробелы, символы валют, оптическое выравнивание, абзацы. По умолчанию возвращает обычный текст; HTML-разметку и HTML-сущности включают флагами.

```js
import { microtypo } from 'microtypo';

microtypo('Он сказал: "Я -- Корвин", и замолчал.');
// 'Он сказал: «Я — Корвин», и замолчал.'
```

- Чистый JavaScript, только ESM, ноль продакшен зависимостей.
- Node.js >= 26.4.
- По умолчанию — обычный Unicode-текст. Разметка `<p>`, `<span>`, `<a>` включается флагом `html: true`, глифы как HTML-сущности — флагом `entities: true`.

## Установка

```bash
pnpm add microtypo
# или: npm install microtypo
```

## Использование

Разовая функция собирает движок под один вызов:

```js
import { microtypo } from 'microtypo';

microtypo('Корвин ступил на Отражение "Земля".');
// 'Корвин ступил на Отражение «Земля».'
```

Markdown (HTML, JSON, YAML) можно передать как формат данных:

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
- В Ардене было -5 °C; шанс пройти Лабиринт — 50%.
- Дворкин сверил: 2 ≠ 3, 2 ≤ 3, 4 ≥ 1.
- Дворкин записал: т. е. Лабиринт, и т. д.
- Знак © Оберон, метка ™ Козыри.
- Дворкин оставил знак: `Лабиринт -- Отражение`.

[Рэбма](https://amber.example/rebma?path=arden-shadow)
*/
```

Экземпляр компилирует правила один раз, чтобы использовать их несколько раз в движке:

```js
import { MicroTypo } from 'microtypo';

const typo = new MicroTypo({
  html: true
});

for (const post of feed) {
  post.body = typo.process(post.body);
}
```

## Производительность

Для циклов, пакетной обработки, серверных обработчиков и лент создавайте `MicroTypo` один раз и переиспользуйте экземпляр. Вызов `microtypo(text, config)` удобен для разовой обработки, но каждый раз создаёт новый экземпляр и заново компилирует настройки.

Не повышайте `maxInputLength` для публичного недоверенного ввода без собственных нагрузочных тестов. Лимит 30 000 — часть DoS-защиты: `maxProcessingMs` проверяется между стадиями и не может остановить уже исполняющееся регулярное выражение.

## Конфигурация

Единый объект с тремя уровнями настройки:

- **Направление** — `html`, `entities`, `input`, лимиты `maxInputLength` и `maxProcessingMs`. `input` принимает и строку, и объектную форму для форматов Markdown, JSON, XML, YAML, TOML, front-matter и защиты шаблонных разделителей.
- **Правила** — `rules: { 'группа.правило': bool }` для точечного включения и отключения правил.
- **Вывод разметки** — `render` управляет выдаваемой разметкой при `html: true`.

Подробности — в разделе [конфигурация](api/configuration.md).

## Документация

- [Конфигурация](api/configuration.md) — три уровня настройки и форматы ввода.
- [Правила](api/rules-reference.md) — двенадцать групп правил и их идентификаторы.
- [CLI](api/cli.md) — фильтр stdin→stdout.
- [Безопасность](api/security.md) — модель угроз, лимиты, ошибки.
- [Расширение](api/extending.md) — методы экземпляра, пользовательские группы правил, типизированные ошибки.

## Безопасность

Microtypo типографирует текст, но не очищает HTML: разметка сохраняется байт-в-байт, включая `<script>`. Недоверенный ввод, который отображается как HTML, очищайте отдельно (Sanitizer, DOMPurify). Движок защищает собственную целостность: удаляет зарезервированный PUA, ограничивает длину и время обработки и выбрасывает типизированные ошибки. Смотрите раздел [безопасность](api/security.md).

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
