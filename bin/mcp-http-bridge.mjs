#!/usr/bin/env node
/**
 * MCP STDIO-to-HTTP Bridge
 *
 * A generic bridge that connects STDIO-based MCP clients (like Cursor, Claude Desktop)
 * to HTTP-based MCP server endpoints with automatic JWT authentication and session management.
 *
 * Environment Variables:
 *   MCP_ENDPOINT (required)  - The HTTP(S) endpoint URL for the MCP server
 *   MCP_BEARER_TOKEN         - JWT Bearer token for authentication (auto-added to Authorization header)
 *   CUSTOM_HEADERS           - Additional custom headers in JSON or comma-separated format
 *   MCP_DEBUG                - Set to "true" to enable debug logging to stderr
 *
 * Features:
 *   - Automatic JWT authentication via MCP_BEARER_TOKEN
 *   - Automatic session ID extraction from initialize response
 *   - Automatic session ID inclusion in subsequent requests
 *   - Session re-initialization on expiration (404 errors)
 *
 * Custom Headers Formats:
 *   JSON:    {"X-API-Key": "abc123", "X-Custom": "value"}
 *   Simple:  X-API-Key:abc123,X-Custom:value
 *
 * Example Usage:
 *   MCP_ENDPOINT="https://example.com/wp-json/mcp" \
 *   MCP_BEARER_TOKEN="your-jwt-token" \
 *   npx @arunshenoy99/mcp-http-bridge
 */

import { createInterface } from 'readline';
import { request } from 'http';
import { request as httpsRequest } from 'https';

// Configuration from environment
const ENDPOINT = process.env.MCP_ENDPOINT || process.env.WP_MCP_ENDPOINT;
const BEARER_TOKEN = process.env.MCP_BEARER_TOKEN || process.env.MCP_JWT_TOKEN;
const CUSTOM_HEADERS_RAW = process.env.CUSTOM_HEADERS || '';
const DEBUG = process.env.MCP_DEBUG === 'true';

// Session management
let sessionId = null;
let isInitialized = false;

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
 * According to JSON-RPC 2.0 spec:
 * - For parse errors: id MUST be null
 * - For other errors: id MUST match the request id (string, number, or null)
 * - The id field is REQUIRED in all error responses
 */
function sendError(code, message, id = null) {
  // JSON-RPC 2.0 requires id field in all error responses
  // For parse errors (-32700), id must be null per spec
  // For other errors, id should match the request id
  const response = {
    jsonrpc: '2.0',
    error: { code, message },
    id: id // Always include id, even if null (required by spec)
  };
  
  const responseStr = JSON.stringify(response);
  console.log(responseStr);
  debug('Error response:', responseStr);
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

// Build base headers
const baseHeaders = {
  'Content-Type': 'application/json'
};

// Add JWT Bearer token if provided
if (BEARER_TOKEN) {
  baseHeaders['Authorization'] = `Bearer ${BEARER_TOKEN}`;
}

// Merge with custom headers (custom headers take precedence)
const defaultHeaders = { ...baseHeaders, ...customHeaders };

debug('Configuration:');
debug('  Endpoint:', ENDPOINT);
debug('  HTTPS:', isHttps);
debug('  Bearer Token:', BEARER_TOKEN ? `${BEARER_TOKEN.substring(0, 20)}...` : 'not set');
debug('  Custom Headers:', JSON.stringify(customHeaders));
debug('  Base Headers:', JSON.stringify(baseHeaders));

// Set up STDIO interface
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

/**
 * Make HTTP request to MCP server with automatic session management
 */
async function makeRequest(jsonRequest) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(jsonRequest);
    
    // Build request headers
    const headers = {
      ...defaultHeaders,
      'Content-Length': Buffer.byteLength(body)
    };

    // Add session ID if available and this is not an initialize request
    const isInitialize = jsonRequest.method === 'initialize';
    if (!isInitialize && sessionId) {
      headers['Mcp-Session-Id'] = sessionId;
      debug('Including session ID in request:', sessionId.substring(0, 20) + '...');
    }

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers,
      timeout: 30000
    };

    debug('HTTP Request:', options.method, `${url.protocol}//${options.hostname}:${options.port}${options.path}`);
    debug('Request method:', jsonRequest.method);
    debug('Headers:', JSON.stringify(headers, null, 2));

    const req = httpRequest(options, (res) => {
      let data = '';

      // Extract session ID from response headers (case-insensitive)
      const sessionHeader = res.headers['mcp-session-id'] || 
                            res.headers['Mcp-Session-Id'] ||
                            res.headers['MCP-Session-ID'];
      
      if (sessionHeader && isInitialize) {
        sessionId = sessionHeader;
        isInitialized = true;
        debug('Session ID extracted from initialize:', sessionId.substring(0, 20) + '...');
      }

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        debug('HTTP Response:', res.statusCode);
        debug('Response data (first 200 chars):', data.substring(0, 200));

        // Handle session expiration (404) - need to re-initialize
        if (res.statusCode === 404 && sessionId && !isInitialize) {
          debug('Session expired (404), re-initializing...');
          sessionId = null;
          isInitialized = false;
          
          // Re-initialize and then retry the original request
          reinitializeAndRetry(jsonRequest).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          // Success - output the response directly for the MCP client
          const trimmedData = data.trim();
          
          if (!trimmedData) {
            debug('Empty response received, skipping');
            resolve(null);
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
          
          resolve(data);
        } else {
          // HTTP error - wrap in JSON-RPC error
          let errorMessage = `HTTP ${res.statusCode}`;
          let errorCode = -32000;
          
          try {
            const errorResponse = JSON.parse(data);
            
            // Handle WordPress REST API error format
            if (errorResponse.code && errorResponse.message) {
              errorMessage = errorResponse.message;
              // Map WordPress error codes to more descriptive messages
              if (errorResponse.code === 'rest_forbidden') {
                if (res.statusCode === 401) {
                  errorMessage = 'Authentication failed: Invalid or expired JWT token';
                } else {
                  errorMessage = `Forbidden: ${errorResponse.message}`;
                }
              }
            } else if (errorResponse.error) {
              // Handle JSON-RPC error format
              errorMessage = errorResponse.error.message || errorMessage;
              if (errorResponse.error.code) {
                errorCode = errorResponse.error.code;
              }
            } else if (errorResponse.message) {
              errorMessage = errorResponse.message;
            }
            
            // Include additional context if available
            if (errorResponse.data?.status) {
              errorMessage = `${errorMessage} (HTTP ${errorResponse.data.status})`;
            }
          } catch (e) {
            // If response isn't JSON, include raw data
            const preview = data.substring(0, 200).trim();
            if (preview) {
              errorMessage += `: ${preview}`;
            }
          }
          
          const error = new Error(errorMessage);
          error.statusCode = res.statusCode;
          error.errorCode = errorCode;
          reject(error);
        }
      });
    });

    req.on('error', (e) => {
      debug('Request error:', e.message);
      reject(e);
    });

    req.on('timeout', () => {
      debug('Request timeout');
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(body);
    req.end();
  });
}

