import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CardDto } from '@tq/shared';
import { groupCardsByGeneral } from '../src/upgrade-groups.ts';

const NAMES: Record<string, string> = { 'cao-cao': 'Tào Tháo', 'liu-bei': 'Lưu Bị', 'lu-bu': 'Lữ Bố' };
const nameOf = (id: string) => NAMES[id] ?? id;
let nextId = 1;
const card = (generalId: string, level: number): CardDto => ({ id: nextId++, generalId, level, createdAt: 'x' });

// Thứ tự "lộn xộn" giống như khi quay ngẫu nhiên
const CARDS: CardDto[] = [
  card('cao-cao', 1),
  card('liu-bei', 2),
  card('cao-cao', 2),
  card('lu-bu', 1),
  card('cao-cao', 1),
  card('liu-bei', 2),
  card('cao-cao', 1),
  card('lu-bu', 4),
  card('liu-bei', 2),
];

/** Danh sách thẻ phẳng theo đúng thứ tự hiển thị. */
const flat = (sort: Parameters<typeof groupCardsByGeneral>[2]) =>
  groupCardsByGeneral(CARDS, nameOf, sort, 2).flatMap((g) => g.runs.flatMap((r) => r.cards));

test('thẻ cùng tướng luôn liền nhau, cùng level liền nhau (mọi kiểu sắp xếp)', () => {
  for (const sort of ['ready', 'level_desc', 'name', 'count'] as const) {
    const list = flat(sort);
    assert.equal(list.length, CARDS.length);
    // Mỗi tướng xuất hiện thành đúng 1 đoạn liên tục
    const seen = new Set<string>();
    let prev = '';
    for (const c of list) {
      if (c.generalId !== prev) {
        assert.ok(!seen.has(c.generalId), `${sort}: ${c.generalId} bị tách rời`);
        seen.add(c.generalId);
        prev = c.generalId;
      }
    }
  }
});

test('thẻ Tào Tháo cùng level nằm cạnh nhau; đủ 2 thẻ là đánh dấu ghép được', () => {
  const groups = groupCardsByGeneral(CARDS, nameOf, 'ready', 2);
  const caoCao = groups.find((g) => g.generalId === 'cao-cao')!;
  assert.deepEqual(
    caoCao.runs.map((r) => [r.level, r.cards.length, r.ready]),
    [
      [2, 1, false],
      [1, 3, true],
    ],
  );
});

test('sắp xếp "ready": tướng ghép được lên trước, level ghép cao hơn trước', () => {
  const order = groupCardsByGeneral(CARDS, nameOf, 'ready', 2).map((g) => g.generalId);
  // Lưu Bị ghép được Lv.2, Tào Tháo ghép được Lv.1, Lữ Bố chưa ghép được
  assert.deepEqual(order, ['liu-bei', 'cao-cao', 'lu-bu']);
});

test('các kiểu sắp xếp khác', () => {
  const ids = (s: 'level_desc' | 'name' | 'count') => groupCardsByGeneral(CARDS, nameOf, s, 2).map((g) => g.generalId);
  assert.deepEqual(ids('level_desc'), ['lu-bu', 'liu-bei', 'cao-cao']);
  assert.deepEqual(ids('count'), ['cao-cao', 'liu-bei', 'lu-bu']);
  assert.equal(ids('name').length, 3);
});

test('thẻ Lv.10 không bao giờ đánh dấu ghép được', () => {
  const g = groupCardsByGeneral([card('cao-cao', 10), card('cao-cao', 10), card('cao-cao', 10)], nameOf, 'ready', 2);
  assert.equal(g[0]!.runs[0]!.ready, false);
  assert.equal(g[0]!.bestReadyLevel, 0);
});

test('ghép 2 thẻ: đúng 2 bản cùng level là đủ ghép, 1 bản thì chưa', () => {
  const g = groupCardsByGeneral([card('lu-bu', 3), card('lu-bu', 3), card('lu-bu', 4)], nameOf, 'ready', 2);
  assert.deepEqual(
    g[0]!.runs.map((r) => [r.level, r.cards.length, r.ready]),
    [
      [4, 1, false],
      [3, 2, true],
    ],
  );
  assert.equal(g[0]!.bestReadyLevel, 3);
});
