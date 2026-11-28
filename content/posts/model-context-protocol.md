+++
date = '2025-06-04'
draft = false
title = 'Model Context Protocol'
tags = ['python']
hideAuthor = true
ShowCodeCopyButtons = true
+++

Model Context Protocol (MCP) is an open standard for connecting LLM applications to tools and data sources. An assistant can use it to look up a dataset or query an API while answering a question. Anthropic introduced the protocol in its [November 2024 announcement](https://www.anthropic.com/news/model-context-protocol).

## How MCP fits together

- The **MCP host** is the application where the conversation happens. This example uses Codex CLI.
- An **MCP client** runs inside the host and communicates with one MCP server. It discovers the server’s tools and sends requests to call them.
- An **MCP server** exposes capabilities such as tools, resources, and prompts, as described in the [MCP architecture overview](https://modelcontextprotocol.io/docs/learn/architecture).

![An MCP host contains a separate client for each connected server](/mcp_architecture.svg?v=2)

## What an MCP server exposes

- **Resources** are data the client can read by URI. A file, an API response, or a reference guide can all be exposed as [MCP resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources).
- **Tools** are functions the model can ask the host to run. The host can ask the user for approval before sending a [tool call](https://modelcontextprotocol.io/specification/2026-07-28/server/tools).
- **Prompts** are reusable message templates for tasks a user wants to run. The client can fill in arguments when it retrieves an [MCP prompt](https://modelcontextprotocol.io/specification/2026-07-28/server/prompts).

## A first tool

The `@mcp.tool()` decorator exposes a Python function to the host. Its parameter names, type hints, and docstring are used to generate a tool definition in the [MCP Python SDK](https://py.sdk.modelcontextprotocol.io/v2/).

```python
from mcp.server import MCPServer

mcp = MCPServer("Example")

@mcp.tool()
def add(a: int, b: int) -> int:
    """Add two integers."""
    return a + b
```

## Compare aurora forecasts for two sites

The original example fetched the latest Kp estimate from NOAA. The server now supports a site comparison and a regional forecast map.

- `get_aurora_status` returns the latest estimate of global geomagnetic activity and its timestamp from [NOAA’s Planetary K-index feed](https://www.spaceweather.gov/products/planetary-k-index).
- `compare_aurora_sites` takes a list of places with coordinates and reads the nearest cell for each one from the same snapshot of [NOAA’s OVATION forecast grid](https://www.spaceweather.gov/products/aurora-30-minute-forecast).
- `get_aurora_map` fetches one OVATION forecast and renders the Southern Ocean overlay in the same call. It returns the PNG, its local file path, and the forecast time.

The `aurora://forecast-guide` resource explains what the forecast values mean. The `aurora_report` prompt takes two sites and asks for a report using the guide and both tools.

Save the server as `aurora_server.py`. The site comparison validates each location and returns its readings as [structured tool results](https://py.sdk.modelcontextprotocol.io/v2/servers/structured-output/).

```python
from asyncio import to_thread
from base64 import b64encode
from datetime import UTC, datetime
from functools import lru_cache
from io import BytesIO
from math import nan
from tempfile import NamedTemporaryFile
from threading import Lock
from typing import Annotated, Any, TypedDict
from urllib.request import urlopen
from zipfile import ZipFile

import cartopy.crs as ccrs
import httpx
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.colors import LinearSegmentedColormap
from matplotlib.figure import Figure
from mcp.server import MCPServer
from mcp.types import CallToolResult, ImageContent, TextContent
from pydantic import Field
import shapefile
from shapely.geometry import shape

mcp = MCPServer("Aurora")
NOAA_URL = "https://services.swpc.noaa.gov/json/"
OVATION_FILE = "ovation_aurora_latest.json"
LAND_URL = "https://naturalearth.s3.amazonaws.com/50m_physical/ne_50m_land.zip"
plot_lock = Lock()


Site = TypedDict(
    "Site",
    {
        "name": Annotated[str, Field(min_length=1)],
        "latitude": Annotated[float, Field(ge=-90, le=90)],
        "longitude": Annotated[float, Field(ge=-180, le=180)],
    },
)


async def fetch_noaa_json(filename: str):
    async with httpx.AsyncClient(base_url=NOAA_URL, timeout=10.0) as client:
        response = await client.get(filename)
        response.raise_for_status()
        return response.json()


@mcp.tool()
async def get_aurora_status() -> dict[str, Any]:
    """Get the latest NOAA planetary Kp estimate and its UTC timestamp."""
    readings = await fetch_noaa_json("planetary_k_index_1m.json")
    available = [row for row in readings if row.get("estimated_kp") is not None]
    if not available:
        raise ValueError("NOAA returned no Kp estimates.")
    latest = max(available, key=lambda row: row["time_tag"])
    estimated_kp = float(latest["estimated_kp"])
    if not 0 <= estimated_kp <= 9:
        raise ValueError("NOAA returned a Kp estimate outside the 0–9 range.")
    # NOAA's Kp feed gives UTC as a timestamp without an offset.
    time_utc = datetime.fromisoformat(latest["time_tag"]).replace(tzinfo=UTC)
    return {"estimated_kp": estimated_kp, "time_utc": time_utc.isoformat()}


@mcp.tool()
async def compare_aurora_sites(
    sites: Annotated[list[Site], Field(min_length=2, max_length=5)],
) -> dict[str, Any]:
    """Compare NOAA OVATION grid values at two to five sites."""
    forecast = await fetch_noaa_json(OVATION_FILE)
    grid = {(lon, lat): value for lon, lat, value in forecast["coordinates"]}
    comparison = []
    for site in sites:
        # The grid has 1-degree cells and uses longitude from 0 to 359.
        lon = round(site["longitude"]) % 360
        lat = round(site["latitude"])
        comparison.append(
            {
                "name": site["name"],
                "grid_latitude": lat,
                "grid_longitude": lon,
                "aurora_value": grid.get((lon, lat)),
            }
        )
    forecast_utc = datetime.fromisoformat(forecast["Forecast Time"])
    return {"forecast_utc": forecast_utc.isoformat(), "sites": comparison}


@lru_cache(maxsize=1)
def load_land():
    """Download the Natural Earth land polygons once per server process."""
    with urlopen(LAND_URL, timeout=20) as response:
        with ZipFile(BytesIO(response.read())) as archive:
            with shapefile.Reader(shp=BytesIO(archive.read("ne_50m_land.shp"))) as coast:
                return [
                    shape(item.__geo_interface__)
                    for item in coast.shapes(bbox=(77, -81, 180, -17))
                ]


def render_aurora_map(forecast: dict[str, Any]) -> bytes:
    """Draw the Southern Ocean portion of one NOAA forecast snapshot."""
    grid = {
        (lon, lat): value for lon, lat, value in forecast["coordinates"]
        if 77 <= lon <= 180 and -81 <= lat <= -17
    }
    longitudes = sorted({lon for lon, lat in grid})
    latitudes = sorted({lat for lon, lat in grid})
    if len(longitudes) < 2 or len(latitudes) < 2:
        raise ValueError("NOAA returned too few forecast points for the Southern Ocean map.")
    # Keep the raster on the native one-degree grid, including missing samples.
    longitudes = range(longitudes[0], longitudes[-1] + 1)
    latitudes = range(latitudes[0], latitudes[-1] + 1)
    values = [[grid.get((lon, lat), nan) for lon in longitudes] for lat in latitudes]

    # Keep Matplotlib rendering serial when clients call the tool concurrently.
    with plot_lock:
        geographic = ccrs.PlateCarree()
        projection = ccrs.PlateCarree(central_longitude=132)
        ink, muted = "#f0e7d5", "#b1b9a6"
        fig = Figure(figsize=(9.6, 6.15), facecolor="#0f1513")
        FigureCanvasAgg(fig)
        ax = fig.add_axes((0.04, 0.15, 0.92, 0.82), projection=projection, facecolor="#131e20")
        ax.set_extent((85, 179, -73, -18), crs=geographic)
        ax.add_geometries(load_land(), geographic, facecolor="#2c342b",
                          edgecolor="#76806c", linewidth=0.65)
        ax.spines["geo"].set_edgecolor("#606b58")
        ax.gridlines(xlocs=range(90, 180, 10), ylocs=range(-70, -10, 10),
                     color=muted, alpha=0.25, linewidth=0.65, linestyle=":")

        palette = LinearSegmentedColormap.from_list(
            "ovation",
            [(0.0, "#166c4800"), (0.03, "#26b45d65"), (0.08, "#31d970c9"),
             (0.14, "#68f58bf0"), (0.22, "#a1ffa0"), (0.38, "#d6ed76"),
             (0.6, "#efbc57"), (1.0, "#ef885e")],
            N=1024,
        )
        # The raster edges lie half a degree beyond the sampled grid points.
        west, south = projection.transform_point(longitudes[0] - 0.5, latitudes[0] - 0.5, geographic)
        east, north = projection.transform_point(longitudes[-1] + 0.5, latitudes[-1] + 0.5, geographic)
        layer = ax.imshow(
            values, extent=(west, east, south, north), origin="lower", aspect=1.13,
            interpolation="bicubic", interpolation_stage="data",
            cmap=palette, vmin=0, vmax=100, zorder=2,
        )

        for name, lon, lat in [
            ("AUSTRALIA", 134.5, -30.6),
            ("Hobart", 147.33, -44.4),
            ("Queenstown, NZ", 167.8, -47.3),
        ]:
            ax.text(lon, lat, name, color=ink, fontsize=11, ha="center",
                    transform=geographic, zorder=4)
        ax.text(
            128, -49, "Southern Ocean", color=ink, fontsize=15, style="italic",
            ha="center", transform=geographic, zorder=4,
        )

        key = fig.add_axes((0.20, 0.094, 0.60, 0.019), facecolor=fig.get_facecolor())
        colorbar = fig.colorbar(layer, cax=key, orientation="horizontal",
                                ticks=[0, 10, 20, 40, 60, 100])
        colorbar.set_label("NOAA OVATION forecast value", color=ink, fontsize=11)
        key.tick_params(labelcolor=muted, color=muted, labelsize=10, length=3)
        colorbar.outline.set_edgecolor("#606b58")
        buffer = BytesIO()
        fig.savefig(buffer, format="png", dpi=144, pil_kwargs={"optimize": True})
    return buffer.getvalue()


@mcp.tool()
async def get_aurora_map() -> CallToolResult:
    """Render the latest NOAA Southern Ocean aurora forecast and return a PNG."""
    forecast = await fetch_noaa_json(OVATION_FILE)
    forecast_utc = datetime.fromisoformat(forecast["Forecast Time"]).isoformat()
    png = await to_thread(render_aurora_map, forecast)

    with NamedTemporaryFile(prefix="aurora-forecast-", suffix=".png", delete=False) as file:
        file.write(png)

    return CallToolResult(content=[
        ImageContent(type="image", data=b64encode(png).decode("ascii"), mime_type="image/png"),
        TextContent(type="text", text=f"NOAA forecast valid {forecast_utc}. PNG: {file.name}"),
    ])


@mcp.resource("aurora://forecast-guide", mime_type="text/plain")
def forecast_guide() -> str:
    """Explain the values returned by the aurora tools."""
    return (
        "Kp estimates global geomagnetic activity.\n"
        "An OVATION value applies to a sampled grid cell at the forecast time.\n"
        "A missing grid cell is reported as null.\n"
        "Darkness, clouds, and the view toward the horizon affect visibility."
    )


@mcp.prompt()
def aurora_report(first_site: str, second_site: str) -> str:
    """Prepare a comparison for two sites supplied with coordinates."""
    return (
        "Read aurora://forecast-guide and use the aurora tools to compare "
        f"{first_site} and {second_site}. Give the latest estimated Kp and its "
        "timestamp, then put each site’s OVATION grid value in a table with "
        "the forecast time in UTC. Say if either source is unavailable."
    )


if __name__ == "__main__":
    mcp.run(transport="stdio")
```

## Try it in Codex

Download [aurora-requirements.txt](/code/model-context-protocol/aurora-requirements.txt) and save it beside `aurora_server.py` in a Git checkout. Run the command from that directory.

```bash
codex exec --ephemeral \
  -c 'mcp_servers.aurora.command="uv"' \
  -c 'mcp_servers.aurora.args=["run","-p","3.12","--no-project","--with-requirements=aurora-requirements.txt","aurora_server.py"]' \
  'Call get_aurora_map and show the forecast time and PNG path.'
```

For a site comparison, use the following prompt as the final argument instead. Clients that support MCP prompts can load `aurora_report` with `first_site` and `second_site`.

> Read `aurora://forecast-guide` and use the aurora tools to compare Hobart (−42.88, 147.33) and Queenstown, NZ (−45.03, 168.66). Give the latest estimated Kp and its timestamp, then put each site’s OVATION grid value in a table with the forecast time in UTC. Say if either source is unavailable.

The server rounds each site’s coordinates to the nearest point in NOAA’s forecast grid. The overlay shows how the forecast values vary across the region south of Australia and New Zealand.

{{< asset-figure src="images/model-context-protocol/aurora-grid.png" alt="A green band of NOAA forecast activity extends across the Southern Ocean, south of Hobart and Queenstown." caption="NOAA OVATION forecast for the Southern Hemisphere, valid 28 November 2026 at 06:59 UTC." >}}

| Site | Sampled grid cell |
| --- | --- |
| Hobart | 43° S, 147° E |
| Queenstown, NZ | 45° S, 169° E |

Codex puts the latest Kp estimate and its timestamp alongside the forecast time and grid value for each site. The server returns `null` when a cell is missing. Darkness, cloud cover, and the view toward the horizon also affect visibility, as explained in [NOAA’s guide to viewing the aurora](https://www.swpc.noaa.gov/content/tips-viewing-aurora).
