import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { blockIfNoMasterAccess } from "@/lib/adminAuth";
import { db } from "@/lib/db";

type SummaryRow = {
  total_strategies: number;
  active_approved_strategies: number;
  active_subscribers: number;
  total_volume_usdt: string | null;
  recent_signals_24h: number;
  recent_mirror_errors_24h: number;
};

type StrategyRow = {
  id: string;
  name: string;
  type: "copy_trading" | "algo";
  symbol: string;
  status: "pending" | "approved" | "rejected";
  is_active: boolean;
  created_at: Date | string;
  active_subscribers: number;
  total_volume_usdt: string | null;
  total_signals: number;
  signals_24h: number;
  mirror_errors_24h: number;
  last_signal_at: Date | string | null;
  webhook_enabled: boolean | null;
  webhook_last_delivery_at: Date | string | null;
};

type ActivityRow = {
  signal_id: string;
  strategy_id: string;
  strategy_name: string;
  strategy_type: "copy_trading" | "algo";
  strategy_symbol: string;
  received_at: Date | string;
  idempotency_key: string;
  action: string | null;
  signal_symbol: string | null;
  side: string | null;
  trigger_type: string | null;
  processed: number;
  ok: number;
  errors: number;
};

type TelegramRow = {
  telegram_connected: boolean | null;
  telegram_notify_enabled: boolean | null;
  telegram_username: string | null;
};

