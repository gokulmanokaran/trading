import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { createClient } from '@supabase/supabase-js'
import { createMarketDataService } from './services/marketDataService.js'
import { createCallMonitor } from './services/callMonitorService.js'
import { createLiveSignalEngine } from './services/liveSignalEngine.js'

const app = express()
const port = Number(process.env.PORT || 3001)
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean)

app.use(cors({ origin: allowedOrigins, methods: ['GET', 'OPTIONS'], credentials: false }))
app.use(express.json())

const hasUpstox = Boolean(process.env.UPSTOX_ACCESS_TOKEN)
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null

const marketState = { NIFTY: null, CRUDE: null }
const marketDataService = createMarketDataService({
  token: process.env.UPSTOX_ACCESS_TOKEN,
  onUpdate: (market, update) => { marketState[market] = { ...marketState[market], ...update } }
})

// Web Service API endpoints
app.get('/api/health', (_req, res) => res.json({
  ok: true,
  service: 'signaldesk-web-api',
  marketDataConfigured: hasUpstox,
  persistenceConfigured: Boolean(supabase),
  timestamp: new Date().toISOString()
}))

app.get('/api/market', (_req, res) => res.json(marketState))
app.get('/api/market/:market', (req, res) => res.json(marketState[req.params.market.toUpperCase()] || null))

// Signal Page API - queries persistent signals stored in Supabase by the background worker
app.get('/api/calls', async (req, res) => {
  const market = String(req.query.market || 'NIFTY').toUpperCase()
  if (!supabase) return res.json([])
  const { data, error } = await supabase
    .from('trading_calls')
    .select('*')
    .eq('market', market)
    .order('created_at', { ascending: false })

  if (error) {
    console.error(JSON.stringify({ event: 'api_calls_error', error: error.message }))
    return res.status(500).json({ error: 'Unable to load calls' })
  }
  res.json(data)
})

app.get('/api/calls/active', async (_req, res) => {
  if (!supabase) return res.json([])
  const { data, error } = await supabase
    .from('trading_calls')
    .select('*')
    .eq('status', 'ACTIVE')
    .order('created_at', { ascending: false })

  if (error) {
    console.error(JSON.stringify({ event: 'api_active_calls_error', error: error.message }))
    return res.status(500).json({ error: 'Unable to load active calls' })
  }
  res.json(data)
})

// In the separated architecture, background strategy evaluation and call monitoring
// run independently on Render Background Worker.
// RUN_EMBEDDED_WORKER=true can be used for single-container local environments if desired.
const runEmbeddedWorker = process.env.RUN_EMBEDDED_WORKER === 'true'
let signalEngine = null
let callMonitor = null
let monitorTimer = null

if (runEmbeddedWorker) {
  console.log(JSON.stringify({ event: 'embedded_worker_enabled', warning: 'Running strategy & monitor inside Web Service' }))
  callMonitor = createCallMonitor({ supabase, token: process.env.UPSTOX_ACCESS_TOKEN })
  signalEngine = createLiveSignalEngine({
    supabase,
    token: process.env.UPSTOX_ACCESS_TOKEN,
    onSignal: signal => console.log(JSON.stringify({ event: 'call_persisted', id: signal.id, market: signal.market }))
  })
}

const server = app.listen(port, async () => {
  console.log(JSON.stringify({
    event: 'server_started',
    role: 'web_service',
    port,
    marketDataConfigured: hasUpstox,
    persistenceConfigured: Boolean(supabase),
    runEmbeddedWorker
  }))
  await marketDataService.start()
  if (runEmbeddedWorker && signalEngine) {
    await signalEngine.start()
    monitorTimer = setInterval(callMonitor, 5000)
  }
})

const shutdown = () => {
  if (monitorTimer) clearInterval(monitorTimer)
  marketDataService.stop()
  if (signalEngine) signalEngine.stop()
  server.close(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
