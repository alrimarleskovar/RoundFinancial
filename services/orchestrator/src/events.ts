/**
 * Lifecycle events — backward-compat shim.
 *
 * Canonical types now live in @roundfi/sdk/events. This file re-exports
 * them so existing imports `from "./events.js"` (orchestrator-internal)
 * and `from "@roundfi/orchestrator"` (downstream consumers) keep working
 * unchanged. New code should import from @roundfi/sdk directly.
 */

export * from "@roundfi/sdk/events";
