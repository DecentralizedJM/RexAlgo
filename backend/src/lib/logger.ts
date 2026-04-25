/**
 * Structured logging (Node runtime only — do not import from Edge middleware).
 */
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
});
