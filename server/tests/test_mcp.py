"""Read-only MCP handshake/discovery check; never operates Chrome."""
import asyncio
from pathlib import Path
import shutil
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def main():
    server = Path(__file__).resolve().parents[1] / "mcp.js"
    async with stdio_client(StdioServerParameters(command=shutil.which("node"), args=[str(server)])) as (reader, writer):
        async with ClientSession(reader, writer) as client:
            info = await client.initialize()
            server_info = getattr(info, 'serverInfo', None) or info.server_info
            assert server_info.name == "codex-chrome"
            listed = await client.list_tools()
            names = {tool.name for tool in listed.tools}
            assert {"tabs", "go", "snap", "do", "read", "shot", "js", "log"}.issubset(names)
            for tool in listed.tools:
                schema = getattr(tool, 'inputSchema', None) or tool.input_schema
                assert schema["type"] == "object"
                assert tool.description
    print("LEAN MCP VERIFIED")

asyncio.run(main())
