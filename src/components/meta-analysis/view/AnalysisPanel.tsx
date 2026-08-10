import { useEffect, useState } from 'react';
import { BarChart3, Database, Play } from 'lucide-react';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { metaAnalysisApi } from '../api/metaAnalysisApi';
import type { AnalysisRun, MetaProject } from '../types';

type Props = {
  metaProject: MetaProject;
  onChanged: () => void;
};

export default function AnalysisPanel({ metaProject, onChanged }: Props) {
  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const response = await metaAnalysisApi.analysisRuns(metaProject.id);
    setRuns(response.analysisRuns);
  };

  useEffect(() => {
    void load();
  }, [metaProject.id]);

  const exportDataset = async () => {
    setBusy(true);
    try {
      const response = await metaAnalysisApi.exportDiagnosticDataset(metaProject.id);
      setMessage(`数据集已更新：${response.datasetPath}，纳入 ${response.includedCount} 行。`);
    } finally {
      setBusy(false);
    }
  };

  const runAnalysis = async () => {
    setBusy(true);
    try {
      const response = await metaAnalysisApi.runDiagnosticAnalysis(metaProject.id);
      setMessage(response.result.error || `分析完成：${response.analysisRun.status}`);
      await load();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mb-3 flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={() => void exportDataset()}>
          <Database className="h-4 w-4" />
          导出/刷新 input CSV
        </Button>
        <Button disabled={busy} onClick={() => void runAnalysis()}>
          <Play className="h-4 w-4" />
          运行诊断 Meta 分析
        </Button>
      </div>
      {message && <div className="mb-3 rounded-md border border-border bg-muted/40 p-3 text-sm">{message}</div>}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {runs.map((run) => (
          <div key={run.id} className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 font-medium">
                <BarChart3 className="h-4 w-4" />
                {run.analysis_type}
              </div>
              <Badge variant={run.status === 'completed' ? 'default' : 'outline'}>{run.status}</Badge>
            </div>
            <div className="mt-3 space-y-1 text-xs text-muted-foreground">
              <div>Input: {run.input_dataset_path || '-'}</div>
              <div>Output: {run.output_json_path || '-'}</div>
              <div>Finished: {run.finished_at || '-'}</div>
              {run.error && <div className="text-destructive">{run.error}</div>}
            </div>
          </div>
        ))}
        {runs.length === 0 && <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">尚无分析运行记录</div>}
      </div>
    </div>
  );
}
