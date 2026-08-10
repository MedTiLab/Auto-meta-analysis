# Venue Rule Matrix

Last updated: 2026-03-24

Use this file to select the correct rebuttal workflow for a target venue.

## Reading guide

Each venue entry tracks:

- primary artifact structure: one-shot PDF, per-review text response, threaded discussion, rolling review response, or single-feedback response
- interaction style: one-shot, threaded, or rolling
- submission mechanics
- revision policy during discussion
- notable prohibitions
- timeline details when available

Use `primary artifact structure` as the main routing key. Treat `interaction style` as a secondary execution detail.

## Matrix

| Venue | Rebuttal mode | Format and limits | Revision mechanics | Key constraints | Sources |
| --- | --- | --- | --- | --- | --- |
| CVPR 2025 | One-shot rebuttal | Optional 1-page PDF rebuttal | No iterative discussion noted in author guide | Must remain anonymous; no external links; should not add unrequested new results or major new material | https://cvpr.thecvf.com/Conferences/2025/AuthorGuidelines |
| ICCV 2025 | One-shot rebuttal | Optional 1-page PDF rebuttal | No iterative discussion noted in author guide | Must remain anonymous; no external links; can send confidential comment to AC; should not add unrequested new results or major new material | https://iccv.thecvf.com/Conferences/2025/AuthorGuidelines |
| ECCV 2026 | One-shot rebuttal | Optional 1-page PDF rebuttal in ECCV rebuttal template | No iterative author-reviewer exchange described on submission policy page | No external links in submission, supplement, or rebuttal when they expand content; overlength or altered-format rebuttals will not be reviewed | https://eccv.ecva.net/Conferences/2026/SubmissionPolicies |
| ICLR 2026 | Threaded discussion | OpenReview discussion plus revised PDF; no single 1-page rebuttal rule | Authors can respond and revise from 2025-11-11 to 2025-12-03 | Main paper limit increases from 9 to 10 pages at rebuttal and camera-ready; `pdfdiff` shown to reviewers and ACs; large revisions may be ignored | https://iclr.cc/Conferences/2026/AuthorGuide |
| NeurIPS 2025 | Threaded discussion | Author rebuttal window in OpenReview; exact form is venue-managed | Rebuttal 2025-07-24 to 2025-07-30, followed by discussion through 2025-08-06 | Reviewer form explicitly requests actionable author-response questions; venue uses discussion rather than a single fixed PDF rebuttal page | https://neurips.cc/Conferences/2025/ReviewerGuidelines |
| ICML 2025 | Per-review response plus discussion | One official response per review, 5000 characters each | Reviewers must acknowledge author response; further reviewer questions and one final author response are supported | Confidential comments to AC exist but must not be used as a late rebuttal channel | https://icml.cc/Conferences/2025/ReviewerInstructions |
| ICML 2026 | Per-review response plus structured discussion | Three rounds in OpenReview-style discussion, each limited to 5000 characters | Reviewer-author discussion runs 2026-03-24 to 2026-04-07; no revised manuscript upload allowed during author response | Authors are encouraged to address major misunderstandings, not every minor point; responses must stay anonymous and avoid non-anonymized or shortened URLs; AC-only comments are possible through reader-restricted notes rather than a public author artifact | https://icml.cc/Conferences/2026/ReviewerInstructions ; https://icml.cc/Conferences/2026/AuthorInstructions ; https://icml.cc/Conferences/2026/AreaChairInstructions |
| AISTATS 2025 | Rebuttal plus discussion | Text-only author-reviewer discussion; no manuscript revision allowed during discussion | Author-reviewer discussion ran 2024-11-27 to 2024-12-09; author rebuttals due 2024-12-10 | Text-only discussion; updated manuscript not allowed until acceptance; authors may post links during discussion but anonymity still applies and reviewers are not obliged to click | https://aistats.org/aistats2025/faqs.html ; https://aistats.org/aistats2025/reviewer_guidelines.html |
| AISTATS 2026 | Rebuttal plus discussion | Text-only author rebuttal and author-reviewer discussion; no manuscript revision allowed during discussion | Author rebuttal period 2025-11-21 to 2025-11-30, then author-reviewer discussion 2025-12-01 to 2025-12-08 | Text-only discussion; no manuscript revision allowed until acceptance; external links are not allowed during discussion in 2026 FAQ | https://virtual.aistats.org/Conferences/2026/SubmissionFAQ ; https://virtual.aistats.org/Conferences/2026/ReviewerGuidelines |
| UAI 2025 | Threaded discussion | OpenReview author response and discussion period | Authors can respond and discuss 2025-04-03 to 2025-04-12 | Discussion is visible only to assigned committee during review; links that reveal identity are forbidden under double-blind policy; author responses may correct misunderstandings or disagree with reviews | https://www.auai.org/uai2025/submission_instructions ; https://www.auai.org/uai2025/instructions_for_reviewers_and_area_chairs |
| UAI 2026 | Threaded discussion | OpenReview author response and discussion period | Authors can respond and discuss 2026-04-23 to 2026-05-02 | Same general threaded discussion model as UAI 2025; public release happens only after decisions for accepted and opted-in rejected papers | https://www.auai.org/uai2026/submission_instructions |
| AAAI 2026 | Single author feedback phase | Author feedback stage after phase-1 and phase-2 reviews; no public iterative author-reviewer thread described | Program committee discussion happens after author feedback | Only papers surviving phase 1 receive author feedback; feedback window is 2025-10-02 to 2025-10-08; AAAI uses a two-phase review pipeline | https://aaai.org/conference/aaai/aaai-26/review-process/ ; https://aaai.org/conference/aaai/aaai-26/submission-instructions/ |
| ARR | Rolling review response | Text response in OpenReview-style discussion | Revision and later resubmission cycles are central to the process | No images or external links in author response; small directly responsive experiments allowed; large new results discouraged; long arguments are low value | https://aclrollingreview.org/authors |
| ACL 2025 / ACL 2026 main conference | ARR-commit model | No separate ACL-specific rebuttal; authors respond within ARR, then commit reviewed papers to the venue | Authors may revise and resubmit in ARR or commit reviewed papers to a venue | Main conference decision is based on ARR reviews and meta-reviews; response behavior follows ARR rather than a standalone ACL rebuttal page | https://2025.aclweb.org/calls/main_conference_papers/ ; https://2026.aclweb.org/calls/main_conference_papers/ ; https://aclrollingreview.org/authors |
| ACL 2026 Industry Track | Single rebuttal window outside ARR | Review release starts rebuttal period; author response due 2026-03-29 | No ARR-style rolling revise-and-resubmit; venue-specific response window | Double-blind; does not use ARR; rebuttal is part of the standalone industry-track process | https://2026.aclweb.org/calls/industry_track/ |
| TMLR | Rolling public discussion | Public author response and discussion | Authors typically respond within 2 weeks after the third review; multiple revisions can happen during discussion | Discussion is public; authors and reviewers are expected to continue technical discussion | https://jmlr.org/tmlr/faq.html ; https://jmlr.org/tmlr/reviewer-guide.html |
| KDD 2025 Research / ADS | Per-review rebuttal in OpenReview | Authors can provide a response to each review during the rebuttal period | Research and ADS both include rebuttal windows in each cycle; reviewers then discuss with ACs | If an author fails required reviewing duties, the submission may lose access to reviews during rebuttal; generative AI use in reviewing must be disclosed and verbatim paper upload is forbidden; Feb 2025 cycle rebuttal ran 2025-04-04 to 2025-04-18 | https://kdd2025.kdd.org/research-track-call-for-papers/ ; https://kdd2025.kdd.org/applied-data-science-ads-track-call-for-papers/ ; https://kdd2025.kdd.org/call-for-reviewers/ |
| KDD 2025 Datasets and Benchmarks | No rebuttal period stated on CFP page | OpenReview-managed review with post-decision review publication note | Current CFP page does not list an author rebuttal window | Track is single-blind rather than double-blind; generative AI use in submissions must be disclosed | https://kdd2025.kdd.org/call-for-datasets-and-benchmarks-track-papers/ |
| SIGIR 2025 Full / Short / Perspectives | No official rebuttal stage found in current CFP pages | EasyChair submission and standard review are described, but no author-response window is specified in the reviewed calls | No rebuttal or discussion stage was found in the current official track CFPs reviewed on 2026-03-24 | Inference from official CFPs: use standard revision planning rather than assuming an in-review rebuttal; strong anonymity and preprint rules still matter | https://sigir2025.dei.unipd.it/call-full-papers.html ; https://sigir2025.dei.unipd.it/call-short-papers.html ; https://sigir2025.dei.unipd.it/call-perspectives-papers.html ; https://sigir2025.dei.unipd.it/arxiv-policy.html |
| WSDM 2025 Research Track | No official rebuttal stage found in current CFP page | CMT submission and review process are described, but no author-response window is specified in the main-track CFP | No rebuttal or discussion stage was found in the current official CFP reviewed on 2026-03-24 | Inference from official CFP: reviewers and an SPC assess papers; anonymity, supplement limits, and ACM AI authorship policy are explicit | https://www.wsdm-conference.org/2025/call-for-papers/ |
| WSDM 2026 Full / Short | No official rebuttal stage found in current CFP pages | EasyChair submission and review are described, but no author-response window is specified in the reviewed calls | No rebuttal or discussion stage was found in the current official CFPs reviewed on 2026-03-24 | Inference from official CFPs: plan for no in-review author exchange unless the conference later publishes separate workflow instructions | https://wsdm-conference.org/2026/index.php/call-for-papers/ ; https://wsdm-conference.org/2026/index.php/call-for-short-papers/ |
| The Web Conference 2024 | Author-reviewer discussion | Response during author-reviewer discussion period | Discussion-based process in OpenReview | Double-blind; accepted papers' reviews, meta-reviews, and discussions become public; response informs AC and SAC decisions | https://www2024.thewebconf.org/calls/research-tracks |
| The Web Conference 2025 Research Tracks | OpenReview-based review, rebuttal details not fully recovered from current official pages | Official homepage confirms OpenReview usage via submission link, but current searchable official pages do not expose detailed rebuttal mechanics | Exact 2025 author-response mechanics remain partially unconfirmed from currently accessible official pages | Treat as an unresolved venue entry for now; do not assume 2024 or 2026 rules are identical without checking the archived call or OpenReview venue configuration | https://www2025.thewebconf.org/ ; https://openreview.net/group?id=ACM.org%2FTheWebConf%2F2025 |
| The Web Conference 2026 Research Tracks | Single rebuttal period | Authors can provide a response during a rebuttal period | No interactive rebuttal after rebuttal period | Double-blind; no interactive back-and-forth after rebuttal; response informs AC, SAC, and chair decisions | https://www2026.thewebconf.org/calls/research-tracks.html |
| The Web Conference 2026 Industry Track | Per-review rebuttal | One length-limited response to each review | Reviewers are prompted to acknowledge rebuttals and revise reviews if needed | Single-blind; if authors do not fulfill required reviewing obligations, they may lose access to reviews during rebuttal stage | https://www2026.thewebconf.org/calls/industry.html |

