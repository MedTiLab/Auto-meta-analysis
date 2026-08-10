import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { metaAnalysisApi } from '../api/metaAnalysisApi';
import type { MetaProject } from '../types';

type Props = {
  metaProject: MetaProject;
  onSaved: (project: MetaProject) => void;
};

type FormState = {
  title: string;
  disease: string;
  biomarker: string;
  population: string;
  indexTest: string;
  referenceStandard: string;
  primaryOutcome: string;
  inclusionCriteria: string;
  exclusionCriteria: string;
};

export default function ProtocolPanel({ metaProject, onSaved }: Props) {
  const [form, setForm] = useState<FormState>({
    title: '',
    disease: '',
    biomarker: '',
    population: '',
    indexTest: '',
    referenceStandard: '',
    primaryOutcome: '',
    inclusionCriteria: '',
    exclusionCriteria: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({
      title: metaProject.title || '',
      disease: metaProject.disease || '',
      biomarker: metaProject.biomarker || '',
      population: metaProject.population || '',
      indexTest: metaProject.index_test || '',
      referenceStandard: metaProject.reference_standard || '',
      primaryOutcome: metaProject.primary_outcome || '',
      inclusionCriteria: String(metaProject.protocol_json?.inclusionCriteria || ''),
      exclusionCriteria: String(metaProject.protocol_json?.exclusionCriteria || ''),
    });
  }, [metaProject]);

  const setField = (field: keyof FormState, value: string) => {
    setForm((previous) => ({ ...previous, [field]: value }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const response = await metaAnalysisApi.updateProject(metaProject.id, {
        title: form.title,
        disease: form.disease,
        biomarker: form.biomarker,
        population: form.population,
        indexTest: form.indexTest,
        referenceStandard: form.referenceStandard,
        primaryOutcome: form.primaryOutcome,
        protocolJson: {
          ...(metaProject.protocol_json || {}),
          inclusionCriteria: form.inclusionCriteria,
          exclusionCriteria: form.exclusionCriteria,
        },
      });
      onSaved(response.metaProject);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-auto p-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <label className="space-y-1.5 xl:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">标题</span>
          <Input value={form.title} onChange={(event) => setField('title', event.target.value)} />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">疾病</span>
          <Input value={form.disease} onChange={(event) => setField('disease', event.target.value)} />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">肿瘤标志物</span>
          <Input value={form.biomarker} onChange={(event) => setField('biomarker', event.target.value)} />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">研究人群</span>
          <Input value={form.population} onChange={(event) => setField('population', event.target.value)} />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Index test</span>
          <Input value={form.indexTest} onChange={(event) => setField('indexTest', event.target.value)} />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Reference standard</span>
          <Input value={form.referenceStandard} onChange={(event) => setField('referenceStandard', event.target.value)} />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Primary outcome</span>
          <Input value={form.primaryOutcome} onChange={(event) => setField('primaryOutcome', event.target.value)} />
        </label>
        <label className="space-y-1.5 xl:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">纳入标准</span>
          <textarea className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.inclusionCriteria} onChange={(event) => setField('inclusionCriteria', event.target.value)} />
        </label>
        <label className="space-y-1.5 xl:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">排除标准</span>
          <textarea className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.exclusionCriteria} onChange={(event) => setField('exclusionCriteria', event.target.value)} />
        </label>
      </div>
      <div className="mt-4">
        <Button onClick={() => void save()} disabled={saving}>
          <Save className="h-4 w-4" />
          {saving ? '保存中...' : '保存 Protocol'}
        </Button>
      </div>
    </div>
  );
}
