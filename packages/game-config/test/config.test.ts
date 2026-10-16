import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROSTER,
  validateGameConfig,
  poolForTicket,
  rollWeighted,
  rollLevel,
  rollTicketType,
  rollSuccess,
  GACHA_LEVEL_RATES,
  GACHA_MAX_LEVEL,
  TICKET_GRANT_WEIGHTS,
  UPGRADE_SUCCESS_BPS,
  UPGRADE_FAILURE_DISTRIBUTION,
  BPS_SCALE,
  DRAW_COUNT_OPTIONS,
  UPGRADE_INPUT_COUNT,
} from '../src/index.ts';

test('cấu hình hợp lệ', () => {
  assert.doesNotThrow(() => validateGameConfig());
});

test('roster: 140 tướng, 35 mỗi phe, ID duy nhất', () => {
  assert.equal(ROSTER.length, 140);
  assert.equal(new Set(ROSTER.map((g) => g.id)).size, 140);
  for (const f of ['wei', 'shu', 'wu', 'qun']) {
    assert.equal(ROSTER.filter((g) => g.faction === f).length, 35);
  }
  assert.equal(ROSTER.find((g) => g.id === 'cao-cao')?.name, 'Tào Tháo');
  assert.equal(ROSTER.find((g) => g.id === 'lu-bu')?.faction, 'qun');
  assert.equal(ROSTER.find((g) => g.id === 'sun-luban')?.faction, 'wu');
  assert.equal(ROSTER.find((g) => g.id === 'zhang-chunhua')?.faction, 'qun');
  assert.equal(ROSTER.find((g) => g.id === 'meng-huo')?.name, 'Mạnh Hoạch');
  assert.equal(ROSTER.find((g) => g.id === 'ju-shou'), undefined, 'Thư Thụ đã được thay bằng Mạnh Hoạch');
  assert.equal(ROSTER.find((g) => g.id === 'zhu-zhi'), undefined, 'Chu Trị đã bị bỏ khỏi roster');
});

test('pool vé: thường 140, mỗi vé phe (Thục/Ngụy/Ngô/Quần) đúng 35 tướng của phe đó', () => {
  assert.equal(poolForTicket('normal').length, 140);
  for (const t of ['shu', 'wei', 'wu', 'qun'] as const) {
    const p = poolForTicket(t);
    assert.equal(p.length, 35);
    assert.ok(p.every((g) => g.faction === t));
  }
  assert.deepEqual(Object.keys(TICKET_GRANT_WEIGHTS).sort(), ['normal', 'qun', 'shu', 'wei', 'wu']);
});

test('ghép thẻ: mỗi lần dùng đúng 2 thẻ', () => {
  assert.equal(UPGRADE_INPUT_COUNT, 2);
});

test('lựa chọn số lần quay: 1 và 10', () => {
  assert.deepEqual([...DRAW_COUNT_OPTIONS], [1, 10]);
});

test('tỷ lệ vé mặc định 20% mỗi loại (5 loại)', () => {
  assert.equal(Object.keys(TICKET_GRANT_WEIGHTS).length, 5);
  for (const w of Object.values(TICKET_GRANT_WEIGHTS)) assert.equal(w, 2000);
});

test('tỷ lệ level gacha khớp đặc tả: level 1–9, tối đa level 9', () => {
  assert.equal(GACHA_MAX_LEVEL, 9);
  assert.deepEqual(
    GACHA_LEVEL_RATES.map((e) => [e.level, e.bps]),
    [[1, 7200], [2, 1500], [3, 700], [4, 350], [5, 200], [6, 40], [7, 7], [8, 2], [9, 1]],
  );
  assert.equal(GACHA_LEVEL_RATES.reduce((s, e) => s + e.bps, 0), BPS_SCALE);
});

test('roll level gacha không bao giờ ra level 10 (duyệt toàn bộ r)', () => {
  for (let r = 0; r < BPS_SCALE; r++) {
    const lv = rollLevel(GACHA_LEVEL_RATES, () => r);
    assert.ok(lv >= 1 && lv <= GACHA_MAX_LEVEL);
  }
});

test('tỷ lệ nâng cấp + phân phối thất bại', () => {
  assert.deepEqual(
    Object.values(UPGRADE_SUCCESS_BPS),
    [9000, 8000, 7000, 6000, 5000, 4000, 3000, 2000, 1000],
  );
  // Thất bại: Lv2 giữ 90% / về Lv1 10%; Lv3–9 giữ 80% / tụt đúng 1 bậc 20%
  assert.deepEqual(UPGRADE_FAILURE_DISTRIBUTION[2], [{ level: 1, bps: 1000 }, { level: 2, bps: 9000 }]);
  for (let lv = 3; lv <= 9; lv++) {
    assert.deepEqual(UPGRADE_FAILURE_DISTRIBUTION[lv], [{ level: lv - 1, bps: 2000 }, { level: lv, bps: 8000 }]);
  }
  for (let lv = 1; lv <= 9; lv++) {
    const d = UPGRADE_FAILURE_DISTRIBUTION[lv]!;
    assert.equal(d.reduce((s, e) => s + e.bps, 0), BPS_SCALE);
    assert.ok(d.every((e) => e.level >= 1 && e.level <= lv));
  }
  assert.deepEqual(UPGRADE_FAILURE_DISTRIBUTION[1], [{ level: 1, bps: 10000 }]);
});

test('rollWeighted: biên chính xác (duyệt toàn bộ r)', () => {
  // Đếm số r trong [0, 10000) cho mỗi level => phải bằng đúng bps.
  const counts = new Map<number, number>();
  for (let r = 0; r < BPS_SCALE; r++) {
    const lv = rollLevel(GACHA_LEVEL_RATES, () => r);
    counts.set(lv, (counts.get(lv) ?? 0) + 1);
  }
  for (const e of GACHA_LEVEL_RATES) assert.equal(counts.get(e.level), e.bps);
});

test('rollTicketType: mỗi loại 2000/10000', () => {
  const counts: Record<string, number> = {};
  for (let r = 0; r < BPS_SCALE; r++) {
    const t = rollTicketType(() => r);
    counts[t] = (counts[t] ?? 0) + 1;
  }
  assert.deepEqual(counts, { normal: 2000, shu: 2000, wei: 2000, wu: 2000, qun: 2000 });
});

test('rollSuccess: đúng ngưỡng', () => {
  assert.equal(rollSuccess(8000, () => 7999), true);
  assert.equal(rollSuccess(8000, () => 8000), false);
  assert.equal(rollSuccess(50, () => 49), true);
  assert.equal(rollSuccess(50, () => 50), false);
});

test('rollWeighted từ chối tổng 0', () => {
  assert.throws(() => rollWeighted([1, 2], () => 0, () => 0));
});

test('chân dung tướng: 100 tướng gốc có ảnh theo artKey, tướng mở rộng tạm dùng placeholder', async () => {
  const { existsSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const dir = resolve(import.meta.dirname, '../../../apps/web/public/generals');
  // 40 tướng mở rộng (STT 26–35 mỗi phe) chưa có artwork — chủ dự án cập nhật sau.
  // art.ts tự rơi về placeholder (glyph phe + chữ viết tắt) khi thiếu file chân dung.
  const CORE_GENERALS = 100;
  const missing = ROSTER.filter((g) => !existsSync(resolve(dir, `${g.artKey}.jpg`))).map((g) => g.id);
  assert.equal(missing.length, ROSTER.length - CORE_GENERALS);
});
