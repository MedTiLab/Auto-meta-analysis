import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { stripInternalContextPrefix } from '../utils/sessionFormatting.js';
import { resolveAppDatabasePath } from '../utils/storagePaths.js';
import { decryptSecret, encryptSecret, getSecretLast4 } from '../utils/secretCipher.js';
import { getDefaultAvatarId, isValidAvatarId } from '../../shared/avatarCatalog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ANSI color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    cyan: '\x1b[36m',
    dim: '\x1b[2m',
};

const c = {
    info: (text) => `${colors.cyan}${text}${colors.reset}`,
    bright: (text) => `${colors.bright}${text}${colors.reset}`,
    dim: (text) => `${colors.dim}${text}${colors.reset}`,
};

const META_ANALYSIS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS meta_projects (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    project_id TEXT NOT NULL,
    review_type TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    disease TEXT,
    biomarker TEXT,
    population TEXT,
    index_test TEXT,
    reference_standard TEXT,
    primary_outcome TEXT,
    protocol_json TEXT,
    status TEXT DEFAULT 'draft',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_meta_projects_user ON meta_projects(user_id);
  CREATE INDEX IF NOT EXISTS idx_meta_projects_project ON meta_projects(project_id);

  CREATE TABLE IF NOT EXISTS meta_search_runs (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    meta_project_id TEXT NOT NULL,
    database_name TEXT NOT NULL,
    query_text TEXT NOT NULL,
    result_count INTEGER DEFAULT 0,
    imported_count INTEGER DEFAULT 0,
    raw_response_path TEXT,
    searched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    metadata_json TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (meta_project_id) REFERENCES meta_projects(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_meta_search_runs_user ON meta_search_runs(user_id);
  CREATE INDEX IF NOT EXISTS idx_meta_search_runs_project ON meta_search_runs(meta_project_id);

  CREATE TABLE IF NOT EXISTS meta_screening_decisions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    meta_project_id TEXT NOT NULL,
    reference_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    decision TEXT NOT NULL,
    reason TEXT,
    reviewer TEXT,
    evidence_note TEXT,
    confidence REAL,
    metadata_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(meta_project_id, reference_id, stage),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (meta_project_id) REFERENCES meta_projects(id) ON DELETE CASCADE,
    FOREIGN KEY (reference_id) REFERENCES references_library(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_meta_screening_user ON meta_screening_decisions(user_id);
  CREATE INDEX IF NOT EXISTS idx_meta_screening_project ON meta_screening_decisions(meta_project_id);
  CREATE INDEX IF NOT EXISTS idx_meta_screening_reference ON meta_screening_decisions(reference_id);

  CREATE TABLE IF NOT EXISTS meta_pdf_assets (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    meta_project_id TEXT NOT NULL,
    reference_id TEXT NOT NULL,
    source TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'not_checked',
    file_path TEXT,
    sha256 TEXT,
    license_status TEXT,
    asset_type TEXT DEFAULT 'pdf',
    content_type TEXT,
    original_filename TEXT,
    source_url TEXT,
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(meta_project_id, reference_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (meta_project_id) REFERENCES meta_projects(id) ON DELETE CASCADE,
    FOREIGN KEY (reference_id) REFERENCES references_library(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_meta_pdf_assets_user ON meta_pdf_assets(user_id);
  CREATE INDEX IF NOT EXISTS idx_meta_pdf_assets_project ON meta_pdf_assets(meta_project_id);
  CREATE INDEX IF NOT EXISTS idx_meta_pdf_assets_reference ON meta_pdf_assets(reference_id);
  CREATE INDEX IF NOT EXISTS idx_meta_pdf_assets_status ON meta_pdf_assets(status);

  CREATE TABLE IF NOT EXISTS meta_parsed_documents (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    meta_project_id TEXT NOT NULL,
    reference_id TEXT NOT NULL,
    pdf_asset_id TEXT,
    parser TEXT NOT NULL DEFAULT 'mineru',
    status TEXT NOT NULL DEFAULT 'pending',
    markdown_path TEXT,
    tables_path TEXT,
    figures_dir TEXT,
    page_map_path TEXT,
    parse_report_path TEXT,
    quality_score REAL,
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(meta_project_id, reference_id, parser),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (meta_project_id) REFERENCES meta_projects(id) ON DELETE CASCADE,
    FOREIGN KEY (reference_id) REFERENCES references_library(id) ON DELETE CASCADE,
    FOREIGN KEY (pdf_asset_id) REFERENCES meta_pdf_assets(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_meta_parsed_docs_user ON meta_parsed_documents(user_id);
  CREATE INDEX IF NOT EXISTS idx_meta_parsed_docs_project ON meta_parsed_documents(meta_project_id);
  CREATE INDEX IF NOT EXISTS idx_meta_parsed_docs_reference ON meta_parsed_documents(reference_id);
  CREATE INDEX IF NOT EXISTS idx_meta_parsed_docs_status ON meta_parsed_documents(status);

  CREATE TABLE IF NOT EXISTS meta_extraction_results (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    meta_project_id TEXT NOT NULL,
    reference_id TEXT NOT NULL,
    extraction_type TEXT NOT NULL,
    field_name TEXT NOT NULL,
    value_json TEXT,
    evidence_text TEXT,
    evidence_location TEXT,
    page INTEGER,
    table_label TEXT,
    confidence REAL,
    review_status TEXT DEFAULT 'candidate',
    reviewer_note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (meta_project_id) REFERENCES meta_projects(id) ON DELETE CASCADE,
    FOREIGN KEY (reference_id) REFERENCES references_library(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_meta_extraction_user ON meta_extraction_results(user_id);
  CREATE INDEX IF NOT EXISTS idx_meta_extraction_project ON meta_extraction_results(meta_project_id);
  CREATE INDEX IF NOT EXISTS idx_meta_extraction_reference ON meta_extraction_results(reference_id);
  CREATE INDEX IF NOT EXISTS idx_meta_extraction_status ON meta_extraction_results(review_status);

  CREATE TABLE IF NOT EXISTS meta_analysis_runs (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    meta_project_id TEXT NOT NULL,
    analysis_type TEXT NOT NULL,
    model TEXT,
    input_dataset_path TEXT,
    script_path TEXT,
    output_json_path TEXT,
    figures_json TEXT,
    status TEXT DEFAULT 'pending',
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (meta_project_id) REFERENCES meta_projects(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_meta_analysis_runs_user ON meta_analysis_runs(user_id);
  CREATE INDEX IF NOT EXISTS idx_meta_analysis_runs_project ON meta_analysis_runs(meta_project_id);
  CREATE INDEX IF NOT EXISTS idx_meta_analysis_runs_status ON meta_analysis_runs(status);

  CREATE TABLE IF NOT EXISTS meta_manuscript_sections (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    meta_project_id TEXT NOT NULL,
    section_key TEXT NOT NULL,
    content_markdown TEXT,
    source_json TEXT,
    version INTEGER DEFAULT 1,
    review_status TEXT DEFAULT 'draft',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(meta_project_id, section_key, version),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (meta_project_id) REFERENCES meta_projects(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_meta_manuscript_user ON meta_manuscript_sections(user_id);
  CREATE INDEX IF NOT EXISTS idx_meta_manuscript_project ON meta_manuscript_sections(meta_project_id);
  CREATE INDEX IF NOT EXISTS idx_meta_manuscript_section ON meta_manuscript_sections(section_key);

  CREATE TABLE IF NOT EXISTS meta_zotero_exports (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    meta_project_id TEXT NOT NULL,
    reference_id TEXT NOT NULL,
    zotero_item_key TEXT,
    zotero_attachment_key TEXT,
    collection_key TEXT,
    review_collection_key TEXT,
    status TEXT DEFAULT 'pending',
    missing_attachment BOOLEAN DEFAULT 0,
    error TEXT,
    metadata_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(meta_project_id, reference_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (meta_project_id) REFERENCES meta_projects(id) ON DELETE CASCADE,
    FOREIGN KEY (reference_id) REFERENCES references_library(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_meta_zotero_exports_user ON meta_zotero_exports(user_id);
  CREATE INDEX IF NOT EXISTS idx_meta_zotero_exports_project ON meta_zotero_exports(meta_project_id);
  CREATE INDEX IF NOT EXISTS idx_meta_zotero_exports_reference ON meta_zotero_exports(reference_id);
  CREATE INDEX IF NOT EXISTS idx_meta_zotero_exports_item ON meta_zotero_exports(zotero_item_key);
  CREATE INDEX IF NOT EXISTS idx_meta_zotero_exports_status ON meta_zotero_exports(status);
`;

const META_EVIDENCE_LEDGER_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS meta_evidence_artifacts (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    meta_project_id TEXT NOT NULL,
    type TEXT NOT NULL,
    version INTEGER NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    produced_by TEXT NOT NULL DEFAULT 'panel',
    inputs_json TEXT NOT NULL DEFAULT '[]',
    content_hash TEXT NOT NULL,
    payload_json TEXT,
    blob_ref TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    validation_json TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_meta_evidence_artifacts_project_type
    ON meta_evidence_artifacts(meta_project_id, type);
  CREATE INDEX IF NOT EXISTS idx_meta_evidence_artifacts_status
    ON meta_evidence_artifacts(meta_project_id, status);

  CREATE TABLE IF NOT EXISTS meta_evidence_artifact_edges (
    from_artifact_id TEXT NOT NULL,
    to_artifact_id TEXT NOT NULL,
    PRIMARY KEY (from_artifact_id, to_artifact_id),
    FOREIGN KEY (from_artifact_id) REFERENCES meta_evidence_artifacts(id) ON DELETE CASCADE,
    FOREIGN KEY (to_artifact_id) REFERENCES meta_evidence_artifacts(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_meta_evidence_edges_from
    ON meta_evidence_artifact_edges(from_artifact_id);
`;

const META_SURVEILLANCE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS meta_surveillance_subscriptions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    meta_project_id TEXT NOT NULL,
    search_strategy_json TEXT NOT NULL DEFAULT '{}',
    eligibility_json TEXT NOT NULL DEFAULT '{}',
    frequency TEXT NOT NULL DEFAULT 'weekly',
    status TEXT NOT NULL DEFAULT 'active',
    last_run_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_meta_surveillance_subs_project
    ON meta_surveillance_subscriptions(meta_project_id);

  CREATE TABLE IF NOT EXISTS meta_surveillance_runs (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    meta_project_id TEXT NOT NULL,
    subscription_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    stats_json TEXT NOT NULL DEFAULT '{}',
    change_set_json TEXT,
    started_at DATETIME,
    finished_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_meta_surveillance_runs_project
    ON meta_surveillance_runs(meta_project_id);
`;

const DEFAULT_LEGACY_STAGE_TAGS = [
  { tagKey: 'literature', label: 'Literature', color: 'sky', sortOrder: 10 },
  { tagKey: 'ideation', label: 'Ideation', color: 'amber', sortOrder: 20 },
  { tagKey: 'experiment', label: 'Experiment', color: 'cyan', sortOrder: 30 },
  { tagKey: 'publication', label: 'Publication', color: 'purple', sortOrder: 40 },
  { tagKey: 'promotion', label: 'Promotion', color: 'pink', sortOrder: 50 },
];
const DEFAULT_META_STAGE_TAGS = [
  { tagKey: 'protocol', label: 'Protocol / PICO', color: 'emerald', sortOrder: 110 },
  { tagKey: 'search_dedupe', label: 'Search / Dedupe', color: 'sky', sortOrder: 120 },
  { tagKey: 'title_abstract_screening', label: 'Title / Abstract Screening', color: 'cyan', sortOrder: 130 },
  { tagKey: 'full_text_review', label: 'Full-text Review', color: 'teal', sortOrder: 140 },
  { tagKey: 'data_extraction', label: 'Data Extraction', color: 'lime', sortOrder: 150 },
  { tagKey: 'quality_assessment', label: 'Quality Assessment', color: 'amber', sortOrder: 160 },
  { tagKey: 'data_analysis', label: 'Data Analysis', color: 'indigo', sortOrder: 170 },
  { tagKey: 'results_figures', label: 'Results / Figures', color: 'violet', sortOrder: 180 },
  { tagKey: 'manuscript_submission', label: 'Manuscript / Submission', color: 'purple', sortOrder: 190 },
  { tagKey: 'presentation', label: 'Presentation', color: 'pink', sortOrder: 200 },
];
const DEFAULT_STAGE_TAGS = [
  ...DEFAULT_LEGACY_STAGE_TAGS,
  ...DEFAULT_META_STAGE_TAGS,
];
const STAGE_TAG_DECISIONS_KEY = 'stageTagDecisions';
const USER_PREFERENCE_MEMORY_MAX_ITEMS = 20;
const USER_PREFERENCE_MEMORY_CATEGORIES = new Set(['general', 'preference', 'context', 'workflow']);
const USER_PREFERENCE_MEMORY_SCOPES = new Set(['user', 'meta', 'project']);
const USER_FEEDBACK_CATEGORIES = new Set(['suggestion', 'bug', 'question', 'other']);
const USER_FEEDBACK_MAX_TITLE_LENGTH = 120;
const USER_FEEDBACK_MAX_CONTENT_LENGTH = 4000;
const USER_FEEDBACK_MAX_CONTACT_LENGTH = 200;
const USER_FEEDBACK_MAX_URL_LENGTH = 500;
const USER_FEEDBACK_MAX_USER_AGENT_LENGTH = 500;
const PROJECT_ACTIVITY_DEFAULT_DAYS = 365;
const PROJECT_ACTIVITY_MAX_DAYS = 366;
const PROJECT_ACTIVITY_MS_PER_DAY = 24 * 60 * 60 * 1000;

function hasAgentApiAccess(user) {
  return Boolean(user);
}

// Use DATABASE_PATH if provided, otherwise default to the home-scoped app data directory.
const DB_PATH = process.env.DATABASE_PATH || resolveAppDatabasePath();
const INIT_SQL_PATH = path.join(__dirname, 'init.sql');

// Ensure the chosen database directory exists before we attempt migrations or open the DB.
const dbDir = path.dirname(DB_PATH);
try {
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log(`Created database directory: ${dbDir}`);
  }
} catch (error) {
  console.error(`Failed to create database directory ${dbDir}:`, error.message);
  throw error;
}

// Migrate the legacy repo-local DB into the selected runtime location when present.
const LEGACY_DB_PATH = path.join(__dirname, 'auth.db');
if (DB_PATH !== LEGACY_DB_PATH && !fs.existsSync(DB_PATH) && fs.existsSync(LEGACY_DB_PATH)) {
  try {
    fs.copyFileSync(LEGACY_DB_PATH, DB_PATH);
    console.log(`[MIGRATION] Copied database from ${LEGACY_DB_PATH} to ${DB_PATH}`);
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(LEGACY_DB_PATH + suffix)) {
        fs.copyFileSync(LEGACY_DB_PATH + suffix, DB_PATH + suffix);
      }
    }
  } catch (err) {
    console.warn(`[MIGRATION] Could not copy legacy database: ${err.message}`);
  }
}

// Create database connection
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

// Show app installation path prominently
const appInstallPath = path.join(__dirname, '../..');
console.log('');
console.log(c.dim('═'.repeat(60)));
console.log(`${c.info('[INFO]')} App Installation: ${c.bright(appInstallPath)}`);
console.log(`${c.info('[INFO]')} Database: ${c.dim(path.relative(appInstallPath, DB_PATH))}`);
if (process.env.DATABASE_PATH) {
  console.log(`       ${c.dim('(Using custom DATABASE_PATH from environment)')}`);
}
console.log(c.dim('═'.repeat(60)));
console.log('');

const runMigrations = () => {
  try {
    db.exec(META_ANALYSIS_SCHEMA_SQL);
    db.exec(META_EVIDENCE_LEDGER_SCHEMA_SQL);
    db.exec(META_SURVEILLANCE_SCHEMA_SQL);
    db.exec(`
      CREATE TABLE IF NOT EXISTS registration_invite_code_uses (
        code_hash TEXT PRIMARY KEY,
        used_by_user_id INTEGER,
        used_by_username TEXT,
        used_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_registration_invite_code_uses_user
        ON registration_invite_code_uses(used_by_user_id);

      CREATE TABLE IF NOT EXISTS registration_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        notification_email TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        review_token_hash TEXT UNIQUE NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        reviewed_at DATETIME,
        approved_user_id INTEGER,
        reviewer_note TEXT,
        request_ip TEXT,
        user_agent TEXT,
        FOREIGN KEY (approved_user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_registration_requests_status ON registration_requests(status);
      CREATE INDEX IF NOT EXISTS idx_registration_requests_email ON registration_requests(notification_email);
      CREATE INDEX IF NOT EXISTS idx_registration_requests_username ON registration_requests(username);

      CREATE TABLE IF NOT EXISTS membership_upgrade_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        current_plan TEXT NOT NULL DEFAULT 'free',
        requested_plan TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        reviewed_at DATETIME,
        reviewer_note TEXT,
        request_ip TEXT,
        user_agent TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_membership_upgrade_requests_status ON membership_upgrade_requests(status);
      CREATE INDEX IF NOT EXISTS idx_membership_upgrade_requests_user ON membership_upgrade_requests(user_id);
      CREATE INDEX IF NOT EXISTS idx_membership_upgrade_requests_requested ON membership_upgrade_requests(requested_plan);
    `);

    const tableInfo = db.prepare("PRAGMA table_info(users)").all();
    const columnNames = tableInfo.map(col => col.name);

    if (!columnNames.includes('git_name')) {
      console.log('Running migration: Adding git_name column');
      db.exec('ALTER TABLE users ADD COLUMN git_name TEXT');
    }

    if (!columnNames.includes('git_email')) {
      console.log('Running migration: Adding git_email column');
      db.exec('ALTER TABLE users ADD COLUMN git_email TEXT');
    }

    if (!columnNames.includes('has_completed_onboarding')) {
      console.log('Running migration: Adding has_completed_onboarding column');
      db.exec('ALTER TABLE users ADD COLUMN has_completed_onboarding BOOLEAN DEFAULT 1');
    }

    // Onboarding is optional, so never block access on legacy/local installs.
    db.exec('UPDATE users SET has_completed_onboarding = 1 WHERE COALESCE(has_completed_onboarding, 0) = 0');

    if (!columnNames.includes('notification_email')) {
      console.log('Running migration: Adding notification_email column');
      db.exec('ALTER TABLE users ADD COLUMN notification_email TEXT');
    }

    if (!columnNames.includes('avatar_id')) {
      console.log('Running migration: Adding avatar_id column');
      db.exec('ALTER TABLE users ADD COLUMN avatar_id TEXT');
    }

    const usersWithMissingAvatars = db.prepare(`
      SELECT id, username, avatar_id
      FROM users
      WHERE avatar_id IS NULL OR avatar_id = ''
    `).all();

    const usersWithInvalidAvatars = db.prepare(`
      SELECT id, username, avatar_id
      FROM users
      WHERE avatar_id IS NOT NULL AND avatar_id != ''
    `).all().filter((user) => !isValidAvatarId(user.avatar_id));

    const avatarUpdateStmt = db.prepare('UPDATE users SET avatar_id = ? WHERE id = ?');
    for (const user of [...usersWithMissingAvatars, ...usersWithInvalidAvatars]) {
      avatarUpdateStmt.run(getDefaultAvatarId(`${user.id}:${user.username}`), user.id);
    }

    if (!columnNames.includes('memory_enabled')) {
      console.log('Running migration: Adding memory_enabled column');
      db.exec('ALTER TABLE users ADD COLUMN memory_enabled BOOLEAN DEFAULT 1');
    }

    if (!columnNames.includes('agent_api_enabled')) {
      console.log('Running migration: Adding agent_api_enabled column');
      db.exec('ALTER TABLE users ADD COLUMN agent_api_enabled BOOLEAN DEFAULT 0');
    }

    if (!columnNames.includes('membership_plan')) {
      console.log('Running migration: Adding membership_plan column');
      db.exec("ALTER TABLE users ADD COLUMN membership_plan TEXT DEFAULT 'free'");
      db.exec("UPDATE users SET membership_plan = 'free' WHERE membership_plan IS NULL OR membership_plan = ''");
    }

    if (!columnNames.includes('usage_quota_bytes')) {
      console.log('Running migration: Adding usage_quota_bytes column');
      db.exec('ALTER TABLE users ADD COLUMN usage_quota_bytes INTEGER');
    }

    if (!columnNames.includes('usage_baseline_bytes')) {
      console.log('Running migration: Adding usage_baseline_bytes column');
      db.exec('ALTER TABLE users ADD COLUMN usage_baseline_bytes INTEGER DEFAULT 0');
      db.exec('UPDATE users SET usage_baseline_bytes = 0 WHERE usage_baseline_bytes IS NULL');
    }

    if (!columnNames.includes('usage_baseline_updated_at')) {
      console.log('Running migration: Adding usage_baseline_updated_at column');
      db.exec('ALTER TABLE users ADD COLUMN usage_baseline_updated_at DATETIME');
    }

    if (!columnNames.includes('trial_started_at')) {
      console.log('Running migration: Adding trial_started_at column');
      db.exec('ALTER TABLE users ADD COLUMN trial_started_at DATETIME');
      db.exec('UPDATE users SET trial_started_at = COALESCE(created_at, CURRENT_TIMESTAMP) WHERE trial_started_at IS NULL');
    }

    if (!columnNames.includes('trial_expires_at')) {
      console.log('Running migration: Adding trial_expires_at column');
      db.exec('ALTER TABLE users ADD COLUMN trial_expires_at DATETIME');
    }

    const userMemoriesInfo = db.prepare("PRAGMA table_info(user_memories)").all();
    const userMemoriesColumns = userMemoriesInfo.map((column) => column.name);
    if (userMemoriesInfo.length > 0 && !userMemoriesColumns.includes('scope')) {
      console.log('Running migration: Adding scope column to user_memories');
      db.exec("ALTER TABLE user_memories ADD COLUMN scope TEXT DEFAULT 'user'");
    }
    if (userMemoriesInfo.length > 0 && !userMemoriesColumns.includes('project_path')) {
      console.log('Running migration: Adding project_path column to user_memories');
      db.exec('ALTER TABLE user_memories ADD COLUMN project_path TEXT');
    }

    // Migration: add FK from project_references.project_id → projects(id)
    const prInfo = db.prepare("PRAGMA table_info(project_references)").all();
    if (prInfo.length > 0) {
      const fkList = db.prepare("PRAGMA foreign_key_list(project_references)").all();
      const hasProjectFk = fkList.some(fk => fk.table === 'projects');
      if (!hasProjectFk) {
        console.log('Running migration: Recreating project_references with FK to projects');
        db.exec(`
          CREATE TABLE IF NOT EXISTS project_references_new (
            project_id TEXT NOT NULL,
            reference_id TEXT NOT NULL,
            added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(project_id, reference_id),
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            FOREIGN KEY (reference_id) REFERENCES references_library(id) ON DELETE CASCADE
          );
          INSERT OR IGNORE INTO project_references_new (project_id, reference_id, added_at)
            SELECT project_id, reference_id, added_at FROM project_references;
          DROP TABLE project_references;
          ALTER TABLE project_references_new RENAME TO project_references;
          CREATE INDEX IF NOT EXISTS idx_project_references_project ON project_references(project_id);
        `);
      }
    }

    const referenceLibraryInfo = db.prepare("PRAGMA table_info(references_library)").all();
    const referenceLibraryColumns = referenceLibraryInfo.map((column) => column.name);
    if (referenceLibraryInfo.length > 0 && !referenceLibraryColumns.includes('library_visible')) {
      console.log('Running migration: Separating project screening corpus from personal literature library');
      db.exec('ALTER TABLE references_library ADD COLUMN library_visible INTEGER DEFAULT 1');
      db.exec(`
        UPDATE references_library
        SET library_visible = 0
        WHERE source LIKE 'meta_search_%'
           OR (
             json_valid(raw_data) = 1
             AND json_extract(raw_data, '$.syncedFrom') IS NOT NULL
           )
           OR (
             source = 'pubmed'
             AND json_valid(raw_data) = 1
             AND json_type(raw_data, '$.raw') IS NOT NULL
           )
      `);
    }
    if (referenceLibraryInfo.length > 0) {
      db.exec('CREATE INDEX IF NOT EXISTS idx_references_library_visible ON references_library(user_id, library_visible)');
    }

    const metaScreeningInfo = db.prepare("PRAGMA table_info(meta_screening_decisions)").all();
    const metaScreeningColumns = metaScreeningInfo.map((column) => column.name);
    if (metaScreeningInfo.length > 0 && !metaScreeningColumns.includes('confidence')) {
      console.log('Running migration: Adding confidence column to meta_screening_decisions');
      db.exec('ALTER TABLE meta_screening_decisions ADD COLUMN confidence REAL');
    }
    if (metaScreeningInfo.length > 0 && !metaScreeningColumns.includes('metadata_json')) {
      console.log('Running migration: Adding metadata_json column to meta_screening_decisions');
      db.exec('ALTER TABLE meta_screening_decisions ADD COLUMN metadata_json TEXT');
    }

    const metaPdfAssetInfo = db.prepare("PRAGMA table_info(meta_pdf_assets)").all();
    const metaPdfAssetColumns = metaPdfAssetInfo.map((column) => column.name);
    if (metaPdfAssetInfo.length > 0 && !metaPdfAssetColumns.includes('asset_type')) {
      console.log('Running migration: Adding asset_type column to meta_pdf_assets');
      db.exec("ALTER TABLE meta_pdf_assets ADD COLUMN asset_type TEXT DEFAULT 'pdf'");
    }
    if (metaPdfAssetInfo.length > 0 && !metaPdfAssetColumns.includes('content_type')) {
      console.log('Running migration: Adding content_type column to meta_pdf_assets');
      db.exec('ALTER TABLE meta_pdf_assets ADD COLUMN content_type TEXT');
    }
    if (metaPdfAssetInfo.length > 0 && !metaPdfAssetColumns.includes('original_filename')) {
      console.log('Running migration: Adding original_filename column to meta_pdf_assets');
      db.exec('ALTER TABLE meta_pdf_assets ADD COLUMN original_filename TEXT');
    }
    if (metaPdfAssetInfo.length > 0 && !metaPdfAssetColumns.includes('source_url')) {
      console.log('Running migration: Adding source_url column to meta_pdf_assets');
      db.exec('ALTER TABLE meta_pdf_assets ADD COLUMN source_url TEXT');
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS meta_zotero_exports (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        meta_project_id TEXT NOT NULL,
        reference_id TEXT NOT NULL,
        zotero_item_key TEXT,
        zotero_attachment_key TEXT,
        collection_key TEXT,
        review_collection_key TEXT,
        status TEXT DEFAULT 'pending',
        missing_attachment BOOLEAN DEFAULT 0,
        error TEXT,
        metadata_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(meta_project_id, reference_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (meta_project_id) REFERENCES meta_projects(id) ON DELETE CASCADE,
        FOREIGN KEY (reference_id) REFERENCES references_library(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_meta_zotero_exports_user ON meta_zotero_exports(user_id);
      CREATE INDEX IF NOT EXISTS idx_meta_zotero_exports_project ON meta_zotero_exports(meta_project_id);
      CREATE INDEX IF NOT EXISTS idx_meta_zotero_exports_reference ON meta_zotero_exports(reference_id);
      CREATE INDEX IF NOT EXISTS idx_meta_zotero_exports_item ON meta_zotero_exports(zotero_item_key);
      CREATE INDEX IF NOT EXISTS idx_meta_zotero_exports_status ON meta_zotero_exports(status);
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS user_memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        category TEXT DEFAULT 'general',
        scope TEXT DEFAULT 'user',
        project_path TEXT,
        is_enabled BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_user_memories_user_id ON user_memories(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_memories_enabled ON user_memories(user_id, is_enabled);
      CREATE INDEX IF NOT EXISTS idx_user_memories_project_scope ON user_memories(user_id, scope, project_path);

      CREATE TABLE IF NOT EXISTS user_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        category TEXT NOT NULL DEFAULT 'suggestion',
        title TEXT,
        content TEXT NOT NULL,
        contact TEXT,
        page_url TEXT,
        user_agent TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        metadata_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_user_feedback_user_id ON user_feedback(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_feedback_status ON user_feedback(status);
      CREATE INDEX IF NOT EXISTS idx_user_feedback_created_at ON user_feedback(created_at);

      CREATE TABLE IF NOT EXISTS agent_api_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_user_id INTEGER,
        scope TEXT NOT NULL DEFAULT 'user',
        name TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'anthropic',
        auth_type TEXT NOT NULL DEFAULT 'api_key',
        encrypted_secret TEXT,
        secret_last4 TEXT,
        base_url TEXT,
        runtime_model TEXT,
        model_plan TEXT DEFAULT 'all',
        is_active BOOLEAN DEFAULT 1,
        is_default BOOLEAN DEFAULT 0,
        priority INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_agent_api_profiles_owner ON agent_api_profiles(owner_user_id);
      CREATE INDEX IF NOT EXISTS idx_agent_api_profiles_scope ON agent_api_profiles(scope);
      CREATE INDEX IF NOT EXISTS idx_agent_api_profiles_active ON agent_api_profiles(is_active);

      CREATE TABLE IF NOT EXISTS agent_api_profile_selections (
        user_id INTEGER PRIMARY KEY,
        selected_profile_id INTEGER,
        mode TEXT NOT NULL DEFAULT 'system_auto',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (selected_profile_id) REFERENCES agent_api_profiles(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS agent_tool_permissions (
        user_id INTEGER NOT NULL,
        provider TEXT NOT NULL DEFAULT 'claude',
        allowed_tools_json TEXT NOT NULL DEFAULT '[]',
        disallowed_tools_json TEXT NOT NULL DEFAULT '[]',
        skip_permissions BOOLEAN DEFAULT 0,
        project_sort_order TEXT DEFAULT 'date',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, provider),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_agent_tool_permissions_provider ON agent_tool_permissions(provider);

      CREATE TABLE IF NOT EXISTS project_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        tag_key TEXT NOT NULL,
        tag_type TEXT NOT NULL,
        label TEXT NOT NULL,
        color TEXT,
        sort_order INTEGER DEFAULT 0,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_name, tag_type, tag_key)
      );
      CREATE INDEX IF NOT EXISTS idx_project_tags_project ON project_tags(project_name);
      CREATE INDEX IF NOT EXISTS idx_project_tags_type ON project_tags(tag_type);
      CREATE TABLE IF NOT EXISTS session_tag_links (
        session_id TEXT NOT NULL,
        tag_id INTEGER NOT NULL,
        linked_by TEXT,
        source TEXT,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(session_id, tag_id),
        FOREIGN KEY (session_id) REFERENCES session_metadata(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES project_tags(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_session_tag_links_session ON session_tag_links(session_id);
      CREATE INDEX IF NOT EXISTS idx_session_tag_links_tag ON session_tag_links(tag_id);

      CREATE TABLE IF NOT EXISTS project_activity_events (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        project_id TEXT NOT NULL,
        project_path TEXT,
        event_type TEXT NOT NULL DEFAULT 'project_open',
        occurred_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        metadata_json TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_project_activity_user_time ON project_activity_events(user_id, occurred_at);
      CREATE INDEX IF NOT EXISTS idx_project_activity_user_project ON project_activity_events(user_id, project_id);

      CREATE TABLE IF NOT EXISTS med_library_report_preview (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        project_name TEXT NOT NULL,
        project_display_name TEXT,
        relative_path TEXT NOT NULL,
        title TEXT,
        kb_upload_relative_path TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, project_name, relative_path),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ml_report_preview_user ON med_library_report_preview(user_id);

      CREATE TABLE IF NOT EXISTS med_library_core_rules (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        rule_slug TEXT NOT NULL,
        title TEXT NOT NULL,
        category TEXT,
        summary TEXT,
        trigger TEXT,
        correct_pattern TEXT,
        stage_hints_json TEXT,
        severity TEXT DEFAULT 'medium',
        status TEXT DEFAULT 'confirmed',
        source_kind TEXT DEFAULT 'lesson',
        metadata_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, rule_slug),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ml_core_rules_user ON med_library_core_rules(user_id);
      CREATE INDEX IF NOT EXISTS idx_ml_core_rules_status ON med_library_core_rules(user_id, status);

      CREATE TABLE IF NOT EXISTS med_library_operating_assets (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        asset_type TEXT NOT NULL,
        title TEXT NOT NULL,
        stage_key TEXT,
        stage_label TEXT,
        description TEXT,
        content_json TEXT NOT NULL,
        metadata_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ml_operating_assets_user ON med_library_operating_assets(user_id);
      CREATE INDEX IF NOT EXISTS idx_ml_operating_assets_type ON med_library_operating_assets(user_id, asset_type);

      CREATE TABLE IF NOT EXISTS pubmed_discovery_state (
        user_id INTEGER NOT NULL,
        state_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, state_key),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_pubmed_discovery_state_user ON pubmed_discovery_state(user_id);

      CREATE TABLE IF NOT EXISTS conversation_share_links (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        project_name TEXT NOT NULL,
        session_id TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'claude',
        visibility TEXT NOT NULL DEFAULT 'public',
        title TEXT,
        snapshot_json TEXT NOT NULL,
        message_count INTEGER DEFAULT 0,
        expires_at DATETIME,
        revoked_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_accessed_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_conversation_share_links_user ON conversation_share_links(user_id);
      CREATE INDEX IF NOT EXISTS idx_conversation_share_links_session ON conversation_share_links(project_name, session_id);
      CREATE INDEX IF NOT EXISTS idx_conversation_share_links_visibility ON conversation_share_links(visibility);
    `);

    console.log('Database migrations completed successfully');
  } catch (error) {
    console.error('Error running migrations:', error.message);
    throw error;
  }
};

// Initialize database with schema
const initializeDatabase = async () => {
  try {
    const usersTable = db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = 'users'
      LIMIT 1
    `).get();

    const initSQL = fs.readFileSync(INIT_SQL_PATH, 'utf8');
    db.exec(initSQL);

    if (!usersTable) {
      console.log('Database initialized successfully');
    } else {
      console.log('Database schema already exists, ensured base schema and applying migrations');
    }

    runMigrations();
  } catch (error) {
    console.error('Error initializing database:', error.message);
    throw error;
  }
};

// User database operations
const userDb = {
  // Check if any users exist
  hasUsers: () => {
    try {
      const row = db.prepare('SELECT COUNT(*) as count FROM users').get();
      return row.count > 0;
    } catch (err) {
      throw err;
    }
  },

  countActiveUsers: () => {
    const row = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_active = 1').get();
    return Number(row?.count || 0);
  },

  listAdminUsers: () => db.prepare(`
    SELECT
      u.id,
      u.username,
      u.notification_email,
      u.avatar_id,
      u.created_at,
      u.last_login,
      u.is_active,
      COALESCE(u.membership_plan, 'free') AS membership_plan,
      u.usage_quota_bytes,
      COALESCE(u.usage_baseline_bytes, 0) AS usage_baseline_bytes,
      u.usage_baseline_updated_at,
      COALESCE(u.agent_api_enabled, 0) AS agent_api_enabled,
      u.trial_started_at,
      u.trial_expires_at,
      COUNT(p.id) AS project_count
    FROM users u
    LEFT JOIN projects p ON p.user_id = u.id
    GROUP BY u.id
    ORDER BY u.is_active DESC, u.created_at DESC
  `).all(),

  // Create a new user
  createUser: (username, passwordHash, notificationEmail = null) => {
    try {
      const avatarId = getDefaultAvatarId(username);
      const stmt = db.prepare(`
        INSERT INTO users (
          username,
          password_hash,
          avatar_id,
          notification_email,
          has_completed_onboarding,
          trial_started_at
        )
        VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
      `);
      const result = stmt.run(username, passwordHash, avatarId, notificationEmail);
      return userDb.getUserById(result.lastInsertRowid) || {
        id: result.lastInsertRowid,
        username,
        avatar_id: avatarId,
        notification_email: notificationEmail,
        trial_started_at: new Date().toISOString(),
        trial_expires_at: null,
      };
    } catch (err) {
      throw err;
    }
  },

  // Get user by username
  getUserByUsername: (username) => {
    try {
      const row = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
      return row;
    } catch (err) {
      throw err;
    }
  },

  resetSingleUser: () => {
    try {
      db.prepare('DELETE FROM users').run();
    } catch (err) {
      throw err;
    }
  },

  // Update last login time (non-fatal)
  updateLastLogin: (userId) => {
    try {
      db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
    } catch (err) {
      console.warn('Failed to update last login:', err.message);
    }
  },

  // Get user by ID
  getUserById: (userId) => {
    try {
      const row = db.prepare(`
        SELECT
          id,
          username,
          avatar_id,
          notification_email,
          created_at,
          last_login,
          COALESCE(membership_plan, 'free') AS membership_plan,
          usage_quota_bytes,
          COALESCE(usage_baseline_bytes, 0) AS usage_baseline_bytes,
          usage_baseline_updated_at,
          COALESCE(agent_api_enabled, 0) AS agent_api_enabled,
          trial_started_at,
          trial_expires_at
        FROM users
        WHERE id = ? AND is_active = 1
      `).get(userId);
      return row;
    } catch (err) {
      throw err;
    }
  },

  getUserAuthById: (userId) => {
    try {
      const row = db.prepare('SELECT id, username, password_hash FROM users WHERE id = ? AND is_active = 1').get(userId);
      return row;
    } catch (err) {
      throw err;
    }
  },

  getFirstUser: () => {
    try {
      const row = db.prepare(`
        SELECT
          id,
          username,
          avatar_id,
          notification_email,
          created_at,
          last_login,
          COALESCE(membership_plan, 'free') AS membership_plan,
          usage_quota_bytes,
          COALESCE(usage_baseline_bytes, 0) AS usage_baseline_bytes,
          usage_baseline_updated_at,
          COALESCE(agent_api_enabled, 0) AS agent_api_enabled,
          trial_started_at,
          trial_expires_at
        FROM users
        WHERE is_active = 1
        LIMIT 1
      `).get();
      return row;
    } catch (err) {
      throw err;
    }
  },

  updateGitConfig: (userId, gitName, gitEmail) => {
    try {
      const stmt = db.prepare('UPDATE users SET git_name = ?, git_email = ? WHERE id = ?');
      stmt.run(gitName, gitEmail, userId);
    } catch (err) {
      throw err;
    }
  },

  getGitConfig: (userId) => {
    try {
      const row = db.prepare('SELECT git_name, git_email FROM users WHERE id = ?').get(userId);
      return row;
    } catch (err) {
      throw err;
    }
  },

  completeOnboarding: (userId) => {
    try {
      const stmt = db.prepare('UPDATE users SET has_completed_onboarding = 1 WHERE id = ?');
      stmt.run(userId);
    } catch (err) {
      throw err;
    }
  },

  hasCompletedOnboarding: (userId) => {
    try {
      const row = db.prepare('SELECT has_completed_onboarding FROM users WHERE id = ?').get(userId);
      return row?.has_completed_onboarding === 1;
    } catch (err) {
      throw err;
    }
  },

  getProfile: (userId) => {
    try {
      return db.prepare(`
        SELECT
          id,
          username,
          avatar_id,
          notification_email,
          COALESCE(membership_plan, 'free') AS membership_plan,
          usage_quota_bytes,
          COALESCE(usage_baseline_bytes, 0) AS usage_baseline_bytes,
          usage_baseline_updated_at,
          COALESCE(agent_api_enabled, 0) AS agent_api_enabled,
          trial_started_at,
          trial_expires_at
        FROM users
        WHERE id = ? AND is_active = 1
      `).get(userId);
    } catch (err) {
      throw err;
    }
  },

  updateProfile: (userId, updates = {}) => {
    try {
      const fields = [];
      const values = [];

      if (Object.prototype.hasOwnProperty.call(updates, 'notificationEmail')) {
        fields.push('notification_email = ?');
        values.push(updates.notificationEmail);
      }

      if (Object.prototype.hasOwnProperty.call(updates, 'avatarId')) {
        fields.push('avatar_id = ?');
        values.push(updates.avatarId);
      }

      if (fields.length > 0) {
        db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values, userId);
      }

      return userDb.getProfile(userId);
    } catch (err) {
      throw err;
    }
  },

  updatePassword: (userId, passwordHash) => {
    try {
      const result = db.prepare('UPDATE users SET password_hash = ? WHERE id = ? AND is_active = 1').run(passwordHash, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  updateMembershipPlan: (userId, membershipPlan) => {
    const result = db.prepare(`
      UPDATE users
      SET membership_plan = ?
      WHERE id = ?
    `).run(membershipPlan, userId);
    return result.changes > 0 ? userDb.getAdminUserById(userId) : null;
  },

  updateUsageQuota: (userId, usageQuotaBytes) => {
    const normalizedUsageQuotaBytes = usageQuotaBytes === null || usageQuotaBytes === undefined
      ? null
      : Math.max(0, Math.round(Number(usageQuotaBytes) || 0));
    const result = db.prepare(`
      UPDATE users
      SET usage_quota_bytes = ?
      WHERE id = ?
    `).run(normalizedUsageQuotaBytes, userId);
    return result.changes > 0 ? userDb.getAdminUserById(userId) : null;
  },

  updateUsageBaseline: (userId, usageBaselineBytes) => {
    const normalizedUsageBaselineBytes = Math.max(0, Math.round(Number(usageBaselineBytes) || 0));
    const result = db.prepare(`
      UPDATE users
      SET
        usage_baseline_bytes = ?,
        usage_baseline_updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(normalizedUsageBaselineBytes, userId);
    return result.changes > 0 ? userDb.getAdminUserById(userId) : null;
  },

  updateAgentApiAccess: (userId, enabled) => {
    const result = db.prepare(`
      UPDATE users
      SET agent_api_enabled = ?
      WHERE id = ?
    `).run(enabled ? 1 : 0, userId);
    return result.changes > 0 ? userDb.getAdminUserById(userId) : null;
  },

  updateTrialExpiration: (userId, trialExpiresAt) => {
    const normalizedExpiresAt = trialExpiresAt || null;
    const result = db.prepare(`
      UPDATE users
      SET
        trial_expires_at = ?,
        trial_started_at = COALESCE(trial_started_at, CURRENT_TIMESTAMP)
      WHERE id = ?
    `).run(normalizedExpiresAt, userId);
    return result.changes > 0 ? userDb.getAdminUserById(userId) : null;
  },

  setTrialPeriod: (userId, trialExpiresAt) => userDb.updateTrialExpiration(userId, trialExpiresAt),

  getAdminUserById: (userId) => db.prepare(`
    SELECT
      u.id,
      u.username,
      u.notification_email,
      u.avatar_id,
      u.created_at,
      u.last_login,
      u.is_active,
      COALESCE(u.membership_plan, 'free') AS membership_plan,
      u.usage_quota_bytes,
      COALESCE(u.usage_baseline_bytes, 0) AS usage_baseline_bytes,
      u.usage_baseline_updated_at,
      COALESCE(u.agent_api_enabled, 0) AS agent_api_enabled,
      u.trial_started_at,
      u.trial_expires_at,
      COUNT(p.id) AS project_count
    FROM users u
    LEFT JOIN projects p ON p.user_id = u.id
    WHERE u.id = ?
    GROUP BY u.id
  `).get(userId),

  deleteUser: (userId) => {
    const result = db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    return result.changes > 0;
  }
};

function normalizeUserPreferenceMemoryCategory(category) {
  const normalized = typeof category === 'string' ? category.trim().toLowerCase() : '';
  return USER_PREFERENCE_MEMORY_CATEGORIES.has(normalized) ? normalized : 'general';
}

function normalizeUserPreferenceMemoryScope(scope) {
  const normalized = typeof scope === 'string' ? scope.trim().toLowerCase() : '';
  return USER_PREFERENCE_MEMORY_SCOPES.has(normalized) ? normalized : 'user';
}

function mapUserPreferenceMemoryRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    id: Number(row.id),
    user_id: Number(row.user_id),
    is_enabled: row.is_enabled === 1,
    scope: normalizeUserPreferenceMemoryScope(row.scope),
    project_path: row.project_path || null,
  };
}

const userPreferenceMemoryDb = {
  getAll: (userId) => {
    try {
      const rows = db.prepare(`
        SELECT *
        FROM user_memories
        WHERE user_id = ?
          AND scope != 'clinical'
        ORDER BY
          is_enabled DESC,
          CASE
            WHEN scope = 'project' THEN 0
            WHEN scope = 'meta' THEN 1
            ELSE 2
          END,
          updated_at DESC,
          id DESC
      `).all(userId);
      return rows.map(mapUserPreferenceMemoryRow);
    } catch (err) {
      throw err;
    }
  },

  getById: (userId, memoryId) => {
    try {
      const row = db.prepare(`
        SELECT *
        FROM user_memories
        WHERE user_id = ? AND id = ?
      `).get(userId, memoryId);
      return mapUserPreferenceMemoryRow(row);
    } catch (err) {
      throw err;
    }
  },

  getEnabled: (userId, options = {}) => {
    try {
      const safeLimit = Number.isFinite(options.limit) ? Math.max(1, Math.floor(Number(options.limit))) : 4;
      const normalizedProjectPath = typeof options.projectPath === 'string' && options.projectPath.trim()
        ? options.projectPath.trim()
        : null;
      const normalizedProjectKind = String(options.projectKind || '').trim().toLowerCase() === 'meta'
        ? String(options.projectKind || '').trim().toLowerCase()
        : null;

      let rows;
      if (normalizedProjectPath && normalizedProjectKind) {
        rows = db.prepare(`
          SELECT *
          FROM user_memories
          WHERE user_id = ?
            AND is_enabled = 1
            AND (
              scope = 'user'
              OR scope = ?
              OR (scope = 'project' AND project_path = ?)
            )
          ORDER BY
            CASE
              WHEN scope = 'project' THEN 0
              WHEN scope = 'meta' THEN 1
              ELSE 2
            END,
            updated_at DESC,
            id DESC
          LIMIT ?
        `).all(userId, normalizedProjectKind, normalizedProjectPath, safeLimit);
      } else if (normalizedProjectPath) {
        rows = db.prepare(`
          SELECT *
          FROM user_memories
          WHERE user_id = ?
            AND is_enabled = 1
            AND (scope = 'user' OR (scope = 'project' AND project_path = ?))
          ORDER BY
            CASE WHEN scope = 'project' THEN 0 ELSE 1 END,
            updated_at DESC,
            id DESC
          LIMIT ?
        `).all(userId, normalizedProjectPath, safeLimit);
      } else if (normalizedProjectKind) {
        rows = db.prepare(`
          SELECT *
          FROM user_memories
          WHERE user_id = ?
            AND is_enabled = 1
            AND (scope = 'user' OR scope = ?)
          ORDER BY
            CASE WHEN scope = 'meta' THEN 0 ELSE 1 END,
            updated_at DESC,
            id DESC
          LIMIT ?
        `).all(userId, normalizedProjectKind, safeLimit);
      } else {
        rows = db.prepare(`
          SELECT *
          FROM user_memories
          WHERE user_id = ?
            AND is_enabled = 1
            AND scope = 'user'
          ORDER BY updated_at DESC, id DESC
          LIMIT ?
        `).all(userId, safeLimit);
      }
      return rows.map(mapUserPreferenceMemoryRow);
    } catch (err) {
      throw err;
    }
  },

  create: (userId, content, category = 'general', scope = 'user', projectPath = null) => {
    try {
      const totalRow = db.prepare(`
        SELECT COUNT(*) AS count
        FROM user_memories
        WHERE user_id = ?
      `).get(userId);

      if ((totalRow?.count || 0) >= USER_PREFERENCE_MEMORY_MAX_ITEMS) {
        throw new Error(`Maximum of ${USER_PREFERENCE_MEMORY_MAX_ITEMS} memories allowed`);
      }

      const result = db.prepare(`
        INSERT INTO user_memories (user_id, content, category, scope, project_path)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        userId,
        String(content || '').trim(),
        normalizeUserPreferenceMemoryCategory(category),
        normalizeUserPreferenceMemoryScope(scope),
        normalizeUserPreferenceMemoryScope(scope) === 'project'
          ? (typeof projectPath === 'string' ? projectPath.trim() : null)
          : null,
      );

      return userPreferenceMemoryDb.getById(userId, result.lastInsertRowid);
    } catch (err) {
      throw err;
    }
  },

  update: (userId, memoryId, updates = {}) => {
    try {
      const existing = userPreferenceMemoryDb.getById(userId, memoryId);
      if (!existing) {
        return null;
      }

      const nextContent = updates.content !== undefined
        ? String(updates.content || '').trim()
        : existing.content;
      const nextCategory = updates.category !== undefined
        ? normalizeUserPreferenceMemoryCategory(updates.category)
        : existing.category;
      const nextScope = updates.scope !== undefined
        ? normalizeUserPreferenceMemoryScope(updates.scope)
        : existing.scope;
      const nextProjectPath = nextScope === 'project'
        ? (
          updates.projectPath !== undefined
            ? (typeof updates.projectPath === 'string' ? updates.projectPath.trim() : null)
            : existing.project_path
        )
        : null;
      const nextEnabled = updates.isEnabled !== undefined
        ? (updates.isEnabled ? 1 : 0)
        : (existing.is_enabled ? 1 : 0);

      db.prepare(`
        UPDATE user_memories
        SET
          content = ?,
          category = ?,
          scope = ?,
          project_path = ?,
          is_enabled = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND id = ?
      `).run(
        nextContent,
        nextCategory,
        nextScope,
        nextProjectPath,
        nextEnabled,
        userId,
        memoryId,
      );

      return userPreferenceMemoryDb.getById(userId, memoryId);
    } catch (err) {
      throw err;
    }
  },

  toggle: (userId, memoryId, isEnabled) => {
    try {
      const existing = userPreferenceMemoryDb.getById(userId, memoryId);
      if (!existing) {
        return null;
      }

      const nextEnabled = typeof isEnabled === 'boolean'
        ? isEnabled
        : !existing.is_enabled;

      return userPreferenceMemoryDb.update(userId, memoryId, { isEnabled: nextEnabled });
    } catch (err) {
      throw err;
    }
  },

  delete: (userId, memoryId) => {
    try {
      const result = db.prepare(`
        DELETE FROM user_memories
        WHERE user_id = ? AND id = ?
      `).run(userId, memoryId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  getMemoryEnabled: (userId) => {
    try {
      const row = db.prepare('SELECT memory_enabled FROM users WHERE id = ?').get(userId);
      return row?.memory_enabled !== 0;
    } catch (err) {
      throw err;
    }
  },

  setMemoryEnabled: (userId, enabled) => {
    try {
      db.prepare('UPDATE users SET memory_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, userId);
      return userPreferenceMemoryDb.getMemoryEnabled(userId);
    } catch (err) {
      throw err;
    }
  },
};

function normalizeUserFeedbackCategory(category) {
  const normalized = typeof category === 'string' ? category.trim().toLowerCase() : '';
  return USER_FEEDBACK_CATEGORIES.has(normalized) ? normalized : 'other';
}

function getTrimmedUserFeedbackText(value, maxLength, fieldName, { required = false } = {}) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (required && !text) {
    throw new Error(`${fieldName} is required`);
  }
  if (text.length > maxLength) {
    throw new Error(`${fieldName} must be ${maxLength} characters or less`);
  }
  return text || null;
}

function mapUserFeedbackRow(row) {
  if (!row) {
    return null;
  }

  let metadata = null;
  if (row.metadata_json) {
    try {
      metadata = JSON.parse(row.metadata_json);
    } catch {
      metadata = null;
    }
  }

  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    category: normalizeUserFeedbackCategory(row.category),
    title: row.title || '',
    content: row.content,
    contact: row.contact || '',
    pageUrl: row.page_url || '',
    userAgent: row.user_agent || '',
    status: row.status || 'new',
    metadata,
    createdAt: row.created_at,
  };
}

const userFeedbackDb = {
  create: (userId, payload = {}) => {
    const category = normalizeUserFeedbackCategory(payload.category);
    const title = getTrimmedUserFeedbackText(
      payload.title,
      USER_FEEDBACK_MAX_TITLE_LENGTH,
      'Feedback title',
    );
    const content = getTrimmedUserFeedbackText(
      payload.content,
      USER_FEEDBACK_MAX_CONTENT_LENGTH,
      'Feedback content',
      { required: true },
    );
    const contact = getTrimmedUserFeedbackText(
      payload.contact,
      USER_FEEDBACK_MAX_CONTACT_LENGTH,
      'Contact',
    );
    const pageUrl = getTrimmedUserFeedbackText(
      payload.pageUrl || payload.page_url,
      USER_FEEDBACK_MAX_URL_LENGTH,
      'Page URL',
    );
    const userAgent = getTrimmedUserFeedbackText(
      payload.userAgent || payload.user_agent,
      USER_FEEDBACK_MAX_USER_AGENT_LENGTH,
      'User agent',
    );
    const metadata = payload.metadata && typeof payload.metadata === 'object'
      ? JSON.stringify(payload.metadata)
      : null;

    const result = db.prepare(`
      INSERT INTO user_feedback (
        user_id, category, title, content, contact, page_url, user_agent, metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, category, title, content, contact, pageUrl, userAgent, metadata);

    return userFeedbackDb.getById(userId, result.lastInsertRowid);
  },

  getById: (userId, feedbackId) => {
    const row = db.prepare(`
      SELECT *
      FROM user_feedback
      WHERE user_id = ? AND id = ?
    `).get(userId, feedbackId);
    return mapUserFeedbackRow(row);
  },

  listForUser: (userId) => db.prepare(`
    SELECT *
    FROM user_feedback
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(userId).map(mapUserFeedbackRow),
};

const autoResearchDb = {
  createRun: (input) => {
    try {
      db.prepare(`
        INSERT INTO auto_research_runs (
          id, user_id, project_name, project_path, provider, status, session_id,
          current_task_id, completed_tasks, total_tasks, error, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.id,
        input.userId,
        input.projectName,
        input.projectPath,
        input.provider || 'claude',
        input.status || 'queued',
        input.sessionId || null,
        input.currentTaskId || null,
        input.completedTasks || 0,
        input.totalTasks || 0,
        input.error || null,
        input.metadata ? JSON.stringify(input.metadata) : null
      );
      return autoResearchDb.getRunById(input.id);
    } catch (err) {
      throw err;
    }
  },

  getRunById: (runId) => {
    try {
      const row = db.prepare('SELECT * FROM auto_research_runs WHERE id = ?').get(runId);
      return row ? {
        ...row,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
      } : null;
    } catch (err) {
      throw err;
    }
  },

  getLatestRunForProject: (userId, projectName) => {
    try {
      const row = db.prepare(`
        SELECT * FROM auto_research_runs
        WHERE user_id = ? AND project_name = ?
        ORDER BY started_at DESC
        LIMIT 1
      `).get(userId, projectName);
      return row ? {
        ...row,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
      } : null;
    } catch (err) {
      throw err;
    }
  },

  getActiveRunForProject: (userId, projectName) => {
    try {
      const row = db.prepare(`
        SELECT * FROM auto_research_runs
        WHERE user_id = ? AND project_name = ? AND status IN ('queued', 'running', 'cancelling')
        ORDER BY started_at DESC
        LIMIT 1
      `).get(userId, projectName);
      return row ? {
        ...row,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
      } : null;
    } catch (err) {
      throw err;
    }
  },

  updateRun: (runId, updates = {}) => {
    try {
      const existing = autoResearchDb.getRunById(runId);
      if (!existing) {
        return null;
      }

      const resolveValue = (updateKey, existingValue) => (
        Object.prototype.hasOwnProperty.call(updates, updateKey) ? updates[updateKey] : existingValue
      );
      const mergedMetadata = Object.prototype.hasOwnProperty.call(updates, 'metadata')
        ? updates.metadata
        : existing.metadata;

      db.prepare(`
        UPDATE auto_research_runs
        SET
          status = ?,
          session_id = ?,
          current_task_id = ?,
          completed_tasks = ?,
          total_tasks = ?,
          error = ?,
          metadata = ?,
          finished_at = ?,
          email_sent_at = ?
        WHERE id = ?
      `).run(
        resolveValue('status', existing.status),
        resolveValue('sessionId', existing.session_id),
        resolveValue('currentTaskId', existing.current_task_id),
        resolveValue('completedTasks', existing.completed_tasks),
        resolveValue('totalTasks', existing.total_tasks),
        resolveValue('error', existing.error),
        mergedMetadata ? JSON.stringify(mergedMetadata) : null,
        resolveValue('finishedAt', existing.finished_at),
        resolveValue('emailSentAt', existing.email_sent_at),
        runId
      );

      return autoResearchDb.getRunById(runId);
    } catch (err) {
      throw err;
    }
  },
};

const registrationRequestDb = {
  create: ({ username, notificationEmail, passwordHash, reviewTokenHash, requestIp = null, userAgent = null }) => {
    const result = db.prepare(`
      INSERT INTO registration_requests (
        username, notification_email, password_hash, review_token_hash, request_ip, user_agent
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(username, notificationEmail, passwordHash, reviewTokenHash, requestIp, userAgent);

    return registrationRequestDb.getById(result.lastInsertRowid);
  },

  getById: (id) => db.prepare('SELECT * FROM registration_requests WHERE id = ?').get(id),

  getByTokenHash: (reviewTokenHash) => db.prepare(`
    SELECT *
    FROM registration_requests
    WHERE review_token_hash = ?
    LIMIT 1
  `).get(reviewTokenHash),

  list: (status = null) => {
    if (status) {
      return db.prepare(`
        SELECT id, username, notification_email, status, requested_at, reviewed_at,
               approved_user_id, reviewer_note, request_ip, user_agent
        FROM registration_requests
        WHERE status = ?
        ORDER BY requested_at DESC
      `).all(status);
    }
    return db.prepare(`
      SELECT id, username, notification_email, status, requested_at, reviewed_at,
             approved_user_id, reviewer_note, request_ip, user_agent
      FROM registration_requests
      ORDER BY requested_at DESC
      LIMIT 200
    `).all();
  },

  getPendingByUsernameOrEmail: (username, notificationEmail) => db.prepare(`
    SELECT *
    FROM registration_requests
    WHERE status = 'pending'
      AND (LOWER(username) = LOWER(?) OR LOWER(notification_email) = LOWER(?))
    LIMIT 1
  `).get(username, notificationEmail),

  approve: (id, approvedUserId) => {
    db.prepare(`
      UPDATE registration_requests
      SET status = 'approved',
          approved_user_id = ?,
          reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'
    `).run(approvedUserId, id);
    return registrationRequestDb.getById(id);
  },

  reject: (id, reviewerNote = null) => {
    db.prepare(`
      UPDATE registration_requests
      SET status = 'rejected',
          reviewer_note = ?,
          reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'
    `).run(reviewerNote, id);
    return registrationRequestDb.getById(id);
  },
};

const membershipUpgradeRequestDb = {
  createOrUpdatePending: ({ userId, username, currentPlan, requestedPlan, requestIp = null, userAgent = null }) => {
    const existing = db.prepare(`
      SELECT *
      FROM membership_upgrade_requests
      WHERE user_id = ? AND requested_plan = ? AND status = 'pending'
      LIMIT 1
    `).get(userId, requestedPlan);

    if (existing) {
      db.prepare(`
        UPDATE membership_upgrade_requests
        SET current_plan = ?,
            username = ?,
            requested_at = CURRENT_TIMESTAMP,
            request_ip = ?,
            user_agent = ?
        WHERE id = ?
      `).run(currentPlan, username, requestIp, userAgent, existing.id);
      return membershipUpgradeRequestDb.getById(existing.id);
    }

    const result = db.prepare(`
      INSERT INTO membership_upgrade_requests (
        user_id, username, current_plan, requested_plan, request_ip, user_agent
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, username, currentPlan, requestedPlan, requestIp, userAgent);

    return membershipUpgradeRequestDb.getById(result.lastInsertRowid);
  },

  getById: (id) => db.prepare(`
    SELECT
      r.*,
      u.notification_email,
      COALESCE(u.membership_plan, r.current_plan, 'free') AS current_membership_plan
    FROM membership_upgrade_requests r
    LEFT JOIN users u ON u.id = r.user_id
    WHERE r.id = ?
  `).get(id),

  list: (status = null) => {
    const where = status ? 'WHERE r.status = ?' : '';
    const stmt = db.prepare(`
      SELECT
        r.*,
        u.notification_email,
        COALESCE(u.membership_plan, r.current_plan, 'free') AS current_membership_plan
      FROM membership_upgrade_requests r
      LEFT JOIN users u ON u.id = r.user_id
      ${where}
      ORDER BY r.requested_at DESC
      LIMIT 200
    `);
    return status ? stmt.all(status) : stmt.all();
  },

  approve: (id, reviewerNote = null) => {
    db.prepare(`
      UPDATE membership_upgrade_requests
      SET status = 'approved',
          reviewer_note = ?,
          reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'
    `).run(reviewerNote, id);
    return membershipUpgradeRequestDb.getById(id);
  },

  reject: (id, reviewerNote = null) => {
    db.prepare(`
      UPDATE membership_upgrade_requests
      SET status = 'rejected',
          reviewer_note = ?,
          reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'
    `).run(reviewerNote, id);
    return membershipUpgradeRequestDb.getById(id);
  },

  resolvePendingForUser: (userId, status, reviewerNote = null, requestedPlan = null) => {
    db.prepare(`
      UPDATE membership_upgrade_requests
      SET status = ?,
          reviewer_note = COALESCE(?, reviewer_note),
          reviewed_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND status = 'pending'
        AND (? IS NULL OR requested_plan = ?)
    `).run(status, reviewerNote, userId, requestedPlan, requestedPlan);
  },
};

const appSettingsDb = {
  get: (key) => {
    try {
      const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
      return row ? row.value : null;
    } catch (err) {
      throw err;
    }
  },

  set: (key, value) => {
    try {
      db.prepare(`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).run(key, value);
      return appSettingsDb.get(key);
    } catch (err) {
      throw err;
    }
  },
};

function normalizeConversationShareVisibility(visibility) {
  const normalized = typeof visibility === 'string' ? visibility.trim().toLowerCase() : '';
  return normalized === 'private' ? 'private' : 'public';
}

function mapConversationShareRow(row) {
  if (!row) {
    return null;
  }

  return {
    token: row.token,
    userId: Number(row.user_id),
    projectName: row.project_name,
    sessionId: row.session_id,
    provider: row.provider || 'claude',
    visibility: normalizeConversationShareVisibility(row.visibility),
    title: row.title || null,
    snapshot: row.snapshot_json ? JSON.parse(row.snapshot_json) : null,
    messageCount: Number(row.message_count || 0),
    expiresAt: row.expires_at || null,
    revokedAt: row.revoked_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    lastAccessedAt: row.last_accessed_at || null,
  };
}

const conversationShareDb = {
  generateToken: () => `conv_${crypto.randomBytes(24).toString('base64url')}`,

  create: (input = {}) => {
    try {
      const token = input.token || conversationShareDb.generateToken();
      const visibility = normalizeConversationShareVisibility(input.visibility);
      const snapshot = input.snapshot && typeof input.snapshot === 'object' ? input.snapshot : {};
      const messageCount = Number.isFinite(Number(input.messageCount))
        ? Math.max(0, Math.floor(Number(input.messageCount)))
        : (Array.isArray(snapshot.messages) ? snapshot.messages.length : 0);

      db.prepare(`
        INSERT INTO conversation_share_links (
          token, user_id, project_name, session_id, provider, visibility, title,
          snapshot_json, message_count, expires_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        token,
        input.userId,
        input.projectName,
        input.sessionId,
        input.provider || 'claude',
        visibility,
        input.title || null,
        JSON.stringify(snapshot),
        messageCount,
        input.expiresAt || null,
      );

      return conversationShareDb.getByToken(token);
    } catch (err) {
      throw err;
    }
  },

  getByToken: (token) => {
    try {
      const normalizedToken = typeof token === 'string' ? token.trim() : '';
      if (!normalizedToken) {
        return null;
      }

      return mapConversationShareRow(
        db.prepare('SELECT * FROM conversation_share_links WHERE token = ?').get(normalizedToken),
      );
    } catch (err) {
      throw err;
    }
  },

  listForSession: (userId, projectName, sessionId) => {
    try {
      const rows = db.prepare(`
        SELECT *
        FROM conversation_share_links
        WHERE user_id = ? AND project_name = ? AND session_id = ?
        ORDER BY datetime(created_at) DESC
      `).all(userId, projectName, sessionId);
      return rows.map(mapConversationShareRow).filter(Boolean);
    } catch (err) {
      throw err;
    }
  },

  markAccessed: (token) => {
    try {
      db.prepare(`
        UPDATE conversation_share_links
        SET last_accessed_at = CURRENT_TIMESTAMP
        WHERE token = ?
      `).run(token);
    } catch (err) {
      console.warn('Failed to update conversation share access time:', err.message);
    }
  },

  revoke: (token, userId) => {
    try {
      const result = db.prepare(`
        UPDATE conversation_share_links
        SET revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE token = ? AND user_id = ? AND revoked_at IS NULL
      `).run(token, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },
};

// API Keys database operations
const apiKeysDb = {
  // Generate a new API key
  generateApiKey: () => {
    return 'ck_' + crypto.randomBytes(32).toString('hex');
  },

  // Create a new API key
  createApiKey: (userId, keyName) => {
    try {
      const apiKey = apiKeysDb.generateApiKey();
      const stmt = db.prepare('INSERT INTO api_keys (user_id, key_name, api_key) VALUES (?, ?, ?)');
      const result = stmt.run(userId, keyName, apiKey);
      return { id: result.lastInsertRowid, keyName, apiKey };
    } catch (err) {
      throw err;
    }
  },

  // Get all API keys for a user
  getApiKeys: (userId) => {
    try {
      const rows = db.prepare('SELECT id, key_name, api_key, created_at, last_used, is_active FROM api_keys WHERE user_id = ? ORDER BY created_at DESC').all(userId);
      return rows;
    } catch (err) {
      throw err;
    }
  },

  // Validate API key and get user
  validateApiKey: (apiKey) => {
    try {
      const row = db.prepare(`
        SELECT
          u.id,
          u.username,
          COALESCE(u.membership_plan, 'free') AS membership_plan,
          u.usage_quota_bytes,
          COALESCE(u.usage_baseline_bytes, 0) AS usage_baseline_bytes,
          u.usage_baseline_updated_at,
          u.trial_started_at,
          u.trial_expires_at,
          ak.id AS api_key_id
        FROM api_keys ak
        JOIN users u ON ak.user_id = u.id
        WHERE ak.api_key = ?
          AND ak.is_active = 1
          AND u.is_active = 1
      `).get(apiKey);

      if (row) {
        // Update last_used timestamp
        db.prepare('UPDATE api_keys SET last_used = CURRENT_TIMESTAMP WHERE id = ?').run(row.api_key_id);
      }

      return row;
    } catch (err) {
      throw err;
    }
  },

  // Delete an API key
  deleteApiKey: (userId, apiKeyId) => {
    try {
      const stmt = db.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?');
      const result = stmt.run(apiKeyId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  // Toggle API key active status
  toggleApiKey: (userId, apiKeyId, isActive) => {
    try {
      const stmt = db.prepare('UPDATE api_keys SET is_active = ? WHERE id = ? AND user_id = ?');
      const result = stmt.run(isActive ? 1 : 0, apiKeyId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  }
};

// User credentials database operations (for GitHub tokens, GitLab tokens, etc.)
const credentialsDb = {
  // Create a new credential
  createCredential: (userId, credentialName, credentialType, credentialValue, description = null) => {
    try {
      const stmt = db.prepare('INSERT INTO user_credentials (user_id, credential_name, credential_type, credential_value, description) VALUES (?, ?, ?, ?, ?)');
      const result = stmt.run(userId, credentialName, credentialType, credentialValue, description);
      return { id: result.lastInsertRowid, credentialName, credentialType };
    } catch (err) {
      throw err;
    }
  },

  // Get all credentials for a user, optionally filtered by type
  getCredentials: (userId, credentialType = null) => {
    try {
      let query = 'SELECT id, credential_name, credential_type, description, created_at, is_active FROM user_credentials WHERE user_id = ?';
      const params = [userId];

      if (credentialType) {
        query += ' AND credential_type = ?';
        params.push(credentialType);
      }

      query += ' ORDER BY created_at DESC';

      const rows = db.prepare(query).all(...params);
      return rows;
    } catch (err) {
      throw err;
    }
  },

  // Get active credential value for a user by type (returns most recent active)
  getActiveCredential: (userId, credentialType) => {
    try {
      const row = db.prepare('SELECT credential_value FROM user_credentials WHERE user_id = ? AND credential_type = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1').get(userId, credentialType);
      return row?.credential_value || null;
    } catch (err) {
      throw err;
    }
  },

  // Delete a credential
  deleteCredential: (userId, credentialId) => {
    try {
      const stmt = db.prepare('DELETE FROM user_credentials WHERE id = ? AND user_id = ?');
      const result = stmt.run(credentialId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  // Toggle credential active status
  toggleCredential: (userId, credentialId, isActive) => {
    try {
      const stmt = db.prepare('UPDATE user_credentials SET is_active = ? WHERE id = ? AND user_id = ?');
      const result = stmt.run(isActive ? 1 : 0, credentialId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  }
};

// Backward compatibility - keep old names pointing to new system
const githubTokensDb = {
  createGithubToken: (userId, tokenName, githubToken, description = null) => {
    return credentialsDb.createCredential(userId, tokenName, 'github_token', githubToken, description);
  },
  getGithubTokens: (userId) => {
    return credentialsDb.getCredentials(userId, 'github_token');
  },
  getActiveGithubToken: (userId) => {
    return credentialsDb.getActiveCredential(userId, 'github_token');
  },
  deleteGithubToken: (userId, tokenId) => {
    return credentialsDb.deleteCredential(userId, tokenId);
  },
  toggleGithubToken: (userId, tokenId, isActive) => {
    return credentialsDb.toggleCredential(userId, tokenId, isActive);
  }
};

const AGENT_API_PROFILE_PLANS = new Set(['all', 'free', 'plus', 'pro']);
const AGENT_API_AUTH_TYPES = new Set(['api_key', 'auth_token']);
const AGENT_API_SYSTEM_STRATEGIES = new Set(['default', 'round_robin']);
const AGENT_API_SYSTEM_STRATEGY_KEY = 'agent_api_system_selection_strategy';

function normalizeAgentApiText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeAgentApiProvider(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || 'anthropic';
}

function normalizeAgentApiAuthType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return AGENT_API_AUTH_TYPES.has(normalized) ? normalized : 'api_key';
}

function normalizeAgentApiPlan(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return AGENT_API_PROFILE_PLANS.has(normalized) ? normalized : 'all';
}

function normalizeAgentApiStrategy(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return AGENT_API_SYSTEM_STRATEGIES.has(normalized) ? normalized : 'default';
}

function mapAgentApiProfileRow(row, { includeSecret = false } = {}) {
  if (!row) return null;

  const profile = {
    id: Number(row.id),
    ownerUserId: row.owner_user_id == null ? null : Number(row.owner_user_id),
    scope: row.scope || 'user',
    name: row.name,
    provider: row.provider || 'anthropic',
    authType: row.auth_type || 'api_key',
    secretLast4: row.secret_last4 || null,
    hasSecret: Boolean(row.encrypted_secret),
    baseUrl: row.base_url || '',
    runtimeModel: row.runtime_model || '',
    modelPlan: row.model_plan || 'all',
    isActive: row.is_active !== 0,
    isDefault: row.is_default !== 0,
    priority: Number(row.priority || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (includeSecret) {
    profile.secret = decryptSecret(row.encrypted_secret);
  }

  return profile;
}

function buildAgentApiProfileInsertPayload(payload = {}, { scope = 'user', ownerUserId = null } = {}) {
  const name = normalizeAgentApiText(payload.name);
  if (!name) {
    throw new Error('Profile name is required');
  }

  const rawSecret = normalizeAgentApiText(payload.apiKey || payload.secret || payload.authToken);
  return {
    ownerUserId: scope === 'system' ? null : ownerUserId,
    scope,
    name,
    provider: normalizeAgentApiProvider(payload.provider),
    authType: normalizeAgentApiAuthType(payload.authType || payload.auth_type),
    encryptedSecret: rawSecret ? encryptSecret(rawSecret) : null,
    secretLast4: rawSecret ? getSecretLast4(rawSecret) : null,
    baseUrl: normalizeAgentApiText(payload.baseUrl || payload.base_url),
    runtimeModel: normalizeAgentApiText(payload.runtimeModel || payload.runtime_model),
    modelPlan: normalizeAgentApiPlan(payload.modelPlan || payload.model_plan),
    isActive: payload.isActive === undefined && payload.is_active === undefined
      ? 1
      : (payload.isActive || payload.is_active ? 1 : 0),
    isDefault: payload.isDefault || payload.is_default ? 1 : 0,
    priority: Number.isFinite(Number(payload.priority)) ? Math.trunc(Number(payload.priority)) : 0,
  };
}

function applyAgentApiProfileUpdates(profile, updates = {}) {
  const clauses = [];
  const params = [];

  const push = (column, value) => {
    clauses.push(`${column} = ?`);
    params.push(value);
  };

  if (Object.prototype.hasOwnProperty.call(updates, 'name')) {
    const name = normalizeAgentApiText(updates.name);
    if (!name) throw new Error('Profile name is required');
    push('name', name);
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'provider')) {
    push('provider', normalizeAgentApiProvider(updates.provider));
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'authType') || Object.prototype.hasOwnProperty.call(updates, 'auth_type')) {
    push('auth_type', normalizeAgentApiAuthType(updates.authType || updates.auth_type));
  }

  if (
    Object.prototype.hasOwnProperty.call(updates, 'apiKey')
    || Object.prototype.hasOwnProperty.call(updates, 'secret')
    || Object.prototype.hasOwnProperty.call(updates, 'authToken')
  ) {
    const rawSecret = normalizeAgentApiText(updates.apiKey || updates.secret || updates.authToken);
    if (rawSecret) {
      push('encrypted_secret', encryptSecret(rawSecret));
      push('secret_last4', getSecretLast4(rawSecret));
    }
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'baseUrl') || Object.prototype.hasOwnProperty.call(updates, 'base_url')) {
    push('base_url', normalizeAgentApiText(updates.baseUrl || updates.base_url));
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'runtimeModel') || Object.prototype.hasOwnProperty.call(updates, 'runtime_model')) {
    push('runtime_model', normalizeAgentApiText(updates.runtimeModel || updates.runtime_model));
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'modelPlan') || Object.prototype.hasOwnProperty.call(updates, 'model_plan')) {
    push('model_plan', normalizeAgentApiPlan(updates.modelPlan || updates.model_plan));
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'isActive') || Object.prototype.hasOwnProperty.call(updates, 'is_active')) {
    const value = Object.prototype.hasOwnProperty.call(updates, 'isActive') ? updates.isActive : updates.is_active;
    push('is_active', value ? 1 : 0);
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'isDefault') || Object.prototype.hasOwnProperty.call(updates, 'is_default')) {
    const value = Object.prototype.hasOwnProperty.call(updates, 'isDefault') ? updates.isDefault : updates.is_default;
    push('is_default', value ? 1 : 0);
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'priority')) {
    push('priority', Number.isFinite(Number(updates.priority)) ? Math.trunc(Number(updates.priority)) : profile.priority || 0);
  }

  if (clauses.length === 0) {
    return false;
  }

  clauses.push('updated_at = CURRENT_TIMESTAMP');
  db.prepare(`
    UPDATE agent_api_profiles
    SET ${clauses.join(', ')}
    WHERE id = ?
  `).run(...params, profile.id);
  return true;
}

function getAgentApiProfileById(profileId) {
  return db.prepare('SELECT * FROM agent_api_profiles WHERE id = ?').get(profileId);
}

function profileMatchesPlan(profile, plan) {
  const profilePlan = normalizeAgentApiPlan(profile?.model_plan || profile?.modelPlan);
  const requestedPlan = normalizeAgentApiPlan(plan || 'all');
  return profilePlan === 'all' || requestedPlan === 'all' || profilePlan === requestedPlan;
}

const agentApiProfilesDb = {
  getSystemStrategy: () => normalizeAgentApiStrategy(appSettingsDb.get(AGENT_API_SYSTEM_STRATEGY_KEY)),

  setSystemStrategy: (strategy) => appSettingsDb.set(
    AGENT_API_SYSTEM_STRATEGY_KEY,
    normalizeAgentApiStrategy(strategy),
  ),

  listSystemProfiles: ({ activeOnly = false } = {}) => {
    const where = activeOnly ? "WHERE scope = 'system' AND is_active = 1" : "WHERE scope = 'system'";
    return db.prepare(`
      SELECT *
      FROM agent_api_profiles
      ${where}
      ORDER BY is_default DESC, priority DESC, created_at DESC, id DESC
    `).all().map((row) => mapAgentApiProfileRow(row));
  },

  listForUser: (userId) => {
    return {
      agentApiEnabled: true,
      profiles: db.prepare(`
      SELECT *
      FROM agent_api_profiles
      WHERE (scope = 'system' AND is_active = 1)
         OR (scope = 'user' AND owner_user_id = ?)
      ORDER BY scope ASC, is_default DESC, priority DESC, created_at DESC, id DESC
    `).all(userId).map((row) => mapAgentApiProfileRow(row)),
      selection: agentApiProfilesDb.getUserSelection(userId),
      systemStrategy: agentApiProfilesDb.getSystemStrategy(),
    };
  },

  getUserSelection: (userId) => {
    const row = db.prepare(`
      SELECT user_id, selected_profile_id, mode, updated_at
      FROM agent_api_profile_selections
      WHERE user_id = ?
    `).get(userId);

    if (!row) {
      return {
        userId: Number(userId),
        mode: 'system_auto',
        selectedProfileId: null,
        updatedAt: null,
      };
    }

    return {
      userId: Number(row.user_id),
      mode: row.mode === 'profile' ? 'profile' : 'system_auto',
      selectedProfileId: row.selected_profile_id == null ? null : Number(row.selected_profile_id),
      updatedAt: row.updated_at,
    };
  },

  setUserSelection: (userId, payload = {}) => {
    const mode = payload.mode === 'profile' ? 'profile' : 'system_auto';
    let selectedProfileId = null;

    if (mode === 'profile') {
      selectedProfileId = Number(payload.profileId || payload.selectedProfileId);
      if (!Number.isInteger(selectedProfileId) || selectedProfileId <= 0) {
        throw new Error('A valid profileId is required');
      }
      const profile = getAgentApiProfileById(selectedProfileId);
      if (!profile || profile.is_active === 0) {
        throw new Error('API profile is not available');
      }
      const isAccessible = profile.scope === 'system'
        || (profile.scope === 'user' && Number(profile.owner_user_id) === Number(userId));
      if (!isAccessible) {
        throw new Error('API profile is not available');
      }
    }

    db.prepare(`
      INSERT INTO agent_api_profile_selections (user_id, selected_profile_id, mode, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        selected_profile_id = excluded.selected_profile_id,
        mode = excluded.mode,
        updated_at = CURRENT_TIMESTAMP
    `).run(userId, selectedProfileId, mode);

    return agentApiProfilesDb.getUserSelection(userId);
  },

  createUserProfile: (userId, payload = {}) => {
    const profile = buildAgentApiProfileInsertPayload(payload, { scope: 'user', ownerUserId: userId });
    profile.modelPlan = 'all';
    const result = db.prepare(`
      INSERT INTO agent_api_profiles (
        owner_user_id, scope, name, provider, auth_type, encrypted_secret, secret_last4,
        base_url, runtime_model, model_plan, is_active, is_default, priority
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      profile.ownerUserId,
      profile.scope,
      profile.name,
      profile.provider,
      profile.authType,
      profile.encryptedSecret,
      profile.secretLast4,
      profile.baseUrl,
      profile.runtimeModel,
      profile.modelPlan,
      profile.isActive,
      profile.isDefault,
      profile.priority,
    );
    return mapAgentApiProfileRow(getAgentApiProfileById(result.lastInsertRowid));
  },

  createSystemProfile: (payload = {}) => {
    const profile = buildAgentApiProfileInsertPayload(payload, { scope: 'system', ownerUserId: null });
    const result = db.prepare(`
      INSERT INTO agent_api_profiles (
        owner_user_id, scope, name, provider, auth_type, encrypted_secret, secret_last4,
        base_url, runtime_model, model_plan, is_active, is_default, priority
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      null,
      'system',
      profile.name,
      profile.provider,
      profile.authType,
      profile.encryptedSecret,
      profile.secretLast4,
      profile.baseUrl,
      profile.runtimeModel,
      profile.modelPlan,
      profile.isActive,
      profile.isDefault,
      profile.priority,
    );
    return mapAgentApiProfileRow(getAgentApiProfileById(result.lastInsertRowid));
  },

  updateUserProfile: (userId, profileId, updates = {}) => {
    const profile = db.prepare(`
      SELECT *
      FROM agent_api_profiles
      WHERE id = ? AND scope = 'user' AND owner_user_id = ?
    `).get(profileId, userId);
    if (!profile) return null;

    applyAgentApiProfileUpdates(profile, { ...updates, modelPlan: 'all' });
    return mapAgentApiProfileRow(getAgentApiProfileById(profileId));
  },

  updateSystemProfile: (profileId, updates = {}) => {
    const profile = db.prepare(`
      SELECT *
      FROM agent_api_profiles
      WHERE id = ? AND scope = 'system'
    `).get(profileId);
    if (!profile) return null;

    applyAgentApiProfileUpdates(profile, updates);
    return mapAgentApiProfileRow(getAgentApiProfileById(profileId));
  },

  deleteUserProfile: (userId, profileId) => {
    const result = db.prepare(`
      DELETE FROM agent_api_profiles
      WHERE id = ? AND scope = 'user' AND owner_user_id = ?
    `).run(profileId, userId);
    return result.changes > 0;
  },

  deleteSystemProfile: (profileId) => {
    const result = db.prepare(`
      DELETE FROM agent_api_profiles
      WHERE id = ? AND scope = 'system'
    `).run(profileId);
    return result.changes > 0;
  },

  resolveForUser: (userId) => {
    const selection = agentApiProfilesDb.getUserSelection(userId);
    if (selection.mode === 'profile' && selection.selectedProfileId) {
      const profile = getAgentApiProfileById(selection.selectedProfileId);
      const isAccessible = profile
        && profile.is_active !== 0
        && (
          profile.scope === 'system'
          || (profile.scope === 'user' && Number(profile.owner_user_id) === Number(userId))
        );
      if (isAccessible) {
        return mapAgentApiProfileRow(profile, { includeSecret: true });
      }
    }

    const candidates = db.prepare(`
      SELECT *
      FROM agent_api_profiles
      WHERE scope = 'system' AND is_active = 1
      ORDER BY is_default DESC, priority DESC, created_at ASC, id ASC
    `).all();

    if (candidates.length === 0) {
      return null;
    }

    const strategy = agentApiProfilesDb.getSystemStrategy();
    if (strategy === 'round_robin') {
      const key = 'agent_api_system_rr_index';
      const current = Number.parseInt(appSettingsDb.get(key) || '0', 10);
      const index = Number.isFinite(current) && current >= 0 ? current % candidates.length : 0;
      appSettingsDb.set(key, String(index + 1));
      return mapAgentApiProfileRow(candidates[index], { includeSecret: true });
    }

    const defaultProfile = candidates.find((profile) => profile.is_default !== 0) || candidates[0];
    return mapAgentApiProfileRow(defaultProfile, { includeSecret: true });
  },
};

const AGENT_TOOL_PERMISSION_PROVIDERS = new Set(['claude']);
const AGENT_TOOL_PERMISSION_SORT_ORDERS = new Set(['date', 'name']);
const AGENT_TOOL_PERMISSION_MAX_ENTRIES = 200;
const AGENT_TOOL_PERMISSION_MAX_ENTRY_LENGTH = 300;

function normalizeAgentToolPermissionProvider(value) {
  const normalized = String(value || 'claude').trim().toLowerCase();
  return AGENT_TOOL_PERMISSION_PROVIDERS.has(normalized) ? normalized : 'claude';
}

function normalizeToolPermissionEntries(entries = []) {
  if (!Array.isArray(entries)) {
    return [];
  }

  const seen = new Set();
  const normalizedEntries = [];
  for (const entry of entries) {
    const text = String(entry || '').trim().slice(0, AGENT_TOOL_PERMISSION_MAX_ENTRY_LENGTH);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    normalizedEntries.push(text);
    if (normalizedEntries.length >= AGENT_TOOL_PERMISSION_MAX_ENTRIES) {
      break;
    }
  }
  return normalizedEntries;
}

function parseToolPermissionEntries(value) {
  if (!value) {
    return [];
  }

  try {
    return normalizeToolPermissionEntries(JSON.parse(value));
  } catch {
    return [];
  }
}

function normalizeAgentToolProjectSortOrder(value) {
  const normalized = String(value || 'date').trim().toLowerCase();
  return AGENT_TOOL_PERMISSION_SORT_ORDERS.has(normalized) ? normalized : 'date';
}

function mapAgentToolPermissionsRow(row, userId, provider) {
  return {
    userId: Number(row?.user_id ?? userId),
    provider: normalizeAgentToolPermissionProvider(row?.provider || provider),
    allowedTools: parseToolPermissionEntries(row?.allowed_tools_json),
    disallowedTools: parseToolPermissionEntries(row?.disallowed_tools_json),
    skipPermissions: false,
    projectSortOrder: normalizeAgentToolProjectSortOrder(row?.project_sort_order),
    updatedAt: row?.updated_at || null,
  };
}

function buildAgentToolPermissionsPayload(payload = {}, existing = null) {
  return {
    allowedTools: Object.prototype.hasOwnProperty.call(payload, 'allowedTools')
      ? normalizeToolPermissionEntries(payload.allowedTools)
      : normalizeToolPermissionEntries(existing?.allowedTools),
    disallowedTools: Object.prototype.hasOwnProperty.call(payload, 'disallowedTools')
      ? normalizeToolPermissionEntries(payload.disallowedTools)
      : normalizeToolPermissionEntries(existing?.disallowedTools),
    skipPermissions: false,
    projectSortOrder: Object.prototype.hasOwnProperty.call(payload, 'projectSortOrder')
      ? normalizeAgentToolProjectSortOrder(payload.projectSortOrder)
      : normalizeAgentToolProjectSortOrder(existing?.projectSortOrder),
  };
}

const agentToolPermissionsDb = {
  getForUser: (userId, provider = 'claude') => {
    const normalizedProvider = normalizeAgentToolPermissionProvider(provider);
    const row = db.prepare(`
      SELECT *
      FROM agent_tool_permissions
      WHERE user_id = ? AND provider = ?
    `).get(userId, normalizedProvider);

    return mapAgentToolPermissionsRow(row, userId, normalizedProvider);
  },

  upsertForUser: (userId, provider = 'claude', payload = {}) => {
    const normalizedProvider = normalizeAgentToolPermissionProvider(provider);
    const existing = agentToolPermissionsDb.getForUser(userId, normalizedProvider);
    const next = buildAgentToolPermissionsPayload(payload, existing);

    db.prepare(`
      INSERT INTO agent_tool_permissions (
        user_id, provider, allowed_tools_json, disallowed_tools_json,
        skip_permissions, project_sort_order, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, provider) DO UPDATE SET
        allowed_tools_json = excluded.allowed_tools_json,
        disallowed_tools_json = excluded.disallowed_tools_json,
        skip_permissions = excluded.skip_permissions,
        project_sort_order = excluded.project_sort_order,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      userId,
      normalizedProvider,
      JSON.stringify(next.allowedTools),
      JSON.stringify(next.disallowedTools),
      0,
      next.projectSortOrder,
    );

    return agentToolPermissionsDb.getForUser(userId, normalizedProvider);
  },

  grantAllowedTool: (userId, provider = 'claude', entry) => {
    const normalizedEntry = normalizeToolPermissionEntries([entry])[0];
    if (!normalizedEntry) {
      throw new Error('Permission entry is required');
    }

    const current = agentToolPermissionsDb.getForUser(userId, provider);
    const allowedTools = current.allowedTools.includes(normalizedEntry)
      ? current.allowedTools
      : [...current.allowedTools, normalizedEntry];
    const disallowedTools = current.disallowedTools.filter((tool) => tool !== normalizedEntry);

    return agentToolPermissionsDb.upsertForUser(userId, provider, {
      ...current,
      allowedTools,
      disallowedTools,
    });
  },
};

// Session metadata index operations
function parseSessionRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    tags: Array.isArray(row.tags) ? row.tags : [],
  };
}

function parseTagRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    projectName: row.project_name,
    tagKey: row.tag_key,
    tagType: row.tag_type,
    label: row.label,
    color: row.color ?? null,
    sortOrder: row.sort_order,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    createdAt: row.created_at,
    source: row.source ?? null,
    linkedBy: row.linked_by ?? null,
    linkedAt: row.linked_at ?? null,
    linkMetadata: row.link_metadata ? JSON.parse(row.link_metadata) : null,
  };
}

function normalizeSessionDisplayName(displayName) {
  if (displayName === null || displayName === undefined) {
    return null;
  }

  return stripInternalContextPrefix(displayName);
}

function normalizeSessionTimestamp(timestamp) {
  if (!timestamp) {
    return null;
  }

  const value = timestamp instanceof Date ? timestamp.toISOString() : String(timestamp).trim();
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

// Returns "YYYY-MM-DD HH:MM:SS" format for SQLite created_at column convention
function normalizeSessionCreatedAt(timestamp) {
  if (!timestamp) {
    return null;
  }

  const value = timestamp instanceof Date ? timestamp.toISOString() : String(timestamp).trim();
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().replace('T', ' ').slice(0, 19);
  }

  return value;
}

function mergeSessionMetadata(existingMetadata, incomingMetadata) {
  const base = existingMetadata && typeof existingMetadata === 'object' ? existingMetadata : {};
  const incoming = incomingMetadata && typeof incomingMetadata === 'object' ? incomingMetadata : {};
  return {
    ...base,
    ...incoming,
  };
}

function resolveLatestActivity(existingActivity, incomingActivity) {
  const normalizedExisting = normalizeSessionTimestamp(existingActivity);
  const normalizedIncoming = normalizeSessionTimestamp(incomingActivity);
  if (!normalizedExisting) {
    return normalizedIncoming;
  }
  if (!normalizedIncoming) {
    return normalizedExisting;
  }

  const existingTime = new Date(normalizedExisting).getTime();
  const incomingTime = new Date(normalizedIncoming).getTime();
  if (Number.isNaN(existingTime)) {
    return normalizedIncoming;
  }
  if (Number.isNaN(incomingTime)) {
    return normalizedExisting;
  }

  return incomingTime >= existingTime ? normalizedIncoming : normalizedExisting;
}

function resolveMessageCount(existingCount, incomingCount) {
  const normalizedExisting = Number(existingCount || 0);
  const normalizedIncoming = Number(incomingCount || 0);
  return Math.max(normalizedExisting, normalizedIncoming);
}

function normalizeMetadataObject(metadata) {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...metadata }
    : {};
}

function serializeMetadata(metadata) {
  const normalized = normalizeMetadataObject(metadata);
  return Object.keys(normalized).length > 0 ? JSON.stringify(normalized) : null;
}

function getStageTagDecisions(metadata) {
  const metadataObject = normalizeMetadataObject(metadata);
  const decisions = metadataObject[STAGE_TAG_DECISIONS_KEY];
  return decisions && typeof decisions === 'object' && !Array.isArray(decisions)
    ? { ...decisions }
    : {};
}

function applyManualStageTagDecisions(existingMetadata, projectStageTags = [], selectedTags = []) {
  const metadataObject = normalizeMetadataObject(existingMetadata);
  const decisions = getStageTagDecisions(metadataObject);
  const selectedStageKeys = new Set(
    (Array.isArray(selectedTags) ? selectedTags : [])
      .filter((tag) => tag?.tagType === 'stage')
      .map((tag) => tag.tagKey)
      .filter(Boolean)
  );
  const timestamp = new Date().toISOString();

  (Array.isArray(projectStageTags) ? projectStageTags : []).forEach((tag) => {
    const tagKey = tag?.tagKey || tag?.tag_key;
    if (!tagKey) {
      return;
    }

    decisions[tagKey] = {
      decision: selectedStageKeys.has(tagKey) ? 'selected' : 'excluded',
      source: 'manual',
      updatedAt: timestamp,
    };
  });

  metadataObject[STAGE_TAG_DECISIONS_KEY] = decisions;
  return metadataObject;
}

function isAutomaticStageTagBlocked(metadata, tagType, tagKey, source) {
  if (tagType !== 'stage' || !tagKey || source === 'manual') {
    return false;
  }

  const decisions = getStageTagDecisions(metadata);
  const decision = decisions[tagKey];
  return decision?.decision === 'excluded' && decision?.source === 'manual';
}

function hydrateSessionRowsWithTags(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const sessionIds = Array.from(new Set(rows.map((row) => row?.id).filter(Boolean)));
  if (sessionIds.length === 0) {
    return rows.map(parseSessionRow).filter(Boolean);
  }

  // SQLite default SQLITE_MAX_VARIABLE_NUMBER is 999; use 900 to leave headroom.
  const chunkSize = 900;
  const tagsBySessionId = new Map();

  for (let index = 0; index < sessionIds.length; index += chunkSize) {
    const chunk = sessionIds.slice(index, index + chunkSize);
    const placeholders = chunk.map(() => '?').join(', ');
    const tagRows = db.prepare(`
      SELECT
        stl.session_id,
        pt.id,
        pt.project_name,
        pt.tag_key,
        pt.tag_type,
        pt.label,
        pt.color,
        pt.sort_order,
        pt.metadata,
        pt.created_at,
        stl.linked_by,
        stl.source,
        stl.metadata AS link_metadata,
        stl.created_at AS linked_at
      FROM session_tag_links stl
      JOIN project_tags pt ON pt.id = stl.tag_id
      WHERE stl.session_id IN (${placeholders})
      ORDER BY pt.sort_order ASC, pt.label COLLATE NOCASE ASC, pt.id ASC
    `).all(...chunk);

    tagRows.forEach((tagRow) => {
      const parsed = parseTagRow(tagRow);
      if (!parsed) {
        return;
      }

      const existing = tagsBySessionId.get(tagRow.session_id) || [];
      existing.push(parsed);
      tagsBySessionId.set(tagRow.session_id, existing);
    });
  }

  return rows.map((row) => parseSessionRow({
    ...row,
    tags: tagsBySessionId.get(row.id) || [],
  })).filter(Boolean);
}

const sessionDb = {
  // Upsert session metadata (insert if not exists, update if exists)
  upsertSession: (id, projectName, provider, displayName, lastActivity, messageCount = 0, metadata = null) => {
    try {
      sessionDb.upsertSessionFromSource(id, projectName, provider, {
        displayName,
        lastActivity,
        messageCount,
        metadata,
      });
    } catch (err) {
      console.error('Error upserting session metadata:', err.message);
    }
  },

  upsertSessionPlaceholder: (id, projectName, provider, displayName = null, lastActivity = null, metadata = null) => {
    try {
      const existing = parseSessionRow(db.prepare('SELECT * FROM session_metadata WHERE id = ?').get(id));
      const cleanedDisplayName = normalizeSessionDisplayName(displayName);
      const mergedMetadata = mergeSessionMetadata(existing?.metadata, metadata);
      const normalizedLastActivity = resolveLatestActivity(existing?.last_activity, lastActivity);

      if (!existing) {
        db.prepare(`
          INSERT INTO session_metadata (id, project_name, provider, display_name, last_activity, message_count, metadata, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          projectName,
          provider,
          cleanedDisplayName,
          normalizedLastActivity,
          0,
          Object.keys(mergedMetadata).length > 0 ? JSON.stringify(mergedMetadata) : null,
          normalizeSessionCreatedAt(lastActivity) || normalizeSessionCreatedAt(new Date())
        );
        return;
      }

      db.prepare(`
        UPDATE session_metadata
        SET project_name = ?,
            provider = ?,
            last_activity = ?,
            metadata = ?,
            display_name = CASE
              WHEN display_name IS NULL OR trim(display_name) = '' THEN ?
              ELSE display_name
            END
        WHERE id = ?
      `).run(
        projectName,
        provider,
        normalizedLastActivity,
        Object.keys(mergedMetadata).length > 0 ? JSON.stringify(mergedMetadata) : null,
        cleanedDisplayName,
        id
      );
    } catch (err) {
      console.error('Error upserting placeholder session metadata:', err.message);
    }
  },

  upsertSessionFromSource: (id, projectName, provider, payload = {}) => {
    try {
      const existing = parseSessionRow(db.prepare('SELECT * FROM session_metadata WHERE id = ?').get(id));
      const incomingDisplayName = normalizeSessionDisplayName(payload.displayName);
      const mergedMetadata = mergeSessionMetadata(existing?.metadata, payload.metadata);
      const normalizedLastActivity = resolveLatestActivity(existing?.last_activity, payload.lastActivity);
      const resolvedMessageCount = resolveMessageCount(existing?.message_count, payload.messageCount);
      const createdAt =
        existing?.created_at ||
        normalizeSessionCreatedAt(payload.createdAt) ||
        normalizeSessionCreatedAt(payload.lastActivity) ||
        normalizeSessionCreatedAt(new Date());
      const resolvedStarred = Number(payload.isStarred ?? existing?.is_starred ?? 0);

      if (!existing) {
        db.prepare(`
          INSERT INTO session_metadata (id, project_name, provider, display_name, last_activity, message_count, is_starred, metadata, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          projectName,
          provider,
          incomingDisplayName,
          normalizedLastActivity,
          resolvedMessageCount,
          resolvedStarred,
          Object.keys(mergedMetadata).length > 0 ? JSON.stringify(mergedMetadata) : null,
          createdAt
        );
        return;
      }

      db.prepare(`
        UPDATE session_metadata
        SET project_name = ?,
            provider = ?,
            display_name = ?,
            last_activity = ?,
            message_count = ?,
            is_starred = ?,
            metadata = ?
        WHERE id = ?
      `).run(
        projectName || existing.project_name,
        provider || existing.provider,
        incomingDisplayName || existing.display_name,
        normalizedLastActivity,
        resolvedMessageCount,
        resolvedStarred,
        Object.keys(mergedMetadata).length > 0 ? JSON.stringify(mergedMetadata) : null,
        id
      );
    } catch (err) {
      console.error('Error upserting session metadata from source:', err.message);
    }
  },

  // Update session name ONLY (priority for manual rename)
  updateSessionName: (id, displayName) => {
    try {
      const cleanedDisplayName = normalizeSessionDisplayName(displayName);
      const stmt = db.prepare('UPDATE session_metadata SET display_name = ? WHERE id = ?');
      stmt.run(cleanedDisplayName, id);
    } catch (err) {
      console.error('Error updating session name:', err.message);
    }
  },

  migrateSessionId: (oldId, newId, provider = null, projectName = null) => {
    try {
      if (!oldId || !newId || oldId === newId) {
        return;
      }

      const oldRow = parseSessionRow(db.prepare('SELECT * FROM session_metadata WHERE id = ?').get(oldId));
      if (!oldRow) {
        return;
      }

      const newRow = parseSessionRow(db.prepare('SELECT * FROM session_metadata WHERE id = ?').get(newId));
      const mergedMetadata = mergeSessionMetadata(oldRow.metadata, newRow?.metadata);
      const mergedLastActivity = resolveLatestActivity(oldRow.last_activity, newRow?.last_activity);
      const mergedMessageCount = resolveMessageCount(oldRow.message_count, newRow?.message_count);
      const mergedDisplayName =
        normalizeSessionDisplayName(newRow?.display_name) ||
        normalizeSessionDisplayName(oldRow.display_name);
      const mergedCreatedAt = newRow?.created_at || oldRow.created_at || normalizeSessionCreatedAt(mergedLastActivity) || normalizeSessionCreatedAt(new Date());
      const mergedStarred = Number(newRow?.is_starred || oldRow.is_starred || 0);

      const migrate = db.transaction(() => {
        if (!newRow) {
          db.prepare(`
            INSERT INTO session_metadata (id, project_name, provider, display_name, last_activity, message_count, is_starred, metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            newId,
            projectName || oldRow.project_name,
            provider || oldRow.provider,
            mergedDisplayName,
            mergedLastActivity,
            mergedMessageCount,
            mergedStarred,
            Object.keys(mergedMetadata).length > 0 ? JSON.stringify(mergedMetadata) : null,
            mergedCreatedAt
          );
        } else {
          db.prepare(`
            UPDATE session_metadata
            SET project_name = ?,
                provider = ?,
                display_name = ?,
                last_activity = ?,
                message_count = ?,
                is_starred = ?,
                metadata = ?,
                created_at = ?
            WHERE id = ?
          `).run(
            projectName || newRow.project_name || oldRow.project_name,
            provider || newRow.provider || oldRow.provider,
            mergedDisplayName,
            mergedLastActivity,
            mergedMessageCount,
            mergedStarred,
            Object.keys(mergedMetadata).length > 0 ? JSON.stringify(mergedMetadata) : null,
            mergedCreatedAt,
            newId
          );
        }

        db.prepare('DELETE FROM session_metadata WHERE id = ?').run(oldId);
      });

      migrate();
    } catch (err) {
      console.error('Error migrating session metadata ID:', err.message);
    }
  },

  // Get all metadata for sessions in a project
  getSessionsByProject: (projectName) => {
    try {
      const rows = db.prepare('SELECT * FROM session_metadata WHERE project_name = ?').all(projectName);
      return hydrateSessionRowsWithTags(rows);
    } catch (err) {
      console.error('Error getting project sessions:', err.message);
      return [];
    }
  },

  getSessionsByProjects: (projectNames = []) => {
    try {
      if (!Array.isArray(projectNames) || projectNames.length === 0) {
        return [];
      }

      // SQLite default SQLITE_MAX_VARIABLE_NUMBER is 999; use 900 to leave headroom.
  const chunkSize = 900;
      const allRows = [];

      for (let index = 0; index < projectNames.length; index += chunkSize) {
        const chunk = projectNames.slice(index, index + chunkSize);
        const placeholders = chunk.map(() => '?').join(', ');
        const rows = db.prepare(
          `SELECT * FROM session_metadata WHERE project_name IN (${placeholders}) ORDER BY datetime(last_activity) DESC, datetime(created_at) DESC`
        ).all(...chunk);
        allRows.push(...rows);
      }

      return hydrateSessionRowsWithTags(allRows);
    } catch (err) {
      console.error('Error getting sessions for projects:', err.message);
      return [];
    }
  },

  // Get metadata for a specific session
  getSessionById: (id) => {
    try {
      return hydrateSessionRowsWithTags([
        db.prepare('SELECT * FROM session_metadata WHERE id = ?').get(id)
      ])[0] || null;
    } catch (err) {
      console.error('Error getting session metadata:', err.message);
      return null;
    }
  },

  updateSessionMetadata: (id, updater) => {
    try {
      const row = db.prepare('SELECT metadata FROM session_metadata WHERE id = ?').get(id);
      if (!row) {
        return null;
      }

      const currentMetadata = row.metadata ? JSON.parse(row.metadata) : null;
      const nextMetadata = typeof updater === 'function'
        ? updater(normalizeMetadataObject(currentMetadata))
        : mergeSessionMetadata(currentMetadata, updater);

      db.prepare('UPDATE session_metadata SET metadata = ? WHERE id = ?').run(
        serializeMetadata(nextMetadata),
        id
      );

      return sessionDb.getSessionById(id);
    } catch (err) {
      console.error('Error updating session metadata:', err.message);
      return null;
    }
  },

  getSessionContextReview: (id) => {
    try {
      const session = sessionDb.getSessionById(id);
      const files = session?.metadata?.contextReview?.files;
      return files && typeof files === 'object' ? files : {};
    } catch (err) {
      console.error('Error getting session context review state:', err.message);
      return {};
    }
  },

  updateSessionContextReview: (id, reviews = {}) => {
    try {
      const existingReviews = sessionDb.getSessionContextReview(id);
      const sanitizedReviews = Object.entries(reviews || {}).reduce((acc, [filePath, value]) => {
        if (!filePath || typeof filePath !== 'string') {
          return acc;
        }

        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          return acc;
        }

        const reviewedAt = typeof value.reviewedAt === 'string' ? value.reviewedAt : null;
        const lastSeenAt = typeof value.lastSeenAt === 'string' ? value.lastSeenAt : null;
        const lastReviewedSeenAt = typeof value.lastReviewedSeenAt === 'string' ? value.lastReviewedSeenAt : null;

        acc[filePath] = {
          reviewedAt,
          lastSeenAt,
          lastReviewedSeenAt,
        };
        return acc;
      }, {});

      const nextFiles = {
        ...existingReviews,
        ...sanitizedReviews,
      };

      sessionDb.updateSessionMetadata(id, {
        contextReview: {
          files: nextFiles,
          updatedAt: new Date().toISOString(),
        },
      });

      return nextFiles;
    } catch (err) {
      console.error('Error updating session context review state:', err.message);
      return {};
    }
  },

  deleteSession: (id) => {
    try {
      db.prepare('DELETE FROM session_metadata WHERE id = ?').run(id);
    } catch (err) {
      console.error('Error deleting session metadata:', err.message);
    }
  },

  deleteSessionsByProject: (projectName) => {
    try {
      db.prepare('DELETE FROM session_metadata WHERE project_name = ?').run(projectName);
    } catch (err) {
      console.error('Error deleting project session metadata:', err.message);
    }
  },

  listTrashedSessions: (userId = null) => {
    try {
      // Prefer JSON1 query for performance; fall back to in-memory filter if unavailable.
      const baseQuery = userId
        ? `
            SELECT sm.*
            FROM session_metadata sm
            JOIN projects p ON p.id = sm.project_name
            WHERE p.user_id = ?
          `
        : `
            SELECT sm.*
            FROM session_metadata sm
          `;

      let rows = [];
      try {
        rows = userId
          ? db.prepare(
              `${baseQuery} AND json_extract(sm.metadata, '$.trash.trashedAt') IS NOT NULL
               ORDER BY datetime(json_extract(sm.metadata, '$.trash.trashedAt')) DESC,
                        datetime(sm.last_activity) DESC,
                        datetime(sm.created_at) DESC`
            ).all(userId)
          : db.prepare(
              `${baseQuery} WHERE json_extract(sm.metadata, '$.trash.trashedAt') IS NOT NULL
               ORDER BY datetime(json_extract(sm.metadata, '$.trash.trashedAt')) DESC,
                        datetime(sm.last_activity) DESC,
                        datetime(sm.created_at) DESC`
            ).all();
      } catch (jsonError) {
        const allRows = userId
          ? db.prepare(baseQuery).all(userId)
          : db.prepare(baseQuery).all();
        rows = allRows.filter((row) => {
          try {
            const meta = row.metadata ? JSON.parse(row.metadata) : null;
            return Boolean(meta?.trash?.trashedAt);
          } catch {
            return false;
          }
        });
      }

      return hydrateSessionRowsWithTags(rows);
    } catch (err) {
      console.error('Error listing trashed sessions:', err.message);
      return [];
    }
  },

  setSessionTrash: (id, trashPatch = {}) => {
    return sessionDb.updateSessionMetadata(id, (current) => ({
      ...(current || {}),
      trash: {
        ...(current?.trash || {}),
        ...trashPatch,
      },
    }));
  },

  clearSessionTrash: (id) => {
    return sessionDb.updateSessionMetadata(id, (current) => {
      const next = { ...(current || {}) };
      delete next.trash;
      return next;
    });
  }
};

const tagDb = {
  ensureDefaultStageTags: (projectName) => {
    if (!projectName) {
      return [];
    }

    const insert = db.prepare(`
      INSERT OR IGNORE INTO project_tags (
        project_name, tag_key, tag_type, label, color, sort_order, metadata
      ) VALUES (?, ?, 'stage', ?, ?, ?, ?)
    `);

    const run = db.transaction(() => {
      DEFAULT_STAGE_TAGS.forEach((tag) => {
        insert.run(
          projectName,
          tag.tagKey,
          tag.label,
          tag.color,
          tag.sortOrder,
          null
        );
      });
    });

    try {
      run();
    } catch (err) {
      console.error('Error ensuring default stage tags:', err.message);
    }

    return tagDb.listProjectTags(projectName, 'stage');
  },

  listProjectTags: (projectName, tagType = null) => {
    try {
      const rows = tagType
        ? db.prepare(`
            SELECT * FROM project_tags
            WHERE project_name = ? AND tag_type = ?
            ORDER BY sort_order ASC, label COLLATE NOCASE ASC, id ASC
          `).all(projectName, tagType)
        : db.prepare(`
            SELECT * FROM project_tags
            WHERE project_name = ?
            ORDER BY tag_type COLLATE NOCASE ASC, sort_order ASC, label COLLATE NOCASE ASC, id ASC
          `).all(projectName);
      return rows.map(parseTagRow).filter(Boolean);
    } catch (err) {
      console.error('Error listing project tags:', err.message);
      return [];
    }
  },

  getTagByProjectAndKey: (projectName, tagType, tagKey) => {
    try {
      return parseTagRow(db.prepare(`
        SELECT * FROM project_tags
        WHERE project_name = ? AND tag_type = ? AND tag_key = ?
      `).get(projectName, tagType, tagKey));
    } catch (err) {
      console.error('Error getting project tag:', err.message);
      return null;
    }
  },

  getTagsByIds: (projectName, tagIds = []) => {
    try {
      if (!Array.isArray(tagIds) || tagIds.length === 0) {
        return [];
      }

      const normalizedIds = Array.from(new Set(
        tagIds
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0)
      ));

      if (normalizedIds.length === 0) {
        return [];
      }

      const placeholders = normalizedIds.map(() => '?').join(', ');
      const rows = db.prepare(`
        SELECT * FROM project_tags
        WHERE project_name = ? AND id IN (${placeholders})
        ORDER BY sort_order ASC, label COLLATE NOCASE ASC, id ASC
      `).all(projectName, ...normalizedIds);
      return rows.map(parseTagRow).filter(Boolean);
    } catch (err) {
      console.error('Error getting project tags by ids:', err.message);
      return [];
    }
  },

  listTagsForSession: (sessionId) => {
    try {
      const rows = db.prepare(`
        SELECT
          pt.id,
          pt.project_name,
          pt.tag_key,
          pt.tag_type,
          pt.label,
          pt.color,
          pt.sort_order,
          pt.metadata,
          pt.created_at,
          stl.linked_by,
          stl.source,
          stl.metadata AS link_metadata,
          stl.created_at AS linked_at
        FROM session_tag_links stl
        JOIN project_tags pt ON pt.id = stl.tag_id
        WHERE stl.session_id = ?
        ORDER BY pt.sort_order ASC, pt.label COLLATE NOCASE ASC, pt.id ASC
      `).all(sessionId);
      return rows.map(parseTagRow).filter(Boolean);
    } catch (err) {
      console.error('Error listing session tags:', err.message);
      return [];
    }
  },

  listSessionIdsForTag: (projectName, tagType, tagKey) => {
    try {
      const rows = db.prepare(`
        SELECT stl.session_id
        FROM session_tag_links stl
        JOIN project_tags pt ON pt.id = stl.tag_id
        WHERE pt.project_name = ? AND pt.tag_type = ? AND pt.tag_key = ?
        ORDER BY datetime(stl.created_at) DESC
      `).all(projectName, tagType, tagKey);
      return rows.map((row) => row.session_id).filter(Boolean);
    } catch (err) {
      console.error('Error listing session ids for tag:', err.message);
      return [];
    }
  },

  replaceSessionTags: (sessionId, projectName, tagIds = [], options = {}) => {
    try {
      const selectedTags = tagDb.getTagsByIds(projectName, tagIds);
      const projectStageTags = tagDb.listProjectTags(projectName, 'stage');
      const normalizedTagIds = selectedTags.map((tag) => tag.id);
      const linkedBy = options.linkedBy || null;
      const source = options.source || null;
      const metadata = options.metadata && typeof options.metadata === 'object'
        ? JSON.stringify(options.metadata)
        : null;

      const replace = db.transaction(() => {
        db.prepare(`
          DELETE FROM session_tag_links
          WHERE session_id = ?
            AND tag_id IN (SELECT id FROM project_tags WHERE project_name = ?)
        `).run(sessionId, projectName);

        const insert = db.prepare(`
          INSERT OR IGNORE INTO session_tag_links (
            session_id, tag_id, linked_by, source, metadata
          ) VALUES (?, ?, ?, ?, ?)
        `);

        normalizedTagIds.forEach((tagId) => {
          insert.run(sessionId, tagId, linkedBy, source, metadata);
        });

        if (source === 'manual') {
          const session = parseSessionRow(db.prepare('SELECT * FROM session_metadata WHERE id = ?').get(sessionId));
          if (session) {
            const nextMetadata = applyManualStageTagDecisions(session.metadata, projectStageTags, selectedTags);
            db.prepare('UPDATE session_metadata SET metadata = ? WHERE id = ?').run(
              serializeMetadata(nextMetadata),
              sessionId
            );
          }
        }
      });

      replace();
      return tagDb.listTagsForSession(sessionId);
    } catch (err) {
      console.error('Error replacing session tags:', err.message);
      return [];
    }
  },

  appendSessionTagsByKeys: (sessionId, projectName, tagType, tagKeys = [], options = {}) => {
    try {
      const normalizedKeys = Array.from(new Set(
        (Array.isArray(tagKeys) ? tagKeys : [])
          .map((value) => String(value || '').trim())
          .filter(Boolean)
      ));

      if (normalizedKeys.length === 0) {
        return tagDb.listTagsForSession(sessionId);
      }

      const session = parseSessionRow(db.prepare('SELECT * FROM session_metadata WHERE id = ?').get(sessionId));
      const linkedBy = options.linkedBy || null;
      const source = options.source || null;
      const metadata = options.metadata && typeof options.metadata === 'object'
        ? JSON.stringify(options.metadata)
        : null;
      const insert = db.prepare(`
        INSERT OR IGNORE INTO session_tag_links (
          session_id, tag_id, linked_by, source, metadata
        ) VALUES (?, ?, ?, ?, ?)
      `);

      const append = db.transaction(() => {
        normalizedKeys.forEach((tagKey) => {
          if (isAutomaticStageTagBlocked(session?.metadata, tagType, tagKey, source)) {
            return;
          }

          const tag = tagDb.getTagByProjectAndKey(projectName, tagType, tagKey);
          if (tag) {
            insert.run(sessionId, tag.id, linkedBy, source, metadata);
          }
        });
      });

      append();
      return tagDb.listTagsForSession(sessionId);
    } catch (err) {
      console.error('Error appending session tags:', err.message);
      return [];
    }
  },
};

function resolveProjectUserIdForInsert(userId) {
  if (userId === undefined || userId === null || userId === '') {
    return null;
  }

  try {
    const row = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    return row?.id ?? null;
  } catch {
    return null;
  }
}

// Project index operations
const projectDb = {
  // Upsert project (insert if not exists, update if exists)
  upsertProject: (id, userId, displayName, path, isStarred = 0, lastAccessed = null, metadata = null) => {
    try {
      const resolvedUserId = resolveProjectUserIdForInsert(userId);
      const stmt = db.prepare(`
        INSERT INTO projects (id, user_id, display_name, path, is_starred, last_accessed, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          display_name = COALESCE(excluded.display_name, projects.display_name),
          path = COALESCE(excluded.path, projects.path),
          user_id = CASE WHEN projects.user_id IS NULL THEN excluded.user_id ELSE projects.user_id END,
          is_starred = COALESCE(excluded.is_starred, projects.is_starred),
          last_accessed = COALESCE(excluded.last_accessed, projects.last_accessed),
          metadata = COALESCE(excluded.metadata, projects.metadata)
      `);
      stmt.run(id, resolvedUserId, displayName, path, isStarred, lastAccessed, metadata ? JSON.stringify(metadata) : null);
    } catch (err) {
      console.error('Error upserting project metadata:', err.message);
    }
  },

  // Update project name ONLY
  updateProjectName: (id, displayName) => {
    try {
      db.prepare('UPDATE projects SET display_name = ? WHERE id = ?').run(displayName, id);
    } catch (err) {
      console.error('Error updating project name:', err.message);
    }
  },

  // Merge + update project metadata JSON
  updateProjectMetadata: (id, patch = {}) => {
    try {
      const row = projectDb.getProjectById(id);
      const current = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
      const next = { ...current, ...(patch && typeof patch === 'object' ? patch : {}) };
      db.prepare('UPDATE projects SET metadata = ? WHERE id = ?').run(
        Object.keys(next).length > 0 ? JSON.stringify(next) : null,
        id,
      );
      return next;
    } catch (err) {
      console.error('Error updating project metadata:', err.message);
      return null;
    }
  },

  // Replace project metadata JSON entirely
  setProjectMetadata: (id, metadata = null) => {
    try {
      const payload =
        metadata && typeof metadata === 'object' && Object.keys(metadata).length > 0
          ? JSON.stringify(metadata)
          : null;
      db.prepare('UPDATE projects SET metadata = ? WHERE id = ?').run(payload, id);
    } catch (err) {
      console.error('Error setting project metadata:', err.message);
    }
  },

  // Get all projects (can filter by userId later)
  getAllProjects: (userId = null) => {
    try {
      const query = userId ? 'SELECT * FROM projects WHERE user_id = ?' : 'SELECT * FROM projects';
      const rows = userId ? db.prepare(query).all(userId) : db.prepare(query).all();
      return rows.map(row => ({
        ...row,
        metadata: row.metadata ? JSON.parse(row.metadata) : null
      }));
    } catch (err) {
      console.error('Error getting projects:', err.message);
      return [];
    }
  },

  // Get project by its encoded ID
  getProjectById: (id) => {
    try {
      const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
      if (row && row.metadata) {
        row.metadata = JSON.parse(row.metadata);
      }
      return row;
    } catch (err) {
      console.error('Error getting project metadata:', err.message);
      return null;
    }
  },

  // Get project by its file-system path (uses idx_projects_path index)
  getProjectByPath: (projectPath, userId = null) => {
    try {
      const query = userId
        ? 'SELECT * FROM projects WHERE path = ? AND user_id = ?'
        : 'SELECT * FROM projects WHERE path = ?';
      const row = userId
        ? db.prepare(query).get(projectPath, userId)
        : db.prepare(query).get(projectPath);
      if (row && row.metadata) {
        row.metadata = JSON.parse(row.metadata);
      }
      return row || null;
    } catch (err) {
      console.error('Error getting project by path:', err.message);
      return null;
    }
  },

  toggleStar: (id, isStarred) => {
    try {
      db.prepare('UPDATE projects SET is_starred = ? WHERE id = ?').run(isStarred ? 1 : 0, id);
    } catch (err) {
      console.error('Error toggling project star:', err.message);
    }
  },

  deleteProject: (id) => {
    try {
      db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    } catch (err) {
      console.error('Error deleting project metadata:', err.message);
    }
  },

  updateProjectPath: (id, projectPath) => {
    try {
      db.prepare('UPDATE projects SET path = ? WHERE id = ?').run(projectPath, id);
    } catch (err) {
      console.error('Error updating project path:', err.message);
    }
  },

  migrateProjectIdentity: (oldId, newId, projectPath) => {
    const migrate = db.transaction(() => {
      db.prepare('UPDATE projects SET id = ?, path = ? WHERE id = ?').run(newId, projectPath, oldId);
      db.prepare('UPDATE session_metadata SET project_name = ? WHERE project_name = ?').run(newId, oldId);
    });

    try {
      migrate();
    } catch (err) {
      console.error('Error migrating project identity:', err.message);
      throw err;
    }
  }
};

function normalizeProjectActivityText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function normalizeProjectActivityTimestamp(value, fallback = new Date()) {
  const candidate = value instanceof Date ? value : new Date(value || fallback);
  if (Number.isNaN(candidate.getTime())) {
    return new Date(fallback).toISOString();
  }
  return candidate.toISOString();
}

function mapProjectActivityEventRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    metadata: parseJsonObject(row.metadata_json),
  };
}

const projectActivityDb = {
  recordProjectOpen: (userId, event = {}) => {
    try {
      const projectId = normalizeProjectActivityText(
        event?.projectId || event?.project_id || event?.projectName || event?.project_name,
      );
      if (!userId || !projectId) {
        return null;
      }

      const id = `project_activity_${crypto.randomUUID()}`;
      const occurredAt = normalizeProjectActivityTimestamp(event?.occurredAt || event?.occurred_at || new Date());
      const metadata = event?.metadata && typeof event.metadata === 'object' ? event.metadata : null;

      db.prepare(`
        INSERT INTO project_activity_events (
          id, user_id, project_id, project_path, event_type, occurred_at, metadata_json
        )
        VALUES (?, ?, ?, ?, 'project_open', ?, ?)
      `).run(
        id,
        userId,
        projectId,
        normalizeProjectActivityText(event?.projectPath || event?.project_path) || null,
        occurredAt,
        serializeJsonValue(metadata),
      );

      return mapProjectActivityEventRow(
        db.prepare('SELECT * FROM project_activity_events WHERE id = ? AND user_id = ?').get(id, userId),
      );
    } catch (err) {
      throw err;
    }
  },

  getActivity: (userId, { days = PROJECT_ACTIVITY_DEFAULT_DAYS, timezoneOffsetMinutes = 0, now = new Date() } = {}) => {
    try {
      const normalizedDays = normalizeProjectActivityDays(days);
      const normalizedOffset = normalizeProjectActivityTimezoneOffset(timezoneOffsetMinutes);
      const dateKeys = buildProjectActivityDateKeys(normalizedDays, normalizedOffset, now);
      const startDate = dateKeys[0];
      const endDate = dateKeys[dateKeys.length - 1];
      const localDateShiftMinutes = -normalizedOffset;
      const localDateModifier = `${localDateShiftMinutes >= 0 ? '+' : ''}${localDateShiftMinutes} minutes`;

      const rows = db.prepare(`
        SELECT
          activity_date AS date,
          COUNT(*) AS open_count,
          COUNT(DISTINCT project_key) AS project_count
        FROM (
          SELECT
            date(datetime(occurred_at, ?)) AS activity_date,
            COALESCE(NULLIF(project_id, ''), NULLIF(project_path, ''), id) AS project_key
          FROM project_activity_events
          WHERE user_id = ?
            AND event_type = 'project_open'
            AND occurred_at IS NOT NULL
        )
        WHERE activity_date BETWEEN ? AND ?
        GROUP BY activity_date
        ORDER BY activity_date ASC
      `).all(localDateModifier, userId, startDate, endDate);

      const totalProjectsRow = db.prepare(`
        SELECT COUNT(DISTINCT COALESCE(NULLIF(project_id, ''), NULLIF(project_path, ''), id)) AS total_projects
        FROM project_activity_events
        WHERE user_id = ?
          AND event_type = 'project_open'
          AND occurred_at IS NOT NULL
          AND date(datetime(occurred_at, ?)) BETWEEN ? AND ?
      `).get(userId, localDateModifier, startDate, endDate);

      const rowsByDate = new Map(rows.map((row) => [
        row.date,
        {
          date: row.date,
          open_count: Number(row.open_count || 0),
          project_count: Number(row.project_count || 0),
        },
      ]));

      const activityDays = dateKeys.map((date) => (
        rowsByDate.get(date) || {
          date,
          open_count: 0,
          project_count: 0,
        }
      ));

      const totals = activityDays.reduce((acc, day) => {
        acc.total_opens += day.open_count;
        if (day.open_count > 0 || day.project_count > 0) {
          acc.active_days += 1;
        }
        return acc;
      }, {
        total_opens: 0,
        total_projects: Number(totalProjectsRow?.total_projects || 0),
        active_days: 0,
      });

      return {
        days: activityDays,
        totals,
        range: {
          start_date: startDate,
          end_date: endDate,
          day_count: normalizedDays,
        },
        timezone_offset_minutes: normalizedOffset,
        generated_at: now.toISOString(),
      };
    } catch (err) {
      throw err;
    }
  },
};

function normalizeProjectActivityDays(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return PROJECT_ACTIVITY_DEFAULT_DAYS;
  }
  return Math.min(Math.max(parsed, 1), PROJECT_ACTIVITY_MAX_DAYS);
}

function normalizeProjectActivityTimezoneOffset(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.min(Math.max(parsed, -14 * 60), 14 * 60);
}

function formatProjectActivityDateKey(value) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildProjectActivityDateKeys(days, timezoneOffsetMinutes, now = new Date()) {
  const normalizedDays = normalizeProjectActivityDays(days);
  const normalizedOffset = normalizeProjectActivityTimezoneOffset(timezoneOffsetMinutes);
  const localNowMs = now.getTime() - (normalizedOffset * 60 * 1000);
  const localToday = new Date(localNowMs);
  const todayUtcMidnightMs = Date.UTC(
    localToday.getUTCFullYear(),
    localToday.getUTCMonth(),
    localToday.getUTCDate(),
  );
  const firstDayMs = todayUtcMidnightMs - ((normalizedDays - 1) * PROJECT_ACTIVITY_MS_PER_DAY);

  return Array.from({ length: normalizedDays }, (_, index) => (
    formatProjectActivityDateKey(new Date(firstDayMs + (index * PROJECT_ACTIVITY_MS_PER_DAY)))
  ));
}

function normalizeConceptString(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function normalizeStringList(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = normalizeConceptString(value);
    if (!normalized) {
      continue;
    }
    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    result.push(normalized);
  }
  return result;
}

function parseJsonArray(value) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function serializeJsonValue(value) {
  if (value == null) {
    return null;
  }

  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }

  if (typeof value === 'object') {
    return Object.keys(value).length > 0 ? JSON.stringify(value) : null;
  }

  return null;
}

function mapConceptRow(row) {
  if (!row) {
    return null;
  }

  const {
    aliases_json,
    metadata_json,
    evidence_count,
    ...rest
  } = row;

  return {
    ...rest,
    aliases: normalizeStringList(parseJsonArray(aliases_json)),
    metadata: parseJsonObject(metadata_json),
    evidence_count: Number(evidence_count || 0),
  };
}

function mapConceptEvidenceRow(row) {
  if (!row) {
    return null;
  }

  const {
    metadata_json,
    extraction_confidence,
    ...rest
  } = row;

  return {
    ...rest,
    metadata: parseJsonObject(metadata_json),
    extraction_confidence: extraction_confidence == null ? null : Number(extraction_confidence),
  };
}

// Structured concept + evidence operations
const conceptsDb = {
  findConceptByCanonical: (userId, conceptType, canonicalName, { excludeId } = {}) => {
    try {
      const normalizedType = normalizeConceptString(conceptType);
      const normalizedName = normalizeConceptString(canonicalName);
      if (!normalizedType || !normalizedName) {
        return null;
      }

      const clauses = [
        'user_id = ?',
        'concept_type = ?',
        'LOWER(canonical_name) = LOWER(?)',
      ];
      const params = [userId, normalizedType, normalizedName];

      if (excludeId) {
        clauses.push('id != ?');
        params.push(excludeId);
      }

      const row = db.prepare(`
        SELECT c.*, (
          SELECT COUNT(*)
          FROM concept_evidence e
          WHERE e.concept_id = c.id
        ) AS evidence_count
        FROM clinical_concepts c
        WHERE ${clauses.join(' AND ')}
        LIMIT 1
      `).get(...params);

      return mapConceptRow(row);
    } catch (err) {
      throw err;
    }
  },

  createConcept: (userId, concept) => {
    try {
      const id = `concept_${crypto.randomUUID()}`;
      const canonicalName = normalizeConceptString(concept?.canonical_name);
      const displayName = normalizeConceptString(concept?.display_name || canonicalName);
      const aliases = normalizeStringList(concept?.aliases);
      const metadata = concept?.metadata && typeof concept.metadata === 'object' ? concept.metadata : null;

      db.prepare(`
        INSERT INTO clinical_concepts (
          id, user_id, concept_type, canonical_name, display_name, aliases_json,
          description, ontology_source, ontology_id, status, source_strategy,
          metadata_json, first_seen_at, last_seen_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        id,
        userId,
        normalizeConceptString(concept?.concept_type),
        canonicalName,
        displayName || null,
        serializeJsonValue(aliases),
        normalizeConceptString(concept?.description) || null,
        normalizeConceptString(concept?.ontology_source) || null,
        normalizeConceptString(concept?.ontology_id) || null,
        normalizeConceptString(concept?.status || 'reviewed'),
        normalizeConceptString(concept?.source_strategy || 'manual'),
        serializeJsonValue(metadata),
        normalizeConceptString(concept?.first_seen_at) || null,
        normalizeConceptString(concept?.last_seen_at) || null,
      );

      return conceptsDb.getConcept(userId, id);
    } catch (err) {
      throw err;
    }
  },

  listConcepts: (userId, { search, conceptTypes, statuses, limit = 50, offset = 0 } = {}) => {
    try {
      const clauses = ['c.user_id = ?'];
      const params = [userId];

      if (search) {
        const term = `%${search}%`;
        clauses.push('(c.canonical_name LIKE ? OR c.display_name LIKE ? OR c.aliases_json LIKE ? OR c.description LIKE ?)');
        params.push(term, term, term, term);
      }

      if (Array.isArray(conceptTypes) && conceptTypes.length > 0) {
        clauses.push(`c.concept_type IN (${conceptTypes.map(() => '?').join(',')})`);
        params.push(...conceptTypes.map((value) => normalizeConceptString(value)).filter(Boolean));
      }

      if (Array.isArray(statuses) && statuses.length > 0) {
        clauses.push(`c.status IN (${statuses.map(() => '?').join(',')})`);
        params.push(...statuses.map((value) => normalizeConceptString(value)).filter(Boolean));
      }

      params.push(limit, offset);

      const rows = db.prepare(`
        SELECT
          c.*,
          COUNT(e.id) AS evidence_count
        FROM clinical_concepts c
        LEFT JOIN concept_evidence e ON e.concept_id = c.id
        WHERE ${clauses.join(' AND ')}
        GROUP BY c.id
        ORDER BY c.updated_at DESC, c.created_at DESC
        LIMIT ? OFFSET ?
      `).all(...params);

      return rows.map(mapConceptRow);
    } catch (err) {
      throw err;
    }
  },

  getConcept: (userId, conceptId) => {
    try {
      const row = db.prepare(`
        SELECT
          c.*,
          COUNT(e.id) AS evidence_count
        FROM clinical_concepts c
        LEFT JOIN concept_evidence e ON e.concept_id = c.id
        WHERE c.user_id = ? AND c.id = ?
        GROUP BY c.id
        LIMIT 1
      `).get(userId, conceptId);

      return mapConceptRow(row);
    } catch (err) {
      throw err;
    }
  },

  updateConcept: (userId, conceptId, updates = {}) => {
    try {
      const fields = [];
      const params = [];

      if (Object.prototype.hasOwnProperty.call(updates, 'concept_type')) {
        fields.push('concept_type = ?');
        params.push(normalizeConceptString(updates.concept_type));
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'canonical_name')) {
        fields.push('canonical_name = ?');
        params.push(normalizeConceptString(updates.canonical_name));
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'display_name')) {
        fields.push('display_name = ?');
        params.push(normalizeConceptString(updates.display_name) || null);
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'aliases')) {
        fields.push('aliases_json = ?');
        params.push(serializeJsonValue(normalizeStringList(updates.aliases)));
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'description')) {
        fields.push('description = ?');
        params.push(normalizeConceptString(updates.description) || null);
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'ontology_source')) {
        fields.push('ontology_source = ?');
        params.push(normalizeConceptString(updates.ontology_source) || null);
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'ontology_id')) {
        fields.push('ontology_id = ?');
        params.push(normalizeConceptString(updates.ontology_id) || null);
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'status')) {
        fields.push('status = ?');
        params.push(normalizeConceptString(updates.status));
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'source_strategy')) {
        fields.push('source_strategy = ?');
        params.push(normalizeConceptString(updates.source_strategy));
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'metadata')) {
        const metadata = updates.metadata && typeof updates.metadata === 'object' ? updates.metadata : null;
        fields.push('metadata_json = ?');
        params.push(serializeJsonValue(metadata));
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'first_seen_at')) {
        fields.push('first_seen_at = ?');
        params.push(normalizeConceptString(updates.first_seen_at) || null);
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'last_seen_at')) {
        fields.push('last_seen_at = ?');
        params.push(normalizeConceptString(updates.last_seen_at) || null);
      }

      if (fields.length === 0) {
        return conceptsDb.getConcept(userId, conceptId);
      }

      fields.push('updated_at = CURRENT_TIMESTAMP');
      params.push(conceptId, userId);

      const result = db.prepare(`
        UPDATE clinical_concepts
        SET ${fields.join(', ')}
        WHERE id = ? AND user_id = ?
      `).run(...params);

      if (result.changes === 0) {
        return null;
      }

      return conceptsDb.getConcept(userId, conceptId);
    } catch (err) {
      throw err;
    }
  },

  deleteConcept: (userId, conceptId) => {
    try {
      const result = db.prepare(`
        DELETE FROM clinical_concepts
        WHERE id = ? AND user_id = ?
      `).run(conceptId, userId);

      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  createConceptEvidence: (userId, conceptId, evidence) => {
    try {
      const id = `evidence_${crypto.randomUUID()}`;
      const metadata = evidence?.metadata && typeof evidence.metadata === 'object' ? evidence.metadata : null;

      db.prepare(`
        INSERT INTO concept_evidence (
          id, concept_id, user_id, reference_id, project_id, evidence_type,
          evidence_text, evidence_location, direction, evidence_level,
          extraction_confidence, review_status, review_note, metadata_json, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        id,
        conceptId,
        userId,
        normalizeConceptString(evidence?.reference_id) || null,
        normalizeConceptString(evidence?.project_id) || null,
        normalizeConceptString(evidence?.evidence_type),
        normalizeConceptString(evidence?.evidence_text),
        normalizeConceptString(evidence?.evidence_location) || null,
        normalizeConceptString(evidence?.direction || 'supporting'),
        normalizeConceptString(evidence?.evidence_level || 'moderate'),
        evidence?.extraction_confidence == null ? null : Number(evidence.extraction_confidence),
        normalizeConceptString(evidence?.review_status || 'accepted'),
        normalizeConceptString(evidence?.review_note) || null,
        serializeJsonValue(metadata),
      );

      return conceptsDb.getConceptEvidenceById(userId, id);
    } catch (err) {
      throw err;
    }
  },

  getConceptEvidenceById: (userId, evidenceId) => {
    try {
      const row = db.prepare(`
        SELECT
          e.*,
          r.title AS reference_title,
          r.year AS reference_year,
          r.journal AS reference_journal
        FROM concept_evidence e
        LEFT JOIN references_library r ON r.id = e.reference_id
        WHERE e.user_id = ? AND e.id = ?
        LIMIT 1
      `).get(userId, evidenceId);

      return mapConceptEvidenceRow(row);
    } catch (err) {
      throw err;
    }
  },

  getConceptEvidence: (userId, conceptId, { limit = 100, offset = 0 } = {}) => {
    try {
      const rows = db.prepare(`
        SELECT
          e.*,
          r.title AS reference_title,
          r.year AS reference_year,
          r.journal AS reference_journal
        FROM concept_evidence e
        LEFT JOIN references_library r ON r.id = e.reference_id
        WHERE e.user_id = ? AND e.concept_id = ?
        ORDER BY e.created_at DESC, e.updated_at DESC
        LIMIT ? OFFSET ?
      `).all(userId, conceptId, limit, offset);

      return rows.map(mapConceptEvidenceRow);
    } catch (err) {
      throw err;
    }
  },

  getOverviewStats: (userId) => {
    try {
      const conceptStats = db.prepare(`
        SELECT
          COUNT(*) AS total_concepts,
          COALESCE(SUM(CASE WHEN status = 'stable' THEN 1 ELSE 0 END), 0) AS stable_concepts,
          COALESCE(SUM(CASE WHEN status = 'reviewed' THEN 1 ELSE 0 END), 0) AS reviewed_concepts,
          COALESCE(SUM(CASE WHEN status = 'candidate' THEN 1 ELSE 0 END), 0) AS candidate_concepts
        FROM clinical_concepts
        WHERE user_id = ?
      `).get(userId);

      const evidenceStats = db.prepare(`
        SELECT COUNT(*) AS total_evidence
        FROM concept_evidence
        WHERE user_id = ?
      `).get(userId);

      return {
        total_concepts: Number(conceptStats?.total_concepts || 0),
        stable_concepts: Number(conceptStats?.stable_concepts || 0),
        reviewed_concepts: Number(conceptStats?.reviewed_concepts || 0),
        candidate_concepts: Number(conceptStats?.candidate_concepts || 0),
        total_evidence: Number(evidenceStats?.total_evidence || 0),
      };
    } catch (err) {
      throw err;
    }
  },
};

// References (literature library) database operations
const referencesDb = {
  /**
   * Batch upsert references from Zotero or other sources.
   * Deduplicates by source_id for the given user.
   */
  syncFromZotero: (userId, items) => {
    const upsert = db.prepare(`
      INSERT INTO references_library (id, user_id, title, authors, year, abstract, doi, url, journal, item_type, source, source_id, keywords, citation_key, raw_data, library_visible, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'zotero', ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        authors = excluded.authors,
        year = excluded.year,
        abstract = excluded.abstract,
        doi = excluded.doi,
        url = excluded.url,
        journal = excluded.journal,
        item_type = excluded.item_type,
        keywords = excluded.keywords,
        citation_key = excluded.citation_key,
        raw_data = excluded.raw_data,
        library_visible = 1,
        updated_at = CURRENT_TIMESTAMP
    `);

    const insertTag = db.prepare(`
      INSERT OR IGNORE INTO reference_tags (reference_id, tag) VALUES (?, ?)
    `);

    const deleteTags = db.prepare(`DELETE FROM reference_tags WHERE reference_id = ?`);

    const tx = db.transaction((rows) => {
      const ids = [];
      for (const item of rows) {
        // Deterministic id: user + source_id
        const id = `zotero_${userId}_${item.sourceId}`;
        upsert.run(
          id,
          userId,
          item.title,
          JSON.stringify(item.authors || []),
          item.year,
          item.abstract,
          item.doi,
          item.url,
          item.journal,
          item.itemType || 'article',
          item.sourceId,
          JSON.stringify(item.keywords || []),
          item.citationKey,
          item.rawData ? JSON.stringify(item.rawData) : null,
        );
        // Clean stale tags, then re-insert
        deleteTags.run(id);
        for (const tag of item.keywords || []) {
          insertTag.run(id, tag);
        }
        ids.push(id);
      }
      return ids;
    });

    try {
      return tx(items);
    } catch (err) {
      throw err;
    }
  },

  /**
   * Import references from BibTeX (or other non-Zotero sources).
   */
  importReferences: (userId, items, source = 'bibtex', { libraryVisible = true } = {}) => {
    const upsert = db.prepare(`
      INSERT INTO references_library (id, user_id, title, authors, year, abstract, doi, url, journal, item_type, source, source_id, keywords, citation_key, raw_data, library_visible, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        authors = excluded.authors,
        year = excluded.year,
        abstract = excluded.abstract,
        doi = excluded.doi,
        url = excluded.url,
        journal = excluded.journal,
        item_type = excluded.item_type,
        keywords = excluded.keywords,
        citation_key = excluded.citation_key,
        raw_data = COALESCE(excluded.raw_data, references_library.raw_data),
        library_visible = MAX(COALESCE(references_library.library_visible, 1), excluded.library_visible),
        updated_at = CURRENT_TIMESTAMP
    `);

    const insertTag = db.prepare(`
      INSERT OR IGNORE INTO reference_tags (reference_id, tag) VALUES (?, ?)
    `);

    const deleteTags = db.prepare(`DELETE FROM reference_tags WHERE reference_id = ?`);

    const tx = db.transaction((rows) => {
      const ids = [];
      for (const item of rows) {
        // When no citationKey, generate deterministic ID from content
        let key = item.citationKey;
        if (!key) {
          const hash = crypto.createHash('sha256')
            .update(`${item.title || ''}|${JSON.stringify(item.authors || [])}|${item.year || ''}`)
            .digest('hex')
            .slice(0, 16);
          key = hash;
        }
        const id = `${source}_${userId}_${key}`;
        upsert.run(
          id,
          userId,
          item.title,
          JSON.stringify(item.authors || []),
          item.year,
          item.abstract,
          item.doi,
          item.url,
          item.journal,
          item.itemType || 'article',
          source,
          item.citationKey || null,
          JSON.stringify(item.keywords || []),
          item.citationKey || null,
          item.rawData ? JSON.stringify(item.rawData) : null,
          libraryVisible ? 1 : 0,
        );
        // Clean stale tags, then re-insert
        deleteTags.run(id);
        for (const tag of item.keywords || []) {
          insertTag.run(id, tag);
        }
        ids.push(id);
      }
      return ids;
    });

    try {
      return tx(items);
    } catch (err) {
      throw err;
    }
  },

  /** List user references with optional search and pagination. */
  getUserReferences: (userId, { search, tags, folderId, limit = 50, offset = 0 } = {}) => {
    try {
      let query = 'SELECT * FROM references_library WHERE user_id = ? AND COALESCE(library_visible, 1) = 1';
      const params = [userId];

      if (search) {
        query += ' AND (title LIKE ? OR authors LIKE ? OR journal LIKE ? OR abstract LIKE ?)';
        const term = `%${search}%`;
        params.push(term, term, term, term);
      }

      if (tags && tags.length > 0) {
        query += ` AND id IN (SELECT reference_id FROM reference_tags WHERE tag IN (${tags.map(() => '?').join(',')}))`;
        params.push(...tags);
      }

      if (folderId === 'unfiled') {
        query += ' AND id NOT IN (SELECT reference_id FROM reference_folder_items)';
      } else if (folderId) {
        query += ` AND id IN (
          SELECT rfi.reference_id
          FROM reference_folder_items rfi
          JOIN reference_folders rf ON rf.id = rfi.folder_id
          WHERE rfi.folder_id = ? AND rf.user_id = ?
        )`;
        params.push(folderId, userId);
      }

      query += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const rows = db.prepare(query).all(...params);
      return rows.map((r) => ({
        ...r,
        authors: r.authors ? JSON.parse(r.authors) : [],
        keywords: r.keywords ? JSON.parse(r.keywords) : [],
        raw_data: undefined, // Don't send raw_data in list
      }));
    } catch (err) {
      throw err;
    }
  },

  /** Count references using the same filters as the paginated library query. */
  countUserReferences: (userId, { search, tags, folderId } = {}) => {
    try {
      let query = 'SELECT COUNT(*) AS count FROM references_library WHERE user_id = ? AND COALESCE(library_visible, 1) = 1';
      const params = [userId];

      if (search) {
        query += ' AND (title LIKE ? OR authors LIKE ? OR journal LIKE ? OR abstract LIKE ?)';
        const term = `%${search}%`;
        params.push(term, term, term, term);
      }

      if (tags && tags.length > 0) {
        query += ` AND id IN (SELECT reference_id FROM reference_tags WHERE tag IN (${tags.map(() => '?').join(',')}))`;
        params.push(...tags);
      }

      if (folderId === 'unfiled') {
        query += ' AND id NOT IN (SELECT reference_id FROM reference_folder_items)';
      } else if (folderId) {
        query += ` AND id IN (
          SELECT rfi.reference_id
          FROM reference_folder_items rfi
          JOIN reference_folders rf ON rf.id = rfi.folder_id
          WHERE rfi.folder_id = ? AND rf.user_id = ?
        )`;
        params.push(folderId, userId);
      }

      return Number(db.prepare(query).get(...params)?.count || 0);
    } catch (err) {
      throw err;
    }
  },

  /** Single reference detail. */
  getReference: (id, userId) => {
    try {
      const row = db.prepare('SELECT * FROM references_library WHERE id = ? AND user_id = ?').get(id, userId);
      if (!row) return null;
      return {
        ...row,
        authors: row.authors ? JSON.parse(row.authors) : [],
        keywords: row.keywords ? JSON.parse(row.keywords) : [],
        raw_data: row.raw_data ? JSON.parse(row.raw_data) : null,
      };
    } catch (err) {
      throw err;
    }
  },

  /** Batch reference detail lookup preserving the requested id order. */
  getReferencesByIds: (userId, referenceIds) => {
    try {
      if (!Array.isArray(referenceIds) || referenceIds.length === 0) {
        return [];
      }

      const placeholders = referenceIds.map(() => '?').join(',');
      const rows = db.prepare(
        `SELECT * FROM references_library WHERE user_id = ? AND id IN (${placeholders})`
      ).all(userId, ...referenceIds);

      const byId = new Map(rows.map((row) => [
        row.id,
        {
          ...row,
          authors: row.authors ? JSON.parse(row.authors) : [],
          keywords: row.keywords ? JSON.parse(row.keywords) : [],
          raw_data: row.raw_data ? JSON.parse(row.raw_data) : null,
        },
      ]));

      return referenceIds
        .map((id) => byId.get(id) || null)
        .filter(Boolean);
    } catch (err) {
      throw err;
    }
  },

  /** Get references linked to a project. */
  getProjectReferences: (projectId, userId) => {
    try {
      const rows = db.prepare(`
        SELECT r.*, pr.added_at AS linked_at
        FROM references_library r
        JOIN project_references pr ON pr.reference_id = r.id
        WHERE pr.project_id = ? AND r.user_id = ?
        ORDER BY pr.added_at DESC
      `).all(projectId, userId);
      return rows.map((r) => ({
        ...r,
        authors: r.authors ? JSON.parse(r.authors) : [],
        keywords: r.keywords ? JSON.parse(r.keywords) : [],
        raw_data: undefined,
      }));
    } catch (err) {
      throw err;
    }
  },

  /** Get project-reference links for a set of references owned by a user. */
  getReferenceProjectLinks: (userId, referenceIds) => {
    try {
      if (!Array.isArray(referenceIds) || referenceIds.length === 0) {
        return [];
      }

      const placeholders = referenceIds.map(() => '?').join(',');
      return db.prepare(`
        SELECT
          pr.project_id,
          pr.reference_id,
          pr.added_at
        FROM project_references pr
        JOIN references_library r ON r.id = pr.reference_id
        WHERE r.user_id = ?
          AND pr.reference_id IN (${placeholders})
        ORDER BY pr.added_at DESC
      `).all(userId, ...referenceIds);
    } catch (err) {
      throw err;
    }
  },

  /** Link a reference to a project (verifies ownership). */
  linkToProject: (projectId, referenceId, userId) => {
    try {
      const ref = db.prepare('SELECT id FROM references_library WHERE id = ? AND user_id = ?').get(referenceId, userId);
      if (!ref) return false;
      db.prepare('INSERT OR IGNORE INTO project_references (project_id, reference_id) VALUES (?, ?)').run(projectId, referenceId);
      return true;
    } catch (err) {
      throw err;
    }
  },

  /** Unlink a reference from a project (verifies ownership). */
  unlinkFromProject: (projectId, referenceId, userId) => {
    try {
      const ref = db.prepare('SELECT id FROM references_library WHERE id = ? AND user_id = ?').get(referenceId, userId);
      if (!ref) return false;
      const result = db.prepare('DELETE FROM project_references WHERE project_id = ? AND reference_id = ?').run(projectId, referenceId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  /** Bulk-link an array of reference IDs to a project. */
  bulkLinkIds: (projectId, referenceIds) => {
    const insert = db.prepare('INSERT OR IGNORE INTO project_references (project_id, reference_id) VALUES (?, ?)');
    const tx = db.transaction((ids) => {
      let count = 0;
      for (const id of ids) {
        count += insert.run(projectId, id).changes;
      }
      return count;
    });
    return tx(referenceIds);
  },

  /** Bulk-unlink an array of reference IDs from a project. */
  bulkUnlinkIds: (projectId, referenceIds) => {
    if (!Array.isArray(referenceIds) || referenceIds.length === 0) {
      return 0;
    }

    const remove = db.prepare('DELETE FROM project_references WHERE project_id = ? AND reference_id = ?');
    const tx = db.transaction((ids) => {
      let count = 0;
      for (const id of ids) {
        count += remove.run(projectId, id).changes;
      }
      return count;
    });

    return tx(referenceIds);
  },

  /** Get all unique tags for a user. */
  getTags: (userId) => {
    try {
      const rows = db.prepare(`
        SELECT DISTINCT rt.tag, COUNT(*) as count
        FROM reference_tags rt
        JOIN references_library r ON r.id = rt.reference_id
        WHERE r.user_id = ? AND COALESCE(r.library_visible, 1) = 1
        GROUP BY rt.tag
        ORDER BY count DESC
      `).all(userId);
      return rows;
    } catch (err) {
      throw err;
    }
  },

  /** List user folders with reference counts and library-wide totals. */
  getFolders: (userId) => {
    const folders = db.prepare(`
      SELECT
        rf.id,
        rf.name,
        rf.parent_id,
        rf.created_at,
        rf.updated_at,
        COUNT(CASE WHEN COALESCE(r.library_visible, 1) = 1 THEN rfi.reference_id END) AS reference_count
      FROM reference_folders rf
      LEFT JOIN reference_folder_items rfi ON rfi.folder_id = rf.id
      LEFT JOIN references_library r ON r.id = rfi.reference_id
      WHERE rf.user_id = ?
      GROUP BY rf.id
      ORDER BY LOWER(rf.name), rf.created_at
    `).all(userId).map((folder) => ({
      ...folder,
      reference_count: Number(folder.reference_count || 0),
    }));
    const totals = db.prepare(`
      SELECT
        COUNT(*) AS total_count,
        COALESCE(SUM(CASE WHEN NOT EXISTS (
          SELECT 1 FROM reference_folder_items rfi WHERE rfi.reference_id = r.id
        ) THEN 1 ELSE 0 END), 0) AS unfiled_count
      FROM references_library r
      WHERE r.user_id = ? AND COALESCE(r.library_visible, 1) = 1
    `).get(userId);
    return {
      folders,
      total_count: Number(totals?.total_count || 0),
      unfiled_count: Number(totals?.unfiled_count || 0),
    };
  },

  getFolder: (userId, folderId) => db.prepare(`
    SELECT id, name, parent_id, created_at, updated_at
    FROM reference_folders
    WHERE id = ? AND user_id = ?
  `).get(folderId, userId) || null,

  createFolder: (userId, name, parentId = null) => {
    if (parentId) {
      const parent = db.prepare('SELECT id FROM reference_folders WHERE id = ? AND user_id = ?').get(parentId, userId);
      if (!parent) return null;
    }
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO reference_folders (id, user_id, name, parent_id)
      VALUES (?, ?, ?, ?)
    `).run(id, userId, name, parentId || null);
    return db.prepare(`
      SELECT id, name, parent_id, created_at, updated_at, 0 AS reference_count
      FROM reference_folders WHERE id = ? AND user_id = ?
    `).get(id, userId);
  },

  renameFolder: (userId, folderId, name) => {
    const result = db.prepare(`
      UPDATE reference_folders
      SET name = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `).run(name, folderId, userId);
    if (result.changes === 0) return null;
    return db.prepare(`
      SELECT rf.id, rf.name, rf.parent_id, rf.created_at, rf.updated_at,
             COUNT(rfi.reference_id) AS reference_count
      FROM reference_folders rf
      LEFT JOIN reference_folder_items rfi ON rfi.folder_id = rf.id
      WHERE rf.id = ? AND rf.user_id = ?
      GROUP BY rf.id
    `).get(folderId, userId);
  },

  deleteFolder: (userId, folderId) => {
    const result = db.prepare('DELETE FROM reference_folders WHERE id = ? AND user_id = ?').run(folderId, userId);
    return result.changes > 0;
  },

  addReferencesToFolder: (userId, folderId, referenceIds) => {
    const folder = db.prepare('SELECT id FROM reference_folders WHERE id = ? AND user_id = ?').get(folderId, userId);
    if (!folder) return null;
    const findReference = db.prepare('SELECT id FROM references_library WHERE id = ? AND user_id = ?');
    const insert = db.prepare('INSERT OR IGNORE INTO reference_folder_items (folder_id, reference_id) VALUES (?, ?)');
    const tx = db.transaction((ids) => {
      let added = 0;
      for (const referenceId of ids) {
        if (findReference.get(referenceId, userId)) {
          added += insert.run(folderId, referenceId).changes;
        }
      }
      return added;
    });
    return tx(referenceIds);
  },

  removeReferenceFromFolder: (userId, folderId, referenceId) => {
    const result = db.prepare(`
      DELETE FROM reference_folder_items
      WHERE folder_id = ? AND reference_id = ?
        AND folder_id IN (SELECT id FROM reference_folders WHERE user_id = ?)
    `).run(folderId, referenceId, userId);
    return result.changes > 0;
  },

  removeReferenceFromAllFolders: (userId, referenceId) => {
    const reference = db.prepare('SELECT id FROM references_library WHERE id = ? AND user_id = ?').get(referenceId, userId);
    if (!reference) return null;
    const result = db.prepare('DELETE FROM reference_folder_items WHERE reference_id = ?').run(referenceId);
    return result.changes;
  },

  /** Aggregate high-level library stats for the global research library view. */
  getLibraryOverview: (userId) => {
    try {
      const referenceStats = db.prepare(`
        SELECT
          COUNT(*) AS total_references,
          COALESCE(SUM(CASE WHEN source = 'zotero' THEN 1 ELSE 0 END), 0) AS zotero_references,
          COALESCE(SUM(CASE WHEN source = 'bibtex' THEN 1 ELSE 0 END), 0) AS bibtex_references,
          COALESCE(SUM(CASE WHEN source = 'news_monitor' THEN 1 ELSE 0 END), 0) AS news_references,
          COALESCE(SUM(CASE WHEN pdf_cached > 0 THEN 1 ELSE 0 END), 0) AS pdf_cached_references,
          MAX(updated_at) AS latest_reference_update
        FROM references_library
        WHERE user_id = ? AND COALESCE(library_visible, 1) = 1
      `).get(userId);

      const linkStats = db.prepare(`
        SELECT
          COUNT(DISTINCT pr.reference_id) AS linked_references,
          COUNT(DISTINCT pr.project_id) AS linked_projects
        FROM project_references pr
        JOIN references_library r ON r.id = pr.reference_id
        WHERE r.user_id = ?
      `).get(userId);

      return {
        total_references: Number(referenceStats?.total_references || 0),
        zotero_references: Number(referenceStats?.zotero_references || 0),
        bibtex_references: Number(referenceStats?.bibtex_references || 0),
        news_references: Number(referenceStats?.news_references || 0),
        pdf_cached_references: Number(referenceStats?.pdf_cached_references || 0),
        latest_reference_update: referenceStats?.latest_reference_update || null,
        linked_references: Number(linkStats?.linked_references || 0),
        linked_projects: Number(linkStats?.linked_projects || 0),
      };
    } catch (err) {
      throw err;
    }
  },

  /** Mark a reference as having its PDF cached. */
  setPdfCached: (id, cached = true) => {
    try {
      db.prepare('UPDATE references_library SET pdf_cached = ? WHERE id = ?').run(cached ? 1 : 0, id);
    } catch (err) {
      throw err;
    }
  },

  /** Delete a reference. */
  deleteReference: (userId, referenceId) => {
    try {
      const result = db.prepare('DELETE FROM references_library WHERE id = ? AND user_id = ?').run(referenceId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  /** Bulk-delete references by id list. Returns number of deleted rows. */
  bulkDeleteReferences: (userId, referenceIds) => {
    if (!referenceIds || referenceIds.length === 0) return 0;
    // Chunk to avoid SQLite parameter limit
    const CHUNK_SIZE = 500;
    let total = 0;
    const tx = db.transaction(() => {
      for (let i = 0; i < referenceIds.length; i += CHUNK_SIZE) {
        const chunk = referenceIds.slice(i, i + CHUNK_SIZE);
        const placeholders = chunk.map(() => '?').join(',');
        const result = db.prepare(
          `DELETE FROM references_library WHERE user_id = ? AND id IN (${placeholders})`
        ).run(userId, ...chunk);
        total += result.changes;
      }
    });
    tx();
    return total;
  },
};

function parseJsonColumn(value, fallback = null) {
  if (value == null || value === '') {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapMetaProjectRow(row) {
  if (!row) return null;
  return {
    ...row,
    protocol_json: parseJsonColumn(row.protocol_json, null),
  };
}

function mapMetaSearchRunRow(row) {
  if (!row) return null;
  return {
    ...row,
    metadata_json: parseJsonColumn(row.metadata_json, null),
  };
}

function mapMetaScreeningDecisionRow(row) {
  if (!row) return null;
  return {
    ...row,
    confidence: row.confidence == null ? null : Number(row.confidence),
    metadata_json: parseJsonColumn(row.metadata_json, null),
  };
}

function mapMetaExtractionRow(row) {
  if (!row) return null;
  return {
    ...row,
    value_json: parseJsonColumn(row.value_json, null),
  };
}

function mapMetaAnalysisRunRow(row) {
  if (!row) return null;
  return {
    ...row,
    figures_json: parseJsonColumn(row.figures_json, []),
  };
}

function mapMetaManuscriptSectionRow(row) {
  if (!row) return null;
  return {
    ...row,
    source_json: parseJsonColumn(row.source_json, null),
  };
}

function mapMetaZoteroExportRow(row) {
  if (!row) return null;
  return {
    ...row,
    missing_attachment: row.missing_attachment === 1,
    metadata_json: parseJsonColumn(row.metadata_json, null),
  };
}

function metaId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

const META_PROJECT_UPDATE_FIELDS = {
  reviewType: 'review_type',
  review_type: 'review_type',
  title: 'title',
  disease: 'disease',
  biomarker: 'biomarker',
  population: 'population',
  indexTest: 'index_test',
  index_test: 'index_test',
  referenceStandard: 'reference_standard',
  reference_standard: 'reference_standard',
  primaryOutcome: 'primary_outcome',
  primary_outcome: 'primary_outcome',
  protocolJson: 'protocol_json',
  protocol_json: 'protocol_json',
  status: 'status',
};

const metaAnalysisDb = {
  createMetaProject: (userId, payload = {}) => {
    const id = payload.id || metaId('meta');
    const rawReviewType = Object.prototype.hasOwnProperty.call(payload, 'reviewType')
      ? payload.reviewType
      : (Object.prototype.hasOwnProperty.call(payload, 'review_type') ? payload.review_type : '');
    const reviewType = String(rawReviewType || '').trim().toLowerCase();
    db.prepare(`
      INSERT INTO meta_projects (
        id, user_id, project_id, review_type, title, disease, biomarker, population,
        index_test, reference_standard, primary_outcome, protocol_json, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      userId,
      payload.projectId || payload.project_id,
      reviewType,
      payload.title || 'Untitled Meta project',
      payload.disease || null,
      payload.biomarker || null,
      payload.population || null,
      payload.indexTest || payload.index_test || null,
      payload.referenceStandard || payload.reference_standard || null,
      payload.primaryOutcome || payload.primary_outcome || null,
      payload.protocolJson || payload.protocol_json ? JSON.stringify(payload.protocolJson || payload.protocol_json) : null,
      payload.status || 'draft',
    );
    return metaAnalysisDb.getMetaProject(userId, id);
  },

  getMetaProject: (userId, metaProjectId) => {
    const row = db.prepare('SELECT * FROM meta_projects WHERE user_id = ? AND id = ?').get(userId, metaProjectId);
    return mapMetaProjectRow(row);
  },

  getMetaProjectByProjectId: (userId, projectId) => {
    const row = db.prepare(`
      SELECT * FROM meta_projects
      WHERE user_id = ? AND project_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(userId, projectId);
    return mapMetaProjectRow(row);
  },

  updateMetaProject: (userId, metaProjectId, updates = {}) => {
    const assignments = [];
    const values = [];
    for (const [key, value] of Object.entries(updates || {})) {
      const column = META_PROJECT_UPDATE_FIELDS[key];
      if (!column) continue;
      assignments.push(`${column} = ?`);
      values.push(column === 'protocol_json' && value != null ? JSON.stringify(value) : value ?? null);
    }
    if (assignments.length === 0) {
      return metaAnalysisDb.getMetaProject(userId, metaProjectId);
    }
    db.prepare(`
      UPDATE meta_projects
      SET ${assignments.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND id = ?
    `).run(...values, userId, metaProjectId);
    return metaAnalysisDb.getMetaProject(userId, metaProjectId);
  },

  createSearchRun: (userId, payload = {}) => {
    const id = payload.id || metaId('meta_search');
    db.prepare(`
      INSERT INTO meta_search_runs (
        id, user_id, meta_project_id, database_name, query_text, result_count,
        imported_count, raw_response_path, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      userId,
      payload.metaProjectId || payload.meta_project_id,
      payload.databaseName || payload.database_name || 'pubmed',
      payload.queryText || payload.query_text || '',
      Number(payload.resultCount || payload.result_count || 0),
      Number(payload.importedCount || payload.imported_count || 0),
      payload.rawResponsePath || payload.raw_response_path || null,
      payload.metadataJson || payload.metadata_json ? JSON.stringify(payload.metadataJson || payload.metadata_json) : null,
    );
    return mapMetaSearchRunRow(db.prepare('SELECT * FROM meta_search_runs WHERE user_id = ? AND id = ?').get(userId, id));
  },

  listSearchRuns: (userId, metaProjectId) => db.prepare(`
    SELECT * FROM meta_search_runs
    WHERE user_id = ? AND meta_project_id = ?
    ORDER BY searched_at DESC
  `).all(userId, metaProjectId).map(mapMetaSearchRunRow),

  upsertScreeningDecision: (userId, payload = {}) => {
    const id = payload.id || metaId('meta_screen');
    const hasConfidence = Object.prototype.hasOwnProperty.call(payload, 'confidence');
    const hasMetadata = Object.prototype.hasOwnProperty.call(payload, 'metadataJson')
      || Object.prototype.hasOwnProperty.call(payload, 'metadata_json');
    db.prepare(`
      INSERT INTO meta_screening_decisions (
        id, user_id, meta_project_id, reference_id, stage, decision, reason, reviewer, evidence_note, confidence, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(meta_project_id, reference_id, stage) DO UPDATE SET
        decision = excluded.decision,
        reason = excluded.reason,
        reviewer = excluded.reviewer,
        evidence_note = excluded.evidence_note,
        confidence = CASE WHEN ? THEN excluded.confidence ELSE meta_screening_decisions.confidence END,
        metadata_json = CASE WHEN ? THEN excluded.metadata_json ELSE meta_screening_decisions.metadata_json END,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      id,
      userId,
      payload.metaProjectId || payload.meta_project_id,
      payload.referenceId || payload.reference_id,
      payload.stage || 'title_abstract',
      payload.decision || 'maybe',
      payload.reason || null,
      payload.reviewer || null,
      payload.evidenceNote || payload.evidence_note || null,
      hasConfidence && payload.confidence != null ? Number(payload.confidence) : null,
      hasMetadata ? JSON.stringify(payload.metadataJson || payload.metadata_json || null) : null,
      hasConfidence ? 1 : 0,
      hasMetadata ? 1 : 0,
    );
    return mapMetaScreeningDecisionRow(db.prepare(`
      SELECT * FROM meta_screening_decisions
      WHERE user_id = ? AND meta_project_id = ? AND reference_id = ? AND stage = ?
    `).get(
      userId,
      payload.metaProjectId || payload.meta_project_id,
      payload.referenceId || payload.reference_id,
      payload.stage || 'title_abstract',
    ));
  },

  listScreeningDecisions: (userId, metaProjectId) => db.prepare(`
    SELECT * FROM meta_screening_decisions
    WHERE user_id = ? AND meta_project_id = ?
    ORDER BY updated_at DESC
  `).all(userId, metaProjectId).map(mapMetaScreeningDecisionRow),

  upsertPdfAsset: (userId, payload = {}) => {
    const id = payload.id || metaId('meta_pdf');
    db.prepare(`
      INSERT INTO meta_pdf_assets (
        id, user_id, meta_project_id, reference_id, source, status, file_path, sha256, license_status,
        asset_type, content_type, original_filename, source_url, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(meta_project_id, reference_id) DO UPDATE SET
        source = excluded.source,
        status = excluded.status,
        file_path = excluded.file_path,
        sha256 = excluded.sha256,
        license_status = excluded.license_status,
        asset_type = excluded.asset_type,
        content_type = excluded.content_type,
        original_filename = excluded.original_filename,
        source_url = excluded.source_url,
        error = excluded.error,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      id,
      userId,
      payload.metaProjectId || payload.meta_project_id,
      payload.referenceId || payload.reference_id,
      payload.source || 'unknown',
      payload.status || 'not_checked',
      payload.filePath || payload.file_path || null,
      payload.sha256 || null,
      payload.licenseStatus || payload.license_status || null,
      payload.assetType || payload.asset_type || 'pdf',
      payload.contentType || payload.content_type || null,
      payload.originalFilename || payload.original_filename || null,
      payload.sourceUrl || payload.source_url || null,
      payload.error || null,
    );
    return metaAnalysisDb.getPdfAsset(userId, payload.metaProjectId || payload.meta_project_id, payload.referenceId || payload.reference_id);
  },

  getPdfAsset: (userId, metaProjectId, referenceId) => db.prepare(`
    SELECT * FROM meta_pdf_assets
    WHERE user_id = ? AND meta_project_id = ? AND reference_id = ?
  `).get(userId, metaProjectId, referenceId) || null,

  listPdfAssets: (userId, metaProjectId) => db.prepare(`
    SELECT * FROM meta_pdf_assets
    WHERE user_id = ? AND meta_project_id = ?
    ORDER BY updated_at DESC
  `).all(userId, metaProjectId),

  upsertParsedDocument: (userId, payload = {}) => {
    const id = payload.id || metaId('meta_parse');
    db.prepare(`
      INSERT INTO meta_parsed_documents (
        id, user_id, meta_project_id, reference_id, pdf_asset_id, parser, status,
        markdown_path, tables_path, figures_dir, page_map_path, parse_report_path, quality_score, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(meta_project_id, reference_id, parser) DO UPDATE SET
        pdf_asset_id = excluded.pdf_asset_id,
        status = excluded.status,
        markdown_path = excluded.markdown_path,
        tables_path = excluded.tables_path,
        figures_dir = excluded.figures_dir,
        page_map_path = excluded.page_map_path,
        parse_report_path = excluded.parse_report_path,
        quality_score = excluded.quality_score,
        error = excluded.error,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      id,
      userId,
      payload.metaProjectId || payload.meta_project_id,
      payload.referenceId || payload.reference_id,
      payload.pdfAssetId || payload.pdf_asset_id || null,
      payload.parser || 'mineru',
      payload.status || 'pending',
      payload.markdownPath || payload.markdown_path || null,
      payload.tablesPath || payload.tables_path || null,
      payload.figuresDir || payload.figures_dir || null,
      payload.pageMapPath || payload.page_map_path || null,
      payload.parseReportPath || payload.parse_report_path || null,
      payload.qualityScore ?? payload.quality_score ?? null,
      payload.error || null,
    );
    return metaAnalysisDb.getParsedDocument(
      userId,
      payload.metaProjectId || payload.meta_project_id,
      payload.referenceId || payload.reference_id,
      payload.parser || 'mineru',
    );
  },

  getParsedDocument: (userId, metaProjectId, referenceId, parser = 'mineru') => db.prepare(`
    SELECT * FROM meta_parsed_documents
    WHERE user_id = ? AND meta_project_id = ? AND reference_id = ? AND parser = ?
  `).get(userId, metaProjectId, referenceId, parser) || null,

  listParsedDocuments: (userId, metaProjectId) => db.prepare(`
    SELECT * FROM meta_parsed_documents
    WHERE user_id = ? AND meta_project_id = ?
    ORDER BY updated_at DESC
  `).all(userId, metaProjectId),

  createExtractionResult: (userId, payload = {}) => {
    const id = payload.id || metaId('meta_extract');
    db.prepare(`
      INSERT INTO meta_extraction_results (
        id, user_id, meta_project_id, reference_id, extraction_type, field_name, value_json,
        evidence_text, evidence_location, page, table_label, confidence, review_status, reviewer_note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      userId,
      payload.metaProjectId || payload.meta_project_id,
      payload.referenceId || payload.reference_id,
      payload.extractionType || payload.extraction_type || 'diagnostic',
      payload.fieldName || payload.field_name,
      payload.valueJson || payload.value_json ? JSON.stringify(payload.valueJson || payload.value_json) : null,
      payload.evidenceText || payload.evidence_text || null,
      payload.evidenceLocation || payload.evidence_location || null,
      payload.page ?? null,
      payload.tableLabel || payload.table_label || null,
      payload.confidence ?? null,
      payload.reviewStatus || payload.review_status || 'candidate',
      payload.reviewerNote || payload.reviewer_note || null,
    );
    return mapMetaExtractionRow(db.prepare('SELECT * FROM meta_extraction_results WHERE user_id = ? AND id = ?').get(userId, id));
  },

  listExtractionResults: (userId, metaProjectId, options = {}) => {
    const conditions = ['user_id = ?', 'meta_project_id = ?'];
    const params = [userId, metaProjectId];
    if (options.reviewStatus || options.review_status) {
      conditions.push('review_status = ?');
      params.push(options.reviewStatus || options.review_status);
    }
    if (options.referenceId || options.reference_id) {
      conditions.push('reference_id = ?');
      params.push(options.referenceId || options.reference_id);
    }
    if (options.extractionType || options.extraction_type) {
      conditions.push('extraction_type = ?');
      params.push(options.extractionType || options.extraction_type);
    }
    return db.prepare(`
      SELECT * FROM meta_extraction_results
      WHERE ${conditions.join(' AND ')}
      ORDER BY updated_at DESC, created_at DESC
    `).all(...params).map(mapMetaExtractionRow);
  },

  updateExtractionReviewStatus: (userId, extractionId, updates = {}) => {
    const assignments = [];
    const params = [];
    if (Object.prototype.hasOwnProperty.call(updates, 'reviewStatus') || Object.prototype.hasOwnProperty.call(updates, 'review_status')) {
      assignments.push('review_status = ?');
      params.push(updates.reviewStatus || updates.review_status);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'valueJson') || Object.prototype.hasOwnProperty.call(updates, 'value_json')) {
      assignments.push('value_json = ?');
      params.push(JSON.stringify(updates.valueJson || updates.value_json || null));
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'reviewerNote') || Object.prototype.hasOwnProperty.call(updates, 'reviewer_note')) {
      assignments.push('reviewer_note = ?');
      params.push(updates.reviewerNote || updates.reviewer_note || null);
    }
    if (assignments.length === 0) {
      return mapMetaExtractionRow(db.prepare('SELECT * FROM meta_extraction_results WHERE user_id = ? AND id = ?').get(userId, extractionId));
    }
    db.prepare(`
      UPDATE meta_extraction_results
      SET ${assignments.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND id = ?
    `).run(...params, userId, extractionId);
    return mapMetaExtractionRow(db.prepare('SELECT * FROM meta_extraction_results WHERE user_id = ? AND id = ?').get(userId, extractionId));
  },

  createAnalysisRun: (userId, payload = {}) => {
    const id = payload.id || metaId('meta_run');
    db.prepare(`
      INSERT INTO meta_analysis_runs (
        id, user_id, meta_project_id, analysis_type, model, input_dataset_path,
        script_path, output_json_path, figures_json, status, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      userId,
      payload.metaProjectId || payload.meta_project_id,
      payload.analysisType || payload.analysis_type || 'diagnostic',
      payload.model || null,
      payload.inputDatasetPath || payload.input_dataset_path || null,
      payload.scriptPath || payload.script_path || null,
      payload.outputJsonPath || payload.output_json_path || null,
      payload.figuresJson || payload.figures_json ? JSON.stringify(payload.figuresJson || payload.figures_json) : null,
      payload.status || 'pending',
      payload.error || null,
    );
    return metaAnalysisDb.getAnalysisRun(userId, id);
  },

  updateAnalysisRun: (userId, analysisRunId, updates = {}) => {
    const fieldMap = {
      model: 'model',
      inputDatasetPath: 'input_dataset_path',
      input_dataset_path: 'input_dataset_path',
      scriptPath: 'script_path',
      script_path: 'script_path',
      outputJsonPath: 'output_json_path',
      output_json_path: 'output_json_path',
      figuresJson: 'figures_json',
      figures_json: 'figures_json',
      status: 'status',
      error: 'error',
      finishedAt: 'finished_at',
      finished_at: 'finished_at',
    };
    const assignments = [];
    const params = [];
    for (const [key, value] of Object.entries(updates || {})) {
      const column = fieldMap[key];
      if (!column) continue;
      assignments.push(`${column} = ?`);
      params.push(column === 'figures_json' && value != null ? JSON.stringify(value) : value ?? null);
    }
    if (assignments.length > 0) {
      db.prepare(`
        UPDATE meta_analysis_runs
        SET ${assignments.join(', ')}
        WHERE user_id = ? AND id = ?
      `).run(...params, userId, analysisRunId);
    }
    return metaAnalysisDb.getAnalysisRun(userId, analysisRunId);
  },

  getAnalysisRun: (userId, analysisRunId) => mapMetaAnalysisRunRow(db.prepare(`
    SELECT * FROM meta_analysis_runs
    WHERE user_id = ? AND id = ?
  `).get(userId, analysisRunId)),

  listAnalysisRuns: (userId, metaProjectId) => db.prepare(`
    SELECT * FROM meta_analysis_runs
    WHERE user_id = ? AND meta_project_id = ?
    ORDER BY created_at DESC
  `).all(userId, metaProjectId).map(mapMetaAnalysisRunRow),

  upsertManuscriptSection: (userId, payload = {}) => {
    const id = payload.id || metaId('meta_section');
    db.prepare(`
      INSERT INTO meta_manuscript_sections (
        id, user_id, meta_project_id, section_key, content_markdown, source_json, version, review_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(meta_project_id, section_key, version) DO UPDATE SET
        content_markdown = excluded.content_markdown,
        source_json = excluded.source_json,
        review_status = excluded.review_status,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      id,
      userId,
      payload.metaProjectId || payload.meta_project_id,
      payload.sectionKey || payload.section_key,
      payload.contentMarkdown || payload.content_markdown || '',
      payload.sourceJson || payload.source_json ? JSON.stringify(payload.sourceJson || payload.source_json) : null,
      payload.version || 1,
      payload.reviewStatus || payload.review_status || 'draft',
    );
    return mapMetaManuscriptSectionRow(db.prepare(`
      SELECT * FROM meta_manuscript_sections
      WHERE user_id = ? AND meta_project_id = ? AND section_key = ? AND version = ?
    `).get(
      userId,
      payload.metaProjectId || payload.meta_project_id,
      payload.sectionKey || payload.section_key,
      payload.version || 1,
    ));
  },

  listManuscriptSections: (userId, metaProjectId) => db.prepare(`
    SELECT * FROM meta_manuscript_sections
    WHERE user_id = ? AND meta_project_id = ?
    ORDER BY section_key ASC, version DESC
  `).all(userId, metaProjectId).map(mapMetaManuscriptSectionRow),

  upsertZoteroExport: (userId, payload = {}) => {
    const id = payload.id || metaId('meta_zotero');
    db.prepare(`
      INSERT INTO meta_zotero_exports (
        id, user_id, meta_project_id, reference_id, zotero_item_key, zotero_attachment_key,
        collection_key, review_collection_key, status, missing_attachment, error, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(meta_project_id, reference_id) DO UPDATE SET
        zotero_item_key = COALESCE(excluded.zotero_item_key, meta_zotero_exports.zotero_item_key),
        zotero_attachment_key = COALESCE(excluded.zotero_attachment_key, meta_zotero_exports.zotero_attachment_key),
        collection_key = COALESCE(excluded.collection_key, meta_zotero_exports.collection_key),
        review_collection_key = COALESCE(excluded.review_collection_key, meta_zotero_exports.review_collection_key),
        status = excluded.status,
        missing_attachment = excluded.missing_attachment,
        error = excluded.error,
        metadata_json = excluded.metadata_json,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      id,
      userId,
      payload.metaProjectId || payload.meta_project_id,
      payload.referenceId || payload.reference_id,
      payload.zoteroItemKey || payload.zotero_item_key || null,
      payload.zoteroAttachmentKey || payload.zotero_attachment_key || null,
      payload.collectionKey || payload.collection_key || null,
      payload.reviewCollectionKey || payload.review_collection_key || null,
      payload.status || 'pending',
      payload.missingAttachment || payload.missing_attachment ? 1 : 0,
      payload.error || null,
      payload.metadataJson || payload.metadata_json ? JSON.stringify(payload.metadataJson || payload.metadata_json) : null,
    );
    return metaAnalysisDb.getZoteroExport(
      userId,
      payload.metaProjectId || payload.meta_project_id,
      payload.referenceId || payload.reference_id,
    );
  },

  getZoteroExport: (userId, metaProjectId, referenceId) => mapMetaZoteroExportRow(db.prepare(`
    SELECT * FROM meta_zotero_exports
    WHERE user_id = ? AND meta_project_id = ? AND reference_id = ?
  `).get(userId, metaProjectId, referenceId)),

  listZoteroExports: (userId, metaProjectId) => db.prepare(`
    SELECT * FROM meta_zotero_exports
    WHERE user_id = ? AND meta_project_id = ?
    ORDER BY updated_at DESC
  `).all(userId, metaProjectId).map(mapMetaZoteroExportRow),
};

function mapEvidenceArtifactRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    metaProjectId: row.meta_project_id,
    type: row.type,
    version: row.version,
    schemaVersion: row.schema_version,
    producedBy: row.produced_by,
    inputs: JSON.parse(row.inputs_json || '[]'),
    contentHash: row.content_hash,
    payload: row.payload_json ? JSON.parse(row.payload_json) : null,
    blobRef: row.blob_ref || null,
    status: row.status,
    validation: row.validation_json ? JSON.parse(row.validation_json) : null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

const evidenceLedgerDb = {
  createArtifact(userId, spec) {
    const {
      metaProjectId, type, producedBy = 'panel',
      inputs = [], payload = null, blobRef = null, schemaVersion = 1,
    } = spec || {};
    if (!metaProjectId) throw new Error('metaProjectId is required');
    if (!type) throw new Error('type is required');

    const id = crypto.randomUUID();
    const { next: version } = db.prepare(
      'SELECT COALESCE(MAX(version), 0) + 1 AS next FROM meta_evidence_artifacts WHERE meta_project_id = ? AND type = ?'
    ).get(metaProjectId, type);
    const contentHash = crypto.createHash('sha256')
      .update(stableStringify({ payload, blobRef }))
      .digest('hex');

    db.prepare(`
      INSERT INTO meta_evidence_artifacts
        (id, user_id, meta_project_id, type, version, schema_version, produced_by,
         inputs_json, content_hash, payload_json, blob_ref, status, validation_json, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', NULL, ?)
    `).run(
      id, userId, metaProjectId, type, version, schemaVersion, producedBy,
      JSON.stringify(inputs || []), contentHash,
      payload === null ? null : JSON.stringify(payload),
      blobRef, userId,
    );

    const edgeStmt = db.prepare(
      'INSERT OR IGNORE INTO meta_evidence_artifact_edges (from_artifact_id, to_artifact_id) VALUES (?, ?)'
    );
    for (const input of inputs || []) {
      if (input && input.artifactId) edgeStmt.run(input.artifactId, id);
    }
    return evidenceLedgerDb.getArtifact(id);
  },

  getArtifact(id) {
    return mapEvidenceArtifactRow(
      db.prepare('SELECT * FROM meta_evidence_artifacts WHERE id = ?').get(id)
    );
  },

  getDependents(artifactId) {
    const rows = db.prepare(`
      SELECT a.* FROM meta_evidence_artifacts a
      JOIN meta_evidence_artifact_edges e ON e.to_artifact_id = a.id
      WHERE e.from_artifact_id = ?
      ORDER BY a.created_at ASC
    `).all(artifactId);
    return rows.map(mapEvidenceArtifactRow);
  },

  collectTransitiveDependents(artifactId) {
    const seen = new Set();
    const queue = [artifactId];
    const stmt = db.prepare(
      'SELECT to_artifact_id AS id FROM meta_evidence_artifact_edges WHERE from_artifact_id = ?'
    );
    while (queue.length) {
      const current = queue.shift();
      for (const dep of stmt.all(current)) {
        if (!seen.has(dep.id)) {
          seen.add(dep.id);
          queue.push(dep.id);
        }
      }
    }
    return [...seen];
  },

  setArtifactStatus(id, status, validation = null) {
    db.prepare(
      'UPDATE meta_evidence_artifacts SET status = ?, validation_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(status, validation === null ? null : JSON.stringify(validation), id);
    return evidenceLedgerDb.getArtifact(id);
  },

  getLatestArtifact(metaProjectId, type) {
    return mapEvidenceArtifactRow(
      db.prepare(
        'SELECT * FROM meta_evidence_artifacts WHERE meta_project_id = ? AND type = ? ORDER BY version DESC LIMIT 1'
      ).get(metaProjectId, type)
    );
  },

  listArtifacts(metaProjectId, { type } = {}) {
    const rows = type
      ? db.prepare('SELECT * FROM meta_evidence_artifacts WHERE meta_project_id = ? AND type = ? ORDER BY version ASC').all(metaProjectId, type)
      : db.prepare('SELECT * FROM meta_evidence_artifacts WHERE meta_project_id = ? ORDER BY created_at ASC').all(metaProjectId);
    return rows.map(mapEvidenceArtifactRow);
  },

  markStale(artifactIds) {
    const stmt = db.prepare(
      "UPDATE meta_evidence_artifacts SET status = 'stale', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status != 'locked'"
    );
    let affected = 0;
    for (const id of artifactIds) affected += stmt.run(id).changes;
    return affected;
  },
};

function mapSurveillanceSubscriptionRow(row) {
  if (!row) return null;
  return {
    id: row.id, userId: row.user_id, metaProjectId: row.meta_project_id,
    searchStrategy: JSON.parse(row.search_strategy_json || '{}'),
    eligibility: JSON.parse(row.eligibility_json || '{}'),
    frequency: row.frequency, status: row.status,
    lastRunAt: row.last_run_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapSurveillanceRunRow(row) {
  if (!row) return null;
  return {
    id: row.id, userId: row.user_id, metaProjectId: row.meta_project_id,
    subscriptionId: row.subscription_id, status: row.status,
    stats: JSON.parse(row.stats_json || '{}'),
    changeSet: row.change_set_json ? JSON.parse(row.change_set_json) : null,
    startedAt: row.started_at, finishedAt: row.finished_at, createdAt: row.created_at,
  };
}

const surveillanceDb = {
  createSubscription(userId, { metaProjectId, searchStrategy = {}, eligibility = {}, frequency = 'weekly' }) {
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO meta_surveillance_subscriptions
        (id, user_id, meta_project_id, search_strategy_json, eligibility_json, frequency, status)
      VALUES (?, ?, ?, ?, ?, ?, 'active')
    `).run(id, userId, metaProjectId, JSON.stringify(searchStrategy), JSON.stringify(eligibility), frequency);
    return surveillanceDb.getSubscription(id);
  },
  getSubscription(id) {
    return mapSurveillanceSubscriptionRow(
      db.prepare('SELECT * FROM meta_surveillance_subscriptions WHERE id = ?').get(id)
    );
  },
  getSubscriptionByProject(metaProjectId) {
    return mapSurveillanceSubscriptionRow(
      db.prepare('SELECT * FROM meta_surveillance_subscriptions WHERE meta_project_id = ? ORDER BY created_at DESC LIMIT 1').get(metaProjectId)
    );
  },
  touchLastRun(id, isoTime) {
    db.prepare('UPDATE meta_surveillance_subscriptions SET last_run_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(isoTime, id);
  },
  recordRun(userId, { subscriptionId, metaProjectId, status = 'completed', stats = {}, changeSet = null, startedAt = null, finishedAt = null }) {
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO meta_surveillance_runs
        (id, user_id, meta_project_id, subscription_id, status, stats_json, change_set_json, started_at, finished_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, metaProjectId, subscriptionId, status, JSON.stringify(stats),
           changeSet === null ? null : JSON.stringify(changeSet), startedAt, finishedAt);
    return surveillanceDb.getRun(id);
  },
  getRun(id) {
    return mapSurveillanceRunRow(db.prepare('SELECT * FROM meta_surveillance_runs WHERE id = ?').get(id));
  },
  listRuns(metaProjectId) {
    return db.prepare('SELECT * FROM meta_surveillance_runs WHERE meta_project_id = ? ORDER BY created_at DESC').all(metaProjectId).map(mapSurveillanceRunRow);
  },
  listActiveSubscriptions() {
    return db.prepare("SELECT * FROM meta_surveillance_subscriptions WHERE status = 'active' ORDER BY created_at ASC")
      .all().map(mapSurveillanceSubscriptionRow);
  },
};

export {
  db,
  initializeDatabase,
  userDb,
  registrationRequestDb,
  membershipUpgradeRequestDb,
  userPreferenceMemoryDb,
  userFeedbackDb,
  autoResearchDb,
  appSettingsDb,
  conversationShareDb,
  apiKeysDb,
  credentialsDb,
  agentApiProfilesDb,
  agentToolPermissionsDb,
  hasAgentApiAccess,
  githubTokensDb, // Backward compatibility
  sessionDb,
  tagDb,
  projectDb,
  projectActivityDb,
  conceptsDb,
  referencesDb,
  metaAnalysisDb,
  evidenceLedgerDb,
  surveillanceDb,
  normalizeSessionTimestamp
};