function asIso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function rowsOf<T>(result: unknown): T[] {
  return (result as { rows?: T[] }).rows ?? [];
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const block = await blockIfNoMasterAccess(session.user);
  if (block) return block;

  const ownerId = session.user.id;

  const [summaryRes, strategiesRes, activityRes, telegramRes] = await Promise.all([
    db.execute(sql`
      select
        (select count(*)::int from strategies s where s.creator_id = ${ownerId}) as total_strategies,
        (
          select count(*)::int
          from strategies s
          where s.creator_id = ${ownerId}
            and s.status = 'approved'
            and s.is_active = true
        ) as active_approved_strategies,
        (
          select count(*)::int
          from subscriptions sub
          inner join strategies s on s.id = sub.strategy_id
          where s.creator_id = ${ownerId}
            and sub.is_active = true
        ) as active_subscribers,
        (
          select coalesce(sum(cast(tl.notional_usdt as numeric)), 0)::text
          from trade_logs tl
          inner join strategies s on s.id = tl.strategy_id
          where s.creator_id = ${ownerId}
            and tl.notional_usdt is not null
        ) as total_volume_usdt,
        (
          select count(*)::int
          from copy_signal_events cse
          inner join strategies s on s.id = cse.strategy_id
          where s.creator_id = ${ownerId}
            and cse.received_at > now() - interval '24 hours'
        ) as recent_signals_24h,
        (
          select count(*)::int
          from copy_mirror_attempts cma
          inner join copy_signal_events cse on cse.id = cma.signal_id
          inner join strategies s on s.id = cse.strategy_id
          where s.creator_id = ${ownerId}
            and cma.status = 'error'
            and cma.created_at > now() - interval '24 hours'
        ) as recent_mirror_errors_24h
    `),
    db.execute(sql`
      select
        s.id,
        s.name,
        s.type,
        s.symbol,
        s.status,
        s.is_active,
        s.created_at,
        (
          select count(*)::int
          from subscriptions sub
          where sub.strategy_id = s.id
            and sub.is_active = true
        ) as active_subscribers,
        (
          select coalesce(sum(cast(tl.notional_usdt as numeric)), 0)::text
          from trade_logs tl
          where tl.strategy_id = s.id
            and tl.notional_usdt is not null
        ) as total_volume_usdt,
        (
          select count(*)::int
          from copy_signal_events cse
          where cse.strategy_id = s.id
        ) as total_signals,
        (
          select count(*)::int
          from copy_signal_events cse
          where cse.strategy_id = s.id
            and cse.received_at > now() - interval '24 hours'
        ) as signals_24h,
        (
          select count(*)::int
          from copy_mirror_attempts cma
          inner join copy_signal_events cse on cse.id = cma.signal_id
          where cse.strategy_id = s.id
            and cma.status = 'error'
            and cma.created_at > now() - interval '24 hours'
        ) as mirror_errors_24h,
        (
          select max(cse.received_at)
          from copy_signal_events cse
          where cse.strategy_id = s.id
        ) as last_signal_at,
        cwc.enabled as webhook_enabled,
        cwc.last_delivery_at as webhook_last_delivery_at
      from strategies s
      left join copy_webhook_config cwc on cwc.strategy_id = s.id
      where s.creator_id = ${ownerId}
      order by s.created_at desc
    `),
    db.execute(sql`
      select
        cse.id as signal_id,
        cse.strategy_id,
        s.name as strategy_name,
        s.type as strategy_type,
        s.symbol as strategy_symbol,
        cse.received_at,
        cse.idempotency_key,
        (cse.payload_json::jsonb ->> 'action') as action,
        (cse.payload_json::jsonb ->> 'symbol') as signal_symbol,
        (cse.payload_json::jsonb ->> 'side') as side,
        (cse.payload_json::jsonb ->> 'trigger_type') as trigger_type,
        (
          select count(*)::int
          from copy_mirror_attempts cma
          where cma.signal_id = cse.id
        ) as processed,
        (
          select count(*)::int
          from copy_mirror_attempts cma
          where cma.signal_id = cse.id
            and cma.status = 'ok'
        ) as ok,
        (
          select count(*)::int
          from copy_mirror_attempts cma
          where cma.signal_id = cse.id
            and cma.status = 'error'
        ) as errors
      from copy_signal_events cse
      inner join strategies s on s.id = cse.strategy_id
      where s.creator_id = ${ownerId}
      order by cse.received_at desc
      limit 20
    `),
    db.execute(sql`
      select
        telegram_connected,
        telegram_notify_enabled,
        telegram_username
      from users
      where id = ${ownerId}
      limit 1
    `),
  ]);

  const summary = rowsOf<SummaryRow>(summaryRes)[0] ?? {
    total_strategies: 0,
    active_approved_strategies: 0,
    active_subscribers: 0,
    total_volume_usdt: "0",
    recent_signals_24h: 0,
    recent_mirror_errors_24h: 0,
  };
  const telegram = rowsOf<TelegramRow>(telegramRes)[0] ?? {
    telegram_connected: false,
    telegram_notify_enabled: false,
    telegram_username: null,
  };

  return NextResponse.json({
    summary: {
      totalStrategies: summary.total_strategies,
      activeApprovedStrategies: summary.active_approved_strategies,
      activeSubscribers: summary.active_subscribers,
      totalVolumeUsdt: summary.total_volume_usdt ?? "0",
      recentSignals24h: summary.recent_signals_24h,
      recentMirrorErrors24h: summary.recent_mirror_errors_24h,
    },
    strategies: rowsOf<StrategyRow>(strategiesRes).map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      symbol: r.symbol,
      status: r.status,
      isActive: r.is_active,
      createdAt: asIso(r.created_at),
      activeSubscribers: r.active_subscribers,
      totalVolumeUsdt: r.total_volume_usdt ?? "0",
      totalSignals: r.total_signals,
      signals24h: r.signals_24h,
      mirrorErrors24h: r.mirror_errors_24h,
      lastSignalAt: asIso(r.last_signal_at),
      webhookEnabled: r.webhook_enabled ?? false,
      webhookLastDeliveryAt: asIso(r.webhook_last_delivery_at),
    })),
    recentActivity: rowsOf<ActivityRow>(activityRes).map((r) => ({
      signalId: r.signal_id,
      strategyId: r.strategy_id,
      strategyName: r.strategy_name,
      strategyType: r.strategy_type,
      strategySymbol: r.strategy_symbol,
      receivedAt: asIso(r.received_at),
      idempotencyKey: r.idempotency_key,
      action: r.action,
      symbol: r.signal_symbol,
      side: r.side,
      triggerType: r.trigger_type,
      processed: r.processed,
      ok: r.ok,
      errors: r.errors,
    })),
    telegram: {
      connected: telegram.telegram_connected ?? false,
      notifyEnabled: telegram.telegram_notify_enabled ?? false,
      username: telegram.telegram_username,
    },
  });
}
