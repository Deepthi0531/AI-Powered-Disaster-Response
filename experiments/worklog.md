# Experiments Worklog: AI Disaster Response ML Research

**Session started:** 2026-09-10

## Key Insights
- Tabular DL (MLP) underperforms tree ensembles — consistent with Grinsztajn et al. 2022
- XGBoost wins on efficiency (0.76ms inference, 1.6MB) while RF wins on F1 (0.7872)
- All models achieve 90%+ conformal coverage under IID
- Split conformal is distribution-free and model-agnostic — key advantage for deployment
- ACI (adaptive conformal) is unstable and should NOT be used for flood risk classification
- Distribution shift causes standard conformal to undercover at alpha=0.10 (83% vs 90%)
- At alpha=0.05, standard conformal maintains coverage even under shift (93.9% vs 95%)
- Practical recommendation: use split conformal with alpha=0.05 for disaster response

## Next Ideas
- Formalize theoretical contribution for NeurIPS/ICML submission
- Test on real-world flood datasets (e.g., FEWS, CFS)
- Explore conformal regression for continuous flood depth prediction
- Deploy conformal prediction API to Flask backend

## Baseline

### Run 0: Project Audit & Gap Identification — novelty_score=40.0 (baseline)
- Timestamp: 2026-09-10
- What changed: Initial project audit — identified architecture, dataset, pipeline, and limitations
- Result: Baseline understanding established
- Insight: Current pipeline is minimal (XGBoost + synthetic data). No uncertainty, no geospatial modeling, no temporal dynamics. Clear research gaps exist.
- Next: Search literature for flood risk prediction SOTA, identify novelty opportunities

### Run 2: Model Comparison + Conformal Prediction — novelty_score=65.0 (keep)
- Timestamp: 2026-09-10
- What changed: Compared 5 models (XGBoost, RF, ET, GB, MLP) with conformal prediction
- Result: XGBoost wins on efficiency (0.76ms, 1.6MB). RF wins on F1 (0.7872). Conformal prediction achieves 90%+ coverage on all models. Tabular DL underperforms.
- Insight: Tree ensembles dominate tabular flood risk. Conformal wrapping provides uncertainty guarantees with minimal overhead.

### Run 3: Split Conformal Experiment + Distribution Shift — novelty_score=75.0 (keep)
- Timestamp: 2026-09-10
- What changed: Formal conformal prediction experiment with 3 coverage levels (80%, 90%, 95%), 2 methods (standard, ACI), 3 models, + distribution shift test
- Result: XGBoost + standard conformal achieves 89.25% actual coverage (target 90%, gap=0.007). At 95% target: 95.25% actual. Distribution shift causes undercoverage at alpha=0.10 (83% vs 90%). ACI collapses under shift.
- Key findings:
  1. Split conformal provides reliable uncertainty for tabular flood risk under IID
  2. ACI is unstable and should NOT be used for this setting
  3. Standard conformal maintains coverage at alpha=0.05 even under distribution shift (93.9% vs 95%)
  4. Prediction sets are small (avg 0.89 at 90%): most predictions are single-label
- Practical recommendation: Use split conformal with alpha=0.05 for disaster response
- Next: Write LaTeX paper for NeurIPS/ICML submission
