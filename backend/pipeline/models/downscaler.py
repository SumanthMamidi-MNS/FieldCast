"""The downscaling model itself.

Three design choices carry the whole thing:

1. **We predict the anomaly, never the absolute value.** The model's output is a
   correction applied on top of the official block forecast. A model that learns
   nothing produces zero correction and the system degrades exactly to the naive
   baseline — the worst case is "no worse than today", which is what makes this
   safe to deploy on top of an operational forecast.

2. **Rainfall is two-stage.** A single regressor trained on rainfall minimises
   error by predicting something near the conditional mean everywhere, which
   smears light drizzle across every panchayat in the block. That is the exact
   false-smoothness failure PRD §7 names. Splitting occurrence from amount lets
   the model say "dry here, 40mm one valley over", which is what actually happens.

3. **Rainfall amount is learned in log-ratio space.** Rainfall is heavy-tailed and
   multiplicative in character — a 2x error on a 60mm day is not remotely the same
   as a 2x error on a 2mm day. Training on log1p(local) - log1p(block) makes the
   loss scale-appropriate and keeps predictions non-negative by construction.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression

from backend.config import (
    LAPSE_RATE_C_PER_M,
    QUANTILES,
    VARIABLES,
    WET_DAY_THRESHOLD_MM,
    Variable,
)

MODEL_VERSION = "0.1.0"

# Deliberately conservative trees. The training signal is a small local anomaly
# on top of a strong block-level baseline; a deep model will happily memorise
# station identity and report inflated skill that vanishes on a held-out block.
_BASE_PARAMS: dict[str, Any] = {
    "objective": "quantile",
    "num_leaves": 31,
    "min_data_in_leaf": 40,
    "learning_rate": 0.05,
    "feature_fraction": 0.8,
    "bagging_fraction": 0.8,
    "bagging_freq": 1,
    "lambda_l2": 1.0,
    "verbose": -1,
    "num_threads": 0,
    "seed": 42,
    "deterministic": True,
}

_CLASSIFIER_PARAMS: dict[str, Any] = {
    **_BASE_PARAMS,
    "objective": "binary",
    "metric": "binary_logloss",
}


@dataclass
class TrainingResult:
    """What actually happened during a fit, so the report can be honest."""

    variable: str
    n_train: int
    n_valid: int
    best_iterations: dict[str, int] = field(default_factory=dict)
    occurrence_auc: float | None = None
    notes: list[str] = field(default_factory=list)


class VariableDownscaler:
    """Downscaling models for one weather variable."""

    def __init__(self, variable: Variable, n_estimators: int = 600):
        self.variable = variable
        self.n_estimators = n_estimators
        self.quantile_models: dict[float, lgb.Booster] = {}
        self.occurrence_model: lgb.Booster | None = None
        self.occurrence_calibrator: IsotonicRegression | None = None
        self.feature_columns: list[str] = []

    # ------------------------------------------------------------------
    # Target construction
    # ------------------------------------------------------------------
    def build_target(self, local: np.ndarray, block: np.ndarray) -> np.ndarray:
        """The anomaly this variable's model learns."""
        if self.variable.reconcile == "multiplicative":
            # Log-ratio: scale-appropriate for heavy-tailed non-negative fluxes.
            return np.log1p(np.maximum(local, 0.0)) - np.log1p(np.maximum(block, 0.0))
        return local - block

    def invert_target(self, anomaly: np.ndarray, block: np.ndarray) -> np.ndarray:
        """Back to the variable's natural units."""
        if self.variable.reconcile == "multiplicative":
            out = np.expm1(np.log1p(np.maximum(block, 0.0)) + anomaly)
            return np.maximum(out, 0.0)
        return block + anomaly

    # ------------------------------------------------------------------
    # Fit
    # ------------------------------------------------------------------
    def fit(
        self,
        train: pd.DataFrame,
        valid: pd.DataFrame,
        feature_columns: list[str],
        local_col: str = "local_value",
        block_col: str = "block_value",
    ) -> TrainingResult:
        self.feature_columns = list(feature_columns)
        result = TrainingResult(
            variable=self.variable.key, n_train=len(train), n_valid=len(valid)
        )

        x_tr = train[self.feature_columns]
        x_va = valid[self.feature_columns]

        if self.variable.two_stage:
            self._fit_occurrence(train, valid, x_tr, x_va, local_col, result)
            # Amount models see only wet days: mixing dry days in would pull every
            # prediction toward zero and re-create the drizzle-everywhere failure.
            wet_tr = train[local_col] >= WET_DAY_THRESHOLD_MM
            wet_va = valid[local_col] >= WET_DAY_THRESHOLD_MM
            if wet_tr.sum() < 50:
                result.notes.append(
                    f"only {int(wet_tr.sum())} wet training days; amount model is unreliable"
                )
            fit_train, fit_valid = train[wet_tr], valid[wet_va]
            x_fit_tr, x_fit_va = x_tr[wet_tr.to_numpy()], x_va[wet_va.to_numpy()]
        else:
            fit_train, fit_valid = train, valid
            x_fit_tr, x_fit_va = x_tr, x_va

        y_tr = self.build_target(
            fit_train[local_col].to_numpy(), fit_train[block_col].to_numpy()
        )
        y_va = self.build_target(
            fit_valid[local_col].to_numpy(), fit_valid[block_col].to_numpy()
        )

        for q in QUANTILES:
            params = {**_BASE_PARAMS, "alpha": q}
            ds_tr = lgb.Dataset(x_fit_tr, label=y_tr, free_raw_data=False)
            ds_va = lgb.Dataset(x_fit_va, label=y_va, reference=ds_tr, free_raw_data=False)
            booster = lgb.train(
                params,
                ds_tr,
                num_boost_round=self.n_estimators,
                valid_sets=[ds_va],
                callbacks=[lgb.early_stopping(50, verbose=False), lgb.log_evaluation(0)],
            )
            self.quantile_models[q] = booster
            result.best_iterations[f"q{q}"] = booster.best_iteration or self.n_estimators

        return result

    def _fit_occurrence(
        self,
        train: pd.DataFrame,
        valid: pd.DataFrame,
        x_tr: pd.DataFrame,
        x_va: pd.DataFrame,
        local_col: str,
        result: TrainingResult,
    ) -> None:
        """Wet/dry classifier, isotonically calibrated.

        Calibration is not optional here. The advisory layer thresholds directly
        on this probability ("40% chance of rain means do not spray"), so a
        systematically overconfident classifier would produce systematically wrong
        spray advice even with a good AUC.
        """
        y_tr = (train[local_col] >= WET_DAY_THRESHOLD_MM).astype(int).to_numpy()
        y_va = (valid[local_col] >= WET_DAY_THRESHOLD_MM).astype(int).to_numpy()

        if len(np.unique(y_tr)) < 2:
            result.notes.append("occurrence model skipped: training data is all wet or all dry")
            return

        ds_tr = lgb.Dataset(x_tr, label=y_tr, free_raw_data=False)
        ds_va = lgb.Dataset(x_va, label=y_va, reference=ds_tr, free_raw_data=False)
        booster = lgb.train(
            _CLASSIFIER_PARAMS,
            ds_tr,
            num_boost_round=self.n_estimators,
            valid_sets=[ds_va],
            callbacks=[lgb.early_stopping(50, verbose=False), lgb.log_evaluation(0)],
        )
        self.occurrence_model = booster
        result.best_iterations["occurrence"] = booster.best_iteration or self.n_estimators

        if len(np.unique(y_va)) >= 2:
            raw_va = booster.predict(x_va, num_iteration=booster.best_iteration)
            raw_va = np.asarray(raw_va, dtype=float)
            self.occurrence_calibrator = IsotonicRegression(
                y_min=0.0, y_max=1.0, out_of_bounds="clip"
            ).fit(raw_va, y_va)

            from sklearn.metrics import roc_auc_score

            result.occurrence_auc = float(roc_auc_score(y_va, raw_va))
        else:
            result.notes.append("occurrence calibration skipped: validation set is single-class")

    # ------------------------------------------------------------------
    # Predict
    # ------------------------------------------------------------------
    def predict_quantiles(
        self, features: pd.DataFrame, block_value: np.ndarray
    ) -> dict[float, np.ndarray]:
        """Predictive quantiles in the variable's natural units."""
        if not self.quantile_models:
            raise RuntimeError(f"{self.variable.key} model is not fitted")

        x = features[self.feature_columns]
        block_value = np.asarray(block_value, dtype=float)

        out: dict[float, np.ndarray] = {}
        for q, booster in self.quantile_models.items():
            anomaly = np.asarray(
                booster.predict(x, num_iteration=booster.best_iteration), dtype=float
            )
            out[q] = self.invert_target(anomaly, block_value)

        # Quantile regressors are fitted independently and can cross.
        levels = sorted(out)
        stacked = np.sort(np.vstack([out[q] for q in levels]), axis=0)
        return {q: stacked[i] for i, q in enumerate(levels)}

    def predict_occurrence(self, features: pd.DataFrame) -> np.ndarray | None:
        """Calibrated P(measurable rain). None for non-precipitation variables."""
        if self.occurrence_model is None:
            return None
        x = features[self.feature_columns]
        raw = np.asarray(
            self.occurrence_model.predict(
                x, num_iteration=self.occurrence_model.best_iteration
            ),
            dtype=float,
        )
        if self.occurrence_calibrator is not None:
            return np.clip(self.occurrence_calibrator.predict(raw), 0.0, 1.0)
        return np.clip(raw, 0.0, 1.0)

    def predict(
        self, features: pd.DataFrame, block_value: np.ndarray
    ) -> tuple[dict[float, np.ndarray], np.ndarray | None]:
        """Full prediction: quantiles, plus occurrence probability for rainfall.

        For a two-stage variable the expected amount is the conditional amount
        weighted by occurrence probability. We keep the two numbers separate in
        the API — "70% chance" and "12mm expected" are different statements, and
        the advisory layer needs each for a different decision.
        """
        quantiles = self.predict_quantiles(features, block_value)
        occurrence = self.predict_occurrence(features)

        if occurrence is not None:
            for q in quantiles:
                # A quantile of the mixed distribution: below the dry probability
                # the quantile of the mixture is zero.
                dry_prob = 1.0 - occurrence
                quantiles[q] = np.where(q <= dry_prob, 0.0, quantiles[q])

        return quantiles, occurrence

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------
    def save(self, directory: Path) -> None:
        directory.mkdir(parents=True, exist_ok=True)
        for q, booster in self.quantile_models.items():
            booster.save_model(str(directory / f"q{q}.txt"), num_iteration=booster.best_iteration)
        if self.occurrence_model is not None:
            self.occurrence_model.save_model(
                str(directory / "occurrence.txt"),
                num_iteration=self.occurrence_model.best_iteration,
            )
        if self.occurrence_calibrator is not None:
            np.savez(
                directory / "calibrator.npz",
                x=self.occurrence_calibrator.X_thresholds_,
                y=self.occurrence_calibrator.y_thresholds_,
            )
        (directory / "meta.json").write_text(
            json.dumps(
                {
                    "variable": self.variable.key,
                    "feature_columns": self.feature_columns,
                    "quantiles": list(self.quantile_models),
                    "model_version": MODEL_VERSION,
                },
                indent=2,
            ),
            encoding="utf-8",
        )

    @classmethod
    def load(cls, directory: Path) -> VariableDownscaler:
        meta = json.loads((directory / "meta.json").read_text(encoding="utf-8"))
        obj = cls(VARIABLES[meta["variable"]])
        obj.feature_columns = meta["feature_columns"]

        for q in meta["quantiles"]:
            obj.quantile_models[float(q)] = lgb.Booster(model_file=str(directory / f"q{q}.txt"))

        occ = directory / "occurrence.txt"
        if occ.exists():
            obj.occurrence_model = lgb.Booster(model_file=str(occ))

        cal = directory / "calibrator.npz"
        if cal.exists():
            data = np.load(cal)
            iso = IsotonicRegression(y_min=0.0, y_max=1.0, out_of_bounds="clip")
            iso.fit(data["x"], data["y"])
            obj.occurrence_calibrator = iso

        return obj

    def feature_importance(self) -> pd.DataFrame:
        """Gain-based importance from the median model.

        Exposed because an extension officer's first question is "why does it say
        that?", and "elevation and windward exposure, mostly" is an answer a tree
        model can actually give.
        """
        booster = self.quantile_models.get(0.5)
        if booster is None:
            return pd.DataFrame(columns=["feature", "gain"])
        gains = booster.feature_importance(importance_type="gain")
        return (
            pd.DataFrame({"feature": booster.feature_name(), "gain": gains})
            .sort_values("gain", ascending=False)
            .reset_index(drop=True)
        )


def lapse_rate_prior(elevation_anomaly_m: np.ndarray) -> np.ndarray:
    """Expected temperature offset from elevation alone.

    Given to the temperature models as a feature so they learn the *departure*
    from known physics (cold-air drainage, slope aspect heating) rather than
    spending capacity rediscovering the lapse rate from data.
    """
    return np.asarray(elevation_anomaly_m, dtype=float) * LAPSE_RATE_C_PER_M
