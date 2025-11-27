# MCP HTTP Bridge

A generic STDIO-to-HTTP bridge for [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) servers. This tool connects STDIO-based MCP clients (like Cursor, Claude Desktop) to HTTP-based MCP server endpoints.

## Installation

```bash
npm install -g @arunshenoy99/mcp-http-bridge
```

Or use directly with npx:

```bash
npx @arunshenoy99/mcp-http-bridge
```

## Features

- Bridges STDIO-based MCP clients to HTTP endpoints
- Supports custom headers for authentication (API keys, session tokens, etc.)
- Works with both HTTP and HTTPS endpoints
- Debug mode for troubleshooting
- Zero dependencies - uses only Node.js built-ins

## Configuration

Configuration is done via environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `MCP_ENDPOINT` | Yes | The HTTP(S) endpoint URL for the MCP server |
| `CUSTOM_HEADERS` | No | Custom headers to include in all requests |
| `MCP_DEBUG` | No | Set to `"true"` to enable debug logging |

### Custom Headers

The `CUSTOM_HEADERS` environment variable supports two formats:

#### JSON Format (Recommended)

```bash
CUSTOM_HEADERS='{"Authorization": "Bearer token123", "X-API-Key": "mykey"}'
```

#### Comma-Separated Format

```bash
CUSTOM_HEADERS="Authorization:Bearer token123,X-API-Key:mykey"
```

## Usage with Cursor

Add to your Cursor MCP settings (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "my-wordpress": {
      "command": "npx",
      "args": ["-y", "@arunshenoy99/mcp-http-bridge"],
      "env": {
        "MCP_ENDPOINT": "https://my-site.com/wp-json/blu/mcp",
        "CUSTOM_HEADERS": "{\"Mcp-Session-Id\": \"your-session-id-here\"}"
      }
    }
  }
}
```

## Usage with Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "@arunshenoy99/mcp-http-bridge"],
      "env": {
        "MCP_ENDPOINT": "https://api.example.com/mcp",
        "CUSTOM_HEADERS": "{\"Authorization\": \"Bearer your-token\"}"
      }
    }
  }
}
```

## Examples

### WordPress with Session Authentication

```json
{
  "mcpServers": {
    "wordpress": {
      "command": "npx",
      "args": ["-y", "@arunshenoy99/mcp-http-bridge"],
      "env": {
        "MCP_ENDPOINT": "https://your-site.com/wp-json/blu/mcp",
        "CUSTOM_HEADERS": "{\"Mcp-Session-Id\": \"abc123-session-id\"}"
      }
    }
  }
}
```

### With Basic Authentication

```json
{
  "mcpServers": {
    "my-api": {
      "command": "npx",
      "args": ["-y", "@arunshenoy99/mcp-http-bridge"],
      "env": {
        "MCP_ENDPOINT": "https://api.example.com/mcp",
        "CUSTOM_HEADERS": "{\"Authorization\": \"Basic dXNlcm5hbWU6cGFzc3dvcmQ=\"}"
      }
    }
  }
}
```

### With Debug Mode

```json
{
  "mcpServers": {
    "debug-server": {
      "command": "npx",
      "args": ["-y", "@arunshenoy99/mcp-http-bridge"],
      "env": {
        "MCP_ENDPOINT": "https://api.example.com/mcp",
        "MCP_DEBUG": "true"
      }
    }
  }
}
```

## How It Works

```
┌─────────────┐      STDIO       ┌──────────────────┐      HTTP       ┌─────────────┐
│   Cursor    │ ◄──────────────► │  MCP HTTP Bridge │ ◄─────────────► │  MCP Server │
│   Claude    │   JSON-RPC       │                  │   JSON-RPC      │   (HTTP)    │
└─────────────┘                  └──────────────────┘                 └─────────────┘
```

1. MCP clients (Cursor, Claude) communicate via STDIO using JSON-RPC
2. The bridge reads JSON-RPC messages from stdin
3. Forwards them as HTTP POST requests to the configured endpoint
4. Returns the HTTP response back via stdout

## Troubleshooting

### Enable Debug Mode

Set `MCP_DEBUG=true` to see detailed logs in stderr:

```bash
MCP_ENDPOINT="https://example.com/mcp" MCP_DEBUG=true npx @arunshenoy99/mcp-http-bridge
```

### Common Issues

1. **"MCP_ENDPOINT environment variable is required"**
   - Make sure you've set the `MCP_ENDPOINT` environment variable

2. **Connection refused**
   - Verify the endpoint URL is correct and the server is running
   - Check if you need to use HTTP vs HTTPS

3. **Authentication errors**
   - Verify your custom headers are correctly formatted
   - Check if your session/token is still valid

## License

MIT