## Notes by family

### One-shot PDF venues

Representative venues:

- CVPR
- ICCV
- ECCV

Recommended workflow:

1. Aggregate repeated concerns.
2. Prioritize the 2-4 issues most likely to affect decisions.
3. Use compact tables or tiny figures only if explicitly allowed.
4. Avoid speculative promises that cannot fit into the one-page artifact.

### Threaded discussion venues

Representative venues:

- ICLR
- NeurIPS
- AISTATS
- UAI

Recommended workflow:

1. Reply quickly to major concerns.
2. Use per-review structure when the platform expects it.
3. Track follow-up questions and convert them into task items.
4. Keep revisions modest unless the venue explicitly invites stronger updates.
5. Check whether the venue allows paper revision during discussion at all, because AISTATS does not.

### Rolling-review venues

Representative venues:

- ARR
- ACL main conference via ARR
- TMLR

Recommended workflow:

1. Distinguish concerns that can be resolved now from concerns requiring a deeper revision.
2. Avoid spending too much space arguing with entrenched reviewers.
3. Prepare a revision plan, not just a response draft.

### Single-feedback venues

Representative venues:

- AAAI
- The Web Conference research tracks
- ACL Industry Track

Recommended workflow:

1. Assume there may be only one effective response window.
2. Prioritize reviewer questions that are explicitly decision-relevant.
3. Keep a separate task list of paper changes, because some venues do not allow revised manuscripts during feedback.

### Per-review rebuttal venues

Representative venues:

- ICML
- KDD Research / ADS
- The Web Conference 2026 Industry Track

Recommended workflow:

1. Keep each reply scoped to one review rather than a global essay.
2. Still maintain an internal merged-concern table to avoid contradictory answers.
3. Generate reviewer-specific drafts and a separate cross-review consistency check.

## Gaps to fill

The matrix still needs more complete official confirmation for:

- AAAI exact author feedback artifact format
- whether KDD imposes explicit character or page limits on each rebuttal response
- exact The Web Conference 2025 research-track rebuttal mechanics from an archived call or venue config
- whether SIGIR or WSDM publish separate workflow instructions outside the CFP that introduce an author-response stage
- additional CS venues such as COLM, WSDM industry tracks, UIST, SIGGRAPH, RSS, CoRL if desired

## Interpretation notes

- Entries that say "No official rebuttal stage found" are explicit conservative inferences from the cited official CFP pages as checked on 2026-03-24. They should be re-verified if a separate reviewer workflow page later appears.
- Entries that say "partially unconfirmed" should not be used for automatic skill routing without a fresh venue-specific check.
