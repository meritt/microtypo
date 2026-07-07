import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { microtypo } from '../../src/index.js';

const NBSP = '\u{00A0}';
const NOP = { html: true, render: { paragraphs: false } };

describe('ENRICH-1 — owned cases for behaviors thin in the corpus', () => {
  test('currency + numeric range in one phrase', () => {
    assert.equal(
      microtypo('Оберон платит 100-150 рублей за Козырь', NOP),
      `Оберон платит 100–150${NBSP}₽ за${NBSP}Козырь`
    );
  });

  test('era abbreviation "до н.э." nowrap-bound', () => {
    assert.equal(
      microtypo('Первые Тени возникли ещё в III веке до н.э., задолго до Дворкина', NOP),
      `Первые Тени возникли ещё в${NBSP}III веке <span style="white-space:nowrap;">до н. э.</span>, задолго до${NBSP}Дворкина`
    );
  });

  test('honorific г-н / г-жа bound with nbsp', () => {
    assert.equal(
      microtypo('Г-н Бенедикт и г-жа Флора спорили у Лабиринта', NOP),
      `Г-н${NBSP}Бенедикт и${NBSP}г-жа${NBSP}Флора спорили у${NBSP}Лабиринта`
    );
  });

  test('data-size unit bound to its number', () => {
    assert.equal(
      microtypo('Мерлин переслал по Козырю файл размером 700 МБ', NOP),
      `Мерлин переслал по${NBSP}Козырю файл размером 700${NBSP}МБ`
    );
  });

  test('two frequency units bound in one sentence', () => {
    assert.equal(
      microtypo('Лабиринт гудел на частоте 40 МГц, пока Хаос отвечал на 2.4 ГГц', NOP),
      `Лабиринт гудел на${NBSP}частоте 40${NBSP}МГц, пока Хаос отвечал на${NBSP}2.4${NBSP}ГГц`
    );
  });

  test('comparison math signs >= and <=', () => {
    assert.equal(
      microtypo('Сила Оберона >= силы Эрика, но <= силы Дворкина', NOP),
      'Сила Оберона ≥ силы Эрика, но ≤ силы Дворкина'
    );
  });

  test('unit binds to its number only; unit↔noun stays a breakable space (NBSP-2)', () => {
    assert.equal(
      microtypo('Рэндом отмерил 5 км Тени пешком', NOP),
      `Рэндом отмерил 5${NBSP}км Тени пешком`
    );
  });
});
