import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { createClient } from '@supabase/supabase-js'
import { createMarketDataService } from './services/marketDataService.js'
import { createCallMonitor } from './services/callMonitorService.js'

const app = express()
const port = Number(process.env.PORT || 3001)
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map(origin => origin.trim()).filter(Boolean)
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
const callMonitor = createCallMonitor({ supabase })

app.get('/api/health', (_req, res) => res.json({ ok: true, marketDataConfigured: hasUpstox, persistenceConfigured: Boolean(supabase) }))
app.get('/api/market', (_req, res) => res.json(marketState))
app.get('/api/market/:market', (req, res) => res.json(marketState[req.params.market.toUpperCase()] || null))

app.get('/api/calls', async (req, res) => {
  const market = String(req.query.market || 'NIFTY').toUpperCase()
  if (!supabase) return res.json([])
  const { data, error } = await supabase.from('trading_calls').select('*').eq('market', market).order('created_at', { ascending: false })
  if (error) return res.status(500).json({ error: 'Unable to load calls' })
  res.json(data)
})
app.get('/api/calls/active', async (_req, res) => {
  if (!supabase) return res.json([])
  const { data, error } = await supabase.from('trading_calls').select('*').eq('status', 'ACTIVE').order('created_at', { ascending: false })
  if (error) return res.status(500).json({ error: 'Unable to load active calls' })
  res.json(data)
})

const server = app.listen(port, async () => {
  console.log(JSON.stringify({ event: 'server_started', port, marketDataConfigured: hasUpstox, persistenceConfigured: Boolean(supabase) }))
  await marketDataService.start()
})
const monitorTimer = setInterval(callMonitor, 5000)
const shutdown = () => { clearInterval(monitorTimer); marketDataService.stop(); server.close(() => process.exit(0)) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
