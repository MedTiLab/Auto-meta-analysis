import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileText, Play } from 'lucide-react';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { metaAnalysisApi } from '../api/metaAnalysisApi';
import PdfMarkdownReader from './PdfMarkdownReader';
import type { MetaProject, MetaReference, ParsedDocument, PdfAsset } from '../types';

type Props = {
  metaProject: MetaProject;
  onChanged: () => void;
};

const TRUSTED_FULL_TEXT_SOURCE_STATUSES = new Set([
  'existing_reference_cache',
  'open_access',
  'user_provided',
  'zotero_attachment',
]);

function normalizeAuditBaseStatus(licenseStatus: string | null | undefined) {
  const normalized = String(licenseStatus || '').trim();
  if (normalized.startsWith('human_audit_pending:')) return normalized.slice('human_audit_pending:'.length) || 'unknown';
  if (normalized.startsWith('human_audited:')) return normalized.slice('human_audited:'.length) || 'unknown';
  return normalized;
}

function isFullTextSourceReady(asset: PdfAsset | undefined) {
  if (!asset || !['downloaded', 'cached'].includes(asset.status)) return false;
  if (asset.license_status?.startsWith('human_audited:')) return true;
  return TRUSTED_FULL_TEXT_SOURCE_STATUSES.has(normalizeAuditBaseStatus(asset.license_status));
}

function getAssetTypeLabel(asset: PdfAsset | undefined) {
  const type = String(asset?.asset_type || '').toLowerCase();
  if (type === 'markdown') return 'Markdown';
  if (type === 'html') return 'HTML';
  if (type === 'text') return 'Text';
  return 'PDF';
}

export default function ParsePanel({ metaProject, onChanged }: Props) {
  const [references, setReferences] = useState<MetaReference[]>([]);
  const [documents, setDocuments] = useState<ParsedDocument[]>([]);
  const [assets, setAssets] = useState<PdfAsset[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [readerReferenceId, setReaderReferenceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [refsResponse, docsResponse, assetsResponse] = await Promise.all([
      metaAnalysisApi.references(metaProject.id),
      metaAnalysisApi.parsedDocuments(metaProject.id),
      metaAnalysisApi.fullTextAssets(metaProject.id),
    ]);
    setReferences(refsResponse.references);
    setDocuments(docsResponse.parsedDocuments);
    setAssets(assetsResponse.fullTextAssets || assetsResponse.pdfAssets);
  };

  useEffect(() => {
    void load();
  }, [metaProject.id]);

  const docByReference = useMemo(() => new Map(documents.map((doc) => [doc.reference_id, doc])), [documents]);
  const assetByReference = useMemo(() => new Map(assets.map((asset) => [asset.reference_id, asset])), [assets]);
  const fullTextReadyReferences = useMemo(
    () => references.filter((reference) => {
      const asset = assetByReference.get(reference.id);
      return isFullTextSourceReady(asset);
    }),
    [assetByReference, references],
  );
  const readerReference = references.find((reference) => reference.id === readerReferenceId) || null;
  const selectedIds = Array.from(selected);

  const toggle = (referenceId: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(referenceId)) next.delete(referenceId);
      else next.add(referenceId);
      return next;
    });
  };

  const parseSelected = async () => {
    setBusy(true);
    try {
      await metaAnalysisApi.parseBatch(metaProject.id, { referenceIds: selectedIds });
      await load();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const reviewParse = async (referenceId: string) => {
    setBusy(true);
    try {
      await metaAnalysisApi.reviewParsedDocument(metaProject.id, referenceId);
      await load();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button onClick={() => void parseSelected()} disabled={busy || selectedIds.length === 0}>
          <Play className="h-4 w-4" />
          解析选中文献
        </Button>
        <span className="text-sm text-muted-foreground">仅显示已通过来源核验的全文材料；PDF 走 MinerU，Markdown/HTML/TXT 可直接转换为可读全文。</span>
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2"></th>
              <th className="px-3 py-2">题名</th>
              <th className="px-3 py-2">解析状态</th>
              <th className="px-3 py-2">质量分</th>
              <th className="px-3 py-2">文件</th>
              <th className="px-3 py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {fullTextReadyReferences.map((reference) => {
              const doc = docByReference.get(reference.id);
              const asset = assetByReference.get(reference.id);
              return (
                <tr key={reference.id} className="border-t border-border align-top">
                  <td className="px-3 py-2"><input type="checkbox" checked={selected.has(reference.id)} onChange={() => toggle(reference.id)} /></td>
                  <td className="max-w-xl px-3 py-2 font-medium">{reference.title}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1">
                      <Badge variant={doc?.status === 'parsed' ? 'default' : 'outline'}>{doc?.status || 'pending'}</Badge>
                      <span className="text-[11px] text-muted-foreground">{getAssetTypeLabel(asset)}: {asset?.status} · {asset?.license_status}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">{doc?.quality_score ?? '-'}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{doc?.markdown_path || '-'}</td>
                  <td className="px-3 py-2">
                    <Button size="sm" variant="outline" onClick={() => setReaderReferenceId(reference.id)}>
                      <FileText className="h-4 w-4" />
                      阅读
                    </Button>
                    <Button className="ml-2" size="sm" variant="outline" disabled={busy || !doc || !['parsed', 'reviewed'].includes(doc.status) || doc.status === 'reviewed'} onClick={() => void reviewParse(reference.id)}>
                      <CheckCircle2 className="h-4 w-4" />
                      {doc?.status === 'reviewed' ? '已复核' : '确认解析'}
                    </Button>
                  </td>
                </tr>
              );
            })}
            {fullTextReadyReferences.length === 0 && (
              <tr><td className="px-3 py-8 text-center text-muted-foreground" colSpan={6}>暂无已通过来源核验的全文材料。请先通过 Zotero 补全文并同步附件；同步后的 PDF、Markdown、HTML 或文本会进入解析/转换队列。</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {readerReference && (
        <div className="mt-4">
          <PdfMarkdownReader metaProject={metaProject} reference={readerReference} />
        </div>
      )}
    </div>
  );
}
