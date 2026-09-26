"""Tests for joining villages to real gram panchayats (synthetic LGD export)."""

from __future__ import annotations

import pandas as pd
import pytest

from backend.config import REGIONS
from backend.pipeline.geo import gram_panchayats as gp

LGD_CSV = """S.No.,State Code,State Name (In English),District Name (In English),Sub-District Code,Sub-District Name (In English),Village Code,Village Name (In English),Census 2001 Code,Census 2011 Code,Local Body Code,Local Body Name (In English)
1,27,Maharashtra,Pune,4180,Bhor,556001,Nere,01234500,556001,190001,Nere
2,27,Maharashtra,Pune,4180,Bhor,556002,Ambade Bk.,01234600,556002,190001,Nere
3,27,Maharashtra,Pune,4180,Bhor,556003,Karanje,01234700,556003,190002,Karanje Group
4,27,Maharashtra,Pune,4180,Bhor,556004,Takali,01234800,,190003,Takali
5,27,Maharashtra,Pune,4181,Velhe,556005,Takali,01234900,,190004,Takali Velhe
"""


@pytest.fixture
def lgd(tmp_path):
    path = tmp_path / "maharashtra_village_gp.csv"
    path.write_text(LGD_CSV, encoding="utf-8")
    return gp.read_lgd_mapping(path)


def test_lgd_columns_are_found_by_keyword(lgd):
    assert list(lgd.columns) == [
        "census_2011",
        "village_name",
        "subdistrict_name",
        "gp_code",
        "gp_name",
    ]
    assert lgd.loc[1, "village_name"] == "ambade"   # "Bk." suffix normalised away
    assert lgd.loc[0, "gp_code"] == "190001"


def test_unrecognisable_file_fails_loudly(tmp_path):
    path = tmp_path / "junk.csv"
    path.write_text("a,b\n1,2\n", encoding="utf-8")
    with pytest.raises(gp.LgdFormatError, match="found columns"):
        gp.read_lgd_mapping(path)


def test_census_code_match_takes_priority(lgd, monkeypatch):
    xwalk = pd.DataFrame({"cen_2001": ["X1", "X2"], "census_2011": ["556001", "556003"]})
    monkeypatch.setattr(gp, "_crosswalk_2001_to_2011", lambda code: xwalk)
    villages = pd.DataFrame(
        {"village_name": ["Wrong Name", "Karanje"], "subdistrict": ["Bhor", "Bhor"], "cen_2001": ["X1", "X2"]}
    )
    out = gp.assign_gram_panchayats(villages, REGIONS["mh_ghats"], lgd=lgd)
    assert list(out["gp_code"]) == ["190001", "190002"]
    assert set(out["match_method"]) == {"census_code"}


def test_name_match_is_scoped_to_the_subdistrict(lgd, monkeypatch):
    """Two villages called Takali in different talukas must not be confused."""
    monkeypatch.setattr(gp, "_crosswalk_2001_to_2011", lambda code: None)
    villages = pd.DataFrame(
        {"village_name": ["TAKALI", "Takali"], "subdistrict": ["Bhor", "Velhe"], "cen_2001": [None, None]}
    )
    out = gp.assign_gram_panchayats(villages, REGIONS["mh_ghats"], lgd=lgd)
    assert list(out["gp_code"]) == ["190003", "190004"]
    assert set(out["match_method"]) == {"name_in_subdistrict"}


def test_ambiguous_names_are_left_unmatched_rather_than_guessed(lgd, monkeypatch):
    monkeypatch.setattr(gp, "_crosswalk_2001_to_2011", lambda code: None)
    villages = pd.DataFrame(
        {"village_name": ["Nere", "Nere"], "subdistrict": ["Bhor", "Bhor"], "cen_2001": [None, None]}
    )
    out = gp.assign_gram_panchayats(villages, REGIONS["mh_ghats"], lgd=lgd)
    assert out["gp_code"].isna().all()


def test_without_an_lgd_file_nothing_is_matched(monkeypatch, tmp_path):
    monkeypatch.setattr(gp, "LGD_DIR", tmp_path / "absent")
    villages = pd.DataFrame({"village_name": ["Nere"], "subdistrict": ["Bhor"], "cen_2001": [None]})
    out = gp.assign_gram_panchayats(villages, REGIONS["mh_ghats"])
    assert out["gp_code"].isna().all()


def test_name_normalisation_handles_common_variants():
    assert gp.normalise_name("Takali Bk.") == gp.normalise_name("TAKALI (BUDRUK)") == "takali"
