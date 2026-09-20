# Decision log

One line per non-obvious technical choice: what was chosen, and why.

- **2026-09-20 — Pilot region = Maharashtra, held-out transfer test = Karnataka:** a Western Ghats rain-shadow belt gives a ~3000mm→~500mm gradient inside 50km, the strongest real demonstration that block-averaging destroys signal; training on pooled states would leak nearby stations between train and test, so generalisation is proven by transfer instead.
- **2026-09-20 — LightGBM over CNN/GAN super-resolution:** covariates are tabular and ground truth is sparse (neural downscalers need dense fine-scale truth we do not have); LightGBM gives native quantile regression for calibrated uncertainty and stays explainable to the extension officer who must trust the output.
- **2026-09-20 — Predict the local anomaly, not the absolute value:** guarantees the system can only refine the official block forecast, never replace it, so the degenerate failure mode is exactly the naive baseline rather than something worse.
- **2026-09-20 — Two-stage rainfall model (occurrence classifier + conditional amount):** a single regressor smears drizzle across every panchayat, which is the precise false-smoothness failure PRD §7 warns about; two stages let one panchayat be dry while its neighbour is wet.
- **2026-09-20 — GHCN-Daily as ground truth:** 3807 real Indian stations are reachable keylessly and give genuine point observations, letting us prove the PRD §9 "beats naive baseline" claim on real data instead of only on synthetically coarsened fields.
- **2026-09-20 — Village polygons (datameet) as panchayat proxies:** official panchayat boundaries are not open data at national scale; real village geometry is a defensible approximation and is disclosed as such rather than silently substituted.
- **2026-09-20 — Three-tier output labelling (T1 measured / T2 gauge-validated / T3 inferred):** the honest alternative to presenting extrapolated panchayat-scale numbers with the confidence of validated ones.
- **2026-09-20 — Block-mean reconciliation as a hard post-step:** an agency must be able to stand behind its own published block forecast, so downscaling redistributes within the block rather than contradicting the aggregate.
- **2026-09-20 — Spatial (whole-block) train/test splits, not random row splits:** random splits leak neighbouring grid cells into the test set and would inflate skill scores into meaninglessness.
