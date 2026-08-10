const formatDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatSequence = (sequence) => String(sequence).padStart(2, '0');

const extractSequenceForDate = (name, dateKey) => {
  if (typeof name !== 'string') {
    return null;
  }

  const match = name.match(new RegExp(`^proj-${dateKey}-(\\d+)$`));
  if (!match) {
    return null;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
};

export const generateWorkspaceName = (existingNames = []) => {
  const now = new Date();
  const dateKey = formatDate(now);
  const highestSequence = existingNames.reduce((maxSequence, name) => {
    const sequence = extractSequenceForDate(name, dateKey);
    if (!sequence) {
      return maxSequence;
    }
    return Math.max(maxSequence, sequence);
  }, 0);
  const nextSequence = highestSequence + 1;
  return `proj-${dateKey}-${formatSequence(nextSequence)}`;
};

export default generateWorkspaceName;
