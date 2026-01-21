# MCP HTTP Bridge

A production-ready STDIO-to-HTTP bridge for [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) servers with automatic JWT authentication and session management. This tool connects STDIO-based MCP clients (like Cursor, Claude Desktop) to HTTP-based MCP server endpoints.

## Quick Start

For WordPress MCP servers with JWT + Session ID authentication:

```json
{
  "mcpServers": {
    "wordpress": {
      "command": "npx",
      "args": ["-y", "@arunshenoy99/mcp-http-bridge"],
      "env": {
        "MCP_ENDPOINT": "https://your-site.com/wp-json/mcp",
        "MCP_BEARER_TOKEN": "your-jwt-token-here"
      }
    }
  }
}
```

That's it! The bridge automatically handles JWT authentication and session management.

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
- **Automatic JWT Bearer token authentication** via `MCP_BEARER_TOKEN`
- **Automatic session ID management** - extracts from initialize, includes in subsequent requests
- **Automatic session re-initialization** on expiration (404 errors)
- Supports custom headers for additional authentication/configuration
- Works with both HTTP and HTTPS endpoints
- Debug mode for troubleshooting
- Zero dependencies - uses only Node.js built-ins

## Configuration

Configuration is done via environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `MCP_ENDPOINT` | Yes | The HTTP(S) endpoint URL for the MCP server |
| `MCP_BEARER_TOKEN` | No | JWT Bearer token for authentication (auto-added as `Authorization: Bearer <token>`) |
| `MCP_JWT_TOKEN` | No | Alias for `MCP_BEARER_TOKEN` |
| `CUSTOM_HEADERS` | No | Additional custom headers to include in all requests |
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

### WordPress with JWT + Automatic Session Management (Recommended)

```json
{
  "mcpServers": {
    "wordpress": {
      "command": "npx",
      "args": ["-y", "@arunshenoy99/mcp-http-bridge"],
      "env": {
        "MCP_ENDPOINT": "https://your-site.com/wp-json/mcp",
        "MCP_BEARER_TOKEN": "your-jwt-token-here"
      }
    }
  }
}
```

The bridge will automatically:
- Send JWT token in `Authorization: Bearer` header
- Extract session ID from initialize response
- Include session ID in all subsequent requests
- Re-initialize on session expiration

### With Custom Headers (Legacy)

```json
{
  "mcpServers": {
    "my-wordpress": {
      "command": "npx",
      "args": ["-y", "@arunshenoy99/mcp-http-bridge"],
      "env": {
        "MCP_ENDPOINT": "https://my-site.com/wp-json/mcp",
        "CUSTOM_HEADERS": "{\"Authorization\": \"Bearer your-token\"}"
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

### WordPress with JWT Authentication (Automatic Session Management)

```json
{
  "mcpServers": {
    "wordpress": {
      "command": "npx",
      "args": ["-y", "@arunshenoy99/mcp-http-bridge"],
      "env": {
        "MCP_ENDPOINT": "https://your-site.com/wp-json/mcp",
        "MCP_BEARER_TOKEN": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
      }
    }
  }
}
```

This configuration automatically handles:
- JWT authentication via `Authorization: Bearer` header
- Session ID extraction from initialize response
- Session ID inclusion in all subsequent requests
- Session re-initialization on expiration

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

### Session Management Flow

When using `MCP_BEARER_TOKEN`:

1. **Initialize Request:**
   - Bridge sends `initialize` with `Authorization: Bearer <JWT>` header
   - Server responds with `Mcp-Session-Id` in response headers
   - Bridge extracts and stores the session ID

2. **Subsequent Requests:**
   - Bridge includes both `Authorization: Bearer <JWT>` and `Mcp-Session-Id` headers
   - Both are required by the MCP server

3. **Session Expiration:**
   - If server returns 404 (session expired), bridge automatically:
     - Clears stored session ID
     - Sends new `initialize` request
     - Retries the original request

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
   - Verify your JWT token is valid and not expired
   - Check if `MCP_BEARER_TOKEN` is set correctly
   - Verify custom headers are correctly formatted (if using `CUSTOM_HEADERS`)

4. **Session ID errors**
   - The bridge automatically handles session IDs when using `MCP_BEARER_TOKEN`
   - If you see "Missing Mcp-Session-Id header" errors, ensure you're using `MCP_BEARER_TOKEN` (not just `CUSTOM_HEADERS`)
   - Check debug logs to see if session ID was extracted from initialize response

## License

MIT

