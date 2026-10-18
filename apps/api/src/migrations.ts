import type { DatabaseSync } from 'node:sqlite';

/**
 * Migration có version, chạy theo thứ tự, mỗi bản trong 1 transaction.
 * KHÔNG sửa migration đã phát hành — thêm migration mới.
 */
const MIGRATIONS: { version: number; name: string; sql: string; disableForeignKeys?: boolean }[] = [
  {
    version: 1,
    name: 'init',
    sql: `
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE generals (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  faction  TEXT NOT NULL CHECK (faction IN ('wei','shu','wu','qun')),
  art_key  TEXT NOT NULL,
  metadata TEXT
);

CREATE TABLE user_cards (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                INTEGER NOT NULL REFERENCES users(id),
  general_id             TEXT NOT NULL REFERENCES generals(id),
  level                  INTEGER NOT NULL CHECK (level BETWEEN 1 AND 10),
  status                 TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','consumed')),
  consumed_at            TEXT,
  consumed_by_upgrade_id INTEGER,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  CHECK ((status = 'active' AND consumed_at IS NULL) OR (status = 'consumed' AND consumed_at IS NOT NULL))
);
CREATE INDEX idx_cards_user_status ON user_cards(user_id, status);
CREATE INDEX idx_cards_user_general_level ON user_cards(user_id, general_id, level);

CREATE TABLE user_tickets (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  ticket_type TEXT NOT NULL CHECK (ticket_type IN ('normal','shu','wei','wu')),
  balance     INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0 AND balance <= 9007199254740991),
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, ticket_type)
);

CREATE TABLE ticket_recovery_state (
  user_id                    INTEGER PRIMARY KEY REFERENCES users(id),
  last_processed_recovery_at TEXT NOT NULL,
  updated_at                 TEXT NOT NULL
);

CREATE TABLE ticket_transactions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  ticket_type     TEXT NOT NULL CHECK (ticket_type IN ('normal','shu','wei','wu')),
  amount_delta    INTEGER NOT NULL CHECK (amount_delta <> 0),
  reason          TEXT NOT NULL CHECK (reason IN ('time_recovery','gacha_draw')),
  reference_id    TEXT,
  idempotency_key TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_ttx_user ON ticket_transactions(user_id, id);
-- Mỗi mốc hồi chỉ cấp 1 vé cho mỗi người chơi
CREATE UNIQUE INDEX uq_ttx_recovery_slot ON ticket_transactions(user_id, reference_id) WHERE reason = 'time_recovery';

CREATE TABLE gacha_history (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id               INTEGER NOT NULL REFERENCES users(id),
  ticket_type           TEXT NOT NULL,
  general_id            TEXT NOT NULL REFERENCES generals(id),
  card_id               INTEGER NOT NULL REFERENCES user_cards(id),
  card_level            INTEGER NOT NULL CHECK (card_level BETWEEN 1 AND 10),
  ticket_transaction_id INTEGER NOT NULL REFERENCES ticket_transactions(id),
  idempotency_key       TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE upgrade_history (
  id                            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                       INTEGER NOT NULL REFERENCES users(id),
  input_card_ids_snapshot       TEXT NOT NULL,
  input_general_id              TEXT NOT NULL REFERENCES generals(id),
  input_level                   INTEGER NOT NULL CHECK (input_level BETWEEN 1 AND 9),
  result_card_id                INTEGER NOT NULL REFERENCES user_cards(id),
  result_level                  INTEGER NOT NULL CHECK (result_level BETWEEN 1 AND 10),
  success_chance                INTEGER NOT NULL,
  failure_chance                INTEGER NOT NULL,
  outcome                       TEXT NOT NULL CHECK (outcome IN ('success','failure')),
  failure_distribution_snapshot TEXT NOT NULL,
  idempotency_key               TEXT NOT NULL,
  created_at                    TEXT NOT NULL,
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE idempotency_keys (
  user_id       INTEGER NOT NULL REFERENCES users(id),
  action        TEXT NOT NULL,
  key           TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (user_id, action, key)
);
`,
  },
  {
    // Thêm reason 'signup_bonus' (quà đăng ký 100 vé). SQLite không sửa được CHECK,
    // nên dựng lại bảng ledger theo quy trình chuẩn: tạo bảng mới -> copy -> drop -> rename.
    // Giữ nguyên id để gacha_history.ticket_transaction_id vẫn đúng.
    version: 2,
    name: 'ledger_signup_bonus',
    disableForeignKeys: true,
    sql: `
CREATE TABLE ticket_transactions_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  ticket_type     TEXT NOT NULL CHECK (ticket_type IN ('normal','shu','wei','wu')),
  amount_delta    INTEGER NOT NULL CHECK (amount_delta <> 0),
  reason          TEXT NOT NULL CHECK (reason IN ('time_recovery','signup_bonus','gacha_draw')),
  reference_id    TEXT,
  idempotency_key TEXT,
  created_at      TEXT NOT NULL
);
INSERT INTO ticket_transactions_new (id, user_id, ticket_type, amount_delta, reason, reference_id, idempotency_key, created_at)
  SELECT id, user_id, ticket_type, amount_delta, reason, reference_id, idempotency_key, created_at FROM ticket_transactions;
DROP TABLE ticket_transactions;
ALTER TABLE ticket_transactions_new RENAME TO ticket_transactions;
CREATE INDEX idx_ttx_user ON ticket_transactions(user_id, id);
CREATE UNIQUE INDEX uq_ttx_recovery_slot ON ticket_transactions(user_id, reference_id) WHERE reason = 'time_recovery';
-- Quà đăng ký chỉ cấp 1 lần mỗi người chơi (tối đa 1 dòng mỗi loại vé)
CREATE UNIQUE INDEX uq_ttx_signup_bonus ON ticket_transactions(user_id, ticket_type) WHERE reason = 'signup_bonus';
`,
  },
  {
    // Thêm reason 'dev_topup' (nút cộng 50 vé thử nghiệm). Dựng lại bảng ledger như v2, giữ nguyên id & dữ liệu.
    version: 3,
    name: 'ledger_dev_topup',
    disableForeignKeys: true,
    sql: `
CREATE TABLE ticket_transactions_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  ticket_type     TEXT NOT NULL CHECK (ticket_type IN ('normal','shu','wei','wu')),
  amount_delta    INTEGER NOT NULL CHECK (amount_delta <> 0),
  reason          TEXT NOT NULL CHECK (reason IN ('time_recovery','signup_bonus','dev_topup','gacha_draw')),
  reference_id    TEXT,
  idempotency_key TEXT,
  created_at      TEXT NOT NULL
);
INSERT INTO ticket_transactions_new (id, user_id, ticket_type, amount_delta, reason, reference_id, idempotency_key, created_at)
  SELECT id, user_id, ticket_type, amount_delta, reason, reference_id, idempotency_key, created_at FROM ticket_transactions;
DROP TABLE ticket_transactions;
ALTER TABLE ticket_transactions_new RENAME TO ticket_transactions;
CREATE INDEX idx_ttx_user ON ticket_transactions(user_id, id);
CREATE UNIQUE INDEX uq_ttx_recovery_slot ON ticket_transactions(user_id, reference_id) WHERE reason = 'time_recovery';
CREATE UNIQUE INDEX uq_ttx_signup_bonus ON ticket_transactions(user_id, ticket_type) WHERE reason = 'signup_bonus';
-- Mỗi lần bấm nút (1 idempotency key) chỉ cấp 1 lần: tối đa 1 dòng mỗi loại vé cho mỗi reference
CREATE UNIQUE INDEX uq_ttx_dev_topup ON ticket_transactions(user_id, reference_id, ticket_type) WHERE reason = 'dev_topup';
`,
  },
  {
    // Thêm loại vé 'qun' (Vé Quần). Dựng lại user_tickets & ticket_transactions để mở rộng CHECK,
    // giữ nguyên toàn bộ số dư, id ledger và lịch sử. Tài khoản cũ nhận thêm dòng số dư Vé Quần = 0.
    version: 4,
    name: 'ticket_type_qun',
    disableForeignKeys: true,
    sql: `
CREATE TABLE user_tickets_new (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  ticket_type TEXT NOT NULL CHECK (ticket_type IN ('normal','shu','wei','wu','qun')),
  balance     INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0 AND balance <= 9007199254740991),
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, ticket_type)
);
INSERT INTO user_tickets_new (user_id, ticket_type, balance, updated_at)
  SELECT user_id, ticket_type, balance, updated_at FROM user_tickets;
INSERT INTO user_tickets_new (user_id, ticket_type, balance, updated_at)
  SELECT id, 'qun', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM users;
DROP TABLE user_tickets;
ALTER TABLE user_tickets_new RENAME TO user_tickets;

CREATE TABLE ticket_transactions_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  ticket_type     TEXT NOT NULL CHECK (ticket_type IN ('normal','shu','wei','wu','qun')),
  amount_delta    INTEGER NOT NULL CHECK (amount_delta <> 0),
  reason          TEXT NOT NULL CHECK (reason IN ('time_recovery','signup_bonus','dev_topup','gacha_draw')),
  reference_id    TEXT,
  idempotency_key TEXT,
  created_at      TEXT NOT NULL
);
INSERT INTO ticket_transactions_new (id, user_id, ticket_type, amount_delta, reason, reference_id, idempotency_key, created_at)
  SELECT id, user_id, ticket_type, amount_delta, reason, reference_id, idempotency_key, created_at FROM ticket_transactions;
DROP TABLE ticket_transactions;
ALTER TABLE ticket_transactions_new RENAME TO ticket_transactions;
CREATE INDEX idx_ttx_user ON ticket_transactions(user_id, id);
CREATE UNIQUE INDEX uq_ttx_recovery_slot ON ticket_transactions(user_id, reference_id) WHERE reason = 'time_recovery';
CREATE UNIQUE INDEX uq_ttx_signup_bonus ON ticket_transactions(user_id, ticket_type) WHERE reason = 'signup_bonus';
CREATE UNIQUE INDEX uq_ttx_dev_topup ON ticket_transactions(user_id, reference_id, ticket_type) WHERE reason = 'dev_topup';
`,
  },
  {
    // Tặng thẻ (mục 5.6). Thẻ đổi chủ bằng cách cập nhật user_cards.user_id; bảng này lưu lịch sử giao dịch.
    version: 5,
    name: 'card_gifts',
    sql: `
CREATE TABLE card_gifts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id    INTEGER NOT NULL REFERENCES users(id),
  to_user_id      INTEGER NOT NULL REFERENCES users(id),
  cards_snapshot  TEXT NOT NULL,
  card_count      INTEGER NOT NULL CHECK (card_count >= 1),
  idempotency_key TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  CHECK (from_user_id <> to_user_id),
  UNIQUE (from_user_id, idempotency_key)
);
CREATE INDEX idx_gifts_from ON card_gifts(from_user_id, id);
CREATE INDEX idx_gifts_to ON card_gifts(to_user_id, id);
`,
  },
  {
    // Duyệt tài khoản & quản trị (mục 3.8). Tài khoản hiện có được coi là đã duyệt;
    // tài khoản có id nhỏ nhất trở thành admin. Thêm reason ledger 'admin_grant' (admin cộng vé).
    version: 6,
    name: 'user_approval_admin',
    disableForeignKeys: true,
    sql: `
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending','approved'));
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0,1));
ALTER TABLE users ADD COLUMN approved_at TEXT;
UPDATE users SET approved_at = created_at;
UPDATE users SET is_admin = 1 WHERE id = (SELECT MIN(id) FROM users);
CREATE INDEX idx_users_status ON users(status, id);

CREATE TABLE ticket_transactions_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  ticket_type     TEXT NOT NULL CHECK (ticket_type IN ('normal','shu','wei','wu','qun')),
  amount_delta    INTEGER NOT NULL CHECK (amount_delta <> 0),
  reason          TEXT NOT NULL CHECK (reason IN ('time_recovery','signup_bonus','dev_topup','admin_grant','gacha_draw')),
  reference_id    TEXT,
  idempotency_key TEXT,
  created_at      TEXT NOT NULL
);
INSERT INTO ticket_transactions_new (id, user_id, ticket_type, amount_delta, reason, reference_id, idempotency_key, created_at)
  SELECT id, user_id, ticket_type, amount_delta, reason, reference_id, idempotency_key, created_at FROM ticket_transactions;
DROP TABLE ticket_transactions;
ALTER TABLE ticket_transactions_new RENAME TO ticket_transactions;
CREATE INDEX idx_ttx_user ON ticket_transactions(user_id, id);
CREATE UNIQUE INDEX uq_ttx_recovery_slot ON ticket_transactions(user_id, reference_id) WHERE reason = 'time_recovery';
CREATE UNIQUE INDEX uq_ttx_signup_bonus ON ticket_transactions(user_id, ticket_type) WHERE reason = 'signup_bonus';
CREATE UNIQUE INDEX uq_ttx_dev_topup ON ticket_transactions(user_id, reference_id, ticket_type) WHERE reason = 'dev_topup';
-- Mỗi lần admin cộng (1 idempotency key của admin) chỉ ghi 1 lần cho mỗi người chơi
CREATE UNIQUE INDEX uq_ttx_admin_grant ON ticket_transactions(user_id, reference_id, ticket_type) WHERE reason = 'admin_grant';
`,
  },
  {
    // Giftcode (mục 3.9): mỗi người chơi nhập mỗi code đúng 1 lần (UNIQUE code_id, user_id).
    // Tạo sẵn 4 code mặc định, không hạn sử dụng, hiện trong popup người mới.
    version: 7,
    name: 'gift_codes',
    sql: `
CREATE TABLE gift_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  rewards     TEXT NOT NULL,
  total_cards INTEGER NOT NULL CHECK (total_cards >= 1),
  expires_at  TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  featured    INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0,1)),
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL
);

CREATE TABLE gift_code_redemptions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code_id        INTEGER NOT NULL REFERENCES gift_codes(id),
  user_id        INTEGER NOT NULL REFERENCES users(id),
  cards_snapshot TEXT NOT NULL,
  card_count     INTEGER NOT NULL CHECK (card_count >= 1),
  created_at     TEXT NOT NULL,
  UNIQUE (code_id, user_id)
);
CREATE INDEX idx_gcr_user ON gift_code_redemptions(user_id, id);

INSERT INTO gift_codes (code, rewards, total_cards, expires_at, is_active, featured, created_by, created_at) VALUES
  ('THUCQUOC', '[{"pool":"shu","count":200}]', 200, NULL, 1, 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('NGUYQUOC', '[{"pool":"wei","count":200}]', 200, NULL, 1, 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('NGOQUOC',  '[{"pool":"wu","count":200}]',  200, NULL, 1, 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('QUANQUOC', '[{"pool":"qun","count":200}]', 200, NULL, 1, 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
`,
  },
  {
    // Giftcode tặng được VÉ QUAY (chủ dự án yêu cầu: 4 code tân thủ là vé, không phải thẻ).
    // - Ledger thêm reason 'giftcode' (dựng lại bảng, giữ nguyên id và dữ liệu).
    // - gift_code_redemptions: card_count cho phép 0 (code chỉ có vé), thêm tickets_snapshot.
    // - gift_codes: thêm total_tickets, total_cards cho phép 0; 4 code mặc định đổi thành 200 vé mỗi loại.
    //   Lượt nhập cũ (đã nhận thẻ) giữ nguyên, không thu hồi, không cho nhập lại.
    version: 8,
    name: 'gift_codes_tickets',
    disableForeignKeys: true,
    sql: `
CREATE TABLE ticket_transactions_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  ticket_type     TEXT NOT NULL CHECK (ticket_type IN ('normal','shu','wei','wu','qun')),
  amount_delta    INTEGER NOT NULL CHECK (amount_delta <> 0),
  reason          TEXT NOT NULL CHECK (reason IN ('time_recovery','signup_bonus','dev_topup','admin_grant','giftcode','gacha_draw')),
  reference_id    TEXT,
  idempotency_key TEXT,
  created_at      TEXT NOT NULL
);
INSERT INTO ticket_transactions_new (id, user_id, ticket_type, amount_delta, reason, reference_id, idempotency_key, created_at)
  SELECT id, user_id, ticket_type, amount_delta, reason, reference_id, idempotency_key, created_at FROM ticket_transactions;
DROP TABLE ticket_transactions;
ALTER TABLE ticket_transactions_new RENAME TO ticket_transactions;
CREATE INDEX idx_ttx_user ON ticket_transactions(user_id, id);
CREATE UNIQUE INDEX uq_ttx_recovery_slot ON ticket_transactions(user_id, reference_id) WHERE reason = 'time_recovery';
CREATE UNIQUE INDEX uq_ttx_signup_bonus ON ticket_transactions(user_id, ticket_type) WHERE reason = 'signup_bonus';
CREATE UNIQUE INDEX uq_ttx_dev_topup ON ticket_transactions(user_id, reference_id, ticket_type) WHERE reason = 'dev_topup';
CREATE UNIQUE INDEX uq_ttx_admin_grant ON ticket_transactions(user_id, reference_id, ticket_type) WHERE reason = 'admin_grant';
-- Mỗi giftcode cộng vé cho mỗi người chơi đúng 1 lần (reference_id = giftcode:{codeId})
CREATE UNIQUE INDEX uq_ttx_giftcode ON ticket_transactions(user_id, reference_id, ticket_type) WHERE reason = 'giftcode';

CREATE TABLE gift_codes_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  rewards       TEXT NOT NULL,
  total_cards   INTEGER NOT NULL CHECK (total_cards >= 0),
  total_tickets INTEGER NOT NULL DEFAULT 0 CHECK (total_tickets >= 0),
  expires_at    TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  featured      INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0,1)),
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL,
  CHECK (total_cards + total_tickets >= 1)
);
INSERT INTO gift_codes_new (id, code, rewards, total_cards, total_tickets, expires_at, is_active, featured, created_by, created_at)
  SELECT id, code, rewards, total_cards, 0, expires_at, is_active, featured, created_by, created_at FROM gift_codes;
DROP TABLE gift_codes;
ALTER TABLE gift_codes_new RENAME TO gift_codes;
UPDATE gift_codes SET rewards = '[{"kind":"ticket","pool":"shu","count":200}]', total_cards = 0, total_tickets = 200 WHERE code = 'THUCQUOC' AND created_by IS NULL;
UPDATE gift_codes SET rewards = '[{"kind":"ticket","pool":"wei","count":200}]', total_cards = 0, total_tickets = 200 WHERE code = 'NGUYQUOC' AND created_by IS NULL;
UPDATE gift_codes SET rewards = '[{"kind":"ticket","pool":"wu","count":200}]',  total_cards = 0, total_tickets = 200 WHERE code = 'NGOQUOC'  AND created_by IS NULL;
UPDATE gift_codes SET rewards = '[{"kind":"ticket","pool":"qun","count":200}]', total_cards = 0, total_tickets = 200 WHERE code = 'QUANQUOC' AND created_by IS NULL;

CREATE TABLE gift_code_redemptions_new (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  code_id          INTEGER NOT NULL REFERENCES gift_codes(id),
  user_id          INTEGER NOT NULL REFERENCES users(id),
  cards_snapshot   TEXT NOT NULL,
  card_count       INTEGER NOT NULL CHECK (card_count >= 0),
  tickets_snapshot TEXT NOT NULL DEFAULT '[]',
  created_at       TEXT NOT NULL,
  UNIQUE (code_id, user_id)
);
INSERT INTO gift_code_redemptions_new (id, code_id, user_id, cards_snapshot, card_count, tickets_snapshot, created_at)
  SELECT id, code_id, user_id, cards_snapshot, card_count, '[]', created_at FROM gift_code_redemptions;
DROP TABLE gift_code_redemptions;
ALTER TABLE gift_code_redemptions_new RENAME TO gift_code_redemptions;
CREATE INDEX idx_gcr_user ON gift_code_redemptions(user_id, id);
`,
  },
  {
    // Giftcode chỉ tặng vé quay (chủ dự án yêu cầu). Tắt mọi code còn phần thưởng thẻ;
    // lượt nhập và thẻ đã nhận trước đó giữ nguyên.
    version: 9,
    name: 'gift_codes_tickets_only',
    sql: `UPDATE gift_codes SET is_active = 0 WHERE total_cards > 0;`,
  },
  {
    // Cài đặt game do admin chỉnh trên trang Quản trị (thay biến môi trường REQUIRE_APPROVAL).
    // require_approval mặc định '0' (tắt): đăng ký là được duyệt ngay.
    version: 10,
    name: 'app_settings',
    sql: `
CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id)
);
INSERT INTO app_settings (key, value, updated_at) VALUES ('require_approval', '0', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
`,
  },
  {
    // Phiên đăng nhập không hết hạn (chủ dự án yêu cầu): expires_at cho phép NULL (= không hạn).
    // Phiên đang có giữ nguyên token và được bỏ hạn. Đăng xuất xoá phiên.
    version: 11,
    name: 'sessions_no_expiry',
    disableForeignKeys: true,
    sql: `
CREATE TABLE sessions_new (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT
);
INSERT INTO sessions_new (token_hash, user_id, created_at, expires_at) SELECT token_hash, user_id, created_at, NULL FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;
CREATE INDEX idx_sessions_user ON sessions(user_id);
`,
  },
  {
    // Nhiệm vụ hằng ngày, thưởng reset 05:00, điểm danh theo tháng và thành tựu (mục 3.10, chủ dự án yêu cầu).
    // - Ledger thêm reason daily_reset / mission / achievement; unique index chặn cộng 2 lần cùng phần thưởng.
    // - reward_claims: mỗi phần thưởng (khoá) chỉ nhận 1 lần, vĩnh viễn; auto = 1 khi server tự nhận lúc qua ngày.
    // - login_days: ngày game (reset 05:00) và ngày dương lịch Việt Nam người chơi đã vào game.
    // - daily_state: ngày gần nhất đã xử lý cho mỗi người chơi (để chỉ xử lý ngày mới 1 lần).
    // Không đổi dữ liệu cũ; thành tựu tính cả lịch sử cũ.
    version: 12,
    name: 'quests_achievements',
    disableForeignKeys: true,
    sql: `
CREATE TABLE ticket_transactions_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  ticket_type     TEXT NOT NULL CHECK (ticket_type IN ('normal','shu','wei','wu','qun')),
  amount_delta    INTEGER NOT NULL CHECK (amount_delta <> 0),
  reason          TEXT NOT NULL CHECK (reason IN ('time_recovery','signup_bonus','dev_topup','admin_grant','giftcode','gacha_draw','daily_reset','mission','achievement')),
  reference_id    TEXT,
  idempotency_key TEXT,
  created_at      TEXT NOT NULL
);
INSERT INTO ticket_transactions_new (id, user_id, ticket_type, amount_delta, reason, reference_id, idempotency_key, created_at)
  SELECT id, user_id, ticket_type, amount_delta, reason, reference_id, idempotency_key, created_at FROM ticket_transactions;
DROP TABLE ticket_transactions;
ALTER TABLE ticket_transactions_new RENAME TO ticket_transactions;
CREATE INDEX idx_ttx_user ON ticket_transactions(user_id, id);
CREATE UNIQUE INDEX uq_ttx_recovery_slot ON ticket_transactions(user_id, reference_id) WHERE reason = 'time_recovery';
CREATE UNIQUE INDEX uq_ttx_signup_bonus ON ticket_transactions(user_id, ticket_type) WHERE reason = 'signup_bonus';
CREATE UNIQUE INDEX uq_ttx_dev_topup ON ticket_transactions(user_id, reference_id, ticket_type) WHERE reason = 'dev_topup';
CREATE UNIQUE INDEX uq_ttx_admin_grant ON ticket_transactions(user_id, reference_id, ticket_type) WHERE reason = 'admin_grant';
CREATE UNIQUE INDEX uq_ttx_giftcode ON ticket_transactions(user_id, reference_id, ticket_type) WHERE reason = 'giftcode';
CREATE UNIQUE INDEX uq_ttx_quest ON ticket_transactions(user_id, reference_id, ticket_type) WHERE reason IN ('daily_reset','mission','achievement');

CREATE TABLE reward_claims (
  user_id    INTEGER NOT NULL REFERENCES users(id),
  reward_key TEXT NOT NULL,
  auto       INTEGER NOT NULL DEFAULT 0 CHECK (auto IN (0,1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, reward_key)
);
CREATE TABLE login_days (
  user_id    INTEGER NOT NULL REFERENCES users(id),
  kind       TEXT NOT NULL CHECK (kind IN ('game','calendar')),
  day        TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, day)
);
CREATE TABLE daily_state (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id),
  last_game_day TEXT NOT NULL,
  last_cal_date TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_gacha_user_time ON gacha_history(user_id, created_at);
CREATE INDEX idx_upgrade_user_time ON upgrade_history(user_id, created_at);
`,
  },
  {
    // Hồ sơ người chơi (mục 3.11, chủ dự án yêu cầu): tên hiển thị + ảnh đại diện.
    // - display_name mặc định = username (tài khoản cũ lấy luôn username).
    // - avatar: data URL ảnh tự tải (đã thu nhỏ ở client) hoặc đường dẫn chân dung tướng /generals/{artKey}.webp; NULL = mặc định.
    version: 13,
    name: 'user_profile',
    sql: `
ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN avatar TEXT;
UPDATE users SET display_name = username;
`,
  },
  {
    // Đấu trường PvP (mục 6.7 — PVP.md): đội hình 6 tướng + nhật ký trận đấu.
    // - pvp_teams: đội hình đang lưu; mỗi slot một tướng (1–3 hàng trước, 4–6 hàng sau).
    //   Lưu general_id + level (không lưu card_id) để đội hình không hỏng khi thẻ bị tiêu thụ lúc ghép.
    // - pvp_battles: toàn bộ dữ liệu phát lại nằm trong cột data (JSON) để tái dựng kết quả (PVP.md mục 15).
    version: 14,
    name: 'pvp',
    sql: `
CREATE TABLE pvp_teams (
  user_id    INTEGER NOT NULL REFERENCES users(id),
  slot       INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 6),
  general_id TEXT NOT NULL,
  level      INTEGER NOT NULL CHECK (level BETWEEN 1 AND 10),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, slot)
);

CREATE TABLE pvp_battles (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  attacker_id    INTEGER NOT NULL REFERENCES users(id),
  defender_id    INTEGER NOT NULL REFERENCES users(id),
  winner         TEXT NOT NULL CHECK (winner IN ('a','b','draw')),
  rounds         INTEGER NOT NULL,
  attacker_power INTEGER NOT NULL,
  defender_power INTEGER NOT NULL,
  data           TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_pvp_battles_attacker ON pvp_battles(attacker_id, id);
CREATE INDEX idx_pvp_battles_defender ON pvp_battles(defender_id, id);
`,
  },
  {
    // Bảng xếp hạng đổi thước đo từ "điểm theo cấp thẻ" sang Lực chiến (LC) đội hình (mục 6.6/6.7):
    // hai cột lưu LC của đội tấn công/phòng thủ trong từng trận — đổi tên cho khớp ngữ nghĩa.
    version: 15,
    name: 'pvp_battle_lc',
    sql: `
ALTER TABLE pvp_battles RENAME COLUMN attacker_power TO attacker_lc;
ALTER TABLE pvp_battles RENAME COLUMN defender_power TO defender_lc;
`,
  },
  {
    // Ngọc Ngũ Hành (DESIGN PROMPT): vật phẩm rời theo (loại, cấp) ghép 2→1, cộng Chỉ số Nền Ra Trận toàn đội.
    // - user_gems: mỗi viên Ngọc là 1 dòng; 'consumed' = đã dùng làm nguyên liệu ghép (giống user_cards).
    // - gem_merge_history: lịch sử từng lần ghép (dùng chung công thức/tỷ lệ với thẻ Tướng).
    // - pvp_team_gems: Ngọc gắn cho đội hình; tối đa PVP_TEAM_GEM_COUNT = 3 dòng khác loại mỗi người chơi.
    version: 16,
    name: 'gems',
    sql: `
CREATE TABLE user_gems (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id               INTEGER NOT NULL REFERENCES users(id),
  element               TEXT NOT NULL CHECK (element IN ('kim','moc','thuy','hoa','tho')),
  level                 INTEGER NOT NULL CHECK (level BETWEEN 1 AND 10),
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','consumed')),
  consumed_at           TEXT,
  consumed_by_merge_id  INTEGER,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  CHECK ((status = 'active' AND consumed_at IS NULL) OR (status = 'consumed' AND consumed_at IS NOT NULL))
);
CREATE INDEX idx_gems_user_status ON user_gems(user_id, status);
CREATE INDEX idx_gems_user_element_level ON user_gems(user_id, element, level);

CREATE TABLE gem_merge_history (
  id                            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                       INTEGER NOT NULL REFERENCES users(id),
  input_gem_ids_snapshot        TEXT NOT NULL,
  element                       TEXT NOT NULL CHECK (element IN ('kim','moc','thuy','hoa','tho')),
  input_level                   INTEGER NOT NULL CHECK (input_level BETWEEN 1 AND 9),
  result_gem_id                 INTEGER NOT NULL REFERENCES user_gems(id),
  result_level                  INTEGER NOT NULL CHECK (result_level BETWEEN 1 AND 10),
  success_chance                INTEGER NOT NULL,
  failure_chance                INTEGER NOT NULL,
  outcome                       TEXT NOT NULL CHECK (outcome IN ('success','failure')),
  failure_distribution_snapshot TEXT NOT NULL,
  idempotency_key               TEXT NOT NULL,
  created_at                    TEXT NOT NULL,
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE pvp_team_gems (
  user_id    INTEGER NOT NULL REFERENCES users(id),
  element    TEXT NOT NULL CHECK (element IN ('kim','moc','thuy','hoa','tho')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, element)
);
`,
  },
  {
    // Khôi phục bảng Ngọc gắn cho đội hình (người chơi chọn tay tối đa PVP_TEAM_GEM_COUNT = 3 loại).
    // Bản v17 từng drop bảng này khi thử nghiệm cơ chế tự động — nay tạo lại; IF NOT EXISTS để
    // DB chưa từng chạy v17 (bảng còn nguyên từ v16) cũng chạy được.
    version: 18,
    name: 'restore_pvp_team_gems',
    sql: `
CREATE TABLE IF NOT EXISTS pvp_team_gems (
  user_id    INTEGER NOT NULL REFERENCES users(id),
  element    TEXT NOT NULL CHECK (element IN ('kim','moc','thuy','hoa','tho')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, element)
);
`,
  },
  {
    // Chuẩn hóa avatar chân dung tướng cũ: bộ ảnh đổi từ .jpg sang .webp.
    // Chỉ chạm đường dẫn /generals/... (không đụng data URL ảnh tự tải của người chơi).
    version: 19,
    name: 'normalize_avatar_webp',
    sql: `
UPDATE users SET avatar = replace(avatar, '.jpg', '.webp')
  WHERE avatar LIKE '/generals/%.jpg';
`,
  },
  {
    // Cấu hình PvP chỉnh được trên trang Quản trị (mục 6.7 — PVP.md).
    // pvp_heroes: hồ sơ chiến đấu từng tướng (phong cách, nội tại, chỉ số nền Cấp 1, kỹ năng, hiệu ứng).
    // pvp_gems:  bảng Ngũ Hành (chỉ số 1 & 2, giá trị Cấp 1 → Cấp 10) cho từng hệ.
    // Dữ liệu ban đầu do seedPvpConfig() nạp từ config cứng trong game-config.
    version: 20,
    name: 'pvp_config',
    sql: `
CREATE TABLE pvp_heroes (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  faction          TEXT NOT NULL CHECK (faction IN ('wei','shu','wu','qun')),
  is_hot           INTEGER NOT NULL DEFAULT 0 CHECK (is_hot IN (0,1)),
  style            TEXT NOT NULL CHECK (style IN ('attack','defense','support')),
  passive_type     TEXT NOT NULL CHECK (passive_type IN ('CRIT_5','DAMAGE_10','HP_10','DEF_5')),
  base_hp          INTEGER NOT NULL,
  base_atk         INTEGER NOT NULL,
  base_def         INTEGER NOT NULL,
  skill_name       TEXT NOT NULL,
  skill_description TEXT NOT NULL DEFAULT '',
  -- Loại kỹ năng dùng cho hiệu ứng PixiJS/SFX phía client (PvpSkill trong @tq/shared).
  skill            TEXT NOT NULL DEFAULT 'ATTACK' CHECK (skill IN ('ATTACK','STUN','BUFF','HEAL','DEBUFF','BURN','DISPEL','PURIFY','CLEANSE')),
  target_type      TEXT NOT NULL CHECK (target_type IN ('single','lane','back_row','back_single','highest_damage_enemy','front_enemies','all_enemies','all_allies','lowest_ally','front_allies','back_allies')),
  damage_rate      INTEGER NOT NULL,
  skill_effects    TEXT NOT NULL DEFAULT '[]',
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_pvp_heroes_faction ON pvp_heroes(faction);

CREATE TABLE pvp_gems (
  element     TEXT PRIMARY KEY CHECK (element IN ('kim','moc','thuy','hoa','tho')),
  stat1_type  TEXT NOT NULL,
  stat1_min   INTEGER NOT NULL,
  stat1_max   INTEGER NOT NULL,
  stat2_type  TEXT NOT NULL,
  stat2_min   INTEGER NOT NULL,
  stat2_max   INTEGER NOT NULL,
  -- Bảng giá trị ĐẦY ĐỦ 10 cấp dạng JSON [[chỉ số 1, chỉ số 2] × 10] (index 0 = Cấp 1).
  -- Admin chỉ sửa 2 mốc Cấp 1/Cấp 10; cột này giữ nguyên đường cong giữa các cấp của config
  -- gốc (không nội suy tuyến tính) cho tới khi mốc bị đổi thật sự.
  levels      TEXT NOT NULL DEFAULT '[]',
  updated_at  TEXT NOT NULL
);
`,
  },
  {
    // Cấu hình TỈ LỆ QUAY chỉnh trên trang Quản trị: bảng tỉ lệ cấp tướng (Lv1–Lv9) + rớt Ngọc.
    // Một dòng duy nhất (id = 1). Dữ liệu ban đầu do seedGachaConfig() nạp từ config cứng.
    version: 21,
    name: 'gacha_config',
    sql: `
CREATE TABLE gacha_config (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  -- Bảng tỉ lệ cấp tướng khi quay dạng JSON [{ level, bps } × N]; thang 100000 = 100%.
  -- Tỉ lệ rớt Ngọc mỗi lượt quay (bps) và trọng số chọn hệ dạng JSON { kim, moc, thuy, hoa, tho } (bps).
  level_rates       TEXT NOT NULL DEFAULT '[]',
  gem_drop_bps      INTEGER NOT NULL DEFAULT 0,
  gem_type_weights  TEXT NOT NULL DEFAULT '{}',
  updated_at        TEXT NOT NULL
);
`,
  },
  {
    // Chợ thẻ tướng (chủ dự án yêu cầu): người chơi đăng bán thẻ của mình cho người khác mua.
    // - Một dòng = một tin đăng bán MỘT thẻ (tướng + cấp). Thẻ lên chợ bị tiêu thụ khỏi bộ sưu tập
    //   (status 'consumed') nên không dùng được khi đang bán; huỷ tin/mua xong thì tạo lại thẻ cho chủ mới.
    // - price: đơn vị tiền tệ Vàng. Hiện luôn 0 (chủ dự án: "chỉ bán giá 0đ", hệ thống Vàng làm sau)
    //   nên chưa có bảng ví — cột này để sẵn cho lần nâng cấp tới.
    // - status: active (đang bán) / sold (đã bán) / cancelled (người bán huỷ). CHECK giữ nhất quán
    //   giữa status và các mốc thời gian + người mua.
    // - Lịch sử mua/bán đọc thẳng từ bảng này (status='sold'), không cần bảng giao dịch riêng.
    version: 22,
    name: 'market_listings',
    sql: `
CREATE TABLE market_listings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id       INTEGER NOT NULL REFERENCES users(id),
  general_id      TEXT NOT NULL REFERENCES generals(id),
  level           INTEGER NOT NULL CHECK (level BETWEEN 1 AND 10),
  price           INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','sold','cancelled')),
  buyer_id        INTEGER REFERENCES users(id),
  idempotency_key TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  sold_at         TEXT,
  cancelled_at    TEXT,
  CHECK (
    (status = 'active'    AND buyer_id IS NULL     AND sold_at IS NULL     AND cancelled_at IS NULL) OR
    (status = 'sold'      AND buyer_id IS NOT NULL AND sold_at IS NOT NULL AND cancelled_at IS NULL) OR
    (status = 'cancelled' AND buyer_id IS NULL     AND sold_at IS NULL     AND cancelled_at IS NOT NULL)
  ),
  CHECK (buyer_id IS NULL OR buyer_id <> seller_id)
);
-- Duyệt chợ: chỉ lấy tin đang bán, mới nhất trước.
CREATE INDEX idx_market_status ON market_listings(status, id);
CREATE INDEX idx_market_seller ON market_listings(seller_id, id);
CREATE INDEX idx_market_buyer ON market_listings(buyer_id, id);
-- Mỗi lần đăng bán (1 idempotency key) chỉ tạo 1 tin
CREATE UNIQUE INDEX uq_market_seller_key ON market_listings(seller_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
`,
  },
];

/** target: chỉ chạy tới version này (dùng khi test migration). */
export function runMigrations(db: DatabaseSync, target = Infinity): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version),
  );
  for (const m of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
    if (applied.has(m.version) || m.version > target) continue;
    // PRAGMA foreign_keys không đổi được bên trong transaction -> tắt trước, bật lại sau.
    if (m.disableForeignKeys) db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(m.sql);
      if (m.disableForeignKeys) {
        const violations = db.prepare('PRAGMA foreign_key_check').all();
        if (violations.length) throw new Error(`Migration ${m.version}: vi phạm foreign key`);
      }
      db.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?,?,?)').run(
        m.version,
        m.name,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      if (m.disableForeignKeys) db.exec('PRAGMA foreign_keys = ON');
    }
  }
}
