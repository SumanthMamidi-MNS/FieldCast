"""Pre-compute panchayat terrain for blocks so their first map load is instant.

Run:  python -m backend.app.warm --region mh_ghats --limit 10
Blocks are warmed in order of panchayat count; each costs ~9 elevation lookups
per panchayat against the Open-Meteo budget, so warm what the demo needs.
"""

from __future__ import annotations

import typer
from rich.console import Console

from backend.app.services import forecast as svc
from backend.config import PRIMARY_REGION, PROCESSED_DIR

app = typer.Typer(add_completion=False)
console = Console()


@app.command()
def run(
    region: str = typer.Option(PRIMARY_REGION),
    limit: int = typer.Option(10, help="Number of blocks to warm"),
    block: list[str] = typer.Option(None, help="Specific block ids (repeatable)"),
) -> None:
    blocks = svc.list_blocks(region)
    targets = [b for b in blocks if b.block_id in block] if block else blocks[:limit]
    done = 0
    for b in targets:
        path = PROCESSED_DIR / f"panchayat_terrain_{region}" / f"{b.block_id}.parquet"
        if path.exists():
            continue
        console.print(f"warming {b.district} / {b.block_name} ({b.panchayat_count} panchayats)")
        svc.panchayat_terrain(region, b.block_id)
        done += 1
    console.print(f"[green]{done} block(s) warmed[/green]")


if __name__ == "__main__":
    app()
