PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cards (id INTEGER PRIMARY KEY AUTOINCREMENT, card_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active', remaining_interview_seconds INTEGER NOT NULL DEFAULT 0, remaining_written_questions REAL NOT NULL DEFAULT 0, max_devices INTEGER NOT NULL DEFAULT 5, created_at TEXT NOT NULL, activated_at TEXT, expires_at TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS devices (id INTEGER PRIMARY KEY AUTOINCREMENT, card_id INTEGER NOT NULL, device_id TEXT NOT NULL, device_name TEXT, platform TEXT, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, UNIQUE(card_id, device_id), FOREIGN KEY(card_id) REFERENCES cards(id));
CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, card_id INTEGER NOT NULL, device_id TEXT NOT NULL, token_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, last_billed_at TEXT, FOREIGN KEY(card_id) REFERENCES cards(id));
CREATE TABLE IF NOT EXISTS usage_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, card_id INTEGER NOT NULL, device_id TEXT NOT NULL, feature TEXT NOT NULL, action TEXT NOT NULL, cost REAL NOT NULL, model TEXT, success INTEGER NOT NULL, error_message TEXT, request_hash TEXT, created_at TEXT NOT NULL, FOREIGN KEY(card_id) REFERENCES cards(id));
CREATE TABLE IF NOT EXISTS interview_request_logs (request_id TEXT PRIMARY KEY, username TEXT NOT NULL, device_id TEXT NOT NULL DEFAULT '', client_version TEXT NOT NULL DEFAULT '', question_text TEXT NOT NULL DEFAULT '', requested_model TEXT NOT NULL DEFAULT '', final_model TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed')), attempt_count INTEGER NOT NULL DEFAULT 0, retry_count INTEGER NOT NULL DEFAULT 0, error_message TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL, completed_at TEXT);
CREATE TABLE IF NOT EXISTS interview_attempt_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL, attempt_number INTEGER NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed')), error_message TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL, completed_at TEXT, FOREIGN KEY(request_id) REFERENCES interview_request_logs(request_id) ON DELETE CASCADE, UNIQUE(request_id,attempt_number));
CREATE TABLE IF NOT EXISTS written_question_cache (id INTEGER PRIMARY KEY AUTOINCREMENT, card_id INTEGER NOT NULL, question_hash TEXT NOT NULL, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, answer_snapshot TEXT, UNIQUE(card_id, question_hash), FOREIGN KEY(card_id) REFERENCES cards(id));
CREATE TABLE IF NOT EXISTS mobile_pairings (id INTEGER PRIMARY KEY AUTOINCREMENT, card_id INTEGER NOT NULL, desktop_device_id TEXT NOT NULL, pairing_code TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, expires_at TEXT NOT NULL, paired_at TEXT, FOREIGN KEY(card_id) REFERENCES cards(id));
CREATE INDEX IF NOT EXISTS idx_sessions_token_id ON sessions(token_id);
CREATE INDEX IF NOT EXISTS idx_sessions_card_device ON sessions(card_id, device_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_card_created ON usage_logs(card_id, created_at);
CREATE INDEX IF NOT EXISTS idx_interview_request_logs_started ON interview_request_logs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_interview_request_logs_status_started ON interview_request_logs(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_interview_attempt_logs_request ON interview_attempt_logs(request_id, attempt_number);

CREATE TABLE IF NOT EXISTS companion_pairings (id TEXT PRIMARY KEY, card_id INTEGER NOT NULL, desktop_device_id TEXT NOT NULL, ticket_hash TEXT NOT NULL, code_hash TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, claimed_at TEXT, revoked_at TEXT, FOREIGN KEY(card_id) REFERENCES cards(id));
CREATE INDEX IF NOT EXISTS idx_companion_pairings_card_device ON companion_pairings(card_id, desktop_device_id, status);
CREATE TABLE IF NOT EXISTS companion_mobile_sessions (id TEXT PRIMARY KEY, pairing_id TEXT NOT NULL, token_hash TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, revoked_at TEXT, FOREIGN KEY(pairing_id) REFERENCES companion_pairings(id));
CREATE TABLE IF NOT EXISTS companion_capture_requests (id TEXT PRIMARY KEY, pairing_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, completed_at TEXT, request_hash TEXT, FOREIGN KEY(pairing_id) REFERENCES companion_pairings(id));

-- Username/password accounts reuse the existing card-based quota and billing
-- path through a private account card. Public redemption cards transfer their
-- quota into that private card, so legacy card logins remain compatible.
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT COLLATE NOCASE NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    account_card_id INTEGER NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    FOREIGN KEY(account_card_id) REFERENCES cards(id)
);
CREATE TABLE IF NOT EXISTS card_metadata (
    card_id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT 'standard' CHECK(kind IN ('standard','account')),
    FOREIGN KEY(card_id) REFERENCES cards(id)
);
CREATE TABLE IF NOT EXISTS card_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_code TEXT NOT NULL UNIQUE,
    sales_platform TEXT NOT NULL CHECK(sales_platform IN ('taobao','xianyu','liandong','legacy')),
    kind TEXT NOT NULL DEFAULT 'standard' CHECK(kind = 'standard'),
    interview_seconds INTEGER NOT NULL,
    written_questions REAL NOT NULL,
    max_devices INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS card_batch_members (
    batch_id INTEGER NOT NULL,
    card_id INTEGER NOT NULL UNIQUE,
    position INTEGER NOT NULL,
    PRIMARY KEY(batch_id, position),
    FOREIGN KEY(batch_id) REFERENCES card_batches(id),
    FOREIGN KEY(card_id) REFERENCES cards(id)
);
CREATE INDEX IF NOT EXISTS idx_card_batch_members_batch ON card_batch_members(batch_id);
CREATE TABLE IF NOT EXISTS card_batch_names (
    batch_id INTEGER PRIMARY KEY,
    display_name TEXT NOT NULL UNIQUE,
    base_name TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    FOREIGN KEY(batch_id) REFERENCES card_batches(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_card_batch_names_base_sequence ON card_batch_names(base_name, sequence);
CREATE TABLE IF NOT EXISTS card_batch_name_sequences (
    base_name TEXT PRIMARY KEY,
    last_sequence INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS card_redemptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'standard' CHECK(kind = 'standard'),
    interview_seconds INTEGER NOT NULL,
    written_questions REAL NOT NULL,
    redeemed_at TEXT NOT NULL,
    FOREIGN KEY(card_id) REFERENCES cards(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS registration_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_address TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_metadata (
    user_id INTEGER PRIMARY KEY,
    registration_ip TEXT NOT NULL DEFAULT '',
    FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_users_account_card ON users(account_card_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_nocase ON users(username COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_card_redemptions_user ON card_redemptions(user_id, redeemed_at);
CREATE INDEX IF NOT EXISTS idx_registration_events_ip_created ON registration_events(ip_address, created_at);

-- One request row represents one user request; attempt rows preserve the
-- Flash/Pro/Qwen retry chain. A bounded question excerpt is retained for
-- duplicate-trigger diagnosis; answers, resumes, and conversation context are not.
-- Existing final-only usage logs are imported as historical summaries.
INSERT OR IGNORE INTO interview_request_logs(request_id,username,device_id,requested_model,final_model,status,attempt_count,retry_count,error_message,started_at,completed_at)
SELECT 'legacy-usage-'||l.id,COALESCE(u.username,'卡密用户'),l.device_id,'',COALESCE(l.model,''),CASE WHEN l.success=1 THEN 'succeeded' ELSE 'failed' END,1,0,COALESCE(l.error_message,''),l.created_at,l.created_at
FROM usage_logs l LEFT JOIN users u ON u.account_card_id=l.card_id
WHERE l.feature='interview' AND l.action IN ('answer','answer_stream');

-- New-account experience quota is controlled from the administrator console.
-- Grant records are deliberately separate from registration rate limiting: an
-- account may still be created after the free quota limit is reached, but it
-- receives no promotional quota. Device hashes are keyed by the server before
-- storage so a browser or desktop device identifier is never exposed here.
CREATE TABLE IF NOT EXISTS trial_offer_settings (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
    interview_seconds INTEGER NOT NULL DEFAULT 300 CHECK(interview_seconds >= 0),
    written_questions REAL NOT NULL DEFAULT 1 CHECK(written_questions >= 0),
    max_grants_per_ip INTEGER NOT NULL DEFAULT 2 CHECK(max_grants_per_ip >= 1),
    ip_window_hours INTEGER NOT NULL DEFAULT 720 CHECK(ip_window_hours >= 1),
    updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO trial_offer_settings(
    id,enabled,interview_seconds,written_questions,max_grants_per_ip,ip_window_hours,updated_at
) VALUES(1,1,300,1,2,720,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE IF NOT EXISTS trial_grants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    device_hash TEXT NOT NULL UNIQUE,
    ip_address TEXT NOT NULL,
    interview_seconds INTEGER NOT NULL,
    written_questions REAL NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_trial_grants_ip_created ON trial_grants(ip_address, created_at);

-- Lifetime trial-claim history intentionally has no user foreign key. Account
-- deletion must not let the same device or network reclaim new-user quota.
CREATE TABLE IF NOT EXISTS trial_claim_history (
    device_hash TEXT PRIMARY KEY,
    ip_address TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trial_claim_history_ip_created ON trial_claim_history(ip_address, created_at);
INSERT OR IGNORE INTO trial_claim_history(device_hash,ip_address,created_at)
SELECT device_hash,ip_address,created_at FROM trial_grants;

-- Immutable sales facts survive later card or batch deletion. Existing
-- redemptions are copied once when an older database first opens this schema.
CREATE TABLE IF NOT EXISTS sales_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL UNIQUE,
    sales_platform TEXT NOT NULL,
    interview_seconds INTEGER NOT NULL,
    written_questions REAL NOT NULL,
    redeemed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_ledger_redeemed_at ON sales_ledger(redeemed_at);
INSERT OR IGNORE INTO sales_ledger(card_id,sales_platform,interview_seconds,written_questions,redeemed_at)
SELECT r.card_id,COALESCE(b.sales_platform,'legacy'),r.interview_seconds,r.written_questions,r.redeemed_at
FROM card_redemptions r
LEFT JOIN card_batch_members m ON m.card_id=r.card_id
LEFT JOIN card_batches b ON b.id=m.batch_id;

-- The administrator username defaults to admin. The password starts
-- from MIAODA_ADMIN_TOKEN, then moves to this bcrypt hash after the first
-- successful web login. Incrementing the version invalidates every previously
-- issued administrator session.
CREATE TABLE IF NOT EXISTS admin_credentials (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    username TEXT NOT NULL DEFAULT 'admin',
    password_hash TEXT NOT NULL,
    session_version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
);

-- Website analytics deliberately stores only a keyed visitor hash. The raw
-- browser identifier and source IP never enter the database.
CREATE TABLE IF NOT EXISTS site_daily_visitors (
    visit_date TEXT NOT NULL,
    visitor_hash TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    page_views INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY(visit_date, visitor_hash)
);
CREATE INDEX IF NOT EXISTS idx_site_daily_visitors_last_seen ON site_daily_visitors(last_seen_at);

-- Account feedback is kept with the account database so text, protected
-- screenshots, replies, and unread state share the same backup lifecycle.
CREATE TABLE IF NOT EXISTS feedback_threads (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','answered','closed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    user_last_read_at TEXT,
    admin_last_read_at TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS feedback_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id TEXT NOT NULL,
    sender TEXT NOT NULL CHECK(sender IN ('user','admin')),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(thread_id) REFERENCES feedback_threads(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS feedback_attachments (
    id TEXT PRIMARY KEY,
    message_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    data BLOB NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(message_id) REFERENCES feedback_messages(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_feedback_threads_user_updated ON feedback_threads(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_messages_thread_created ON feedback_messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_attachments_message ON feedback_attachments(message_id);

-- Device entitlement belongs to the username/password account, not to any
-- redemption card. Keep this idempotent so existing one-device accounts are
-- upgraded whenever the service opens the database.
UPDATE cards
SET max_devices = 5
WHERE id IN (SELECT account_card_id FROM users)
  AND max_devices <> 5;

-- Browser account sessions must not consume a desktop device slot.
DELETE FROM devices
WHERE platform = 'web'
  AND card_id IN (SELECT account_card_id FROM users);
