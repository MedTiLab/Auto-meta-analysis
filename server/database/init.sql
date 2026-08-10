-- Initialize authentication database
PRAGMA foreign_keys = ON;

-- Users table (single user system)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    avatar_id TEXT,
    notification_email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    is_active BOOLEAN DEFAULT 1,
    git_name TEXT,
    git_email TEXT,
    has_completed_onboarding BOOLEAN DEFAULT 1,
    memory_enabled BOOLEAN DEFAULT 1,
    agent_api_enabled BOOLEAN DEFAULT 0,
    membership_plan TEXT DEFAULT 'free',
    usage_quota_bytes INTEGER,
    usage_baseline_bytes INTEGER DEFAULT 0,
    usage_baseline_updated_at DATETIME,
    trial_started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    trial_expires_at DATETIME
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

-- Historical registration-code usage audit. Kept for migration compatibility;
-- new account creation uses registration_requests and administrator approval.
CREATE TABLE IF NOT EXISTS registration_invite_code_uses (
    code_hash TEXT PRIMARY KEY,
    used_by_user_id INTEGER,
    used_by_username TEXT,
    used_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_registration_invite_code_uses_user ON registration_invite_code_uses(used_by_user_id);

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

-- Lightweight user preference memory for cross-session personalization
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

-- User feedback submitted from the Help & Suggestions settings page
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

-- API Keys table for external API access
CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    key_name TEXT NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used DATETIME,
    is_active BOOLEAN DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(api_key);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active);

-- User credentials table for storing various tokens/credentials (GitHub, GitLab, etc.)
CREATE TABLE IF NOT EXISTS user_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    credential_name TEXT NOT NULL,
    credential_type TEXT NOT NULL, -- 'github_token', 'gitlab_token', 'bitbucket_token', etc.
    credential_value TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_credentials_user_id ON user_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_user_credentials_type ON user_credentials(credential_type);
CREATE INDEX IF NOT EXISTS idx_user_credentials_active ON user_credentials(is_active);

-- Claude/agent API profiles. System profiles are shared defaults; user profiles
-- allow BYOK-style switching without exposing full secrets back to the browser.
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

