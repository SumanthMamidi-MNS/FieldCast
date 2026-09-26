"""Real gram-panchayat membership for villages, from the Local Government Directory.

LGD (lgdirectory.gov.in) publishes a "Village To Gram Panchayat Mapping" per
state. The download sits behind a CAPTCHA, so it cannot be fetched
automatically; a person downloads it once as CSV and drops it in
`data/raw/lgd/`. When present, villages are grouped into their real gram
panchayats. Villages that cannot be matched fall back to the deterministic
village clusters, and every unit records which kind it is, so the provenance of
each boundary stays visible.

Matching, in order of reliability:
1. Census 2011 village code. For Maharashtra the village polygons carry 2001
   codes, translated to 2011 through datameet's published crosswalk.
2. Normalised village name within the same sub-district (taluka), used only when
   that name is unique inside the sub-district, so an ambiguous name never
   silently lands in the wrong panchayat.
"""

from __future__ import annotations

import re
from pathlib import Path

import httpx
import pandas as pd

from backend.config import RAW_DIR, Region
from backend.pipeline.sources.cache import OfflineCacheMiss, is_offline

LGD_DIR = RAW_DIR / "lgd"

_CROSSWALK_URLS = {
    "mh": "https://raw.githubusercontent.com/datameet/indian_village_boundaries/master/mh/mh.csv",
}


class LgdFormatError(ValueError):
    """The LGD file is present but its columns could not be identified."""


def normalise_name(name: object) -> str:
    """Lower-case, strip punctuation, common suffixes and repeated spaces.

    Village names are spelled inconsistently across sources ("Takali Bk.",
    "Takali Budruk", "TAKALI (BK)"), so matching needs a canonical form.
    """
    s = str(name or "").lower()
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"\b(bk|budruk|kh|khurd|bu|kd)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _find_col(columns: list[str], *must: str, avoid: tuple[str, ...] = ()) -> str | None:
    for c in columns:
        low = c.lower()
        if all(m in low for m in must) and not any(a in low for a in avoid):
            return c
    return None


def read_lgd_mapping(path: Path) -> pd.DataFrame:
    """Parse an LGD village-to-gram-panchayat file into a canonical table.

    Column headers vary between LGD exports, so columns are found by keywords.
    Returns: census_2011, village_name, subdistrict_name, gp_code, gp_name.
    """
    if path.suffix.lower() in {".xls", ".xlsx"}:
        raw = pd.read_excel(path, dtype=str)
    else:
        raw = pd.read_csv(path, dtype=str, encoding_errors="replace")
    raw.columns = [str(c).strip() for c in raw.columns]
    cols = list(raw.columns)

    census = _find_col(cols, "census", "2011")
    vname = _find_col(cols, "village", "name", avoid=("local",)) or _find_col(cols, "village", "name")
    subdist = _find_col(cols, "sub", "district", "name", avoid=("local",)) or _find_col(
        cols, "sub", "district", "name"
    )
    gp_code = (
        _find_col(cols, "local body code")
        or _find_col(cols, "gram panchayat code")
        or _find_col(cols, "panchayat", "code")
    )
    gp_name = (
        _find_col(cols, "local body name", avoid=("local)",))
        or _find_col(cols, "local body name")
        or _find_col(cols, "gram panchayat name")
        or _find_col(cols, "panchayat", "name")
    )
    if gp_code is None or gp_name is None or (census is None and vname is None):
        raise LgdFormatError(
            f"could not identify village / gram-panchayat columns in {path.name}; "
            f"found columns: {cols}"
        )

    out = pd.DataFrame(
        {
            "census_2011": raw[census].str.strip().str.lstrip("0") if census else None,
            "village_name": raw[vname].map(normalise_name) if vname else None,
            "subdistrict_name": raw[subdist].map(normalise_name) if subdist else None,
            "gp_code": raw[gp_code].str.strip(),
            "gp_name": raw[gp_name].str.strip(),
        }
    )
    return out.dropna(subset=["gp_code"]).reset_index(drop=True)


