import { MAX_LEVEL, type Faction, type PvpEffectType, type PvpPassive, type PvpSkill, type PvpSkillEffectDto, type PvpStyle, type PvpTargeting } from '@tq/shared';
import {
  PVP_CLEANSE_CHAMP_BPS,
  PVP_NO_BUFF,
  PVP_NO_COUNTER,
  PVP_NO_DEBUFF,
  PVP_NO_DODGE_REACT,
  PVP_SHIELD_BREAK,
  type PvpBuff,
  type PvpBuffEntry,
  type PvpDebuff,
  type PvpProfile,
  type PvpSkillDef,
} from './pvp.ts';

/**
 * Bộ chuyển đổi giữa `PvpSkillDef` (engine) và danh sách hiệu ứng dạng phẳng lưu trong DB
 * (`pvp_heroes.skill_effects`). Nhờ vậy trang Admin chỉnh được từng hiệu ứng một mà engine vẫn
 * dựng lại đúng định nghĩa kỹ năng để mô phỏng trận đấu.
 *
 * Quy ước giá trị: `value` = giá trị CHỐT (ở Cấp MAX_LEVEL) tính bằng bps hoặc điểm Giáp nguyên;
 * `rate` = hệ số MỖI CẤP cho các hiệu ứng tuyến tính (choáng, hút máu, phản kích).
 */

/** Số lượt mặc định khi hiệu ứng không ghi rõ (khớp `PVP_BUFF_ROUNDS`/`PVP_DEBUFF_ROUNDS`). */
const DEFAULT_DURATION = 3;
/** Số lớp mặc định (khớp `PVP_BUFF_MAX_LAYERS`/`PVP_DEBUFF_MAX_LAYERS`). */
const DEFAULT_MAX_LAYERS = 3;

/** Các hiệu ứng đi theo KÊNH buff (kèm `scope`) thay vì áp thẳng lên định nghĩa kỹ năng. */
const BUFF_FIELD: Partial<Record<PvpEffectType, keyof PvpBuff>> = {
  BUFF_DAMAGE: 'damageBps',
  BUFF_HP: 'hpBps',
  BUFF_CRIT: 'critBps',
  BUFF_CRIT_DAMAGE: 'critDamageBps',
  BUFF_TAKEN_DOWN: 'takenDownBps',
  BUFF_LIFESTEAL: 'lifestealBps',
  BUFF_SHIELD: 'shieldBps',
  BUFF_HIT: 'hitBps',
  BUFF_DODGE: 'dodgeBps',
  BUFF_DEF_ARMOR: 'defArmor',
  BUFF_DEF_PEN: 'defPenBps',
  BUFF_HOT: 'hotBps',
  BUFF_BURN_UP: 'burnUpBps',
};

/** Các hiệu ứng bất lợi áp lên địch (trừ Thiêu đốt có vòng đời riêng). */
const DEBUFF_FIELD: Partial<Record<PvpEffectType, keyof PvpDebuff>> = {
  DEBUFF_DAMAGE_DOWN: 'damageDownBps',
  DEBUFF_HP_DOWN: 'hpDownBps',
  DEBUFF_CRIT_DOWN: 'critDownBps',
  DEBUFF_CRIT_DAMAGE_DOWN: 'critDamageDownBps',
  DEBUFF_HIT_DOWN: 'hitDownBps',
  DEBUFF_DODGE_DOWN: 'dodgeDownBps',
  DEBUFF_DEF_ARMOR_DOWN: 'defArmorDown',
  DEBUFF_DEF_PEN_DOWN: 'defPenDownBps',
};

/** Tạo một dòng hiệu ứng với giá trị mặc định (duration=3, maxLayers=3, rate=0, FIXED_CAP_MINUS_10). */
function effect(type: PvpEffectType, value: number, patch: Partial<PvpSkillEffectDto> = {}): PvpSkillEffectDto {
  return {
    type,
    value,
    duration: patch.duration ?? DEFAULT_DURATION,
    maxLayers: patch.maxLayers ?? DEFAULT_MAX_LAYERS,
    rate: patch.rate ?? 0,
    formulaType: patch.formulaType ?? 'FIXED_CAP_MINUS_10',
    ...(patch.minValue !== undefined ? { minValue: patch.minValue } : {}),
    ...(patch.scope !== undefined ? { scope: patch.scope } : {}),
    ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
  };
}

/**
 * Dựng danh sách hiệu ứng từ định nghĩa kỹ năng của một tướng. Dùng cho script seed (đọc config
 * cứng) và cho trang Admin (hiển thị danh sách hiệu ứng đang áp dụng).
 */
