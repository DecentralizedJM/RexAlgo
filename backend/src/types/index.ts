export interface MudrexWalletBalance {
  total: string;
  withdrawable: string;
  invested: string;
  rewards: string;
  currency: string;
}

export interface MudrexFuturesBalance {
  balance: string;
  locked_amount: string;
  unrealized_pnl: string;
  first_time_user: boolean;
}

export interface MudrexAsset {
  asset_id: string;
  symbol: string;
  base_currency: string;
  quote_currency: string;
  min_quantity: string;
  max_quantity: string;
  quantity_step: string;
  min_leverage: string;
  max_leverage: string;
  maker_fee: string;
  taker_fee: string;
  is_active: boolean;
  price_step?: string;
  price?: string;
  name?: string;
  trading_fee_perc?: string;
  min_contract?: string;
  max_contract?: string;
}

export interface MudrexOrder {
  order_id: string;
  asset_id: string;
  symbol: string;
  order_type: "LONG" | "SHORT";
  trigger_type: "MARKET" | "LIMIT";
  status: string;
  quantity: string;
  filled_quantity: string;
  price: string;
  leverage: string;
  created_at?: string;
  stoploss_price?: string;
  takeprofit_price?: string;
}

export interface MudrexPosition {
  position_id: string;
  asset_id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  quantity: string;
  entry_price: string;
  mark_price: string;
  leverage: string;
  margin: string;
  unrealized_pnl: string;
  realized_pnl: string;
  liquidation_price?: string;
  stoploss_price?: string;
  takeprofit_price?: string;
  status: string;
  /** History rows may include timestamps (field names vary by Mudrex version). */
  closed_at?: string;
  updated_at?: string;
  created_at?: string;
  stoploss?: { price: string; order_id: string };
  takeprofit?: { price: string; order_id: string };
}

export interface MudrexLeverage {
  asset_id: string;
  symbol: string;
  leverage: string;
  margin_type: string;
}

export interface CreateOrderParams {
  symbol: string;
  side: "LONG" | "SHORT";
  quantity: string;
  leverage: string;
  triggerType: "MARKET" | "LIMIT";
  price?: string;
  stoplosPrice?: string;
  takeprofitPrice?: string;
  reduceOnly?: boolean;
}

export interface Strategy {
  id: string;
  creatorId: string;
  creatorName: string;
  name: string;
  description: string;
  type: "copy_trading" | "algo";
  symbol: string;
  side: "LONG" | "SHORT" | "BOTH";
  leverage: string;
  stoplossPct: number | null;
  takeprofitPct: number | null;
  riskLevel: "low" | "medium" | "high";
  timeframe: string | null;
  isActive: boolean;
  totalPnl: number;
  winRate: number;
  totalTrades: number;
  subscriberCount: number;
  createdAt: Date;
}

export interface Subscription {
  id: string;
  userId: string;
  strategyId: string;
  marginPerTrade: string;
  isActive: boolean;
  createdAt: Date;
}

export interface AuthUser {
  id: string;
  displayName: string;
  email: string | null;
}
