create extension if not exists pgcrypto;

create table if not exists public.trading_calls (
  id uuid primary key default gen_random_uuid(),
  market text not null check (market in ('NIFTY', 'CRUDE')),
  underlying text not null,
  underlying_instrument_key text,
  option_instrument_key text,
  option_symbol text,
  option_type text check (option_type in ('CE', 'PE')),
  strike numeric,
  expiry date,
  signal text not null check (signal in ('BUY')),
  entry_price numeric,
  underlying_entry_price numeric,
  stop_loss numeric,
  target_1 numeric,
  target_2 numeric,
  strategy_score integer check (strategy_score between 0 and 10),
  strategy_name text,
  timeframe text,
  reason text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'TARGET_1_HIT', 'TARGET_2_HIT', 'STOP_LOSS_HIT', 'EXPIRED', 'CLOSED', 'INVALIDATED')),
  created_at timestamptz not null default now(),
  entry_at timestamptz,
  target_1_at timestamptz,
  target_2_at timestamptz,
  stop_loss_at timestamptz,
  closed_at timestamptz
);

create index if not exists trading_calls_market_idx on public.trading_calls (market);
create index if not exists trading_calls_status_idx on public.trading_calls (status);
create index if not exists trading_calls_created_at_idx on public.trading_calls (created_at desc);
create index if not exists trading_calls_option_instrument_key_idx on public.trading_calls (option_instrument_key);

alter table public.trading_calls enable row level security;
create policy "public can read calls" on public.trading_calls for select using (true);
