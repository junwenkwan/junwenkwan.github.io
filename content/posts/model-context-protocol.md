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

- The **MCP host** is the application where the conversation happens.
- An **MCP client** runs inside the host and communicates with one MCP server. It discovers the server’s tools and sends requests to call them.
- An **MCP server** exposes capabilities such as tools, resources, and prompts, as described in the [MCP architecture overview](https://modelcontextprotocol.io/docs/learn/architecture).

![An MCP host contains a separate client for each connected server](/mcp_architecture.svg?v=2)

## What an MCP server exposes

- **Resources** are data the client can read by URI. A file, an API response, or a reference guide can all be exposed as [MCP resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources).
- **Tools** are functions the model can ask the host to run. The host can ask the user for approval before sending a [tool call](https://modelcontextprotocol.io/specification/2026-07-28/server/tools).
- **Prompts** are reusable message templates for tasks a user wants to run. The client can fill in arguments when it retrieves an [MCP prompt](https://modelcontextprotocol.io/specification/2026-07-28/server/prompts).

In this example, I will use Github Copilot as the host, and I will connect the host to my own MCP server. I will also create a MCP server with `FastMCP` which is the Python MCP SDK. Remember, the client's job is to discover custom tools, while the server's job is to expose relevant tools to the client. With this Python MCP SDK, it is easy to define a MCP tool, please see code snippet below.

```python
@mcp.tool()
def add(a: int, b: int) -> int:
    """
    Args:
        a: 1st num to add
        b: 2nd num to add
    Returns:
        The sum of a and b
    """
    return a + b
```

Let's now look at a more complicated example. I will allow Github Copilot agent to query and format the data obtained from National Oceanic and Atmospheric Administration (NOAA) to get the latest Aurora Kp index.

```python
async def fetch_kp_index() -> dict | None:
    """
    Fetch the latest kp index from NOAA.
    Returns:
        A json containing kp index.
    """
    headers = {
        "User-Agent": "AuroraMCP/1.0",
        "Accept": "application/geo+json"
    }
    url = "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json"
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url,
                                        headers=headers,
                                        timeout=30.0)
            response.raise_for_status()
            return response.json()[-2:]
        except Exception:
            return None

def format_kp_index(feature: dict) -> str:
    """
    Format aurora kp index into a readable string.
    Args:
        feature: JSON containing Aurora kp index.
    Returns:
        Formatted string.
    """
    return f"""previous_time_tag: {feature[-2].get('time_tag', 'Unknown')}
previous_kp_index: {feature[-2].get('kp_index', 'Unknown')}
previous_estimated_kp: {feature[-2].get('estimated_kp', 'Unknown')}
previous_kp: {feature[-2].get('kp', 'Unknown')}
current_time_tag: {feature[-1].get('time_tag', 'Unknown')}
current_kp_index: {feature[-1].get('kp_index', 'Unknown')}
current_estimated_kp: {feature[-1].get('estimated_kp', 'Unknown')}
current_kp: {feature[-1].get('kp', 'Unknown')}"""
```

And then the tool can be wrapped with the `@mcp.tool()` decorator.

```python
@mcp.tool()
async def get_aurora_status() -> str:
    """
    A MCP tool to get current aurora Kp index.
    Returns:
        Formatted string.
    """
    kp = await fetch_kp_index()
    if kp is None:
        return "Unable to fetch Kp index."

    return format_kp_index(kp)
```

The MCP server can be started using the following code snippet.

```python
if __name__ == "__main__":
    mcp.run(transport="sse")
```

Finally, the GitHub Copilot agent can then discover this tool and get the latest Aurora Kp index from NOAA!

![MCP Copilot](/mcp_copilot.png)
