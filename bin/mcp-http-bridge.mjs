#!/usr/bin/env node
/**
 * MCP STDIO-to-HTTP Bridge
 *
 * A generic bridge that connects STDIO-based MCP clients (like Cursor, Claude Desktop)
 * to HTTP-based MCP server endpoints.
 *
 * Environment Variables:
 *   MCP_ENDPOINT (required)  - The HTTP(S) endpoint URL for the MCP server
 *   CUSTOM_HEADERS           - Custom headers in JSON or comma-separated format
 *   MCP_DEBUG                - Set to "true" to enable debug logging to stderr
 *
 * Custom Headers Formats:
 *   JSON:    {"X-API-Key": "abc123", "Authorization": "Bearer token"}
 *   Simple:  X-API-Key:abc123,Authorization:Bearer token
 *
 * Example Usage:
 *   MCP_ENDPOINT="https://example.com/wp-json/mcp" \
 *   CUSTOM_HEADERS='{"Mcp-Session-Id": "your-session-id"}' \
 *   npx mcp-http-bridge
 */

import { createInterface } from 'readline';
import { request } from 'http';
import { request as httpsRequest } from 'https';

// Configuration from environment
const ENDPOINT = process.env.MCP_ENDPOINT || process.env.WP_MCP_ENDPOINT;
const CUSTOM_HEADERS_RAW = process.env.CUSTOM_HEADERS || '';
const DEBUG = process.env.MCP_DEBUG === 'true';

/**
 * Log debug messages to stderr (doesn't interfere with STDIO protocol)
 */
function debug(...args) {
  if (DEBUG) {
    console.error('[MCP-BRIDGE]', ...args);
  }
}

/**
 * Send a JSON-RPC error response
 */
function sendError(code, message, id = null) {
  const response = JSON.stringify({
    jsonrpc: '2.0',
    error: { code, message },
    id
  });
  console.log(response);
  debug('Error response:', response);
}

/**
 * Parse custom headers from environment variable
 * Supports both JSON format and comma-separated key:value format
 */
function parseCustomHeaders(headersRaw) {
  if (!headersRaw || !headersRaw.trim()) {
    return {};
  }

  const trimmed = headersRaw.trim();

  // Try JSON format first
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      debug('Failed to parse headers as JSON:', e.message);
    }
  }

  // Fall back to comma-separated format: "Key1:Value1,Key2:Value2"
  const headers = {};
  const pairs = trimmed.split(',');

  for (const pair of pairs) {
    const colonIndex = pair.indexOf(':');
    if (colonIndex > 0) {
      const key = pair.substring(0, colonIndex).trim();
      const value = pair.substring(colonIndex + 1).trim();
      if (key && value) {
        headers[key] = value;
      }
    }
  }

  return headers;
}

// Validate required configuration
if (!ENDPOINT) {
  sendError(-32000, 'MCP_ENDPOINT environment variable is required');
  process.exit(1);
}

// Parse the endpoint URL
let url;
try {
  url = new URL(ENDPOINT);
} catch (e) {
  sendError(-32000, `Invalid MCP_ENDPOINT URL: ${e.message}`);
  process.exit(1);
}

const isHttps = url.protocol === 'https:';
const httpRequest = isHttps ? httpsRequest : request;

// Parse custom headers
const customHeaders = parseCustomHeaders(CUSTOM_HEADERS_RAW);

debug('Configuration:');
debug('  Endpoint:', ENDPOINT);
debug('  HTTPS:', isHttps);
debug('  Custom Headers:', JSON.stringify(customHeaders));

// Set up STDIO interface
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

/**
 * Handle incoming JSON-RPC requests from STDIO
 */
rl.on('line', (line) => {
  if (!line.trim()) return;

  debug('Received:', line);

  // Parse the JSON-RPC request
  let jsonRequest;
  try {
    jsonRequest = JSON.parse(line);
  } catch (e) {
    sendError(-32700, 'Parse error: ' + e.message);
    return;
  }

  const body = JSON.stringify(jsonRequest);

  // Build request headers
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Accept': 'application/json',
    ...customHeaders
  };

  const options = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    method: 'POST',
    headers
  };

  debug('HTTP Request:', options.method, `${url.protocol}//${options.hostname}:${options.port}${options.path}`);
  debug('Headers:', JSON.stringify(headers, null, 2));

  const req = httpRequest(options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      debug('HTTP Response:', res.statusCode, data.substring(0, 200));

      if (res.statusCode >= 200 && res.statusCode < 300) {
        // Success - output the response directly for the MCP client
        // Trim whitespace and ensure we have valid content
        const trimmedData = data.trim();
        
        if (!trimmedData) {
          debug('Empty response received, skipping');
          return;
        }

        // Handle potential multiple JSON objects (newline-delimited)
        const lines = trimmedData.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          // Validate it's valid JSON before sending
          try {
            JSON.parse(line);
            console.log(line);
          } catch (e) {
            debug('Invalid JSON in response line:', line.substring(0, 100), e.message);
          }
        }
      } else {
        // HTTP error - wrap in JSON-RPC error
        sendError(
          -32000,
          `HTTP ${res.statusCode}: ${data.substring(0, 500)}`,
          jsonRequest.id || null
        );
      }
    });
  });

  req.on('error', (e) => {
    debug('Request error:', e.message);
    sendError(-32000, 'Request error: ' + e.message, jsonRequest.id || null);
  });

  req.write(body);
  req.end();
});

rl.on('close', () => {
  debug('STDIO closed, exiting');
  process.exit(0);
});

// Handle process signals gracefully
process.on('SIGINT', () => {
  debug('Received SIGINT');
  process.exit(0);
});

process.on('SIGTERM', () => {
  debug('Received SIGTERM');
  process.exit(0);
});

