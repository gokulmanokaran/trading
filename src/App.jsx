import { useEffect, useState } from 'react'
import { Activity, ArrowUpRight, BarChart3, Clock3, Radio, ShieldCheck, WifiOff } from 'lucide-react'

const formatPrice = (value, currency = false) => value == null ? '--' : `${currency ? '₹' : ''}${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const formatTime = (value) => value ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).format(new Date(value)) : '--'
const formatDate = (value) => value ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value)) : '--'
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
const apiUrl = path => `${apiBaseUrl}${path}`

function MarketCard({ market, data }) {
  const available = data?.available
  const positive = Number(data?.change) >= 0
  return <article className="market-card">
    <div className="market-card__head"><div><span className="eyebrow">{market === 'NIFTY' ? 'National index' : 'MCX derivative'}</span><h2>{market === 'NIFTY' ? 'NIFTY 50' : 'Crude Oil'}</h2></div><span className={`status ${available ? 'status--live' : 'status--offline'}`}><span className="status-dot" />{available ? 'LIVE' : 'UNAVAILABLE'}</span></div>
    <div className="market-card__price">{formatPrice(data?.ltp, market === 'CRUDE')}</div>
    <div className={`market-card__change ${positive && available ? 'change--up' : ''}`}>{available ? `${positive ? '+' : ''}${formatPrice(data.change, market === 'CRUDE')} (${positive ? '+' : ''}${data.changePercent?.toFixed(2)}%)` : 'Waiting for server data'}</div>
    <div className="market-stats"><div><span>Open</span><strong>{formatPrice(data?.open, market === 'CRUDE')}</strong></div><div><span>High</span><strong>{formatPrice(data?.high, market === 'CRUDE')}</strong></div><div><span>Low</span><strong>{formatPrice(data?.low, market === 'CRUDE')}</strong></div></div>
    <div className="market-card__foot"><Clock3 size={14} /> Last update <strong>{available ? formatTime(data.updatedAt) : 'No successful update'}</strong></div>
  </article>
}

function CallCard({ call }) {
  return <article className="call-card"><div className="call-card__top"><div><span className="eyebrow">{call.market === 'NIFTY' ? 'NIFTY 50' : 'Crude Oil'}</span><h3><span className="signal-mark">{call.signal === 'BUY' ? '↗' : '↘'}</span>{call.signal} {call.option_symbol || 'Option pending'}</h3></div><span className={`pill pill--${call.status?.toLowerCase()}`}>{call.status}</span></div><div className="call-grid"><div><span>Underlying</span><strong>{formatPrice(call.underlying_entry_price, call.market === 'CRUDE')}</strong></div><div><span>Option entry</span><strong>{formatPrice(call.entry_price, true)}</strong></div><div><span>Target 1</span><strong>{formatPrice(call.target_1, true)}</strong></div><div><span>Target 2</span><strong>{formatPrice(call.target_2, true)}</strong></div><div><span>Stop loss</span><strong>{formatPrice(call.stop_loss, true)}</strong></div><div><span>Score</span><strong>{call.strategy_score == null ? '--' : `${call.strategy_score}/10`}</strong></div></div><div className="call-card__reason">{call.reason || 'Signal details will appear when the strategy engine generates a call.'}</div><div className="call-card__time">Created {formatDate(call.created_at)} at {formatTime(call.created_at)} IST</div></article>
}

function App() {
  const [page, setPage] = useState('home')
  const [market, setMarket] = useState('NIFTY')
  const [markets, setMarkets] = useState({})
  const [calls, setCalls] = useState([])
  const [serverOnline, setServerOnline] = useState(true)

  useEffect(() => { const load = async () => { try { const response = await fetch(apiUrl('/api/market')); setMarkets(await response.json()); setServerOnline(true) } catch { setServerOnline(false) } }; load(); const timer = setInterval(load, 5000); return () => clearInterval(timer) }, [])
  useEffect(() => { if (page !== 'calls') return; const load = async () => { try { const response = await fetch(apiUrl(`/api/calls?market=${market}`)); setCalls(await response.json()) } catch { setCalls([]) } }; load(); const timer = setInterval(load, 2000); return () => clearInterval(timer) }, [page, market])

  return <div className="app-shell"><header className="topbar"><div className="brand"><div className="brand-mark"><Activity size={18} /></div><span>signal<span className="brand-accent">desk</span></span></div><nav><button className={page === 'home' ? 'nav-link nav-link--active' : 'nav-link'} onClick={() => setPage('home')}>Home</button><button className={page === 'calls' ? 'nav-link nav-link--active' : 'nav-link'} onClick={() => setPage('calls')}>Calls</button></nav><div className="connection"><span className={`connection-dot ${serverOnline ? '' : 'connection-dot--off'}`} /> {serverOnline ? 'Server connected' : 'Server offline'}</div></header>
    <main>{page === 'home' ? <><section className="hero"><div><span className="eyebrow">Read-only market intelligence</span><h1>Stay close to the move.</h1><p>Live market context and disciplined signals for the instruments you follow.</p></div><div className="hero-note"><ShieldCheck size={18} /><span>No orders. No automation.<br /><b>Signals only.</b></span></div></section><section className="section-heading"><div><span className="eyebrow">Market live</span><h2>Watchlist</h2></div><span className="updated-label"><Radio size={14} /> Backend feed</span></section><div className="market-grid"><MarketCard market="NIFTY" data={markets.NIFTY} /><MarketCard market="CRUDE" data={markets.CRUDE} /></div><section className="empty-state"><BarChart3 size={20} /><div><strong>Signals appear here when the engine confirms a setup.</strong><span>Live prices are sourced server-side from Upstox. Configure credentials to activate the feed.</span></div><ArrowUpRight size={18} /></section></> : <><section className="hero hero--compact"><div><span className="eyebrow">Signal archive</span><h1>Calls, with context.</h1><p>Every signal keeps its server timestamp, setup score, and outcome.</p></div><div className="hero-note"><Clock3 size={18} /><span>All times shown in<br /><b>Asia/Kolkata</b></span></div></section><div className="tabs"><button className={market === 'NIFTY' ? 'tab tab--active' : 'tab'} onClick={() => setMarket('NIFTY')}>NIFTY 50</button><button className={market === 'CRUDE' ? 'tab tab--active' : 'tab'} onClick={() => setMarket('CRUDE')}>Crude Oil</button></div><section className="calls-section"><div className="section-heading"><div><span className="eyebrow">{calls.length ? 'Latest first' : 'No signals yet'}</span><h2>{calls.length ? 'Recent calls' : 'Waiting for confirmation'}</h2></div></div>{calls.length ? <div className="calls-list">{calls.map(call => <CallCard key={call.id} call={call} />)}</div> : <div className="empty-state empty-state--large"><WifiOff size={20} /><div><strong>No {market === 'NIFTY' ? 'NIFTY 50' : 'Crude Oil'} calls yet.</strong><span>Signals are created only when all configured confirmations and live data requirements pass.</span></div></div>}</section></>}</main><footer><span>Signal Desk v0.1</span><span>Data status is controlled by the backend.</span></footer></div>
}

export default App
