"""Central configuration. Every path and region constant lives here.

The pipeline is region-agnostic: adding a state means adding a REGIONS entry,
not editing pipeline code. That is what makes the Karnataka transfer test cheap.
"""

from __future__ import annotations

import contextlib
from dataclasses import dataclass
from pathlib import Path

# --------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent

DATA_DIR = ROOT / "data"
CACHE_DIR = DATA_DIR / "cache"
RAW_DIR = DATA_DIR / "raw"
INTERIM_DIR = DATA_DIR / "interim"
PROCESSED_DIR = DATA_DIR / "processed"
ARTIFACT_DIR = ROOT / "models" / "artifacts"
REPORT_DIR = ROOT / "reports"
# Bumped whenever the model or its features change; stamped into every bundle.
MODEL_VERSION = "0.2.0"

# Precomputed serving bundle: the only data the deployed API reads.
SERVE_DIR = ROOT / "serve_bundle"

# Pipeline working directories. Creation is best-effort: on a serverless host the
# filesystem is read-only and the API never touches these.
for _d in (CACHE_DIR, RAW_DIR, INTERIM_DIR, PROCESSED_DIR, ARTIFACT_DIR, REPORT_DIR):
    with contextlib.suppress(OSError):
        _d.mkdir(parents=True, exist_ok=True)


# --------------------------------------------------------------------------
# Region definitions
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class Region:
    """A pilot or evaluation region.

    `districts` selects the subset of a state we actually process; the full state
    is too large to be useful and district selection is how we keep the terrain
    contrast (windward vs rain-shadow) inside the training set.
    """

    key: str
    state_name: str          # as spelled in GADM NAME_1
    datameet_code: str       # datameet repo directory, e.g. "mh"
    districts: tuple[str, ...]
    role: str                # "train" or "transfer"

    @property
    def is_transfer(self) -> bool:
        return self.role == "transfer"


REGIONS: dict[str, Region] = {
    "mh_ghats": Region(
        key="mh_ghats",
        state_name="Maharashtra",
        datameet_code="mh",
        # Windward Ghats -> crest -> rain shadow, west to east.
        districts=("Pune", "Satara", "Ahmadnagar", "Nashik", "Raigad", "Kolhapur", "Sangli"),
        role="train",
    ),
    "ka_ghats": Region(
        key="ka_ghats",
        state_name="Karnataka",
        datameet_code="ka",
        districts=("Belgaum", "Dharwad", "Uttara Kannada", "Shimoga", "Chikmagalur", "Hassan"),
        # Trained on its own data for serving; also the target of the transfer
        # test, where Maharashtra-trained models are evaluated here.
        role="train",
    ),
}

PRIMARY_REGION = "mh_ghats"
TRANSFER_REGION = "ka_ghats"


# --------------------------------------------------------------------------
# Weather variables
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class Variable:
    key: str
    open_meteo_daily: str
    ghcn_element: str | None      # None => no real gauge validation available
    unit: str
    label: str
    # "multiplicative" for non-negative fluxes, "additive" for intensive vars.
    # Governs both block-mean reconciliation and the anomaly definition.
    reconcile: str
    two_stage: bool = False       # rainfall only: occurrence + amount
    ghcn_scale: float = 1.0       # GHCN stores tenths; converts to our unit


VARIABLES: dict[str, Variable] = {
    "precip": Variable(
        key="precip",
        open_meteo_daily="precipitation_sum",
        ghcn_element="PRCP",
        unit="mm",
        label="Rainfall",
        reconcile="multiplicative",
        two_stage=True,
        ghcn_scale=0.1,           # GHCN PRCP is in tenths of mm
    ),
    "tmax": Variable(
        key="tmax",
        open_meteo_daily="temperature_2m_max",
        ghcn_element="TMAX",
        unit="°C",
        label="Max temperature",
        reconcile="additive",
        ghcn_scale=0.1,           # tenths of °C
    ),
    "tmin": Variable(
        key="tmin",
        open_meteo_daily="temperature_2m_min",
        ghcn_element="TMIN",
        unit="°C",
        label="Min temperature",
        reconcile="additive",
        ghcn_scale=0.1,
    ),
    "humidity": Variable(
        key="humidity",
        open_meteo_daily="relative_humidity_2m_mean",
        ghcn_element=None,
        unit="%",
        label="Relative humidity",
        reconcile="additive",
    ),
    "wind": Variable(
        key="wind",
        open_meteo_daily="wind_speed_10m_max",
        ghcn_element=None,
        unit="km/h",
        label="Wind speed",
        reconcile="multiplicative",
    ),
}


# --------------------------------------------------------------------------
# Physical + modelling constants
# --------------------------------------------------------------------------
# Environmental lapse rate. Used as a physical prior so the temperature models
# learn the *departure* from known physics rather than rediscovering it.
LAPSE_RATE_C_PER_M = -0.0065

