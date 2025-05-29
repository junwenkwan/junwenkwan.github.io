+++
date = '2025-05-29'
draft = false
title = 'Model Context Protocol (WIP)'
+++

Model Context Protocol (MCP) is an open source standard for LLMs to be interacting with applications. MCP is originally introduced by Anthropic [in this post](https://www.anthropic.com/news/model-context-protocol). With MCP, LLMs now can have assess to custom tools or data source to provide a more intelligent response. In addition, MCP also allows developers to build agents capable of more tasks, such as searching the internet or exploring dataset. MCP essentially standardizes LLM applications to work with many toolings. A nice quote by an Anthropic developer, "the models are only as good as the context provided to them".


In MCP architecture, there are several components involved, such as:
- MCP Host: LLM applications to access data through MCP, such as Claude Desktop
- MCP Clients: Inside a host, always maintain a 1:1 connection with MCP servers
- MCP Servers: Lightweight programs to expose capabilities

In this example, I will use Github Copilot as the host, and I will connect the host to my own MCP server. I will also create a MCP server with `FastMCP` which is the Python MCP SDK. Remember, the client's job is to discover custom tools, while the server's job is to expose relevant tools to the client. With this Python MCP SDK, it is very easy to define a tool, please see code snippet below.

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

_(To be continued...)_
