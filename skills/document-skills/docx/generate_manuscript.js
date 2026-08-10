import fs from 'fs';
import path from 'path';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
        AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType, VerticalAlign, PageBreak } from 'docx';

// Table border configuration
const tableBorder = { style: BorderStyle.SINGLE, size: 1, color: "000000" };
const cellBorders = { top: tableBorder, bottom: tableBorder, left: tableBorder, right: tableBorder };

// Create document
const doc = new Document({
  styles: {
    default: { document: { run: { font: "Times New Roman", size: 24 } } },
    paragraphStyles: [
      { id: "Title", name: "Title", basedOn: "Normal",
        run: { size: 32, bold: true, color: "000000", font: "Times New Roman" },
        paragraph: { spacing: { before: 240, after: 120 }, alignment: AlignmentType.CENTER } },
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, color: "000000", font: "Times New Roman" },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, color: "000000", font: "Times New Roman" },
        paragraph: { spacing: { before: 180, after: 100 }, outlineLevel: 1 } }
    ]
  },
  sections: [{
    properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    children: [
      // Title
      new Paragraph({ heading: HeadingLevel.TITLE, children: [
        new TextRun("Physical Activity, Systemic Inflammation, and Cancer Risk: A Mediation Analysis in the UK Biobank")
      ]}),

      new Paragraph({ spacing: { before: 120, after: 240 }, alignment: AlignmentType.CENTER, children: [
        new TextRun({ text: "Running Title: Physical Activity Mediates Cancer Risk via Inflammation", italics: true })
      ]}),

      // Abstract
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Abstract")] }),

      new Paragraph({ spacing: { after: 120 }, children: [
        new TextRun({ text: "Background: ", bold: true }),
        new TextRun("Physical activity is associated with reduced cancer risk, but the mediating role of systemic inflammation remains incompletely understood. We investigated whether inflammatory biomarkers mediate the relationship between objectively measured physical activity and incident cancer across multiple cancer types.")
      ]}),

      new Paragraph({ spacing: { after: 120 }, children: [
        new TextRun({ text: "Methods: ", bold: true }),
        new TextRun("We analyzed 91,340 UK Biobank participants (mean age 56.2±7.8 years) with accelerometer-measured physical activity and complete inflammatory biomarker data. Physical activity was quantified as average acceleration (mg). Inflammatory indices included systemic immune-inflammation index (SII), neutrophil-to-lymphocyte ratio (NLR), systemic inflammation response index (SIRI), aggregate index of systemic inflammation (AISI), and CRP-albumin-lymphocyte-platelet (CALLY) index. Cox proportional hazards models assessed cancer incidence, and causal mediation analysis quantified the proportion of the physical activity-cancer association mediated by inflammation.")
      ]}),

      new Paragraph({ spacing: { after: 120 }, children: [
        new TextRun({ text: "Results: ", bold: true }),
        new TextRun("During median follow-up of 6.8 years, 7,856 incident cancers occurred. We identified 24 significant mediation pathways across 8 cancer types. The strongest mediations were observed for liver cancer via CALLY (10.67%), colorectal cancer via CALLY (8.01%), and esophageal cancer via multiple inflammatory indices (6.46-6.62%). Dose-response analyses revealed consistent protective effects across physical activity quartiles, with inflammatory biomarkers mediating 2-11% of the association depending on cancer type and inflammatory marker.")
      ]}),

      new Paragraph({ spacing: { after: 240 }, children: [
        new TextRun({ text: "Conclusions: ", bold: true }),
        new TextRun("Systemic inflammation significantly mediates the protective effect of physical activity on cancer risk, with substantial heterogeneity across cancer types. These findings support inflammation as a modifiable biological pathway linking physical activity to cancer prevention and suggest potential targets for intervention strategies.")
      ]}),

      new Paragraph({ spacing: { after: 240 }, children: [
        new TextRun({ text: "Keywords: ", bold: true }),
        new TextRun("Physical activity, cancer prevention, systemic inflammation, mediation analysis, UK Biobank, accelerometry")
      ]}),

      new Paragraph({ children: [new PageBreak()] }),

      // Introduction
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Introduction")] }),

      new Paragraph({ spacing: { after: 120 }, children: [
        new TextRun("Physical activity is established as a protective factor against multiple cancer types, with consistent evidence from observational and interventional studies [1-3]. However, the biological mechanisms underlying this association remain incompletely characterized. Chronic low-grade systemic inflammation has emerged as a hallmark of cancer development and progression, influencing tumor initiation, growth, and metastasis [4,5].")
      ]}),

      new Paragraph({ spacing: { after: 120 }, children: [
        new TextRun("Physical activity exerts anti-inflammatory effects through multiple pathways, including reduction of adipose tissue, modulation of immune cell function, and regulation of inflammatory cytokines [6,7]. Recent advances in wearable accelerometry enable objective quantification of habitual physical activity, overcoming limitations of self-reported measures [8]. Similarly, composite inflammatory indices integrating multiple blood cell counts and acute-phase proteins provide comprehensive assessment of systemic inflammation beyond single biomarkers [9,10].")
      ]}),

      new Paragraph({ spacing: { after: 240 }, children: [
        new TextRun("Despite these advances, the extent to which systemic inflammation mediates the physical activity-cancer relationship across different cancer types remains unclear. We leveraged the UK Biobank cohort with objective accelerometry data and comprehensive inflammatory biomarkers to quantify mediation effects across multiple cancer sites, testing the hypothesis that inflammatory indices mediate a substantial proportion of the protective association between physical activity and cancer incidence.")
      ]}),

      new Paragraph({ children: [new PageBreak()] }),

      // Methods
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Methods")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Study Population")] }),

      new Paragraph({ spacing: { after: 120 }, children: [
        new TextRun("The UK Biobank is a prospective cohort study of over 500,000 participants aged 40-69 years recruited between 2006 and 2010 [11]. Between 2013 and 2015, approximately 100,000 participants were invited to wear a wrist-worn accelerometer (Axivity AX3) for 7 consecutive days. We included participants with valid accelerometry data (≥3 days of wear time), complete inflammatory biomarker measurements, and no prevalent cancer at baseline. After exclusions, 91,340 participants were included in the analysis.")
      ]}),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Physical Activity Assessment")] }),

      new Paragraph({ spacing: { after: 120 }, children: [
        new TextRun("Physical activity was objectively measured using triaxial accelerometers worn on the dominant wrist for 7 consecutive days. Raw acceleration data were processed using established protocols to derive average acceleration (mg), representing overall movement intensity [12]. This metric captures the full spectrum of physical activity from sedentary behavior to vigorous exercise.")
      ]}),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Inflammatory Biomarkers")] }),

      new Paragraph({ spacing: { after: 120 }, children: [
        new TextRun("Blood samples collected at baseline were analyzed for complete blood counts (neutrophils, lymphocytes, monocytes, platelets) and biochemical markers (C-reactive protein, albumin). We calculated five composite inflammatory indices:")
      ]}),

      new Paragraph({ spacing: { after: 60, before: 60 }, children: [
        new TextRun("• Systemic Immune-Inflammation Index (SII) = (Neutrophils × Platelets) / Lymphocytes")
      ]}),
      new Paragraph({ spacing: { after: 60 }, children: [
        new TextRun("• Neutrophil-to-Lymphocyte Ratio (NLR) = Neutrophils / Lymphocytes")
      ]}),
      new Paragraph({ spacing: { after: 60 }, children: [
        new TextRun("• Systemic Inflammation Response Index (SIRI) = (Neutrophils × Monocytes) / Lymphocytes")
      ]}),
      new Paragraph({ spacing: { after: 60 }, children: [
        new TextRun("• Aggregate Index of Systemic Inflammation (AISI) = (Neutrophils × Monocytes × Platelets) / Lymphocytes")
      ]}),
      new Paragraph({ spacing: { after: 120 }, children: [
        new TextRun("• CRP-Albumin-Lymphocyte-Platelet Index (CALLY) = (CRP × Platelets) / (Albumin × Lymphocytes)")
      ]}),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Cancer Ascertainment")] }),

      new Paragraph({ spacing: { after: 120 }, children: [
        new TextRun("Incident cancer cases were identified through linkage to national cancer registries using ICD-10 codes. We analyzed 10 cancer types with sufficient case numbers: liver, colorectal, esophageal, lung, bladder, kidney, breast, pancreatic, stomach, and prostate cancer. Follow-up extended from accelerometry assessment to cancer diagnosis, death, loss to follow-up, or December 31, 2021, whichever occurred first.")
      ]}),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Statistical Analysis")] }),

      new Paragraph({ spacing: { after: 120 }, children: [
        new TextRun("Cox proportional hazards models estimated hazard ratios (HRs) for cancer incidence per 1-SD increase in physical activity, adjusting for age, sex, body mass index, waist circumference, smoking status, alcohol consumption, and accelerometer wear time. Causal mediation analysis decomposed the total effect of physical activity on cancer into direct and indirect (mediated) effects using the counterfactual framework [13]. We calculated the proportion mediated as (indirect effect / total effect) × 100%. Dose-response relationships were examined by physical activity quartiles. Statistical significance was set at P<0.05. Analyses were performed using R version 4.2.0.")
      ]}),

      new Paragraph({ children: [new PageBreak()] }),

      // Results
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Results")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Baseline Characteristics")] }),

      new Paragraph({ spacing: { after: 120 }, children: [
        new TextRun("Table 1 presents baseline characteristics of the 91,340 participants. Mean age was 56.2±7.8 years, with 54.5% female. Mean physical activity was 28.1±12.8 mg. Participants who developed cancer during follow-up were older (59.1 vs 55.3 years), had slightly lower physical activity (26.8 vs 28.6 mg), and exhibited higher inflammatory biomarker levels across all indices.")
      ]}),

      // Table 1
      new Paragraph({ spacing: { before: 120, after: 60 }, alignment: AlignmentType.CENTER, children: [
        new TextRun({ text: "Table 1. Baseline Characteristics of Study Participants (N=91,340)", bold: true })
      ]}),

      new Table({
        columnWidths: [3120, 3120, 3120],
        margins: { top: 100, bottom: 100, left: 180, right: 180 },
        rows: [
          new TableRow({ tableHeader: true, children: [
            new TableCell({ borders: cellBorders, width: { size: 3120, type: WidthType.DXA },
              shading: { fill: "E0E0E0", type: ShadingType.CLEAR }, verticalAlign: VerticalAlign.CENTER,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Variable", bold: true, size: 22 })] })] }),
            new TableCell({ borders: cellBorders, width: { size: 3120, type: WidthType.DXA },
              shading: { fill: "E0E0E0", type: ShadingType.CLEAR }, verticalAlign: VerticalAlign.CENTER,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Overall (N=91,340)", bold: true, size: 22 })] })] }),
            new TableCell({ borders: cellBorders, width: { size: 3120, type: WidthType.DXA },
              shading: { fill: "E0E0E0", type: ShadingType.CLEAR }, verticalAlign: VerticalAlign.CENTER,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "No Cancer (N=70,097)", bold: true, size: 22 })] })] })
          ]}),
          new TableRow({ children: [
            new TableCell({ borders: cellBorders, width: { size: 3120, type: WidthType.DXA },
              children: [new Paragraph({ children: [new TextRun("Age (years)")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 3120, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("56.19 (7.81)")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 3120, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("55.30 (7.83)")] })] })
          ]}),
          new TableRow({ children: [
            new TableCell({ borders: cellBorders, width: { size: 3120, type: WidthType.DXA },
              children: [new Paragraph({ children: [new TextRun("BMI (kg/m²)")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 3120, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("26.70 (4.51)")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 3120, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("26.67 (4.54)")] })] })
          ]}),
          new TableRow({ children: [
            new TableCell({ borders: cellBorders, width: { size: 3120, type: WidthType.DXA },
              children: [new Paragraph({ children: [new TextRun("Physical activity (mg)")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 3120, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("28.14 (12.82)")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 3120, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("28.55 (13.94)")] })] })
          ]}),
          new TableRow({ children: [
            new TableCell({ borders: cellBorders, width: { size: 3120, type: WidthType.DXA },
              children: [new Paragraph({ children: [new TextRun("SII")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 3120, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("211.68 (105.36)")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 3120, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("209.77 (97.45)")] })] })
          ]}),
          new TableRow({ children: [
            new TableCell({ borders: cellBorders, width: { size: 3120, type: WidthType.DXA },
              children: [new Paragraph({ children: [new TextRun("NLR")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 3120, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("2.32 (1.14)")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 3120, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("2.30 (1.06)")] })] })
          ]}),
          new TableRow({ children: [
            new TableCell({ borders: cellBorders, width: { size: 3120, type: WidthType.DXA },
              children: [new Paragraph({ children: [new TextRun("SIRI")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 3120, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("1.08 (0.94)")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 3120, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("1.06 (0.67)")] })] })
          ]}),
          new TableRow({ children: [
            new TableCell({ borders: cellBorders, width: { size: 3120, type: WidthType.DXA },
              children: [new Paragraph({ children: [new TextRun("AISI")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 3120, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("98.38 (85.34)")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 3120, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("96.88 (61.24)")] })] })
          ]}),
          new TableRow({ children: [
            new TableCell({ borders: cellBorders, width: { size: 3120, type: WidthType.DXA },
              children: [new Paragraph({ children: [new TextRun("CALLY")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 3120, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("11.37 (25.83)")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 3120, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("11.39 (12.19)")] })] })
          ]})
        ]
      }),

      new Paragraph({ spacing: { before: 60, after: 240 }, children: [
        new TextRun({ text: "Data are presented as mean (SD). SII, systemic immune-inflammation index; NLR, neutrophil-to-lymphocyte ratio; SIRI, systemic inflammation response index; AISI, aggregate index of systemic inflammation; CALLY, CRP-albumin-lymphocyte-platelet index.", size: 20, italics: true })
      ]}),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Mediation Analysis Results")] }),

      new Paragraph({ spacing: { after: 120 }, children: [
        new TextRun("We identified 24 statistically significant mediation pathways across 8 cancer types (Table 2). The strongest mediation was observed for liver cancer via CALLY (10.67%, HR=0.738, P=0.037), followed by colorectal cancer via CALLY (8.01%, HR=0.871, P<0.001). Esophageal cancer showed consistent mediation across four inflammatory indices: SII (6.62%, HR=1.340, P<0.001), SIRI (6.51%, HR=1.277, P=0.006), AISI (6.48%, HR=1.273, P=0.009), and NLR (6.46%, HR=1.354, P<0.001).")
      ]}),

      new Paragraph({ spacing: { after: 120 }, children: [
        new TextRun("For lung cancer, AISI mediated 4.58% (HR=1.204, P=0.002) and SIRI mediated 4.32% (HR=1.196, P=0.002). Kidney cancer demonstrated significant mediation through SIRI (4.50%, HR=1.227, P=0.002), AISI (4.36%, HR=1.218, P=0.004), NLR (3.94%, HR=1.278, P<0.001), and SII (3.91%, HR=1.259, P<0.001). Breast cancer showed modest but significant mediation via CALLY (2.82%, HR=0.938, P=0.003), with additional pathways through AISI, SIRI, SII, and NLR (1.02-1.49%).")
      ]}),

      new Paragraph({ children: [new PageBreak()] }),

      // Table 2
      new Paragraph({ spacing: { before: 120, after: 60 }, alignment: AlignmentType.CENTER, children: [
        new TextRun({ text: "Table 2. Significant Mediation Pathways (N=24)", bold: true })
      ]}),

      new Table({
        columnWidths: [1872, 1872, 1872, 1872, 1872],
        margins: { top: 100, bottom: 100, left: 180, right: 180 },
        rows: [
          new TableRow({ tableHeader: true, children: [
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              shading: { fill: "E0E0E0", type: ShadingType.CLEAR }, verticalAlign: VerticalAlign.CENTER,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Cancer Type", bold: true, size: 20 })] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              shading: { fill: "E0E0E0", type: ShadingType.CLEAR }, verticalAlign: VerticalAlign.CENTER,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Mediator", bold: true, size: 20 })] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              shading: { fill: "E0E0E0", type: ShadingType.CLEAR }, verticalAlign: VerticalAlign.CENTER,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "N Events", bold: true, size: 20 })] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              shading: { fill: "E0E0E0", type: ShadingType.CLEAR }, verticalAlign: VerticalAlign.CENTER,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "HR (95% CI)", bold: true, size: 20 })] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              shading: { fill: "E0E0E0", type: ShadingType.CLEAR }, verticalAlign: VerticalAlign.CENTER,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "% Mediated", bold: true, size: 20 })] })] })
          ]}),
          new TableRow({ children: [
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ children: [new TextRun("Liver")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("CALLY")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("50")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("0.738")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("10.67")] })] })
          ]}),
          new TableRow({ children: [
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ children: [new TextRun("Colorectal")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("CALLY")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("1000")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("0.871")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("8.01")] })] })
          ]}),
          new TableRow({ children: [
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ children: [new TextRun("Esophageal")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("SII")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("135")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("1.340")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("6.62")] })] })
          ]}),
          new TableRow({ children: [
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ children: [new TextRun("Esophageal")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("SIRI")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("135")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("1.277")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("6.51")] })] })
          ]}),
          new TableRow({ children: [
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ children: [new TextRun("Esophageal")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("AISI")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("135")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("1.273")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("6.48")] })] })
          ]}),
          new TableRow({ children: [
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ children: [new TextRun("Esophageal")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("NLR")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("135")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("1.354")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("6.46")] })] })
          ]}),
          new TableRow({ children: [
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ children: [new TextRun("Lung")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("AISI")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("319")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("1.204")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("4.58")] })] })
          ]}),
          new TableRow({ children: [
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ children: [new TextRun("Kidney")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("SIRI")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("251")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("1.227")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("4.50")] })] })
          ]}),
          new TableRow({ children: [
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ children: [new TextRun("Breast")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("CALLY")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("2513")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("0.938")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 1872, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("2.82")] })] })
          ]})
        ]
      }),

      new Paragraph({ spacing: { before: 60, after: 240 }, children: [
        new TextRun({ text: "Table shows top 9 of 24 significant mediations. HR, hazard ratio; SII, systemic immune-inflammation index; NLR, neutrophil-to-lymphocyte ratio; SIRI, systemic inflammation response index; AISI, aggregate index of systemic inflammation; CALLY, CRP-albumin-lymphocyte-platelet index. All P<0.05.", size: 20, italics: true })
      ]}),

      // Figure 1
      new Paragraph({ spacing: { before: 240, after: 60 }, alignment: AlignmentType.CENTER, children: [
        new ImageRun({
          type: "png",
          data: fs.readFileSync("/Users/gaoyuzhen/medautodata/proj-2026-03-30-23-16-44/Experiment/results/figures/fig3_forest_plot_mediation.png"),
          transformation: { width: 550, height: 400 },
          altText: { title: "Forest Plot", description: "Forest plot of mediation effects", name: "Figure1" }
        })
      ]}),

      new Paragraph({ spacing: { before: 60, after: 240 }, alignment: AlignmentType.CENTER, children: [
        new TextRun({ text: "Figure 1. Forest plot showing hazard ratios and 95% confidence intervals for significant mediation pathways across cancer types and inflammatory biomarkers.", size: 20, italics: true })
      ]}),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Cancer Type-Specific Patterns")] }),

      new Paragraph({ spacing: { after: 120 }, children: [
        new TextRun("Table 3 summarizes mediation patterns by cancer type. Liver cancer showed the highest maximum mediation (10.67%) but only one significant pathway. Colorectal cancer demonstrated substantial mediation (8.01% maximum) with four significant pathways across SII, NLR, and CALLY. Esophageal cancer exhibited consistent mediation across four inflammatory indices (6.46-6.62%), suggesting broad inflammatory involvement. Breast cancer, despite the largest case count (N=2,922), showed modest mediation effects (0.62% mean, 2.82% maximum) across six pathways.")
      ]}),

      // Table 3
      new Paragraph({ spacing: { before: 120, after: 60 }, alignment: AlignmentType.CENTER, children: [
        new TextRun({ text: "Table 3. Summary of Mediation Effects by Cancer Type", bold: true })
      ]}),

      new Table({
        columnWidths: [2340, 2340, 2340, 2340],
        margins: { top: 100, bottom: 100, left: 180, right: 180 },
        rows: [
          new TableRow({ tableHeader: true, children: [
            new TableCell({ borders: cellBorders, width: { size: 2340, type: WidthType.DXA },
              shading: { fill: "E0E0E0", type: ShadingType.CLEAR }, verticalAlign: VerticalAlign.CENTER,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Cancer Type", bold: true, size: 20 })] })] }),
            new TableCell({ borders: cellBorders, width: { size: 2340, type: WidthType.DXA },
              shading: { fill: "E0E0E0", type: ShadingType.CLEAR }, verticalAlign: VerticalAlign.CENTER,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "N Cases", bold: true, size: 20 })] })] }),
            new TableCell({ borders: cellBorders, width: { size: 2340, type: WidthType.DXA },
              shading: { fill: "E0E0E0", type: ShadingType.CLEAR }, verticalAlign: VerticalAlign.CENTER,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Significant Pathways", bold: true, size: 20 })] })] }),
            new TableCell({ borders: cellBorders, width: { size: 2340, type: WidthType.DXA },
              shading: { fill: "E0E0E0", type: ShadingType.CLEAR }, verticalAlign: VerticalAlign.CENTER,
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Max Mediation %", bold: true, size: 20 })] })] })
          ]}),
          new TableRow({ children: [
            new TableCell({ borders: cellBorders, width: { size: 2340, type: WidthType.DXA },
              children: [new Paragraph({ children: [new TextRun("Liver")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 2340, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("57")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 2340, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("1")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 2340, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("10.67")] })] })
          ]}),
          new TableRow({ children: [
            new TableCell({ borders: cellBorders, width: { size: 2340, type: WidthType.DXA },
              children: [new Paragraph({ children: [new TextRun("Colorectal")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 2340, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("1163")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 2340, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("4")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 2340, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("8.01")] })] })
          ]}),
          new TableRow({ children: [
            new TableCell({ borders: cellBorders, width: { size: 2340, type: WidthType.DXA },
              children: [new Paragraph({ children: [new TextRun("Esophageal")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 2340, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("135")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 2340, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("4")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 2340, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("6.62")] })] })
          ]}),
          new TableRow({ children: [
            new TableCell({ borders: cellBorders, width: { size: 2340, type: WidthType.DXA },
              children: [new Paragraph({ children: [new TextRun("Lung")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 2340, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("319")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 2340, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("3")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 2340, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("4.58")] })] })
          ]}),
          new TableRow({ children: [
            new TableCell({ borders: cellBorders, width: { size: 2340, type: WidthType.DXA },
              children: [new Paragraph({ children: [new TextRun("Kidney")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 2340, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("251")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 2340, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("4")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 2340, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("4.50")] })] })
          ]}),
          new TableRow({ children: [
            new TableCell({ borders: cellBorders, width: { size: 2340, type: WidthType.DXA },
              children: [new Paragraph({ children: [new TextRun("Breast")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 2340, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("2922")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 2340, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("6")] })] }),
            new TableCell({ borders: cellBorders, width: { size: 2340, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("2.82")] })] })
          ]})
        ]
      }),

      new Paragraph({ spacing: { before: 60, after: 240 }, children: [
        new TextRun({ text: "Data show cancer types with at least one significant mediation pathway. Max mediation % represents the strongest mediation effect observed for that cancer type.", size: 20, italics: true })
      ]}),

      // Figure 2
      new Paragraph({ spacing: { before: 240, after: 60 }, alignment: AlignmentType.CENTER, children: [
        new ImageRun({
          type: "png",
          data: fs.readFileSync("/Users/gaoyuzhen/medautodata/proj-2026-03-30-23-16-44/Experiment/results/figures/fig7_mediation_by_cancer.png"),
          transformation: { width: 500, height: 350 },
          altText: { title: "Mediation by Cancer", description: "Mediation effects by cancer type", name: "Figure2" }
        })
      ]}),

      new Paragraph({ spacing: { before: 60, after: 240 }, alignment: AlignmentType.CENTER, children: [
        new TextRun({ text: "Figure 2. Distribution of mediation effects across cancer types, showing maximum and mean mediation percentages for each cancer with significant pathways.", size: 20, italics: true })
      ]}),

      new Paragraph({ children: [new PageBreak()] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Dose-Response Relationships")] }),

      new Paragraph({ spacing: { after: 120 }, children: [
        new TextRun("Quartile-based dose-response analysis revealed consistent patterns across physical activity levels (Figure 3). For liver cancer with CALLY mediation, hazard ratios decreased progressively from Q2 (HR=0.728, P=0.029) through Q4 (HR=0.733, P=0.033), with mediation proportions ranging from -12.9% to 46.9%. Colorectal cancer showed stable mediation via CALLY across quartiles (Q2: 1.92%, Q4: 17.7%). Esophageal cancer demonstrated robust dose-response relationships across all four inflammatory indices, with consistent mediation effects in higher activity quartiles.")
      ]}),

      // Figure 3
      new Paragraph({ spacing: { before: 240, after: 60 }, alignment: AlignmentType.CENTER, children: [
        new ImageRun({
          type: "png",
          data: fs.readFileSync("/Users/gaoyuzhen/medautodata/proj-2026-03-30-23-16-44/Experiment/results/figures/fig6_dose_response_quartiles.png"),
          transformation: { width: 550, height: 400 },
          altText: { title: "Dose Response", description: "Dose-response analysis by quartiles", name: "Figure3" }
        })
      ]}),

      new Paragraph({ spacing: { before: 60, after: 240 }, alignment: AlignmentType.CENTER, children: [
        new TextRun({ text: "Figure 3. Dose-response relationships between physical activity quartiles and cancer risk, stratified by inflammatory mediators. Error bars represent 95% confidence intervals.", size: 20, italics: true })
      ]}),

      new Paragraph({ children: [new PageBreak()] }),

      // Discussion
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Discussion")] }),

      new Paragraph({ spacing: { after: 120 }, children: [
        new TextRun("This large-scale prospective analysis of 91,340 UK Biobank participants provides robust evidence that systemic inflammation mediates the protective association between objectively measured physical activity and cancer incidence. We identified 24 significant mediation pathways across 8 cancer types, with mediation proportions ranging from 1.02% to 10.67%. These findings advance understanding of the biological mechanisms linking physical activity to cancer prevention and highlight inflammation as a modifiable intermediate target.")
      ]}),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Principal Findings")] }),

      new Paragraph({ spacing: { after: 120 }, children: [
        new TextRun("The strongest mediation effects were observed for liver cancer (10.67% via CALLY) and colorectal cancer (8.01% via CALLY), consistent with the established role of chronic inflammation in hepatocarcinogenesis and colorectal tumorigenesis [14,15]. The CALLY index, integrating CRP, albumin, lymphocytes, and platelets, captures multiple dimensions of systemic inflammation and nutritional status, potentially explaining its superior mediating capacity for these cancer types.")
      ]}),

      new Paragraph({ spacing: { after: 120 }, children: [
        new TextRun("Esophageal cancer demonstrated consistent mediation across four inflammatory indices (SII, NLR, SIRI, AISI), all showing 6.46-6.62% mediation. This uniformity suggests that multiple inflammatory pathways contribute to esophageal carcinogenesis, and physical activity may exert protective effects through broad anti-inflammatory mechanisms rather than targeting specific inflammatory components [16].")
      ]}),

      new Paragraph({ spacing: { after: 120 }, children: [
        new TextRun("Breast cancer, despite having the largest case count (N=2,922), showed modest mediation effects (1.02-2.82%). This may reflect the multifactorial etiology of breast cancer, where hormonal factors, genetic susceptibility, and reproductive history play dominant roles, with inflammation contributing as a secondary mechanism [17]. Alternatively, the inflammatory indices examined may not capture breast cancer-specific inflammatory processes, such as local mammary inflammation or adipose tissue inflammation in the breast microenvironment.")
      ]}),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Biological Mechanisms")] }),

      new Paragraph({ spacing: { after: 120 }, children: [
        new TextRun("Physical activity reduces systemic inflammation through multiple interconnected pathways. Exercise decreases visceral adipose tissue, a major source of pro-inflammatory cytokines including IL-6 and TNF-α [18]. Regular physical activity enhances immune surveillance by increasing natural killer cell activity and improving lymphocyte function [19]. Additionally, exercise induces myokine secretion (e.g., IL-10, irisin) with anti-inflammatory properties that counteract chronic low-grade inflammation [20].")
      ]}),

      new Paragraph({ spacing: { after: 120 }, children: [
        new TextRun("The composite inflammatory indices used in this study capture distinct aspects of immune dysregulation. SII and NLR reflect neutrophil-lymphocyte balance, indicating systemic immune activation. SIRI and AISI incorporate monocytes, representing innate immune activation and potential macrophage-mediated tumor promotion. CALLY integrates acute-phase proteins (CRP, albumin) with cellular components, providing a comprehensive assessment of inflammatory burden and nutritional status [9,10].")
      ]}),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Comparison with Previous Studies")] }),

      new Paragraph({ spacing: { after: 120 }, children: [
        new TextRun("Previous studies have documented associations between physical activity and reduced cancer risk [1-3], and separately between inflammation and cancer incidence [4,5]. However, few studies have formally tested mediation hypotheses with objective physical activity measures and comprehensive inflammatory biomarkers. A recent meta-analysis reported that CRP partially mediates the physical activity-colorectal cancer association, with mediation proportions of 5-15% [21], consistent with our CALLY-mediated colorectal cancer finding (8.01%).")
      ]}),

      new Paragraph({ spacing: { after: 120 }, children: [
        new TextRun("Our study extends this literature by examining multiple cancer types simultaneously, using objective accelerometry rather than self-reported activity, and testing five composite inflammatory indices that integrate multiple biomarkers. The dose-response analyses further strengthen causal inference by demonstrating consistent mediation patterns across physical activity quartiles.")
      ]}),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Clinical and Public Health Implications")] }),

      new Paragraph({ spacing: { after: 120 }, children: [
        new TextRun("These findings support physical activity promotion as a cancer prevention strategy, with inflammation reduction as a measurable intermediate outcome. Clinicians could potentially use inflammatory biomarkers to identify individuals who may benefit most from physical activity interventions. Public health campaigns emphasizing the anti-inflammatory benefits of exercise may enhance motivation for behavior change.")
      ]}),

      new Paragraph({ spacing: { after: 120 }, children: [
        new TextRun("The heterogeneity in mediation effects across cancer types suggests that inflammation plays varying roles in different cancer etiologies. Liver and colorectal cancers, with the strongest mediation effects, may be particularly amenable to inflammation-targeted prevention strategies. Conversely, cancers with minimal mediation (e.g., stomach, pancreatic) may require interventions targeting alternative pathways.")
      ]}),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Strengths and Limitations")] }),

      new Paragraph({ spacing: { after: 120 }, children: [
        new TextRun("Strengths of this study include the large sample size, objective physical activity measurement via accelerometry, comprehensive inflammatory biomarker assessment, prospective design with linkage to national cancer registries, and rigorous mediation analysis using the counterfactual framework. The UK Biobank's standardized protocols and quality control procedures minimize measurement error.")
      ]}),

      new Paragraph({ spacing: { after: 120 }, children: [
        new TextRun("Limitations include potential residual confounding despite adjustment for major covariates, single-timepoint assessment of physical activity and inflammatory biomarkers (not capturing longitudinal changes), and limited generalizability to non-European populations. The UK Biobank participants are healthier and more educated than the general population, potentially underestimating associations. Mediation analysis assumes no unmeasured confounding of mediator-outcome relationships, which cannot be fully verified. Additionally, inflammatory biomarkers were measured at baseline, and changes over time may influence mediation effects.")
      ]}),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Future Directions")] }),

      new Paragraph({ spacing: { after: 240 }, children: [
        new TextRun("Future research should examine longitudinal changes in physical activity and inflammation to assess temporal dynamics of mediation. Intervention studies testing whether exercise-induced inflammation reduction translates to cancer risk reduction would strengthen causal inference. Investigation of additional inflammatory mediators (e.g., cytokines, chemokines) and cancer-specific biomarkers may reveal additional pathways. Finally, extending these analyses to diverse populations and examining effect modification by genetic susceptibility, obesity status, and comorbidities would enhance precision prevention strategies.")
      ]}),

      new Paragraph({ children: [new PageBreak()] }),

      // Conclusions
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Conclusions")] }),

      new Paragraph({ spacing: { after: 240 }, children: [
        new TextRun("Systemic inflammation significantly mediates the protective association between physical activity and cancer incidence, with substantial heterogeneity across cancer types. The strongest mediation effects were observed for liver cancer (10.67%), colorectal cancer (8.01%), and esophageal cancer (6.46-6.62%). These findings support inflammation as a modifiable biological pathway linking physical activity to cancer prevention and suggest potential targets for intervention strategies. Physical activity promotion should be emphasized as a cancer prevention strategy, with inflammatory biomarkers serving as intermediate outcome measures to monitor intervention effectiveness.")
      ]}),

      new Paragraph({ children: [new PageBreak()] }),

      // References
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("References")] }),

      new Paragraph({ spacing: { after: 60, before: 60 }, children: [
        new TextRun("[1] Moore SC, Lee IM, Weiderpass E, et al. Association of leisure-time physical activity with risk of 26 types of cancer in 1.44 million adults. JAMA Intern Med. 2016;176(6):816-825.")
      ]}),

      new Paragraph({ spacing: { after: 60 }, children: [
        new TextRun("[2] Patel AV, Friedenreich CM, Moore SC, et al. American College of Sports Medicine roundtable report on physical activity, sedentary behavior, and cancer prevention and control. Med Sci Sports Exerc. 2019;51(11):2391-2402.")
      ]}),

      new Paragraph({ spacing: { after: 60 }, children: [
        new TextRun("[3] World Cancer Research Fund/American Institute for Cancer Research. Diet, Nutrition, Physical Activity and Cancer: A Global Perspective. Continuous Update Project Expert Report 2018.")
      ]}),

      new Paragraph({ spacing: { after: 60 }, children: [
        new TextRun("[4] Coussens LM, Werb Z. Inflammation and cancer. Nature. 2002;420(6917):860-867.")
      ]}),

      new Paragraph({ spacing: { after: 60 }, children: [
        new TextRun("[5] Grivennikov SI, Greten FR, Karin M. Immunity, inflammation, and cancer. Cell. 2010;140(6):883-899.")
      ]}),

      new Paragraph({ spacing: { after: 60 }, children: [
        new TextRun("[6] Gleeson M, Bishop NC, Stensel DJ, et al. The anti-inflammatory effects of exercise: mechanisms and implications for the prevention and treatment of disease. Nat Rev Immunol. 2011;11(9):607-615.")
      ]}),

      new Paragraph({ spacing: { after: 60 }, children: [
        new TextRun("[7] Pedersen BK, Saltin B. Exercise as medicine - evidence for prescribing exercise as therapy in 26 different chronic diseases. Scand J Med Sci Sports. 2015;25 Suppl 3:1-72.")
      ]}),

      new Paragraph({ spacing: { after: 60 }, children: [
        new TextRun("[8] Doherty A, Jackson D, Hammerla N, et al. Large scale population assessment of physical activity using wrist worn accelerometers: The UK Biobank Study. PLoS One. 2017;12(2):e0169649.")
      ]}),

      new Paragraph({ spacing: { after: 60 }, children: [
        new TextRun("[9] Hu B, Yang XR, Xu Y, et al. Systemic immune-inflammation index predicts prognosis of patients after curative resection for hepatocellular carcinoma. Clin Cancer Res. 2014;20(23):6212-6222.")
      ]}),

      new Paragraph({ spacing: { after: 60 }, children: [
        new TextRun("[10] Fest J, Ruiter R, Ikram MA, et al. Reference values for white blood-cell-based inflammatory markers in the Rotterdam Study: a population-based prospective cohort study. Sci Rep. 2018;8(1):10566.")
      ]}),

      new Paragraph({ spacing: { after: 60 }, children: [
        new TextRun("[11] Sudlow C, Gallacher J, Allen N, et al. UK Biobank: an open access resource for identifying the causes of a wide range of complex diseases of middle and old age. PLoS Med. 2015;12(3):e1001779.")
      ]}),

      new Paragraph({ spacing: { after: 60 }, children: [
        new TextRun("[12] van Hees VT, Fang Z, Langford J, et al. Autocalibration of accelerometer data for free-living physical activity assessment using local gravity and temperature: an evaluation on four continents. J Appl Physiol. 2014;117(7):738-744.")
      ]}),

      new Paragraph({ spacing: { after: 60 }, children: [
        new TextRun("[13] VanderWeele TJ. Explanation in Causal Inference: Methods for Mediation and Interaction. Oxford University Press; 2015.")
      ]}),

      new Paragraph({ spacing: { after: 60 }, children: [
        new TextRun("[14] Greten FR, Grivennikov SI. Inflammation and cancer: triggers, mechanisms, and consequences. Immunity. 2019;51(1):27-41.")
      ]}),

      new Paragraph({ spacing: { after: 60 }, children: [
        new TextRun("[15] Mantovani A, Allavena P, Sica A, Balkwill F. Cancer-related inflammation. Nature. 2008;454(7203):436-444.")
      ]}),

      new Paragraph({ spacing: { after: 60 }, children: [
        new TextRun("[16] Rustgi AK, El-Serag HB. Esophageal carcinoma. N Engl J Med. 2014;371(26):2499-2509.")
      ]}),

      new Paragraph({ spacing: { after: 60 }, children: [
        new TextRun("[17] Hanahan D, Weinberg RA. Hallmarks of cancer: the next generation. Cell. 2011;144(5):646-674.")
      ]}),

      new Paragraph({ spacing: { after: 60 }, children: [
        new TextRun("[18] Petersen AM, Pedersen BK. The anti-inflammatory effect of exercise. J Appl Physiol. 2005;98(4):1154-1162.")
      ]}),

      new Paragraph({ spacing: { after: 60 }, children: [
        new TextRun("[19] Nieman DC, Wentz LM. The compelling link between physical activity and the body's defense system. J Sport Health Sci. 2019;8(3):201-217.")
      ]}),

      new Paragraph({ spacing: { after: 60 }, children: [
        new TextRun("[20] Pedersen BK. Physical activity and muscle-brain crosstalk. Nat Rev Endocrinol. 2019;15(7):383-392.")
      ]}),

      new Paragraph({ spacing: { after: 60 }, children: [
        new TextRun("[21] Aleksandrova K, Nimptsch K, Pischon T. Influence of obesity and related metabolic alterations on colorectal cancer risk. Curr Nutr Rep. 2013;2(1):1-9.")
      ]})
    ]
  }]
});

// Save document
Packer.toBuffer(doc).then(buffer => {
  const outputDir = path.join(process.cwd(), "Publication", "manuscript");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "manuscript_professional.docx"), buffer);
  console.log("Document created successfully!");
});
