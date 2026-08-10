import { useEffect, useState } from 'react';
import { Check, Database, Play, X } from 'lucide-react';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { metaAnalysisApi } from '../api/metaAnalysisApi';
import type { ExtractionResult, MetaProject } from '../types';

type Props = {
  metaProject: MetaProject;
  onChanged: () => void;
};

function valuePreview(value: Record<string, unknown> | null) {
  if (!value) return '-';
  const data = Array.isArray(value.diagnosticData) ? value.diagnosticData[0] as Record<string, unknown> : value;
  return ['TP', 'FP', 'FN', 'TN']
    .map((field) => `${field}: ${data[field] ?? '-'}`)
    .join(' · ');
}

export default function ExtractionPanel({ metaProject, onChanged }: Props) {
  const [rows, setRows] = useState<ExtractionResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const response = await metaAnalysisApi.extractions(metaProject.id);
    setRows(response.extractionResults);
  };

  useEffect(() => {
    void load();
  }, [metaProject.id]);

  const runExtraction = async () => {
    setBusy(true);
    try {
      const response = await metaAnalysisApi.runDiagnosticExtraction(metaProject.id, { referenceIds: [] });
      const skipped = response.skippedParseReview ? `；${response.skippedParseReview} 篇因解析/来源状态未就绪被跳过` : '';
      setMessage(`生成 ${response.extractionResults.length} 条候选提取结果${skipped}。`);
      await load();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const updateStatus = async (row: ExtractionResult, reviewStatus: ExtractionResult['review_status']) => {
    setBusy(true);
    try {
      await metaAnalysisApi.updateExtraction(metaProject.id, row.id, { reviewStatus });
      await load();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const exportDataset = async () => {
    setBusy(true);
    try {
      const response = await metaAnalysisApi.exportDiagnosticDataset(metaProject.id);
      setMessage(`已导出数据集：纳入 ${response.includedCount} 行，排除 ${response.excludedCount} 行。`);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button onClick={() => void runExtraction()} disabled={busy}>
          <Play className="h-4 w-4" />
          从已解析全文生成候选提取
        </Button>
        <Button variant="outline" onClick={() => void exportDataset()} disabled={busy}>
          <Database className="h-4 w-4" />
          导出 confirmed 数据集
        </Button>
      </div>
      <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100">
        AI 提取只生成候选字段，可从已解析且来源授权的全文开始。Claude 可做 AI 复核；高风险或冲突项再交用户覆盖/抽查，只有标记为 confirmed 的记录会进入最终数据集和统计分析。
      </div>
      {message && <div className="mb-3 rounded-md border border-border bg-muted/40 p-3 text-sm">{message}</div>}
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full min-w-[1080px] text-left text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Reference</th>
              <th className="px-3 py-2">Field</th>
              <th className="px-3 py-2">Value</th>
              <th className="px-3 py-2">Evidence</th>
              <th className="px-3 py-2">Confidence</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-border align-top">
                <td className="px-3 py-2 font-mono text-xs">{row.reference_id}</td>
                <td className="px-3 py-2">{row.field_name}</td>
                <td className="px-3 py-2 text-xs">{valuePreview(row.value_json)}</td>
                <td className="max-w-sm px-3 py-2 text-xs text-muted-foreground">{row.evidence_text || '-'}</td>
                <td className="px-3 py-2">{row.confidence ?? '-'}</td>
                <td className="px-3 py-2"><Badge variant={row.review_status === 'confirmed' ? 'default' : 'outline'}>{row.review_status}</Badge></td>
                <td className="px-3 py-2">
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void updateStatus(row, 'confirmed')}>
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void updateStatus(row, 'rejected')}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td className="px-3 py-8 text-center text-muted-foreground" colSpan={7}>尚无提取结果</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
