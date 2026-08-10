# Statistical Modeling Skill Routing

Purpose: keep the "Statistical Modeling & Testing" shortcut from invoking too many overlapping skills. Treat the listed skills as routes, not as a bundle that should always be used together.

Default UX: users should click the shortcut and describe the task. The model should then auto-select the smallest necessary skill set before executing. Users only need to pick an individual skill when they explicitly want to override the router.

## Routing Rule

Use the smallest skill set that matches the user's statistical task.

| User intent | Use | Why |
| --- | --- | --- |
| Choose the right test, write a statistical analysis plan, check assumptions, calculate effect size or power, or format academic reporting | `statistical-analysis` | Best as the planning and reporting layer for hypothesis tests and academic interpretation. |
| Run straightforward hypothesis tests that are already specified, such as t-test, ANOVA, chi-square, correlation, non-parametric tests, or multiple-testing correction | `data-stats-analysis` | Best for direct local scipy/statsmodels execution of common inferential statistics. |
| Fit regression models with coefficient tables, confidence intervals, diagnostics, robust standard errors, or time-series models | `statsmodels` | Best for OLS, logistic, GLM, mixed models, ARIMA/SARIMAX, and rigorous statistical inference. |
| Analyze censored time-to-event outcomes, KM curves, Cox models, competing risks, time-dependent AUC, or survival prediction | `scikit-survival` | Best for survival-specific data structures, censoring-aware models, and survival metrics. |
| Build prediction models, ML pipelines, cross-validation, preprocessing, clustering, feature selection, or hyperparameter tuning | `scikit-learn` | Best for predictive modeling rather than explanatory statistical inference. |
| Build Bayesian, hierarchical, probabilistic, prior/posterior, MCMC, or uncertainty-quantification models | `pymc` | Best for full Bayesian modeling and posterior diagnostics. |
| Explain trained model predictions or produce feature-contribution plots | `shap` | Best after a fitted ML/statistical model exists and interpretation is the main task. |
| Work specifically inside a UK Biobank cohort, including field mapping, endpoints, covariates, Cox/logistic models, and sensitivity analysis | `ukb-cohort-analysis` | Best for UKB-specific cohort construction and domain conventions. |
| Integrate finished tables, model outputs, figures, and clinical interpretation into manuscript-ready Results text | `inno-experiment-analysis` | Best as the downstream clinical results synthesis layer, not the first modeling tool. |

## Suggested Shortcut Prompt

Use this prompt for the "Statistical Modeling & Testing" shortcut when the user has not picked a specific skill yet:

```text
请先把我的统计任务分流到最小必要 skill 组合，不要默认调用整个“统计建模与检验”技能组。

先判断任务类型：
1. 统计方案/检验选择/假设与效应量/功效/APA或论文报告：使用 statistical-analysis。
2. 已明确要直接运行 t 检验、ANOVA、卡方、相关、非参数检验或多重校正：使用 data-stats-analysis。
3. 线性、Logistic、Poisson/负二项、混合模型、ARIMA/时间序列、稳健标准误、诊断和系数表：使用 statsmodels。
4. Cox、KM、生存结局、删失数据、竞争风险或时间依赖 AUC：使用 scikit-survival。
5. 预测建模、机器学习 pipeline、交叉验证、调参、聚类或降维：使用 scikit-learn。
6. 贝叶斯、层级模型、MCMC、先验/后验预测检查或不确定性量化：使用 pymc。
7. 已有模型后的变量贡献、SHAP 图或可解释性：使用 shap。
8. 已有统计输出后整合表格、图和 Results 文本：使用 inno-experiment-analysis。

请先用一句话说明你选择的 skill 组合和理由，然后再开始执行。

我的任务：
```

## Practical Defaults

- Unknown clinical/epidemiologic analysis request: start with `statistical-analysis`; add `statsmodels` only when a concrete model is needed.
- Clear regression request: use `statsmodels`; add `statistical-analysis` only if the test choice or reporting format is unclear.
- Clear survival request: use `scikit-survival`; add `statsmodels` only for companion logistic/linear models or diagnostics not covered by survival tooling.
- Predictive performance request: use `scikit-learn`; add `shap` only after the model is trained or model explanation is explicitly requested.
- Bayesian wording: use `pymc`; do not mix with frequentist tests unless the user asks to compare both.
- UKB wording: use `ukb-cohort-analysis` first, then add `statsmodels` or `scikit-survival` according to outcome type.
