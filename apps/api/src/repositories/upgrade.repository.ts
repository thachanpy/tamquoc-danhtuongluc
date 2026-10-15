import type { UpgradeOutcome, WeightEntry } from '@tq/shared';
import type { DB } from '../db.ts';

/** Truy vấn bảng upgrade_history (lịch sử ghép thẻ). */

export function insertUpgrade(
  db: DB,
  p: {
    userId: number;
    inputCardIdsSnapshot: string;
    inputGeneralId: string;
    inputLevel: number;
    resultCardId: number;
    resultLevel: number;
    successBps: number;
    failureBps: number;
    outcome: UpgradeOutcome;
    failureDistributionSnapshot: WeightEntry[];
    idempotencyKey: string;
    createdAt: string;
  },
): number {
  const r = db
    .prepare(
      `INSERT INTO upgrade_history (user_id, input_card_ids_snapshot, input_general_id, input_level, result_card_id,
         result_level, success_chance, failure_chance, outcome, failure_distribution_snapshot, idempotency_key, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      p.userId,
      p.inputCardIdsSnapshot,
      p.inputGeneralId,
      p.inputLevel,
      p.resultCardId,
      p.resultLevel,
      p.successBps,
      p.failureBps,
      p.outcome,
      JSON.stringify(p.failureDistributionSnapshot),
      p.idempotencyKey,
      p.createdAt,
    );
  return Number(r.lastInsertRowid);
}