export function skillDefToEffects(def: PvpSkillDef, profile?: Pick<PvpProfile, 'lifestealPerLevelBps' | 'teamLifestealPerLevelBps'>): PvpSkillEffectDto[] {
  const out: PvpSkillEffectDto[] = [];
  if (def.healBps > 0) out.push(effect('HEAL', def.healBps));
  if (def.selfHealBps > 0) out.push(effect('HEAL_SELF', def.selfHealBps));
  if (def.stun !== 'none')
    out.push(effect('STUN', (def.stunPerLevelBps || 0) * MAX_LEVEL, { rate: def.stunPerLevelBps, mode: def.stun, formulaType: 'PER_LEVEL_LINEAR' }));
  if (def.cleanse) {
    const span = def.cleanseMinBps !== undefined && def.cleanseMaxBps !== undefined;
    out.push(
      effect('CLEANSE', span ? def.cleanseMaxBps! : PVP_CLEANSE_CHAMP_BPS, {
        minValue: span ? def.cleanseMinBps : undefined,
        formulaType: span ? 'LEVEL_SPAN' : 'FIXED_CAP_MINUS_10',
      }),
    );
  }
  if (def.purify) out.push(effect('PURIFY', 1, { formulaType: 'PER_LEVEL_LINEAR', rate: 750 }));
  if (def.dispel) out.push(effect('DISPEL', 1, { formulaType: 'PER_LEVEL_LINEAR', rate: 750 }));
  if (profile && profile.lifestealPerLevelBps > 0)
    out.push(effect('LIFESTEAL', profile.lifestealPerLevelBps * MAX_LEVEL, { rate: profile.lifestealPerLevelBps, formulaType: 'PER_LEVEL_LINEAR' }));
  if (profile && profile.teamLifestealPerLevelBps > 0)
    out.push(effect('TEAM_LIFESTEAL', profile.teamLifestealPerLevelBps * MAX_LEVEL, { rate: profile.teamLifestealPerLevelBps, formulaType: 'PER_LEVEL_LINEAR' }));
  if (def.counter.damageBps > 0 || def.counter.perLevelBps > 0)
    out.push(effect('COUNTER', def.counter.damageBps, { rate: def.counter.perLevelBps, duration: def.counter.rounds, mode: def.counter.scope }));
  if (def.debuff.shieldBreakPerLevelBps > 0) out.push(effect('SHIELD_BREAK', def.debuff.shieldBreakPerLevelBps, { mode: 'single' }));
  if (def.revive) out.push(effect('REVIVE', 1));
  if (def.vsDebuffBonusBps > 0) out.push(effect('VS_DEBUFF_BONUS', def.vsDebuffBonusBps));
  if (def.selfBurn) out.push(effect('SELF_BURN', 1, { duration: def.selfBurnRounds }));
  if (def.burnCritMulBps > 0) out.push(effect('BURN_CRIT_MUL', def.burnCritMulBps));
  if (def.burnCritDamageBps > 0) out.push(effect('BURN_CRIT_DAMAGE', def.burnCritDamageBps));
  if (def.burnLifesteal) out.push(effect('BURN_LIFESTEAL', 1));
  if (def.dodgeReact?.counterDamageBps) out.push(effect('DODGE_REACT_COUNTER', def.dodgeReact.counterDamageBps));
  if (def.dodgeReact?.critDamageBps)
    out.push(effect('DODGE_REACT_CRIT_DAMAGE', def.dodgeReact.critDamageBps, { maxLayers: def.dodgeReact.maxLayers || 1 }));
  if ((def.guaranteedHitBelowHpBps ?? 0) > 0) out.push(effect('GUARANTEED_HIT_BELOW_HP', def.guaranteedHitBelowHpBps ?? 0));

  // Buff: mỗi KÊNH buff là một nhóm (scope, duration, maxLayers); các hiệu ứng cùng nhóm sẽ gộp lại khi decode.
  for (const entry of def.buffs) {
    for (const [type, field] of Object.entries(BUFF_FIELD) as [PvpEffectType, keyof PvpBuff][]) {
      const v = entry.buff[field] as number;
      if (v > 0) out.push(effect(type, v, { scope: entry.scope, duration: entry.buff.rounds, maxLayers: entry.buff.maxLayers }));
    }
  }
  // Debuff: Thiêu đốt có vòng đời riêng (burnRounds/burnMaxLayers).
  if (def.debuff.burnBps > 0)
    out.push(effect('DEBUFF_BURN', def.debuff.burnBps, { duration: def.debuff.burnRounds, maxLayers: def.debuff.burnMaxLayers }));
  for (const [type, field] of Object.entries(DEBUFF_FIELD) as [PvpEffectType, keyof PvpDebuff][]) {
    const v = def.debuff[field] as number;
    const formulaType = type === 'DEBUFF_DEF_ARMOR_DOWN' ? 'DEF_ARMOR_RAMP' : 'FIXED_CAP_MINUS_10';
    if (v > 0) out.push(effect(type, v, { duration: def.debuff.rounds, maxLayers: def.debuff.maxLayers, formulaType }));
  }
  return out;
}

export interface PvpHeroConfigInput {
  id: string;
  name: string;
  faction: Faction;
  isHot: boolean;
  style: PvpStyle;
  passive: PvpPassive;
  baseHp: number;
  baseAtk: number;
  baseDef: number;
  skill: PvpSkill;
  skillName: string;
  skillDescription: string;
  targetType: PvpTargeting;
  damageRate: number;
  effects: PvpSkillEffectDto[];
}

