"""Tests for GHCN-Daily fixed-width parsing.

Fixtures are built by hand, character position by character position, mirroring
NOAA's documented format (verified against a real downloaded record during
development). This parser is the sole gate on our real ground-truth data, so a
subtly wrong column offset would silently corrupt everything downstream — these
tests exist to make that impossible to get wrong unnoticed.
"""

from __future__ import annotations

import pandas as pd
import pytest

from backend.pipeline.sources.ghcn import (
    parse_dly,
    parse_station_inventory,
    screen_stations_by_record_quality,
)


def _station_line(
    station_id: str, lat: str, lon: str, elev: str, state: str, name: str
) -> str:
    """Build one ghcnd-stations.txt line at exact 1-indexed column positions:

    ID 1-11, LATITUDE 13-20, LONGITUDE 22-30, ELEVATION 32-37, STATE 39-40,
    NAME 42-71.
    """
    line = list(" " * 85)
    line[0:11] = list(f"{station_id:<11}")
    line[12:20] = list(f"{lat:>8}")
    line[21:30] = list(f"{lon:>9}")
    line[31:37] = list(f"{elev:>6}")
    line[38:40] = list(f"{state:<2}")
    line[41:71] = list(f"{name:<30}")
    return "".join(line)


def _dly_block(value: int, mflag: str = " ", qflag: str = " ", sflag: str = " ") -> str:
    """Build one 8-char VALUE(5) MFLAG(1) QFLAG(1) SFLAG(1) day block."""
    return f"{value:>5}{mflag}{qflag}{sflag}"


def _dly_line(station_id: str, year: int, month: int, element: str, blocks: list[str]) -> str:
    """Build one .dly record: ID(11) YEAR(4) MONTH(2) ELEMENT(4) + 31 x 8-char blocks."""
    header = f"{station_id:<11}{year:04d}{month:02d}{element:<4}"
    body = "".join(blocks)
    assert len(blocks) == 31
    line = header + body
    assert len(line) == 21 + 31 * 8
    return line


class TestParseStationInventory:
    def test_parses_id_lat_lon_elevation_state_name(self):
        line = _station_line(
            "USW00094728", "40.7789", "-73.9692", "39.6", "NY", "NY CITY CENTRAL PARK"
        )
        df = parse_station_inventory(line)

        assert len(df) == 1
        row = df.iloc[0]
        assert row["station_id"] == "USW00094728"
        assert row["latitude"] == pytest.approx(40.7789)
        assert row["longitude"] == pytest.approx(-73.9692)
        assert row["elevation_m"] == pytest.approx(39.6)
        assert row["state"] == "NY"
        assert row["name"] == "NY CITY CENTRAL PARK"

    def test_name_with_internal_spaces_is_not_mis_split(self):
        # This is exactly why we slice by column, not str.split(): a whitespace
        # split would fragment this name across several bogus "columns".
        line = _station_line(
            "IN001010100", "18.8700", "79.4300", "143.0", "  ", "MANCHERIAL (RAL) STATION"
        )
        df = parse_station_inventory(line)
        assert df.iloc[0]["name"] == "MANCHERIAL (RAL) STATION"

    def test_multiple_lines_and_blank_lines_ignored(self):
        line1 = _station_line("AAA00000001", "10.0000", "20.0000", "100.0", "XX", "FIRST")
        line2 = _station_line("BBB00000002", "-5.0000", "-30.0000", "0.0", "YY", "SECOND")
        text = f"{line1}\n\n{line2}\n"
        df = parse_station_inventory(text)
        assert list(df["station_id"]) == ["AAA00000001", "BBB00000002"]


