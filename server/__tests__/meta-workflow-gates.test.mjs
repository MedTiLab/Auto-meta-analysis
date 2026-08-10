import { describe, expect, it } from 'vitest';

import {
  filterHumanReviewedFullTextCandidates,
  isParsedDocumentQualityReviewed,
  isPdfHumanAudited,
  markPdfAuditPending,
  markPdfHumanAudited,
} from '../services/meta-analysis/workflow-gates.js';

describe('Meta workflow gate helpers', () => {
  it('allows full-text handling after named-agent include/maybe decisions or explicit user overrides', () => {
    const references = [{ id: 'ref_ai' }, { id: 'ref_claude' }, { id: 'ref_user' }, { id: 'ref_excluded' }, { id: 'ref_final' }];
    const decisions = [
      { reference_id: 'ref_ai', stage: 'title_abstract', decision: 'include', reviewer: 'ai_pre_screen', updated_at: '2026-01-01' },
      { reference_id: 'ref_claude', stage: 'title_abstract', decision: 'include', reviewer: 'claude', updated_at: '2026-01-02' },
      { reference_id: 'ref_user', stage: 'title_abstract', decision: 'maybe', reviewer: 'user', updated_at: '2026-01-02' },
      { reference_id: 'ref_excluded', stage: 'title_abstract', decision: 'include', reviewer: 'user', updated_at: '2026-01-02' },
      { reference_id: 'ref_excluded', stage: 'final', decision: 'exclude', reviewer: 'user', updated_at: '2026-01-03' },
      { reference_id: 'ref_final', stage: 'final', decision: 'include', reviewer: 'lead_reviewer', updated_at: '2026-01-03' },
    ];

    expect(filterHumanReviewedFullTextCandidates(references, decisions).map((item) => item.id)).toEqual(['ref_claude', 'ref_user']);
  });

  it('requires explicit PDF audit and parse quality review for clinical workflow gates', () => {
    const pending = markPdfAuditPending('open_access');
    const audited = markPdfHumanAudited(pending);

    expect(pending).toBe('human_audit_pending:open_access');
    expect(audited).toBe('human_audited:open_access');
    expect(isPdfHumanAudited({ status: 'downloaded', license_status: pending }, { requireExplicitAudit: true })).toBe(false);
    expect(isPdfHumanAudited({ status: 'downloaded', license_status: audited }, { requireExplicitAudit: true })).toBe(true);
    expect(isParsedDocumentQualityReviewed({ status: 'parsed' }, { requireExplicitReview: true })).toBe(false);
    expect(isParsedDocumentQualityReviewed({ status: 'reviewed' }, { requireExplicitReview: true })).toBe(true);
  });
});
