import { useEffect, useState } from 'react';
import { FilePenLine } from 'lucide-react';
import { Button } from '../../ui/button';
import { metaAnalysisApi } from '../api/metaAnalysisApi';
import type { ManuscriptSection, MetaProject } from '../types';

type Props = {
  metaProject: MetaProject;
  onChanged: () => void;
};

const sections = ['introduction', 'methods', 'results', 'discussion', 'conclusion'];

export default function ManuscriptPanel({ metaProject, onChanged }: Props) {
  const [items, setItems] = useState<ManuscriptSection[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const response = await metaAnalysisApi.manuscript(metaProject.id);
    setItems(response.sections);
  };

  useEffect(() => {
    void load();
  }, [metaProject.id]);

  const generate = async (sectionKey: string) => {
    setBusy(sectionKey);
    try {
      await metaAnalysisApi.generateManuscriptSection(metaProject.id, sectionKey);
      await load();
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mb-4 flex flex-wrap gap-2">
        {sections.map((section) => (
          <Button key={section} variant="outline" size="sm" disabled={busy === section} onClick={() => void generate(section)}>
            <FilePenLine className="h-4 w-4" />
            生成 {section}
          </Button>
        ))}
      </div>
      <div className="space-y-3">
        {items.map((section) => (
          <div key={section.id} className="rounded-lg border border-border">
            <div className="border-b border-border px-4 py-2 text-sm font-medium">{section.section_key}</div>
            <pre className="whitespace-pre-wrap p-4 text-sm leading-6">{section.content_markdown}</pre>
          </div>
        ))}
        {items.length === 0 && <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">尚无文稿章节</div>}
      </div>
    </div>
  );
}