/**
 * Dựng lại `PvpProfile` (engine) từ dữ liệu cấu hình phẳng đọc trong DB.
 * `damage_rate` là % sát thương gốc; các nhóm buff trùng (scope + duration + maxLayers) được gộp
 * thành một KÊNH buff để giữ nguyên ngữ nghĩa "mỗi lượt phát một lớp".
 */
export function heroConfigToProfile(input: PvpHeroConfigInput): PvpProfile {
  const def: PvpSkillDef = {
    targeting: input.targetType,
    damageBps: input.damageRate,
    healBps: 0,
    selfHealBps: 0,
    stun: 'none',
    stunPerLevelBps: 0,
    cleanse: false,
    purify: false,
    dispel: false,
    buffs: [],
    debuff: { ...PVP_NO_DEBUFF },
    counter: { ...PVP_NO_COUNTER },
    revive: false,
    vsDebuffBonusBps: 0,
    selfBurn: false,
    selfBurnRounds: 0,
    burnCritMulBps: 0,
    burnLifesteal: false,
    burnCritDamageBps: 0,
    guaranteedHitBelowHpBps: 0,
  };
  const buffByKey = new Map<string, PvpBuffEntry>();
  let lifestealPerLevelBps = 0;
  let teamLifestealPerLevelBps = 0;
  let dodgeReact: { counterDamageBps: number; critDamageBps: number; maxLayers: number } | undefined;

  for (const e of input.effects) {
    const buffField = BUFF_FIELD[e.type];
    if (buffField) {
      const scope = e.scope ?? 'all_allies';
      const key = `${scope}|${e.duration}|${e.maxLayers}`;
      let entry = buffByKey.get(key);
      if (!entry) {
        entry = { scope, buff: { ...PVP_NO_BUFF } };
        buffByKey.set(key, entry);
      }
      entry.buff.rounds = e.duration;
      entry.buff.maxLayers = e.maxLayers;
      (entry.buff[buffField] as number) = e.value;
      continue;
    }
    const debuffField = DEBUFF_FIELD[e.type];
    if (debuffField) {
      (def.debuff[debuffField] as number) = e.value;
      def.debuff.rounds = e.duration;
      def.debuff.maxLayers = e.maxLayers;
      continue;
    }
    switch (e.type) {
      case 'HEAL': def.healBps = e.value; break;
      case 'HEAL_SELF': def.selfHealBps = e.value; break;
      case 'STUN':
        def.stun = e.mode === 'row' ? 'row' : 'single';
        def.stunPerLevelBps = e.rate;
        break;
      case 'CLEANSE':
        def.cleanse = true;
        if (e.formulaType === 'LEVEL_SPAN') {
          def.cleanseMinBps = e.minValue ?? e.value;
          def.cleanseMaxBps = e.value;
        }
        break;
      case 'PURIFY': def.purify = true; break;
      case 'DISPEL': def.dispel = true; break;
      case 'LIFESTEAL': lifestealPerLevelBps = e.rate; break;
      case 'TEAM_LIFESTEAL': teamLifestealPerLevelBps = e.rate; break;
      case 'COUNTER':
        def.counter = { perLevelBps: e.rate, damageBps: e.value, rounds: e.duration, scope: e.mode === 'all' ? 'all' : 'single' };
        break;
      case 'SHIELD_BREAK': def.debuff.shieldBreakPerLevelBps = e.value > 0 ? e.value : PVP_SHIELD_BREAK; break;
      case 'REVIVE': def.revive = true; break;
      case 'VS_DEBUFF_BONUS': def.vsDebuffBonusBps = e.value; break;
      case 'SELF_BURN':
        def.selfBurn = true;
        def.selfBurnRounds = e.duration;
        break;
      case 'BURN_CRIT_MUL': def.burnCritMulBps = e.value; break;
      case 'BURN_CRIT_DAMAGE': def.burnCritDamageBps = e.value; break;
      case 'BURN_LIFESTEAL': def.burnLifesteal = true; break;
      case 'DODGE_REACT_COUNTER':
        dodgeReact = { ...(dodgeReact ?? PVP_NO_DODGE_REACT), counterDamageBps: e.value };
        break;
      case 'DODGE_REACT_CRIT_DAMAGE':
        dodgeReact = { ...(dodgeReact ?? PVP_NO_DODGE_REACT), critDamageBps: e.value, maxLayers: e.maxLayers };
        break;
      case 'GUARANTEED_HIT_BELOW_HP': def.guaranteedHitBelowHpBps = e.value; break;
      case 'DEBUFF_BURN':
        def.debuff.burnBps = e.value;
        def.debuff.burnRounds = e.duration;
        def.debuff.burnMaxLayers = e.maxLayers;
        break;
      default: break;
    }
  }
  def.buffs = [...buffByKey.values()];
  if (dodgeReact) def.dodgeReact = dodgeReact;

  return {
    style: input.style,
    skill: input.skill,
    skillName: input.skillName,
    faction: input.faction,
    passive: input.passive,
    hot: input.isHot,
    lifestealPerLevelBps,
    teamLifestealPerLevelBps,
    skillDescription: input.skillDescription,
    baseHp: input.baseHp,
    baseAtk: input.baseAtk,
    baseDef: input.baseDef,
    def,
  };
}
