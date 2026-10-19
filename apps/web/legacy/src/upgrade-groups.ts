import { MAX_LEVEL, type CardDto } from '@tq/shared';

/** Thứ tự các nhóm tướng trên trang Nâng cấp. */
export type UpgradeSort = 'ready' | 'level_desc' | 'name' | 'count';

/** Các thẻ cùng tướng + cùng level, nằm liền nhau. */
export interface LevelRun {
  level: number;
  cards: CardDto[];
  /** Đủ số thẻ để ghép (inputCount) và level < 10. */
  ready: boolean;
}

/** Tất cả thẻ của một tướng, nằm liền nhau. */
export interface GeneralGroup {
  generalId: string;
  name: string;
  total: number;
  maxLevel: number;
  /** Level cao nhất có thể ghép, 0 nếu chưa ghép được. */
  bestReadyLevel: number;
  runs: LevelRun[];
}

/**
 * Gom thẻ theo tướng để các bản sao cùng tướng luôn nằm cạnh nhau (VD các thẻ Tào Tháo liền nhau).
 * inputCount = số thẻ mỗi lần ghép (lấy từ cấu hình server).
 * Trong mỗi tướng: chia theo level (cao → thấp), trong cùng level theo id tăng dần.
 * Chỉ sắp xếp hiển thị — không quyết định gì về kết quả ghép.
 */
export function groupCardsByGeneral(
  cards: readonly CardDto[],
  nameOf: (generalId: string) => string,
  sort: UpgradeSort,
  inputCount: number,
): GeneralGroup[] {
  const byGeneral = new Map<string, CardDto[]>();
  for (const c of cards) {
    const arr = byGeneral.get(c.generalId);
    if (arr) arr.push(c);
    else byGeneral.set(c.generalId, [c]);
  }

  const groups: GeneralGroup[] = [...byGeneral.entries()].map(([generalId, list]) => {
    const sorted = [...list].sort((a, b) => b.level - a.level || a.id - b.id);
    const runs: LevelRun[] = [];
    for (const c of sorted) {
      const last = runs[runs.length - 1];
      if (last && last.level === c.level) last.cards.push(c);
      else runs.push({ level: c.level, cards: [c], ready: false });
    }
    for (const r of runs) r.ready = r.level < MAX_LEVEL && r.cards.length >= inputCount;
    const readyRuns = runs.filter((r) => r.ready);
    return {
      generalId,
      name: nameOf(generalId),
      total: sorted.length,
      maxLevel: sorted[0]!.level,
      bestReadyLevel: readyRuns.length ? Math.max(...readyRuns.map((r) => r.level)) : 0,
      runs,
    };
  });

  const byName = (a: GeneralGroup, b: GeneralGroup) => a.name.localeCompare(b.name, 'vi') || a.generalId.localeCompare(b.generalId);
  const cmp: Record<UpgradeSort, (a: GeneralGroup, b: GeneralGroup) => number> = {
    // Nhóm ghép được lên trước (level ghép được cao hơn trước), sau đó theo level cao nhất
    ready: (a, b) =>
      Number(b.bestReadyLevel > 0) - Number(a.bestReadyLevel > 0) ||
      b.bestReadyLevel - a.bestReadyLevel ||
      b.maxLevel - a.maxLevel ||
      byName(a, b),
    level_desc: (a, b) => b.maxLevel - a.maxLevel || byName(a, b),
    name: byName,
    count: (a, b) => b.total - a.total || byName(a, b),
  };
  return groups.sort(cmp[sort]);
}
