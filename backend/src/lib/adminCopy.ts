type AdminUserCopy = {
  id: string;
  displayName?: string | null;
  email?: string | null;
};

type AdminStrategyCopy = {
  id: string;
  name: string;
  type: "algo" | "copy_trading" | string;
  symbol?: string | null;
};

export function escapeTelegramHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function formatAdminUserLine(user: AdminUserCopy): string {
  const name = clean(user.displayName) ?? clean(user.email) ?? user.id;
  const email = clean(user.email);
  return [
    `<b>${escapeTelegramHtml(name)}</b>`,
    email ? `(<code>${escapeTelegramHtml(email)}</code>)` : null,
    `· <code>${escapeTelegramHtml(user.id)}</code>`,
  ]
    .filter(Boolean)
    .join(" ");
}

export function formatAdminStrategyLine(strategy: AdminStrategyCopy): string {
  const symbol = clean(strategy.symbol);
  return [
    `<b>${escapeTelegramHtml(strategy.name)}</b>`,
    `· <code>${escapeTelegramHtml(strategy.type)}</code>`,
    symbol ? `· <code>${escapeTelegramHtml(symbol)}</code>` : null,
    `· <code>${escapeTelegramHtml(strategy.id)}</code>`,
  ]
    .filter(Boolean)
    .join(" ");
}

export function humanizeAuthProvider(provider: string | null | undefined): string {
  const p = clean(provider)?.toLowerCase() ?? "unknown";
  if (p === "google") return "Google";
  if (p === "telegram") return "Telegram";
  if (p === "legacy") return "Legacy API key";
  return p
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
