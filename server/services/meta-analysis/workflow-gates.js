const NAMED_AGENT_REVIEWER_RE = /^claude(?:[\s:_-]|$)/i;

const FULL_TEXT_GATE_STAGE_RANK = {
  final: 3,
  full_text: 2,
  title_abstract: 1,
};

const PDF_AUDIT_PENDING_PREFIX = 'human_audit_pending:';
const PDF_AUDITED_PREFIX = 'human_audited:';
const TRUSTED_PDF_SOURCE_STATUSES = new Set([
  'existing_reference_cache',
  'open_access',
  'user_provided',
  'zotero_attachment',
]);

export function isHumanReviewer(reviewer) {
  const normalized = String(reviewer || '').trim().toLowerCase();
  return normalized === 'user' || NAMED_AGENT_REVIEWER_RE.test(normalized);
}

export function getHumanReviewedScreeningGate(decisions = [], referenceId) {
  const candidates = decisions
    .filter((decision) => decision?.reference_id === referenceId && isHumanReviewer(decision.reviewer))
    .sort((left, right) => {
      const rankDiff = (FULL_TEXT_GATE_STAGE_RANK[right.stage] || 0) - (FULL_TEXT_GATE_STAGE_RANK[left.stage] || 0);
      if (rankDiff !== 0) return rankDiff;
      return String(right.updated_at || '').localeCompare(String(left.updated_at || ''));
    });
  return candidates[0] || null;
}

export function isHumanReviewedFullTextCandidate(decision) {
  return Boolean(decision && ['include', 'maybe'].includes(decision.decision) && isHumanReviewer(decision.reviewer));
}

export function filterHumanReviewedFullTextCandidates(references = [], decisions = []) {
  return references.filter((reference) => (
    isHumanReviewedFullTextCandidate(getHumanReviewedScreeningGate(decisions, reference.id))
  ));
}

function normalizeAuditBaseStatus(licenseStatus) {
  const normalized = String(licenseStatus || '').trim();
  if (!normalized) return 'unknown';
  if (normalized.startsWith(PDF_AUDIT_PENDING_PREFIX)) return normalized.slice(PDF_AUDIT_PENDING_PREFIX.length) || 'unknown';
  if (normalized.startsWith(PDF_AUDITED_PREFIX)) return normalized.slice(PDF_AUDITED_PREFIX.length) || 'unknown';
  return normalized;
}

export function markPdfAuditPending(licenseStatus) {
  const normalized = String(licenseStatus || '').trim();
  if (normalized.startsWith(PDF_AUDITED_PREFIX) || normalized.startsWith(PDF_AUDIT_PENDING_PREFIX)) {
    return normalized;
  }
  return `${PDF_AUDIT_PENDING_PREFIX}${normalizeAuditBaseStatus(normalized)}`;
}

export function markPdfHumanAudited(licenseStatus) {
  return `${PDF_AUDITED_PREFIX}${normalizeAuditBaseStatus(licenseStatus)}`;
}

export function isPdfHumanAudited(asset, { requireExplicitAudit = false } = {}) {
  if (!asset || !['downloaded', 'cached'].includes(asset.status)) return false;
  const licenseStatus = String(asset.license_status || asset.licenseStatus || '').trim();
  if (licenseStatus.startsWith(PDF_AUDITED_PREFIX)) return true;
  if (requireExplicitAudit) return false;
  return TRUSTED_PDF_SOURCE_STATUSES.has(normalizeAuditBaseStatus(licenseStatus));
}

export function isParsedDocumentQualityReviewed(parsedDocument, { requireExplicitReview = false } = {}) {
  if (!parsedDocument) return false;
  if (parsedDocument.status === 'reviewed') return true;
  if (requireExplicitReview) return false;
  return parsedDocument.status === 'parsed';
}
