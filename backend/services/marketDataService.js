import { gunzipSync } from 'node:zlib'

const instrumentsUrl = 'https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz'

export function isNiftyMarketOpen(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  const weekday = values.weekday
  const minutes = Number(values.hour) * 60 + Number(values.minute)
  return !['Sat', 'Sun'].includes(weekday) && minutes >= 9 * 60 + 15 && minutes < 15 * 60 + 30
}

export function isCrudeMarketOpen(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  const minutes = Number(values.hour) * 60 + Number(values.minute)
  return !['Sat', 'Sun'].includes(values.weekday) && minutes >= 9 * 60 && minutes < 23 * 60 + 30
}

async function resolveCurrentCrudeInstrument() {
  const response = await fetch(instrumentsUrl)
  if (!response.ok) throw new Error(`Instrument catalogue request failed: ${response.status}`)
  const instruments = JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())).toString('utf8'))
  const now = Date.now()
  const contracts = instruments.filter(instrument => instrument.exchange === 'MCX' && instrument.segment === 'MCX_FO' && instrument.name === 'CRUDE OIL' && instrument.instrument_type === 'FUT' && instrument.trading_symbol?.startsWith('CRUDEOIL FUT') && Number(instrument.expiry) > now).sort((left, right) => Number(left.expiry) - Number(right.expiry))
  const contract = contracts[0]
  if (!contract) throw new Error('No current MCX Crude Oil futures contract found')
  console.log(JSON.stringify({ event: 'instrument_resolved', market: 'CRUDE', instrumentKey: contract.instrument_key, tradingSymbol: contract.trading_symbol }))
  return contract
}

export function createMarketDataService({ token, onUpdate }) {
  let timer
  let running = false
  let crudeInstrument
  return {
    async start() {
      if (!token) { console.warn(JSON.stringify({ event: 'market_data_disabled', reason: 'UPSTOX_ACCESS_TOKEN is missing' })); return }
      running = true
      console.log(JSON.stringify({ event: 'market_data_starting', source: 'Upstox' }))
      crudeInstrument = await resolveCurrentCrudeInstrument()
      await refresh()
      timer = setInterval(refresh, 5000)
    },
    stop() { running = false; if (timer) clearInterval(timer) }
  }
  async function refresh() {
    if (!running) return
    try {
      const now = new Date()
      const baseUrl = process.env.UPSTOX_API_BASE_URL || 'https://api.upstox.com/v2'
      const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }
      await updateQuote('NIFTY', 'NSE_INDEX|Nifty 50', isNiftyMarketOpen(now), baseUrl, headers)
      if (crudeInstrument) await updateQuote('CRUDE', crudeInstrument.instrument_key, isCrudeMarketOpen(now), baseUrl, headers)
    } catch (error) { console.error(JSON.stringify({ event: 'market_data_error', error: error.message })) }
  }

  async function updateQuote(market, instrumentKey, marketOpen, baseUrl, headers) {
    if (!marketOpen) { onUpdate(market, { available: false, statusReason: 'MARKET_CLOSED' }); return }
    const query = new URLSearchParams({ instrument_key: instrumentKey })
    const response = await fetch(`${baseUrl}/market-quote/quotes?${query}`, { headers })
    if (!response.ok) throw new Error(`Upstox quote request failed for ${market}: ${response.status}`)
    const quote = Object.values((await response.json()).data || {})[0]
    if (quote?.last_price == null) { onUpdate(market, { available: false, statusReason: 'DATA_UNAVAILABLE' }); return }
    const previousClose = quote.close_price ?? quote.prev_close
    const change = previousClose == null ? null : quote.last_price - previousClose
    onUpdate(market, { ltp: quote.last_price, open: quote.ohlc?.open, high: quote.ohlc?.high, low: quote.ohlc?.low, volume: quote.volume, previousClose, change, changePercent: previousClose ? (change / previousClose) * 100 : null, updatedAt: new Date().toISOString(), available: true, statusReason: null, instrumentKey })
  }
}

export { instrumentsUrl }
