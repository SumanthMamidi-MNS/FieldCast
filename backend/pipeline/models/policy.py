"""Serving policy: where the model may not beat the block value, serve the block value.

FieldCast's core promise is "refine, never replace": at worst the output equals
the official block forecast. Evaluation showed that promise can fail for rain
*amounts* (Karnataka's served rain amount was worse than the block value), even
while the model's rain *chance* and temperature refinements are clearly better.

So each variable gets a policy decided on the **validation** split (held-out
blocks inside the training seasons; never the test seasons): if the served,
post-reconciliation estimate does not beat the block value there, the point
value served is the block value itself. The model still supplies the range, the
rain probability and the support level, which is where its skill lies.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from backend.config import Variable
from backend.pipeline.models.downscaler import VariableDownscaler
from backend.pipeline.models.numerics import FEATURE_COLUMNS, mixture_quantiles
from backend.pipeline.models.reconcile import reconcile, reconcile_two_stage


def served_median(
    model: VariableDownscaler, frame: pd.DataFrame, group_cols: tuple[str, str] = ("block_id", "date")
) -> np.ndarray:
    """The median the API would serve: model output reconciled per block-day."""
    x = frame[FEATURE_COLUMNS]
    block = frame["block_value"].to_numpy(dtype=float)
    cond = model.predict_quantiles(x, block)
    occ = model.predict_occurrence(x)
    out = np.empty(len(frame))
    groups = frame.groupby(list(group_cols)).indices
    for idx in groups.values():
        i = np.asarray(idx)
        bv = float(block[i[0]])
        q = {lvl: v[i] for lvl, v in cond.items()}
        if occ is not None:
            q = reconcile_two_stage(q, occ[i], np.ones(i.size), bv)
            out[i] = mixture_quantiles(q, occ[i])[0.5]
        else:
            out[i] = reconcile(q[0.5], np.ones(i.size), bv, model.variable.reconcile)
    return out


def decide_policy(model: VariableDownscaler, valid: pd.DataFrame, variable: Variable) -> dict:
    """Validation-based decision: serve the model's point value, or the block value."""
    frame = valid.reset_index(drop=True)
    y = frame["local_value"].to_numpy(dtype=float)
    block = frame["block_value"].to_numpy(dtype=float)
    median = served_median(model, frame)
    mae_model = float(np.mean(np.abs(median - y)))
    mae_block = float(np.mean(np.abs(block - y)))
    skill = 1.0 - mae_model / mae_block if mae_block > 0 else 0.0
    return {
        "variable": variable.key,
        "validation_served_skill": round(skill, 4),
        "validation_rows": len(frame),
        "point_is_block": bool(skill <= 0.0),
    }
