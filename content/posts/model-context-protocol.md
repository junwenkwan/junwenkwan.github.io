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

The original example fetched the latest Kp estimate from NOAA. The example adds a comparison of the forecast at two locations.

- `get_aurora_status` returns the latest estimate of global geomagnetic activity and its timestamp from [NOAA’s Planetary K-index feed](https://www.spaceweather.gov/products/planetary-k-index).
- `compare_aurora_sites` takes a list of places with coordinates and reads the nearest cell for each one from the same snapshot of [NOAA’s OVATION forecast grid](https://www.spaceweather.gov/products/aurora-30-minute-forecast).

The `aurora://forecast-guide` resource explains what the forecast values mean. The `aurora_report` prompt takes two sites and asks for a report using the guide and both tools.

Save the server as `aurora_server.py`. The site comparison validates each location and returns its readings as [structured tool results](https://py.sdk.modelcontextprotocol.io/v2/servers/structured-output/).

```python
from datetime import UTC, datetime
from typing import Annotated, Any, TypedDict

import httpx
from mcp.server import MCPServer
from pydantic import Field

mcp = MCPServer("Aurora")
NOAA_URL = "https://services.swpc.noaa.gov/json/"
OVATION_FILE = "ovation_aurora_latest.json"


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
  'Read aurora://forecast-guide and compare Hobart (-42.88, 147.33) and Queenstown, NZ (-45.03, 168.66). Show the Kp estimate and forecast values with UTC times.'
```

Clients that support MCP prompts can load `aurora_report` with `first_site` and `second_site`.

The server rounds each site’s coordinates to the nearest point in NOAA’s forecast grid.

| Site | Sampled grid cell |
| --- | --- |
| Hobart | 43° S, 147° E |
| Queenstown, NZ | 45° S, 169° E |

Codex puts the latest Kp estimate and its timestamp alongside the forecast time and grid value for each site. The server returns `null` when a cell is missing. Darkness, cloud cover, and the view toward the horizon also affect visibility, as explained in [NOAA’s guide to viewing the aurora](https://www.swpc.noaa.gov/content/tips-viewing-aurora).
