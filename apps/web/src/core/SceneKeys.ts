/**
 * Tên các Scene dùng chung.
 *
 * Dùng object `as const` thay cho `enum` để tuân thủ `erasableSyntaxOnly` trong
 * `tsconfig.base.json`, đồng thời tránh gõ sai chuỗi khi `start`/`launch` scene.
 */
export const SceneKeys = {
  Boot: 'Boot',
  Preload: 'Preload',
  Login: 'Login',
  Shell: 'Shell',
  Collection: 'Collection',
  Draw: 'Draw',
  Upgrade: 'Upgrade',
  Market: 'Market',
  Pvp: 'Pvp',
  Quests: 'Quests',
  Leaderboard: 'Leaderboard',
  History: 'History',
  GiftCode: 'GiftCode',
  Profile: 'Profile',
  Admin: 'Admin',
} as const;

export type SceneKey = (typeof SceneKeys)[keyof typeof SceneKeys];
