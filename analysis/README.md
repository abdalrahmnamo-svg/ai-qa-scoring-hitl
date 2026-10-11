# Rater-agreement analysis

Python notebook that measures how well the AI scorer's drafts agree with held-out human scores: Bland-Altman on totals, Cohen's kappa (with bootstrap CI) on pass/fail, per-criterion weighted kappa and bias, confidence calibration, and three recommendations for a QA lead. All data is synthetic and the scorer is the repo's mock heuristic.

`rater_agreement.ipynb` is committed with outputs, so it renders on GitHub without running anything. Without `data/eval_criteria.csv` it falls back to the 54-row `data/sample_eval.csv`; with the full export it uses all 20 golden conversations (360 criterion rows).

## Reproduce

From the repo root (Node 22.13+ and Python 3.12+):

```bash
npm ci
npm run seed          # synthetic conversations + human and golden scores
npm run batch         # optional: drafts a batch (the export itself re-scores the golden set)
npm run eval:export   # writes analysis/data/eval_criteria.csv and eval_conversations.csv

# Windows
py -m venv analysis\.venv
analysis\.venv\Scripts\python.exe -m pip install -r analysis\requirements.txt
cd analysis
.venv\Scripts\python.exe -m jupyter nbconvert --to notebook --execute --inplace rater_agreement.ipynb

# macOS / Linux
python3 -m venv analysis/.venv
analysis/.venv/bin/python -m pip install -r analysis/requirements.txt
cd analysis
.venv/bin/python -m jupyter nbconvert --to notebook --execute --inplace rater_agreement.ipynb
```

Executing the notebook also writes `docs/bland_altman.png`, `docs/criterion_bias.png` and `docs/confidence_calibration.png`. Everything is deterministic (seeded data, deterministic mock scorer, fixed bootstrap seed), so re-runs give identical numbers. The generated CSVs in `analysis/data/` are git-ignored; only `sample_eval.csv` is tracked.

## Columns in `eval_criteria.csv`

One row per golden conversation x criterion: `conversation_id, agent, date, criterion_id, criterion_label, section, max_points, ai_points, human_points, deterministic` (1 when computed from timestamps rather than judged), `ai_total, human_total, ai_pass, human_pass` (pass = total >= 90), `ai_confidence`.