# SW monsoon mean flow direction (degrees from north, direction wind comes FROM).
# Aspect is scored against this to separate windward from leeward slopes.
MONSOON_FLOW_DEG = 245.0

# Rain occurrence threshold (mm/day): IMD's "rainy day" definition. A lower
# threshold (0.1 mm) made reanalysis drizzle count as rain on ~92% of monsoon
# days, so the advisory said "rain likely, hold off spraying" for 2 mm that would
# never wash a spray off. 2.5 mm is the standard agro-met meaning of a rainy day.
WET_DAY_THRESHOLD_MM = 2.5

# Predictive quantiles.
QUANTILES: tuple[float, ...] = (0.1, 0.5, 0.9)

# Projected CRS for metric operations over peninsular India.
METRIC_CRS = "EPSG:7755"   # WGS84 / India NSF LCC
GEOGRAPHIC_CRS = "EPSG:4326"

# Terrain stencil half-width in metres, used for slope/aspect/ruggedness.
TERRAIN_STENCIL_M = 1000.0


# --------------------------------------------------------------------------
# Training window
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class Season:
    """A contiguous date range fetched and modelled as one unit."""

    start: str
    end: str
    kind: str            # "monsoon" (Jun-Sep) or "dry" (Oct-May)
    test: bool = False   # held out for evaluation; never trained on

    @property
    def label(self) -> str:
        return f"{self.kind} {self.start[:4]}" + (f"-{self.end[2:4]}" if self.kind == "dry" else "")


@dataclass(frozen=True)
class TrainingWindow:
    """Training and test seasons, covering the whole year.

    Four monsoons and one dry season train the models; the following monsoon and
    dry season are held out as test periods. The dry test season starts five days
    after the last training monsoon ends, which keeps the 3-day embargo against
    day-to-day weather autocorrelation.

    Open-Meteo's free tier (10k weighted calls/day) is the constraint: fetching
    all of this takes several days of quota, which `pipeline.fetch` handles by
    waiting and resuming from cache.
    """

    seasons: tuple[Season, ...] = (
        Season("2019-06-01", "2019-09-30", "monsoon"),
        Season("2020-06-01", "2020-09-30", "monsoon"),
        Season("2021-06-01", "2021-09-30", "monsoon"),
        Season("2021-10-01", "2022-05-31", "dry"),
        Season("2022-06-01", "2022-09-30", "monsoon"),
        Season("2022-10-05", "2023-05-31", "dry", test=True),
        Season("2023-06-01", "2023-09-30", "monsoon", test=True),
    )
    # Historical gauge seasons. India's older station network ended around 1970,
    # leaving ~100 gauges per state with dense monsoon records in 1956-61 versus
    # only 4 today. The reanalysis covers those years, so they give a far larger
    # real-gauge test. Never used for training: 1958-59 calibrate the
    # point-scale interval factor, 1960-61 are the historical gauge test.
    gauge_calibration_seasons: tuple[Season, ...] = (
        Season("1958-06-01", "1958-09-30", "monsoon"),
        Season("1959-06-01", "1959-09-30", "monsoon"),
    )
    gauge_test_seasons: tuple[Season, ...] = (
        Season("1960-06-01", "1960-09-30", "monsoon", test=True),
        Season("1961-06-01", "1961-09-30", "monsoon", test=True),
    )
    # Grid spacing (degrees). ~16km gives ~3.5 fine points per block, the minimum
    # for a non-degenerate within-block anomaly, while fitting the call budget.
    grid_step_deg: float = 0.15

    @property
    def train_seasons(self) -> tuple[Season, ...]:
        return tuple(s for s in self.seasons if not s.test)

    @property
    def test_seasons(self) -> tuple[Season, ...]:
        return tuple(s for s in self.seasons if s.test)

    @property
    def test_periods(self) -> tuple[tuple[str, str], ...]:
        return tuple((s.start, s.end) for s in self.test_seasons)

    @property
    def gauge_seasons(self) -> tuple[Season, ...]:
        return self.gauge_calibration_seasons + self.gauge_test_seasons

    @property
    def start(self) -> str:
        return min(s.start for s in self.seasons)

    @property
    def end(self) -> str:
        return max(s.end for s in self.seasons)


TRAINING_WINDOW = TrainingWindow()


# --------------------------------------------------------------------------
# Confidence labelling
# --------------------------------------------------------------------------
SUPPORT_LABELS = {
    "high": "well-supported",
    "medium": "moderate",
    "low": "low — treat as indicative",
}

# Tier definitions, surfaced in every API response.
TIERS = {
    "T1": "Validated against dense reanalysis truth at ~9km.",
    "T2": "Validated against real rain-gauge observations.",
    "T3": "Inferred below the validated scale; uncertainty inflated.",
}

# How much to inflate the predictive interval when extrapolating to T3.
T3_INTERVAL_INFLATION = 1.35
