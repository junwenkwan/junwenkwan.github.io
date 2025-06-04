+++
date = '2025-05-29'
draft = false
title = 'Model Context Protocol'
+++

Model Context Protocol (MCP) is an open source standard for LLMs to be interacting with applications. MCP is originally introduced by Anthropic [in this post](https://www.anthropic.com/news/model-context-protocol). With MCP, LLMs now can have assess to custom tools or data source to provide a more intelligent response. 

In addition, MCP also allows developers to build agents capable of more tasks, such as searching the internet or exploring dataset. MCP essentially standardizes LLM applications to work with many toolings. A nice quote by an Anthropic developer, "the models are only as good as the context provided to them".

In MCP architecture, there are several components involved, such as:
- MCP Host: LLM applications to access data through MCP, such as Claude Desktop
- MCP Clients: Inside a host, always maintain a 1:1 connection with MCP servers
- MCP Servers: Lightweight programs to expose capabilities

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
async def fetch_kp_index() -> float | None:
    """Fetch the latest Kp index value from NOAA."""
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
    """Format aurora kp index into a readable string."""
    return f"""previous_time_tag: {feature[-2].get('time_tag', 'Unknown')}
previous_kp_index: {feature[-2].get('kp_index', 'Unknown')}
previous_estimated_kp: {feature[-2].get('estimated_kp', 'Unknown')}
previous_kp: {feature[-2].get('kp', 'Unknown')}
current_time_tag: {feature[-1].get('time_tag', 'Unknown')}
current_kp_index: {feature[-1].get('kp_index', 'Unknown')}
current_estimated_kp: {feature[-1].get('estimated_kp', 'Unknown')}
current_kp: {feature[-1].get('kp', 'Unknown')}"""
```

And then the tool can be wrapped with Python MCP SDK.

```python
@mcp.tool()
async def get_aurora_status() -> str:
    """Get current aurora Kp index."""
    kp = await fetch_kp_index()
    if kp is None:
        return "Unable to fetch Kp index."

    return format_kp_index(kp)
```

I will run the MCP server using the following code snippet.

```python
if __name__ == "__main__":
    mcp.run(transport="sse")
```

Finally, the agent can then discover this tool and get the latest Aurora Kp index from NOAA.

![MCP Example](/mcp.png)
