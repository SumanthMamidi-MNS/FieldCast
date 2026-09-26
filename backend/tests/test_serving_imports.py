"""The deployed API must not import the training stack.

Vercel installs only the runtime dependencies (FastAPI, pydantic, httpx, numpy).
If the serving path ever imports pandas, LightGBM, SciPy or GeoPandas, the
deployment breaks, so this is checked in a fresh interpreter.
"""

from __future__ import annotations

import subprocess
import sys


def test_serving_app_imports_only_runtime_dependencies():
    code = (
        "import sys; import backend.app.main; "
        "bad = [m for m in ('pandas', 'geopandas', 'lightgbm', 'sklearn', 'scipy', 'pyarrow', "
        "'shapely', 'pyproj', 'PIL') if m in sys.modules]; "
        "print(','.join(bad))"
    )
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True)
    assert out.stdout.strip() == "", f"training-stack modules imported: {out.stdout.strip()}"
