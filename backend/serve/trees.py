"""LightGBM tree ensembles evaluated with numpy alone.

The deployed API must not depend on LightGBM: its native library is large and a
common source of serverless build failures. At export time each booster is
flattened into plain arrays; at serve time every row walks every tree at once,
one depth level per numpy step. A parity test requires predictions to match
LightGBM's own to ~1e-12.

Split semantics mirror LightGBM for numerical features: go left when
`value <= threshold`. Missing values follow the node's `missing_type`:
"NaN" routes NaN by `default_left`; "Zero" treats NaN and 0 as missing and
routes them by `default_left`; "None" converts NaN to 0.0 before comparing.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

_MISSING_NONE, _MISSING_ZERO, _MISSING_NAN = 0, 1, 2
_MISSING_CODES = {"None": _MISSING_NONE, "Zero": _MISSING_ZERO, "NaN": _MISSING_NAN}
_KZERO = 1e-35  # LightGBM's kZeroThreshold


@dataclass
class TreeEnsemble:
    """All trees of one booster as flat node arrays.

    Node i is a leaf when `is_leaf[i]`; otherwise it splits on `feature[i]` at
    `threshold[i]` with children `left[i]` / `right[i]` (global node indices).
    """

    feature: np.ndarray
    threshold: np.ndarray
    left: np.ndarray
    right: np.ndarray
    default_left: np.ndarray
    missing_type: np.ndarray
    is_leaf: np.ndarray
    value: np.ndarray
    roots: np.ndarray
    max_depth: int
    objective: str  # "quantile" or "binary"

    # ------------------------------------------------------------------
    @classmethod
    def from_lightgbm(cls, booster) -> TreeEnsemble:
        """Flatten a trained booster (export time only; needs LightGBM)."""
        dump = booster.dump_model()
        objective = str(dump.get("objective", "")).split()[0]
        feature, threshold, left, right = [], [], [], []
        default_left, missing, is_leaf, value, roots = [], [], [], [], []
        depth_max = 0

        def add(node: dict, depth: int) -> int:
            nonlocal depth_max
            depth_max = max(depth_max, depth)
            idx = len(feature)
            feature.append(0)
            threshold.append(0.0)
            left.append(-1)
            right.append(-1)
            default_left.append(False)
            missing.append(_MISSING_NONE)
            if "leaf_value" in node:
                is_leaf.append(True)
                value.append(float(node["leaf_value"]))
                return idx
            if node.get("decision_type", "<=") != "<=":
                raise ValueError(f"unsupported decision type {node.get('decision_type')!r}")
            is_leaf.append(False)
            value.append(0.0)
            feature[idx] = int(node["split_feature"])
            threshold[idx] = float(node["threshold"])
            default_left[idx] = bool(node.get("default_left", True))
            missing[idx] = _MISSING_CODES[str(node.get("missing_type", "None"))]
            left[idx] = add(node["left_child"], depth + 1)
            right[idx] = add(node["right_child"], depth + 1)
            return idx

        for tree in dump["tree_info"]:
            roots.append(add(tree["tree_structure"], 0))

        return cls(
            feature=np.asarray(feature, dtype=np.int32),
            threshold=np.asarray(threshold, dtype=np.float64),
            left=np.asarray(left, dtype=np.int32),
            right=np.asarray(right, dtype=np.int32),
            default_left=np.asarray(default_left, dtype=bool),
            missing_type=np.asarray(missing, dtype=np.int8),
            is_leaf=np.asarray(is_leaf, dtype=bool),
            value=np.asarray(value, dtype=np.float64),
            roots=np.asarray(roots, dtype=np.int32),
            max_depth=int(depth_max),
            objective="binary" if objective.startswith("binary") else "quantile",
        )

    # ------------------------------------------------------------------
    def to_arrays(self, prefix: str) -> dict[str, np.ndarray]:
        out = {
            f"{prefix}/{name}": getattr(self, name)
            for name in (
                "feature",
                "threshold",
                "left",
                "right",
                "default_left",
                "missing_type",
                "is_leaf",
                "value",
                "roots",
            )
        }
        out[f"{prefix}/meta"] = np.asarray([self.max_depth, 1 if self.objective == "binary" else 0])
        return out

    @classmethod
    def from_arrays(cls, arrays, prefix: str) -> TreeEnsemble:
        meta = np.asarray(arrays[f"{prefix}/meta"])
        return cls(
            **{
                name: np.asarray(arrays[f"{prefix}/{name}"])
                for name in (
                    "feature",
                    "threshold",
                    "left",
                    "right",
                    "default_left",
                    "missing_type",
                    "is_leaf",
                    "value",
                    "roots",
                )
            },
            max_depth=int(meta[0]),
            objective="binary" if int(meta[1]) == 1 else "quantile",
        )

    # ------------------------------------------------------------------
    def predict_raw(self, x: np.ndarray) -> np.ndarray:
        """Sum of leaf values over all trees, for each row of `x`."""
        x = np.asarray(x, dtype=np.float64)
        if x.ndim == 1:
            x = x.reshape(1, -1)
        n_rows = x.shape[0]
        # (rows, trees) matrix of current node indices, advanced one level per step.
        cur = np.broadcast_to(self.roots, (n_rows, self.roots.size)).copy()
        row_idx = np.broadcast_to(np.arange(n_rows)[:, None], cur.shape)

        for _ in range(self.max_depth + 1):
            active = ~self.is_leaf[cur]
            if not active.any():
                break
            node = cur[active]
            fval = x[row_idx[active], self.feature[node]]
            mtype = self.missing_type[node]
            is_nan = np.isnan(fval)

            # "None": NaN behaves as 0.0.
            fval = np.where(is_nan & (mtype == _MISSING_NONE), 0.0, fval)
            missing = np.where(
                mtype == _MISSING_NAN,
                is_nan,
                np.where(mtype == _MISSING_ZERO, is_nan | (np.abs(fval) <= _KZERO), False),
            )
            with np.errstate(invalid="ignore"):
                go_left = np.where(missing, self.default_left[node], fval <= self.threshold[node])
            cur[active] = np.where(go_left, self.left[node], self.right[node])

        return self.value[cur].sum(axis=1)

    def predict(self, x: np.ndarray) -> np.ndarray:
        raw = self.predict_raw(x)
        if self.objective == "binary":
            return 1.0 / (1.0 + np.exp(-raw))
        return raw
