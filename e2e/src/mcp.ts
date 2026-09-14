import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport, type StreamableHTTPClientTransportOptions } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { BASE_URL } from './config.js'

/** Official SDK against the same published Nginx entry used by Chromium. */
export async function connectMcp(options: StreamableHTTPClientTransportOptions = {}) {
  const client = new Client({ name: 'visualise-ai-browser-acceptance', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', BASE_URL), options)
  // SDK 1.30's concrete getter includes undefined while its Transport interface
  // declares sessionId optional. Bridge that declaration-only mismatch under
  // exactOptionalPropertyTypes; runtime is the unmodified official transport.
  await client.connect(transport as Transport)
  const catalogue = await client.listTools()
  async function call(name: string, input: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: input })
    if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.structuredContent ?? result.content)}`)
    if (!result.structuredContent) throw new Error(`${name}: missing structured output`)
    return result.structuredContent as Record<string, unknown>
  }
  return { client, transport, catalogue, call, close: () => client.close() }
}

export function writeIdentity(projectId: string, runId: string, agentId: string, parentAgentId: string | null = null) {
  return { contractVersion: '2.0.0', projectId, runId, agentId, parentAgentId,
    clientEventId: randomUUID(), occurredAt: new Date().toISOString() }
}