class TestParseDly:
    def test_missing_value_becomes_absent_not_a_bogus_number(self):
        blocks = [_dly_block(-9999)] * 31
        line = _dly_line("USW00094728", 2020, 1, "PRCP", blocks)
        df = parse_dly(line)
        assert df.empty  # every day was the -9999 sentinel -> nothing survives

    def test_qflag_flagged_value_is_dropped(self):
        blocks = [_dly_block(-9999)] * 31
        blocks[2] = _dly_block(100, qflag="G")  # day 3: value present but QC-failed
        line = _dly_line("USW00094728", 2020, 1, "PRCP", blocks)
        df = parse_dly(line)
        assert df.empty  # the only non-missing day was quality-flagged -> dropped

    def test_tenths_scaling_applied_for_prcp(self):
        blocks = [_dly_block(-9999)] * 31
        blocks[0] = _dly_block(50, sflag="0")  # day 1: raw 50 tenths-of-mm -> 5.0mm
        blocks[3] = _dly_block(235, sflag="0")  # day 4: raw 235 -> 23.5mm
        line = _dly_line("USW00094728", 2020, 1, "PRCP", blocks)
        df = parse_dly(line)

        assert len(df) == 2
        by_date = df.set_index("date")["value"]
        assert by_date[pd.Timestamp("2020-01-01")] == pytest.approx(5.0)
        assert by_date[pd.Timestamp("2020-01-04")] == pytest.approx(23.5)

    def test_mixed_valid_missing_and_flagged_in_one_month(self):
        blocks = [_dly_block(-9999)] * 31
        blocks[0] = _dly_block(50, sflag="0")  # valid
        blocks[1] = _dly_block(-9999)  # missing sentinel
        blocks[2] = _dly_block(100, qflag="G")  # quality-failed
        blocks[3] = _dly_block(235, sflag="0")  # valid
        line = _dly_line("USW00094728", 2020, 1, "PRCP", blocks)
        df = parse_dly(line)

        assert set(df["date"].dt.day) == {1, 4}
        assert (df["station_id"] == "USW00094728").all()
        assert (df["element"] == "PRCP").all()

    def test_element_filter_restricts_output(self):
        prcp_blocks = [_dly_block(-9999)] * 31
        prcp_blocks[0] = _dly_block(50, sflag="0")
        tmax_blocks = [_dly_block(-9999)] * 31
        tmax_blocks[0] = _dly_block(300, sflag="0")  # 30.0 C after tenths scale

        text = "\n".join(
            [
                _dly_line("USW00094728", 2020, 1, "PRCP", prcp_blocks),
                _dly_line("USW00094728", 2020, 1, "TMAX", tmax_blocks),
            ]
        )

        prcp_only = parse_dly(text, elements={"PRCP"})
        assert set(prcp_only["element"]) == {"PRCP"}

        both = parse_dly(text)
        assert set(both["element"]) == {"PRCP", "TMAX"}
        tmax_row = both[both["element"] == "TMAX"].iloc[0]
        assert tmax_row["value"] == pytest.approx(30.0)

    def test_invalid_day_in_month_is_skipped_not_raised(self):
        # February in a .dly file still carries 31 day-slots; days 29-31 (in a
        # non-leap year) must be silently skipped, not raise or fabricate a date.
        blocks = [_dly_block(-9999)] * 31
        blocks[0] = _dly_block(10, sflag="0")  # Feb 1: valid
        blocks[28] = _dly_block(20, sflag="0")  # "Feb 29" in a non-leap year: invalid
        line = _dly_line("USW00094728", 2021, 2, "PRCP", blocks)
        df = parse_dly(line)
        assert len(df) == 1
        assert df.iloc[0]["date"] == pd.Timestamp("2021-02-01")


class TestScreenStationsByRecordQuality:
    def test_drops_stations_below_minimum_observation_count(self):
        daily = pd.DataFrame(
            {
                "station_id": ["A"] * 400 + ["B"] * 10,
                "date": pd.date_range("2020-01-01", periods=410, freq="D"),
                "element": ["PRCP"] * 410,
                "value": [1.0] * 410,
            }
        )
        kept = screen_stations_by_record_quality(daily, ["A", "B"], min_valid_obs=365)
        assert kept == ["A"]

    def test_empty_daily_frame_drops_everything(self):
        empty = pd.DataFrame(columns=["station_id", "date", "element", "value"])
        kept = screen_stations_by_record_quality(empty, ["A", "B"], min_valid_obs=1)
        assert kept == []
