import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { createCallMonitor } from './services/callMonitorService.js'
import { createLiveSignalEngine, isNiftyOpen, isCrudeOpen } from './services/liveSignalEngine.js'

console.log(JSON.stringify({
  event: 'worker_initializing',
  service: 'signaldesk-background-worker',
  nodeVersion: process.version,
  pid: process.pid,
  timestamp: new Date().toISOString()
}))

const token = process.env.UPSTOX_ACCESS_TOKEN
const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!token) {
  console.error(JSON.stringify({
    event: 'worker_config_error',
    error: 'UPSTOX_ACCESS_TOKEN is missing. Background worker cannot fetch live quotes or generate signals.'
  }))
}

if (!supabaseUrl || !supabaseKey) {
  console.error(JSON.stringify({
    event: 'worker_config_error',
    error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing. Background worker cannot store signals.'
  }))
}

const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null
const callMonitorIntervalMs = Number(process.env.CALL_MONITOR_INTERVAL_MS || 5000)
const heartbeatIntervalMs = Number(process.env.HEARTBEAT_INTERVAL_MS || 60000)

let monitorTimer = null
let heartbeatTimer = null
let running = false

const signalEngine = createLiveSignalEngine({
  supabase,
  token,
  onSignal: signal => console.log(JSON.stringify({
    event: 'call_persisted',
    id: signal.id,
    market: signal.market,
    option_symbol: signal.option_symbol,
    signal: signal.signal,
    entry_price: signal.entry_price,
    underlying_entry_price: signal.underlying_entry_price,
    target_1: signal.target_1,
    target_2: signal.target_2,
    stop_loss: signal.stop_loss,
    strategy_score: signal.strategy_score,
    timestamp: new Date().toISOString()
  }))
})

const callMonitor = createCallMonitor({ supabase, token })

async function safeCallMonitor() {
  if (!running) return
  try {
    await callMonitor()
  } catch (error) {
    console.error(JSON.stringify({
      event: 'call_monitor_cycle_error',
      error: error?.message || String(error),
      timestamp: new Date().toISOString()
    }))
  }
}

function logHeartbeat() {
  const now = new Date()
  console.log(JSON.stringify({
    event: 'worker_heartbeat',
    status: 'HEALTHY',
    uptimeSeconds: Math.floor(process.uptime()),
    pid: process.pid,
    markets: {
      NIFTY_NSE: isNiftyOpen(now) ? 'OPEN' : 'CLOSED',
      CRUDE_MCX: isCrudeOpen(now) ? 'OPEN' : 'CLOSED'
    },
    timestamp: now.toISOString()
  }))
}

async function startWorker() {
  try {
    running = true
    console.log(JSON.stringify({
      event: 'worker_started',
      hasUpstoxToken: Boolean(token),
      hasSupabaseClient: Boolean(supabase),
      callMonitorIntervalMs,
      timestamp: new Date().toISOString()
    }))

    await signalEngine.start()
    monitorTimer = setInterval(safeCallMonitor, callMonitorIntervalMs)
    heartbeatTimer = setInterval(logHeartbeat, heartbeatIntervalMs)
    logHeartbeat()
  } catch (err) {
    console.error(JSON.stringify({
      event: 'worker_start_error',
      error: err?.message || String(err),
      timestamp: new Date().toISOString()
    }))
    // Wait 5 seconds and retry to ensure continuous operation
    setTimeout(startWorker, 5000)
  }
}

function shutdown(signal) {
  console.log(JSON.stringify({ event: 'worker_shutting_down', signal, timestamp: new Date().toISOString() }))
  running = false
  if (monitorTimer) clearInterval(monitorTimer)
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  signalEngine.stop()
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

process.on('uncaughtException', (error) => {
  console.error(JSON.stringify({
    event: 'worker_uncaught_exception',
    error: error?.message || String(error),
    stack: error?.stack,
    timestamp: new Date().toISOString()
  }))
  // Avoid sudden hard exit if possible, or restart worker loop
})

process.on('unhandledRejection', (reason) => {
  console.error(JSON.stringify({
    event: 'worker_unhandled_rejection',
    reason: reason?.message || String(reason),
    timestamp: new Date().toISOString()
  }))
})

startWorker()
