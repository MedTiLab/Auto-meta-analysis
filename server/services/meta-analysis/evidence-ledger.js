import { evidenceLedgerDb } from '../../database/db.js';

const validatorRegistry = new Map();

export function registerValidator(type, validatorId, fn) {
  const list = validatorRegistry.get(type) || [];
  list.push({ validatorId, fn });
  validatorRegistry.set(type, list);
}

export function clearValidators() {
  validatorRegistry.clear();
}

export function getValidators(type) {
  return validatorRegistry.get(type) || [];
}

export function runValidators(type, draft) {
  const errors = [];
  for (const { validatorId, fn } of getValidators(type)) {
    const result = fn(draft) || {};
    if (!result.passed) {
      for (const err of result.errors || []) errors.push({ validatorId, ...err });
    }
  }
  return { passed: errors.length === 0, errors };
}

export function recordArtifact(userId, spec) {
  const prior = evidenceLedgerDb.getLatestArtifact(spec.metaProjectId, spec.type);
  const artifact = evidenceLedgerDb.createArtifact(userId, spec);
  const validation = runValidators(spec.type, artifact);

  if (validation.passed) {
    const validated = evidenceLedgerDb.setArtifactStatus(
      artifact.id, 'validated',
      { passed: true, errors: [], validatedAt: new Date().toISOString() },
    );
    if (prior) {
      const affected = evidenceLedgerDb.collectTransitiveDependents(prior.id);
      if (affected.length) evidenceLedgerDb.markStale(affected);
    }
    return { artifact: validated, validation };
  }

  const draft = evidenceLedgerDb.setArtifactStatus(
    artifact.id, 'draft',
    { passed: false, errors: validation.errors },
  );
  return { artifact: draft, validation };
}

export function overrideValidation(userId, artifactId, justification) {
  if (!justification || !justification.trim()) {
    throw new Error('justification is required to override validation');
  }
  return evidenceLedgerDb.setArtifactStatus(artifactId, 'validated', {
    passed: true, errors: [], overriddenBy: userId,
    justification, validatedAt: new Date().toISOString(),
  });
}