def find_lgd_file(region: Region) -> Path | None:
    """The LGD export for this region's state, if someone has downloaded it."""
    if not LGD_DIR.exists():
        return None
    state = region.state_name.lower()
    for path in sorted(LGD_DIR.iterdir()):
        name = path.name.lower()
        if path.suffix.lower() in {".csv", ".xls", ".xlsx"} and (
            state in name or region.datameet_code == name[:2]
        ):
            return path
    return None


def _crosswalk_2001_to_2011(code: str) -> pd.DataFrame | None:
    """datameet's CEN_2001 -> census 2011 village code table, where published."""
    url = _CROSSWALK_URLS.get(code)
    if url is None:
        return None
    path = RAW_DIR / f"{code}_village_code_crosswalk.csv"
    if not path.exists():
        if is_offline():
            raise OfflineCacheMiss(f"crosswalk {code}")
        resp = httpx.get(url, timeout=120, follow_redirects=True)
        resp.raise_for_status()
        path.write_bytes(resp.content)
    df = pd.read_csv(path, dtype=str)
    if "CEN_2001" not in df.columns or "village_code_2011" not in df.columns:
        return None
    return pd.DataFrame(
        {
            "cen_2001": df["CEN_2001"].str.strip(),
            "census_2011": df["village_code_2011"].str.strip().str.lstrip("0"),
        }
    ).drop_duplicates("cen_2001")


def assign_gram_panchayats(
    villages: pd.DataFrame, region: Region, lgd: pd.DataFrame | None = None
) -> pd.DataFrame:
    """gp_code / gp_name / match_method per village row (NaN where unmatched).

    `villages` needs `village_name` and `subdistrict`, plus `cen_2001` where the
    source provides it. `lgd` can be injected (tests); otherwise it is read from
    `data/raw/lgd/`.
    """
    out = pd.DataFrame(
        {"gp_code": pd.NA, "gp_name": pd.NA, "match_method": pd.NA}, index=villages.index
    )
    if lgd is None:
        path = find_lgd_file(region)
        if path is None:
            return out
        lgd = read_lgd_mapping(path)

    # 1. census-code join
    if "cen_2001" in villages.columns and lgd["census_2011"].notna().any():
        xwalk = _crosswalk_2001_to_2011(region.datameet_code)
        if xwalk is not None:
            codes = villages[["cen_2001"]].merge(xwalk, on="cen_2001", how="left")["census_2011"]
            codes.index = villages.index
            by_code = lgd.dropna(subset=["census_2011"]).drop_duplicates("census_2011")
            by_code = by_code.set_index("census_2011")
            hit = codes.isin(by_code.index)
            out.loc[hit, "gp_code"] = by_code.loc[codes[hit], "gp_code"].to_numpy()
            out.loc[hit, "gp_name"] = by_code.loc[codes[hit], "gp_name"].to_numpy()
            out.loc[hit, "match_method"] = "census_code"

    # 2. unique name within sub-district, for what is still unmatched
    if lgd["village_name"].notna().any() and "subdistrict" in villages.columns:
        keyed = lgd.dropna(subset=["village_name", "subdistrict_name"]).copy()
        keyed["_k"] = keyed["subdistrict_name"] + "|" + keyed["village_name"]
        unique = keyed[~keyed["_k"].duplicated(keep=False)].set_index("_k")

        v_keys = villages["subdistrict"].map(normalise_name) + "|" + villages["village_name"].map(
            normalise_name
        )
        ambiguous_in_polygons = v_keys.duplicated(keep=False)
        todo = out["gp_code"].isna() & v_keys.isin(unique.index) & ~ambiguous_in_polygons
        out.loc[todo, "gp_code"] = unique.loc[v_keys[todo], "gp_code"].to_numpy()
        out.loc[todo, "gp_name"] = unique.loc[v_keys[todo], "gp_name"].to_numpy()
        out.loc[todo, "match_method"] = "name_in_subdistrict"

    return out
