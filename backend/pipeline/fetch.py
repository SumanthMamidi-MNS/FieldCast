"""Fill the weather cache for every configured season, across API-quota resets.

Run (it may take days of wall-clock time; it is safe to stop and restart):
    python -m backend.pipeline.fetch --region mh_ghats --region ka_ghats

Open-Meteo's free tier allows ~10k weighted calls per day. Each season is fetched
in cached chunks; when the hourly or daily budget is spent the command sleeps and
resumes, so the only cost of a large history is waiting.
"""

from __future__ import annotations

import time

import geopandas as gpd
import typer
from rich.console import Console

from backend.config import PROCESSED_DIR, REGIONS, TRAINING_WINDOW
from backend.pipeline.sources.open_meteo import ApiBudgetExceeded
from backend.pipeline.train import build_grid_for_region, fetch_weather_panel

app = typer.Typer(add_completion=False)
console = Console()

_RETRY_SLEEP_S = 30 * 60


@app.command()
def run(
    region: list[str] = typer.Option(["mh_ghats"], help="Region keys, in priority order"),
    step_deg: float = typer.Option(TRAINING_WINDOW.grid_step_deg),
) -> None:
    # Test seasons first: without them nothing can be evaluated. Then training
    # seasons, most recent first.
    ordered = sorted(TRAINING_WINDOW.seasons, key=lambda s: (not s.test, s.start), reverse=False)
    ordered = [s for s in ordered if s.test] + sorted(
        [s for s in ordered if not s.test], key=lambda s: s.start, reverse=True
    )
    for key in region:
        blocks = gpd.read_parquet(PROCESSED_DIR / f"blocks_{REGIONS[key].key}.parquet")
        points = build_grid_for_region(blocks, step_deg=step_deg)
        for season in ordered:
            while True:
                try:
                    console.print(f"[cyan]{key}[/cyan] {season.label}: {len(points)} points")
                    fetch_weather_panel(points, ((season.start, season.end),))
                    console.print(f"  [green]cached[/green] {key} {season.label}")
                    break
                except ApiBudgetExceeded as exc:
                    console.print(f"  [yellow]{exc} — sleeping {_RETRY_SLEEP_S // 60} min[/yellow]")
                    time.sleep(_RETRY_SLEEP_S)
    console.print("[bold green]all seasons cached[/bold green]")


if __name__ == "__main__":
    app()
