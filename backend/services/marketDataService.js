const instrumentsUrl = 'https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz'

export function createMarketDataService({ token, onUpdate }) {
  let timer
  let running = false
  return {
    async start() {
      if (!token) { console.warn(JSON.stringify({ event: 'market_data_disabled', reason: 'UPSTOX_ACCESS_TOKEN is missing' })); return }
      running = true
      console.log(JSON.stringify({ event: 'market_data_starting', source: 'Upstox' }))
      await refresh()
      timer = setInterval(refresh, 5000)
    },
    stop() { running = false; if (timer) clearInterval(timer) }
  }
  async function refresh() {
    if (!running) return
    try {
      // Instrument discovery and the authenticated quote request stay server-side.
      // WebSocket feed integration can replace this polling transport without changing the API contract.
      const response = await fetch(`${process.env.UPSTOX_API_BASE_URL || 'https://api.upstox.com/v2'}/market-quote/ltp?instrument_key=NSE_INDEX|Nifty%2050`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
      if (!response.ok) throw new Error(`Upstox quote request failed: ${response.status}`)
      const body = await response.json(); const quote = Object.values(body.data || {})[0]
      if (quote?.last_price != null) onUpdate('NIFTY', { ltp: quote.last_price, updatedAt: new Date().toISOString(), available: true })
    } catch (error) { console.error(JSON.stringify({ event: 'market_data_error', error: error.message })) }
  }
}

export { instrumentsUrl }
