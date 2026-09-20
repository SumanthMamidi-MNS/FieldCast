"""CLI: build the regional geo+station base (Phase 1) end to end.

Usage: python -m backend.pipeline.build_base build-base --region mh_ghats

Runs boundaries -> panchayat units -> GHCN station index, in that order (each
step depends on the previous one's output), and writes everything under
data/processed/. This is the single command Phase 1's success criterion refers
to: "one command builds the full regional geo+station base offline from cache."
"""

from __future__ import annotations

import typer
from rich.console import Console
from rich.table import Table

from backend.config import METRIC_CRS, PROCESSED_DIR, REGIONS, TRAINING_WINDOW, VARIABLES
from backend.pipeline.geo.boundaries import load_block_boundaries, save_block_boundaries
from backend.pipeline.geo.panchayats import build_panchayat_units, save_panchayat_units
from backend.pipeline.sources.ghcn import (
    load_station_daily,
    load_stations_in_region,
    screen_stations_by_record_quality,
)

app = typer.Typer(add_completion=False)
console = Console()


@app.command("build-base")
def build_base(
    region: str = typer.Option(..., "--region", help="Region key from config.REGIONS"),
) -> None:
    """Build blocks, panchayat-proxy units, and a quality-screened station index."""
    if region not in REGIONS:
        console.print(f"[bold red]Unknown region {region!r}. Available: {list(REGIONS)}[/bold red]")
        raise typer.Exit(code=1)
    cfg = REGIONS[region]

    console.print(f"[bold]Building base data for region {cfg.key!r} ({cfg.state_name})[/bold]")

    console.print("[cyan]Step 1/3[/cyan]: block boundaries (GADM L3)...")
    blocks = load_block_boundaries(cfg)
    save_block_boundaries(blocks, cfg)
    console.print(f"  {len(blocks)} blocks loaded across districts {list(blocks['district'].unique())}")

    console.print("[cyan]Step 2/3[/cyan]: panchayat-proxy units (datameet villages)...")
    panchayats = build_panchayat_units(cfg, blocks)
    save_panchayat_units(panchayats, cfg)
    n_villages = int(panchayats["n_villages"].sum())
    console.print(f"  {n_villages} villages clustered into {len(panchayats)} panchayat-proxy units")

    console.print("[cyan]Step 3/3[/cyan]: GHCN station index...")
    bbox = tuple(blocks.total_bounds)
    stations = load_stations_in_region(cfg, bbox=bbox)
    element_list = sorted({v.ghcn_element for v in VARIABLES.values() if v.ghcn_element is not None})
    daily = load_station_daily(
        stations["station_id"].tolist(),
        TRAINING_WINDOW.start,
        TRAINING_WINDOW.end,
        elements=element_list,
    )
    good_ids = screen_stations_by_record_quality(daily, stations["station_id"].tolist())
    stations_screened = stations[stations["station_id"].isin(good_ids)].reset_index(drop=True)
    stations_out_path = PROCESSED_DIR / f"stations_{cfg.key}.parquet"
    stations_screened.to_parquet(stations_out_path)
    console.print(
        f"  {len(stations)} stations in bbox, {len(stations_screened)} passed the record-quality screen"
    )

    area_km2 = blocks.to_crs(METRIC_CRS).geometry.area.sum() / 1e6

    table = Table(title=f"Base data summary — {cfg.key}")
    table.add_column("Metric")
    table.add_column("Value", justify="right")
    table.add_row("Blocks", str(len(blocks)))
    table.add_row("Villages (assigned to a block)", str(n_villages))
    table.add_row("Panchayat-proxy units", str(len(panchayats)))
    table.add_row("GHCN stations in bbox", str(len(stations)))
    table.add_row("GHCN stations (quality-screened)", str(len(stations_screened)))
    table.add_row("Area covered (km^2)", f"{area_km2:,.0f}")
    console.print(table)
    console.print(f"[green]Done.[/green] Outputs written under {PROCESSED_DIR}")


if __name__ == "__main__":
    app()
