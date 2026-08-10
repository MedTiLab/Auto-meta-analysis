import { useEffect, useState } from 'react';
import { metaAnalysisApi } from '../api/metaAnalysisApi';
import type { MetaProject, MetaReference } from '../types';

type Props = {
  metaProject: MetaProject;
  reference: MetaReference;
};

export default function PdfMarkdownReader({ metaProject, reference }: Props) {
  const [markdown, setMarkdown] = useState('');
  const [tables, setTables] = useState<unknown>(null);
  const pdfUrl = `/api/meta-analysis/${encodeURIComponent(metaProject.id)}/references/${encodeURIComponent(reference.id)}/pdf`;

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      metaAnalysisApi.markdown(metaProject.id, reference.id).catch((error: unknown) => String(error)),
      metaAnalysisApi.tables(metaProject.id, reference.id).catch((error: unknown) => ({ error: String(error) })),
    ]).then(([nextMarkdown, nextTables]) => {
      if (!cancelled) {
        setMarkdown(String(nextMarkdown));
        setTables(nextTables);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [metaProject.id, reference.id]);

  return (
    <div className="grid h-[34rem] grid-cols-1 gap-3 xl:grid-cols-2">
      <iframe className="h-full w-full rounded-lg border border-border bg-white" title={reference.title} src={pdfUrl} />
      <div className="flex min-h-0 flex-col rounded-lg border border-border">
        <div className="border-b border-border px-3 py-2 text-sm font-medium">MinerU Markdown / Tables</div>
        <div className="grid min-h-0 flex-1 grid-rows-2">
          <pre className="overflow-auto border-b border-border p-3 text-xs whitespace-pre-wrap">{markdown || '暂无 Markdown'}</pre>
          <pre className="overflow-auto p-3 text-xs whitespace-pre-wrap">{JSON.stringify(tables, null, 2)}</pre>
        </div>
      </div>
    </div>
  );
}
