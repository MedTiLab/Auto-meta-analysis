# Local Database Groups

Use this file to choose the correct local database skill before extraction.

## Core judgment axes

Classify every routing request on three axes first:

- follow-up structure: `longitudinal`, `repeated_cross_sectional`, or `longitudinal_within_stay`
- primary unit: `patient/admission/stay/event`, `individual`, `household`, or `community`
- content family: ICU/EHR, biobank, health survey, aging cohort, family/labor panel, or social/income survey

## Canonical routing table

| Database | Study design | Accurate description | Primary unit | API source | AI-readable tags | Main warning |
| --- | --- | --- | --- | --- | --- | --- |
| `MIMIC-IV` | `longitudinal_within_stay` | hospital EHR within admission and ICU care | `patient/admission/stay/event` | `mimiciv` | `clinical_ehr; icu; hospital_ehr; longitudinal_within_stay; unit=patient/admission/stay/event` | choose patient vs admission vs stay anchor before extraction |
| `eICU-CRD` | `longitudinal_within_stay` | multicenter ICU hospitalization database | `icu_stay/event` | `eicu` | `clinical_ehr; icu; multicenter; longitudinal_within_stay; unit=icu_stay/event` | ICU-relative offsets and stay-level joins must be handled explicitly |
| `UK Biobank` | `longitudinal` | prospective biobank and multimodal cohort | `individual` | `ukb` | `biobank; prospective_cohort; multimodal; longitudinal; unit=individual` | only locally indexed fields and modalities are in scope |
| `NHANES` | `repeated_cross_sectional` | nationally representative repeated cross-sectional health survey | `individual` | `nhanes` | `health_survey; repeated_cross_sectional; exam_lab_questionnaire; unit=individual` | cycle compatibility and survey-weight rules must be checked first |
| `ELSA` | `longitudinal` | English Longitudinal Study of Ageing split cohort | `individual` | `elsa` | `aging_cohort; UK; longitudinal; unit=individual` | verify one-row-per-ID-wave grain and local variable names |
| `HRS` | `longitudinal` | Health and Retirement Study split cohort | `individual` | `hrs` | `aging_cohort; US; longitudinal; unit=individual` | verify one-row-per-ID-wave grain and local variable names |
| `KLoSA` | `longitudinal` | Korean Longitudinal Study of Aging split cohort | `individual` | `klosa` | `aging_cohort; Korea; longitudinal; unit=individual` | verify one-row-per-ID-wave grain and local variable names |
| `LASI` | `longitudinal` | Longitudinal Aging Study in India split cohort | `individual` | `lasi` | `aging_cohort; India; longitudinal; unit=individual` | local table is one row per ID; do not assume a standalone wave column |
| `MHAS` | `longitudinal` | Mexican Health and Aging Study split cohort | `individual` | `mhas` | `aging_cohort; Mexico; longitudinal; unit=individual` | verify one-row-per-ID-wave grain and local variable names |
| `SHARE` | `longitudinal` | Survey of Health, Ageing and Retirement in Europe split cohort | `individual` | `share` | `aging_cohort; Europe; longitudinal; unit=individual` | verify one-row-per-ID-wave grain and local variable names |
| `CHARLS` | `longitudinal` | China aging longitudinal cohort | `individual/household` | `charls` | `aging_cohort; China; longitudinal; unit=individual/household` | repeated-wave handling must be explicit |
| `CLHLS` | `longitudinal` | oldest-old and longevity longitudinal cohort | `individual` | `clhls` | `aging_cohort; longevity_cohort; longitudinal; unit=individual` | repeated-wave handling must be explicit |
| `CHNS` | `longitudinal` | health and nutrition longitudinal panel | `individual/household/community` | `chns` | `nutrition_health_panel; longitudinal; unit=individual/household/community` | variables often live in separate topic sub-tables |
| `CFPS` | `longitudinal` | family-individual-community longitudinal panel | `individual/household/community` | `cfps` | `family_panel; longitudinal; unit=individual/household/community` | person-level and family-level tables must not be mixed without explicit join keys |
| `CLDS` | `longitudinal` | labor dynamics longitudinal panel | `individual/household/community` | `clds` | `labor_panel; longitudinal; unit=individual/household/community` | repeated-wave handling and labor-force panel scope must be stated |
| `CGSS` | `repeated_cross_sectional` | continuous general social survey series | `individual` | `cgss` | `social_survey; repeated_cross_sectional; unit=individual` | default to repeated cross-sectional unless stable tracking is proven |
| `CHIP` | `repeated_cross_sectional` | income distribution survey series and multi-round cross-sections | `household/individual` | `chip` | `income_survey; repeated_cross_sectional; unit=household/individual` | do not treat survey rounds as a fixed-person panel by default |
| `CSS` | `default_cross_sectional` | continuous national social status survey | `individual` | `css` | `social_status_survey; default_cross_sectional; unit=individual` | keep the default cross-sectional assumption unless local follow-up IDs are verified |
| `CHFS` | `default_repeated_cross_sectional` | household finance multi-round survey | `household/individual` | `chfs` | `household_finance_survey; default_repeated_cross_sectional; unit=household/individual` | multi-round release does not imply stable household follow-up by default |

## Family-level routing rules

Use these family defaults when the user starts from a research question rather than a fixed source. All searches and extractions go through `$local-database-api-access`:

- ICU process, labs, treatments, short-term prognosis, or event timelines -> source `mimiciv` or `eicu`
- genetics, proteomics, imaging, long-term linked outcomes, or multimodal cohort work -> source `ukb`
- questionnaire + exam + lab cycles in the US population -> source `nhanes`
- cross-country aging comparison or variable overlap -> inspect the relevant split sources separately: `elsa`, `hrs`, `klosa`, `lasi`, `mhas`, and/or `share`
- single-cohort ELSA, HRS, KLoSA, LASI, MHAS, or SHARE work -> source `elsa`, `hrs`, `klosa`, `lasi`, `mhas`, or `share`
- China aging, cognition, disability, depression, retirement, or older-adult trajectories -> source `charls` or `clhls`
- China nutrition, examination, diet, or multi-table health panel construction -> source `chns`
- China family panel or household-person linkage with repeated follow-up -> source `cfps`
- China labor dynamics and employment panel -> source `clds`
- China income, finance, social attitudes, or social status surveys with the source still undecided -> choose directly among `cgss`, `chip`, `css`, and `chfs`, then use the selected API source

## Split Aging Cohort Sources

The local database now has separate AI_Access packages for these cohorts:

- `ELSA` -> `elsa`
- `HRS` -> `hrs`
- `KLoSA` -> `klosa`
- `LASI` -> `lasi`
- `MHAS` -> `mhas`
- `SHARE` -> `share`

The former monolithic OLDMAN cohort bundle is not wired as the default local source entry. For pooled or
cross-cohort work, search the relevant split sources separately and only append
or compare after checking variable overlap, labels, row grain, and wave
semantics. `CHARLS` is intentionally separate (source `charls`) and should not
be routed through these split cohorts.

## Research-fit summary

- longitudinal databases fit survival analysis, trajectory analysis, repeated-measures models, panel models, state-transition models, and onset or prognosis studies
- repeated cross-sectional databases fit prevalence estimates, distribution description, cross-sectional association, subgroup comparison, and period-trend analysis
- ICU and hospital EHR databases fit short-term prognosis, intervention response, lab and vital-sign dynamics, within-stay time-series modeling, and treatment-pathway analysis