/**
 * Re-initialize session and retry the original request
 */
async function reinitializeAndRetry(originalRequest) {
  debug('Re-initializing session...');
  
  try {
    // Send initialize request
    const initRequest = {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        clientInfo: {
          name: 'mcp-http-bridge',
          version: '1.0.0'
        }
      },
      id: 0
    };

    await makeRequest(initRequest);
    debug('Re-initialization successful, retrying original request...');
    
    // Retry the original request (with new session ID)
    // makeRequest will output the response, so we just await it
    await makeRequest(originalRequest);
  } catch (error) {
    debug('Re-initialization failed:', error.message);
    // Send error response for the original request
    // Use the original request's id
    const requestId = originalRequest.id !== undefined ? originalRequest.id : null;
    const errorCode = error.errorCode || -32000;
    sendError(
      errorCode,
      `Session expired and re-initialization failed: ${error.message}`,
      requestId
    );
    throw error;
  }
}

/**
 * Handle incoming JSON-RPC requests from STDIO
 */
rl.on('line', (line) => {
  if (!line.trim()) return;

  debug('Received:', line.substring(0, 200) + (line.length > 200 ? '...' : ''));

  // Parse the JSON-RPC request
  let jsonRequest;
  try {
    jsonRequest = JSON.parse(line);
  } catch (e) {
    // Parse error - id MUST be null per JSON-RPC 2.0 spec
    sendError(-32700, 'Parse error: ' + e.message, null);
    return;
  }

  // Validate JSON-RPC 2.0 format
  if (jsonRequest.jsonrpc !== '2.0') {
    // Use the request id if available, otherwise null
    const requestId = jsonRequest.id !== undefined ? jsonRequest.id : null;
    sendError(-32600, 'Invalid Request: jsonrpc must be "2.0"', requestId);
    return;
  }

  // Handle notifications (no id) - just forward them
  if (jsonRequest.id === undefined && jsonRequest.method) {
    debug('Handling notification:', jsonRequest.method);
    makeRequest(jsonRequest).catch((error) => {
      debug('Notification error:', error.message);
      // Don't send error for notifications
    });
    return;
  }

  // Handle requests (must have id)
  if (jsonRequest.method && jsonRequest.id !== undefined && jsonRequest.id !== null) {
    makeRequest(jsonRequest).catch((error) => {
      debug('Request error:', error.message);
      // Send error response (reinitializeAndRetry handles its own errors)
      // Use the request's id, or null if somehow missing
      const errorCode = error.errorCode || -32000;
      sendError(
        errorCode,
        error.message || 'Request failed',
        jsonRequest.id !== undefined ? jsonRequest.id : null
      );
    });
  } else {
    // Invalid request - missing method or id
    // Use the id from the request if available, otherwise null
    const requestId = jsonRequest.id !== undefined ? jsonRequest.id : null;
    sendError(-32600, 'Invalid Request: missing method or id', requestId);
  }
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

// Log startup info to stderr (doesn't interfere with JSON-RPC on stdout)
if (DEBUG) {
  console.error('[MCP-BRIDGE] Starting...');
  console.error('[MCP-BRIDGE] Endpoint:', ENDPOINT);
  console.error('[MCP-BRIDGE] JWT Token:', BEARER_TOKEN ? 'configured' : 'not set');
  console.error('[MCP-BRIDGE] Session ID:', sessionId || 'will be extracted on initialize');
}

