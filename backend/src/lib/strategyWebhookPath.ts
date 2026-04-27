/**
 * Canonical path for POSTing algo / copy-trading mirror signals.
 * Legacy `/api/webhooks/copy-trading/:id` remains supported.
 */
export function strategySignalWebhookPath(strategyId: string): string {
  return `/api/webhooks/strategy/${strategyId}`;
}
