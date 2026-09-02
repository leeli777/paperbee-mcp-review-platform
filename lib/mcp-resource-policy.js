export const MAX_MCP_RESOURCE_BYTES = 8 * 1024 * 1024;

export function canReadMcpResource(sizeBytes) {
  return Number.isInteger(sizeBytes) && sizeBytes >= 0 && sizeBytes <= MAX_MCP_RESOURCE_BYTES;
}
