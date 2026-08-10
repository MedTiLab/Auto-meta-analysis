export const diagnosticExtractionSchema = {
  study: {
    firstAuthor: 'evidenceField',
    year: 'evidenceField',
    country: 'evidenceField',
    design: 'evidenceField',
    cancerType: 'evidenceField',
    sampleSize: 'evidenceField',
    caseN: 'evidenceField',
    controlN: 'evidenceField',
  },
  indexTest: {
    biomarker: 'evidenceField',
    sampleType: 'evidenceField',
    assayMethod: 'evidenceField',
    cutoff: 'evidenceField',
  },
  referenceStandard: {
    name: 'evidenceField',
    details: 'evidenceField',
  },
  diagnosticData: [
    {
      group: 'evidenceField',
      TP: 'evidenceField',
      FP: 'evidenceField',
      FN: 'evidenceField',
      TN: 'evidenceField',
      sensitivity: 'evidenceField',
      specificity: 'evidenceField',
      AUC: 'evidenceField',
      derived: false,
      derivationNote: null,
    },
  ],
  riskOfBiasCandidates: {
    patientSelection: 'evidenceField',
    indexTest: 'evidenceField',
    referenceStandard: 'evidenceField',
    flowAndTiming: 'evidenceField',
  },
  missingFields: [],
  warnings: [],
};
