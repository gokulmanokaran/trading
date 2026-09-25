import { gunzipSync } from 'node:zlib'
import { levels, scoreSetup } from './strategyEngine.js'
import { createSignalService } from './signalService.js'

const instrumentsUrl = 'https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz'
const markets = {
  NIFTY: { underlyingKey: 'NSE_INDEX|Nifty 50', marketOpen: isNiftyOpen },
  CRUDE: { marketOpen: isCrudeOpen }
}

export function isNiftyOpen(date = new Date()) { return sessionOpen(date, 9 * 60 + 15, 15 * 60 + 30, ['Sat', 'Sun']) }
export function isCrudeOpen(date = new Date()) { return sessionOpen(date, 9 * 60, 23 * 60 + 30, ['Sat', 'Sun']) }
function sessionOpen(date, openMinutes, closeMinutes, closedDays) {
  const parts = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return !closedDays.includes(values.weekday) && Number(values.hour) * 60 + Number(values.minute) >= openMinutes && Number(values.hour) * 60 + Number(values.minute) < closeMinutes
}

export function createLiveSignalEngine({ token, supabase, onSignal = () => {} }) {
  const signalService = createSignalService({ supabase })
  let timer
  let running = false
  let instruments = []
  let lastRun = new Map()

  let instrumentsLoadedAt = 0
  async function ensureInstruments() {
    const TWELVE_HOURS = 12 * 60 * 60 * 1000
    if (!instruments.length || (Date.now() - instrumentsLoadedAt) > TWELVE_HOURS) {
      instruments = await loadInstruments()
      instrumentsLoadedAt = Date.now()
      console.log(JSON.stringify({ event: 'instruments_loaded', count: instruments.length }))
    }
    return instruments
  }

  return { start, stop }

  async function start() {
    if (!token || !supabase) { console.warn(JSON.stringify({ event: 'signal_engine_disabled', reason: !token ? 'UPSTOX_ACCESS_TOKEN is missing' : 'Supabase is not configured' })); return }
    try {
      await ensureInstruments()
    } catch (err) {
      console.error(JSON.stringify({ event: 'instruments_initial_load_error', error: err.message }))
    }
    running = true
    console.log(JSON.stringify({ event: 'signal_engine_started', markets: Object.keys(markets), interval: '5m' }))
    await runAll()
    timer = setInterval(runAll, 5000)
  }

  function stop() { running = false; if (timer) clearInterval(timer) }

  async function runAll() {
    if (!running) return
    try {
      await ensureInstruments()
    } catch (err) {
      console.error(JSON.stringify({ event: 'instruments_refresh_error', error: err.message }))
      return
    }
    for (const market of Object.keys(markets)) {
      try { await evaluateMarket(market) } catch (error) { console.error(JSON.stringify({ event: 'signal_engine_error', market, error: error.message })) }
    }
  }

  async function evaluateMarket(market) {
    const config = markets[market]
    if (!config.marketOpen()) return
    const underlying = config.underlyingKey || resolveCrudeFuture(instruments)?.instrument_key
    if (!underlying) return
    const candles5m = await fetchCandles(underlying, 5)
    const candles15m = await fetchCandles(underlying, 15)
    const latest = candles5m.at(-1)
    if (!latest || Date.now() - new Date(latest.timestamp).getTime() > 10 * 60 * 1000) return
    const vwap = calculateVwap(candles5m)
    const optionChain = await fetchOptionChain(underlying, latest.close)
    const options = selectOptions(optionChain, latest.close)
    if (!options) return
    const preview = scoreSetup({ candles5m, candles15m, vwap, optionConfirmation: { direction: 'CE', liquid: true } })
    if (!preview.direction) return
    const option = options[preview.optionType]
    if (!option) return
    const optionConfirmation = { direction: preview.optionType, liquid: true, option }
    const setup = scoreSetup({ candles5m, candles15m, vwap, optionConfirmation })
    console.log(JSON.stringify({ event: 'strategy_calculated', market, score: setup.score, valid: setup.valid }))
    if (!setup.valid) return
    const optionLevels = levels({ entry: option.lastPrice, stopReference: option.lastPrice * 0.85, direction: setup.direction })
    const setupKey = `${market}:${option.instrumentKey}:${setup.optionType}:${Math.floor(new Date(latest.timestamp).getTime() / 300000)}`
    if (lastRun.get(market) === setupKey) return
    lastRun.set(market, setupKey)
    const result = await signalService.insertIfNew({
      market,
      underlying: market === 'NIFTY' ? 'NIFTY 50' : 'CRUDE OIL',
      underlying_instrument_key: underlying,
      option_instrument_key: option.instrumentKey,
      option_symbol: option.symbol,
      option_type: setup.optionType,
      strike: option.strike,
      expiry: option.expiry,
      signal: 'BUY',
      entry_price: option.lastPrice,
      underlying_entry_price: latest.close,
      stop_loss: optionLevels.stopLoss,
      target_1: optionLevels.target1,
      target_2: optionLevels.target2,
      strategy_score: setup.score,
      strategy_name: 'Multi-confirmation breakout',
      timeframe: '5m + 15m',
      reason: [...setup.reasons, `Selected ${option.symbol} using expiry, liquidity, volume, OI, and spread.`].join(' ')
    })
    if (result.created) onSignal(result.data)
  }

  async function loadInstruments() {
    const response = await fetch(instrumentsUrl)
    if (!response.ok) throw new Error(`Instrument catalogue request failed: ${response.status}`)
    return JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())).toString('utf8'))
  }

  async function fetchCandles(instrumentKey, interval) {
    const encodedKey = encodeURIComponent(instrumentKey)
    const response = await fetch(`${apiBase().replace(/\/v2\/?$/, '/v3')}/historical-candle/intraday/${encodedKey}/minutes/${interval}`, { headers: authHeaders() })
    if (!response.ok) throw new Error(`Candle request failed: ${response.status}`)
    const body = await response.json()
    return (body.data?.candles || []).reverse().map(([timestamp, open, high, low, close, volume, openInterest]) => ({ timestamp, open, high, low, close, volume, openInterest }))
  }

  async function fetchOptionChain(underlyingKey, spot) {
    const optionItems = instruments.filter(item => ['CE', 'PE'].includes(item.instrument_type) && item.underlying_key === underlyingKey && Number(item.expiry) > Date.now()).sort((left, right) => Number(left.expiry) - Number(right.expiry))
    const expiryTimestamp = optionItems[0]?.expiry
    if (!expiryTimestamp) return []
    const expiry = new Date(Number(expiryTimestamp)).toISOString().slice(0, 10)
    const response = await fetch(`${apiBase()}/option/chain?${new URLSearchParams({ instrument_key: underlyingKey, expiry_date: expiry })}`, { headers: authHeaders() })
    if (!response.ok) throw new Error(`Option-chain request failed: ${response.status}`)
    const body = await response.json()
    if (body.data?.length) return body.data
    if (!optionItems.length) return []
    const nearby = optionItems.filter(item => Math.abs(Number(item.strike_price) - spot) <= (underlyingKey.startsWith('MCX_') ? 500 : 1000)).slice(0, 24)
    const quoteResponse = await fetch(`${apiBase()}/market-quote/quotes?${new URLSearchParams({ instrument_key: nearby.map(item => item.instrument_key).join(',') })}`, { headers: authHeaders() })
    if (!quoteResponse.ok) throw new Error(`Option quote request failed: ${quoteResponse.status}`)
    const quotes = (await quoteResponse.json()).data || {}
    return nearby.map(item => {
      const quote = quotes[item.instrument_key] || quotes[item.trading_symbol] || {}
      const option = { instrument_key: item.instrument_key, trading_symbol: item.trading_symbol, market_data: quote }
      return { expiry, strike_price: item.strike_price, call_options: item.instrument_type === 'CE' ? option : undefined, put_options: item.instrument_type === 'PE' ? option : undefined }
    })
  }

  function selectOptions(chain, spot) {
    const entries = chain.flatMap(row => {
      const expiry = row.expiry || row.expiry_date
      const strike = Number(row.strike_price ?? row.strike)
      return [{ ...normaliseOption(row.call_options || row.call_option || row.ce, 'CE'), expiry, strike }, { ...normaliseOption(row.put_options || row.put_option || row.pe, 'PE'), expiry, strike }]
    }).filter(option => option.instrumentKey && option.lastPrice > 0 && option.strike > 0)
    if (!entries.length) return null
    const expiry = entries.map(option => option.expiry).filter(Boolean).sort()[0]
    const current = entries.filter(option => option.expiry === expiry)
    const liquid = current.filter(option => option.volume > 0 && option.oi > 0 && option.spread >= 0 && option.spread <= option.lastPrice * 0.08)
    if (!liquid.length) return null
    liquid.sort((left, right) => Math.abs(left.strike - spot) - Math.abs(right.strike - spot))
    return { CE: liquid.find(option => option.optionType === 'CE'), PE: liquid.find(option => option.optionType === 'PE') }
  }

  function normaliseOption(option, type) {
    if (!option) return {}
    const marketData = option.market_data || option
    return { instrumentKey: option.instrument_key || option.instrumentKey, symbol: option.trading_symbol || option.symbol, lastPrice: Number(marketData.ltp ?? marketData.last_price ?? 0), volume: Number(marketData.volume ?? 0), oi: Number(marketData.oi ?? marketData.open_interest ?? 0), spread: Math.abs(Number(marketData.ask_price ?? 0) - Number(marketData.bid_price ?? 0)), optionType: type }
  }

  function resolveCrudeFuture(items) { return items.filter(item => item.exchange === 'MCX' && item.segment === 'MCX_FO' && item.name === 'CRUDE OIL' && item.instrument_type === 'FUT' && item.trading_symbol?.startsWith('CRUDEOIL FUT') && Number(item.expiry) > Date.now()).sort((a, b) => Number(a.expiry) - Number(b.expiry))[0] }
  function calculateVwap(candles) { const usable = candles.filter(candle => candle.volume > 0); const volume = usable.reduce((sum, candle) => sum + candle.volume, 0); return volume ? usable.reduce((sum, candle) => sum + ((candle.high + candle.low + candle.close) / 3) * candle.volume, 0) / volume : null }
  function apiBase() { return process.env.UPSTOX_API_BASE_URL || 'https://api.upstox.com/v2' }
  function authHeaders() { return { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
}
