# Source Map

Use this map when a user asks for a database by name, alias, or research concept. After choosing a source, call `$local-database-api-access` for all API mechanics.

## Chinese Social, Household, Labor, Health

| Source ID | Skill | Use for |
| --- | --- | --- |
| `cfps` | `$cfps-database-access` | CFPS / 中国家庭追踪调查; family panel, household economy, individual and family dynamics |
| `cgss` | `$cgss-database-access` | CGSS / 中国综合社会调查; social attitudes, values, class, trust, governance, repeated cross-sections |
| `charls` | `$charls-database-access` | CHARLS / 中国健康与养老追踪调查; China HRS-family aging panel, 45+, cognition, retirement, health |
| `chfs` | `$chfs-database-access` | CHFS / 中国家庭金融调查; assets, liabilities, housing, insurance, financial behavior |
| `chip` | `$chip-database-access` | CHIP / 中国家庭收入调查; income distribution, poverty, inequality, employment income |
| `chns` | `$chns-database-access` | CHNS / 中国健康与营养调查; diet, physical activity, anthropometry, household/community environment |
| `clds` | `$clds-database-access` | CLDS / 中国劳动力动态调查; labor, migration, employment, household/community labor context |
| `clhls` | `$clhls-database-access` | CLHLS / 中国老年健康影响因素跟踪调查; oldest-old, longevity, mortality, ADL, cognition |
| `css` | `$css-database-access` | CSS / 中国社会状况综合调查; social conditions, social quality, wellbeing, governance |

## Aging And Longitudinal Surveys

| Source ID | Skill | Use for |
| --- | --- | --- |
| `hrs` | `$hrs-database-access` | US Health and Retirement Study |
| `elsa` | `$elsa-database-access` | English Longitudinal Study of Ageing |
| `klosa` | `$klosa-database-access` | Korean Longitudinal Study of Aging |
| `lasi` | `$lasi-database-access` | Longitudinal Ageing Study in India |
| `mhas` | `$mhas-database-access` | Mexican Health and Aging Study |
| `share` | `$share-database-access` | Survey of Health, Ageing and Retirement in Europe |

## Public Health And Biobank

| Source ID | Skill | Use for |
| --- | --- | --- |
| `nhanes` | `$nhanes-database-access` | NHANES cycles, labs, exam, diet, survey weights |
| `ukb` | `$ukb-database-access` | UK Biobank field IDs, instances, arrays, matched omics when present |

## ICU And EHR

| Source ID | Skill | Use for |
| --- | --- | --- |
| `mimiciii` | `$mimiciii-database-access` | MIMIC-III v1.4 ICU/EHR tables and concepts |
| `mimiciv` | `$mimiciv-database-access` | MIMIC-IV v1.0 core, hosp, icu modules |
| `mimiciv31` | `$mimiciv31-database-access` | MIMIC-IV v3.1 and MIMIC-IV-ED semantics |
| `eicu` | `$eicu-database-access` | eICU Collaborative Research Database |
| `nwicu` | `$nwicu-database-access` | Northwestern ICU data |
| `pic` | `$pic-database-access` | Paediatric Intensive Care data |

## Separate API Family

`gco-database-analysis` is not a 23-source MedHelp database API source. It should stay separate because it uses local GCO/GLOBOCAN assets and official GCO API endpoints. Use it for cancer epidemiology, Cancer Today/Tomorrow, CI5plus, HDI linkage, and GCO map/table workflows.
