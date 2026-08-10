export type TableDelimiter = ',' | '\t';

export type DelimitedTable = {
  headers: string[];
  rows: string[][];
  columnCount: number;
};

export function getDelimitedFileDelimiter(fileName = ''): TableDelimiter | null {
  const extension = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : '';
  if (extension === 'csv') return ',';
  if (extension === 'tsv') return '\t';
  return null;
}

export function parseDelimitedTable(value: string, delimiter: TableDelimiter): DelimitedTable {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const nextChar = value[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  while (rows.length > 0 && rows[rows.length - 1].every((entry) => entry.trim() === '')) {
    rows.pop();
  }

  const columnCount = rows.reduce((max, nextRow) => Math.max(max, nextRow.length), 0);
  const normalizedRows = rows.map((nextRow) => {
    const paddedRow = [...nextRow];
    while (paddedRow.length < columnCount) {
      paddedRow.push('');
    }
    return paddedRow;
  });

  return {
    headers: normalizedRows[0] || [],
    rows: normalizedRows.slice(1),
    columnCount,
  };
}

function serializeCell(value: string, delimiter: TableDelimiter): string {
  const text = String(value ?? '');
  if (!text.includes('"') && !text.includes(delimiter) && !/[\r\n]/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

export function serializeDelimitedTable(headers: string[], rows: string[][], delimiter: TableDelimiter): string {
  const columnCount = Math.max(
    headers.length,
    ...rows.map((row) => row.length),
    0,
  );

  const normalizeRow = (row: string[]) => {
    const nextRow = [...row];
    while (nextRow.length < columnCount) {
      nextRow.push('');
    }
    return nextRow.slice(0, columnCount).map((cell) => serializeCell(cell, delimiter)).join(delimiter);
  };

  if (columnCount === 0) {
    return '';
  }

  return [normalizeRow(headers), ...rows.map(normalizeRow)].join('\n');
}
