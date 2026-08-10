import { RefreshCw } from 'lucide-react';
import { Button } from '../../ui/button';
import type { MetaOverview } from '../types';

type Props = {
  overview: MetaOverview | null;
  onRefresh: () => void;
};

const CARD_ITEMS: Array<{ label: string; value: (overview: MetaOverview) => number | string }> = [
  { label: '项目文献', value: (overview) => overview.counts.references.total },
  { label: '检索记录', value: (overview) => overview.counts.searchRuns.total },
  { label: '题摘待一筛', value: (overview) => overview.counts.screeningStatus?.byStage?.title_abstract?.pending || overview.counts.screeningStatus?.pending || 0 },
  { label: '题摘一筛结果', value: (overview) => overview.counts.screeningStatus?.byStage?.title_abstract?.aiPreScreen || overview.counts.screeningStatus?.aiPreScreen || 0 },
  { label: '题摘待 AI 二筛', value: (overview) => overview.counts.screeningStatus?.byStage?.title_abstract?.pendingAgentReview || overview.counts.screeningStatus?.pendingAgentReview || 0 },
  { label: '题摘已 AI 二筛', value: (overview) => overview.counts.screeningStatus?.byStage?.title_abstract?.agentReviewed || overview.counts.screeningStatus?.agentReviewed || 0 },
  { label: '全文待 AI 二筛', value: (overview) => overview.counts.screeningStatus?.byStage?.full_text?.pendingAgentReview || 0 },
  { label: '用户覆盖/抽查', value: (overview) => overview.counts.screeningStatus?.userAuthorized || 0 },
  { label: 'PDF 已下载', value: (overview) => overview.counts.pdfAssets.downloaded || 0 },
  { label: '需要手动上传', value: (overview) => overview.counts.pdfAssets.manual_upload_required || 0 },
  { label: 'MinerU 已解析', value: (overview) => overview.counts.parsedDocuments.parsed || 0 },
  { label: '待确认提取', value: (overview) => overview.counts.extractions.candidate || 0 },
  { label: '已确认数据', value: (overview) => overview.counts.extractions.confirmed || 0 },
  { label: '分析运行', value: (overview) => overview.counts.analysisRuns.completed || 0 },
  { label: '文稿章节', value: (overview) => overview.counts.manuscriptSections.total },
];

export default function MetaOverviewPanel({ overview, onRefresh }: Props) {
  if (!overview) {
    return <div className="p-4 text-sm text-muted-foreground">正在加载 Meta 分析工作区...</div>;
  }

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">{overview.metaProject.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {overview.metaProject.disease || '未设置疾病'} · {overview.metaProject.biomarker || '未设置标志物'} · {overview.metaProject.review_type}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-4 w-4" />
          刷新
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {CARD_ITEMS.map((item) => (
          <div key={item.label} className="rounded-lg border border-border bg-background p-4">
            <div className="text-xs font-medium text-muted-foreground">{item.label}</div>
            <div className="mt-2 text-2xl font-semibold text-foreground">{item.value(overview)}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        统计分析只会使用 `review_status = confirmed` 且包含完整 TP/FP/FN/TN 的记录。自动提取结果默认作为候选，可由 Claude 做 AI 复核；冲突或高风险项再交用户覆盖/抽查。
      </div>
    </div>
  );
}
