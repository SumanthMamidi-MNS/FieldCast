# Build log

- **2026-09-26** — Built the full panchayat downscaling system end to end: data layer (GADM blocks, datameet villages → 1,955 panchayat proxies, GHCN gauges), terrain features, two-stage LightGBM models with calibrated uncertainty, evaluation (T1/T2 + Karnataka transfer), FastAPI and the React/MapLibre dashboard. Evaluation: rain occurrence and temperature beat naive; rain amount not significant and does not transfer to KA. Docker packaging not built.