-- Session metadata index table for fast lookup and renaming
CREATE TABLE IF NOT EXISTS session_metadata (
    id TEXT PRIMARY KEY,
    project_name TEXT NOT NULL,
    provider TEXT NOT NULL,
    display_name TEXT,
    last_activity DATETIME,
    message_count INTEGER DEFAULT 0,
    is_starred BOOLEAN DEFAULT 0,
    metadata TEXT, -- JSON storage for extra provider-specific data
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_session_metadata_project ON session_metadata(project_name);
CREATE INDEX IF NOT EXISTS idx_session_metadata_provider ON session_metadata(provider);

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

-- Projects table for unified management across all providers
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id INTEGER,
    display_name TEXT,
    path TEXT NOT NULL,
    is_starred BOOLEAN DEFAULT 0,
    last_accessed DATETIME,
    metadata TEXT, -- JSON for provider-specific info
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(path);

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

CREATE TABLE IF NOT EXISTS auto_research_runs (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    project_name TEXT NOT NULL,
    project_path TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'claude',
    status TEXT NOT NULL,
    session_id TEXT,
    current_task_id TEXT,
    completed_tasks INTEGER DEFAULT 0,
    total_tasks INTEGER DEFAULT 0,
    error TEXT,
    metadata TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME,
    email_sent_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auto_research_runs_user ON auto_research_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_auto_research_runs_project ON auto_research_runs(project_name);
CREATE INDEX IF NOT EXISTS idx_auto_research_runs_status ON auto_research_runs(status);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Account-bound PubMed variable discovery UI state
CREATE TABLE IF NOT EXISTS pubmed_discovery_state (
    user_id INTEGER NOT NULL,
    state_key TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, state_key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pubmed_discovery_state_user ON pubmed_discovery_state(user_id);

-- References (literature) cache table
CREATE TABLE IF NOT EXISTS references_library (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    authors TEXT,
    year INTEGER,
    abstract TEXT,
    doi TEXT,
    url TEXT,
    journal TEXT,
    item_type TEXT DEFAULT 'article',
    source TEXT DEFAULT 'zotero',
    source_id TEXT,
    keywords TEXT,
    citation_key TEXT,
    pdf_cached INTEGER DEFAULT 0,
    library_visible INTEGER DEFAULT 1,
    raw_data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_references_user ON references_library(user_id);
CREATE INDEX IF NOT EXISTS idx_references_source_id ON references_library(source_id);
CREATE INDEX IF NOT EXISTS idx_references_doi ON references_library(doi);

-- User-defined folders for organizing the global literature library.
-- A reference can appear in more than one folder; deleting a folder never
-- deletes its references.
CREATE TABLE IF NOT EXISTS reference_folders (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    parent_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES reference_folders(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reference_folders_unique_name
    ON reference_folders(user_id, COALESCE(parent_id, ''), name);
CREATE INDEX IF NOT EXISTS idx_reference_folders_user ON reference_folders(user_id);
CREATE INDEX IF NOT EXISTS idx_reference_folders_parent ON reference_folders(parent_id);

CREATE TABLE IF NOT EXISTS reference_folder_items (
    folder_id TEXT NOT NULL,
    reference_id TEXT NOT NULL,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (folder_id, reference_id),
    FOREIGN KEY (folder_id) REFERENCES reference_folders(id) ON DELETE CASCADE,
    FOREIGN KEY (reference_id) REFERENCES references_library(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reference_folder_items_reference
    ON reference_folder_items(reference_id);

-- Reference ↔ Project many-to-many
CREATE TABLE IF NOT EXISTS project_references (
    project_id TEXT NOT NULL,
    reference_id TEXT NOT NULL,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, reference_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (reference_id) REFERENCES references_library(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_references_project ON project_references(project_id);

-- Project-level Meta Analysis Workspace
CREATE TABLE IF NOT EXISTS meta_projects (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    project_id TEXT NOT NULL,
    review_type TEXT NOT NULL DEFAULT 'diagnostic',
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

-- Reference tags
CREATE TABLE IF NOT EXISTS reference_tags (
    reference_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    UNIQUE(reference_id, tag),
    FOREIGN KEY (reference_id) REFERENCES references_library(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reference_tags_ref ON reference_tags(reference_id);

-- Structured clinical concepts curated from literature and manual review
CREATE TABLE IF NOT EXISTS clinical_concepts (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    concept_type TEXT NOT NULL,
    canonical_name TEXT NOT NULL,
    display_name TEXT,
    aliases_json TEXT,
    description TEXT,
    ontology_source TEXT,
    ontology_id TEXT,
    status TEXT DEFAULT 'reviewed',
    source_strategy TEXT DEFAULT 'manual',
    metadata_json TEXT,
    first_seen_at DATETIME,
    last_seen_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_clinical_concepts_user ON clinical_concepts(user_id);
CREATE INDEX IF NOT EXISTS idx_clinical_concepts_type ON clinical_concepts(concept_type);
CREATE INDEX IF NOT EXISTS idx_clinical_concepts_status ON clinical_concepts(status);
CREATE INDEX IF NOT EXISTS idx_clinical_concepts_name ON clinical_concepts(canonical_name);

-- Evidence records connecting concepts to references and project context
CREATE TABLE IF NOT EXISTS concept_evidence (
    id TEXT PRIMARY KEY,
    concept_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    reference_id TEXT,
    project_id TEXT,
    evidence_type TEXT NOT NULL,
    evidence_text TEXT NOT NULL,
    evidence_location TEXT,
    direction TEXT DEFAULT 'supporting',
    evidence_level TEXT DEFAULT 'moderate',
    extraction_confidence REAL,
    review_status TEXT DEFAULT 'accepted',
    review_note TEXT,
    metadata_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (concept_id) REFERENCES clinical_concepts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (reference_id) REFERENCES references_library(id) ON DELETE SET NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_concept_evidence_concept ON concept_evidence(concept_id);
CREATE INDEX IF NOT EXISTS idx_concept_evidence_user ON concept_evidence(user_id);
CREATE INDEX IF NOT EXISTS idx_concept_evidence_reference ON concept_evidence(reference_id);

-- User-curated “report preview” entries for the research library (from Research Lab file preview)
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
