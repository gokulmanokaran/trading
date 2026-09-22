const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null

export function ema(values, period) {
  if (values.length < period) return null
  const multiplier = 2 / (period + 1)
  let result = average(values.slice(0, period))
  for (const value of values.slice(period)) result = (value - result) * multiplier + result
  return result
}

export function rsi(values, period = 14) {
  if (values.length <= period) return null
  let gains = 0; let losses = 0
  for (let index = 1; index <= period; index += 1) { const delta = values[index] - values[index - 1]; if (delta >= 0) gains += delta; else losses -= delta }
  let averageGain = gains / period; let averageLoss = losses / period
  for (let index = period + 1; index < values.length; index += 1) { const delta = values[index] - values[index - 1]; averageGain = (averageGain * (period - 1) + Math.max(delta, 0)) / period; averageLoss = (averageLoss * (period - 1) + Math.max(-delta, 0)) / period }
  return averageLoss === 0 ? 100 : 100 - (100 / (1 + averageGain / averageLoss))
}

export function scoreSetup({ candles5m, candles15m, vwap, optionConfirmation }) {
  if (!candles5m?.length || !candles15m?.length || vwap == null || !optionConfirmation) return { valid: false, score: 0, direction: null, reasons: ['Required live candle or option data is unavailable.'] }
  const closes = candles5m.map(candle => candle.close)
  const latest = candles5m.at(-1)
  const prior = candles5m.slice(-6, -1)
  const resistance = Math.max(...prior.map(candle => candle.high))
  const support = Math.min(...prior.map(candle => candle.low))
  const fast = ema(closes, 20); const slow = ema(closes, 50); const momentum = rsi(closes)
  const higherFast = ema(candles15m.map(candle => candle.close), 20); const higherSlow = ema(candles15m.map(candle => candle.close), 50)
  if ([fast, slow, momentum, higherFast, higherSlow].some(value => value == null)) return { valid: false, score: 0, direction: null, reasons: ['Not enough candles for multi-timeframe confirmation.'] }
  const bullish = fast > slow && latest.close > vwap && higherFast > higherSlow && latest.close > resistance
  const bearish = fast < slow && latest.close < vwap && higherFast < higherSlow && latest.close < support
  const direction = bullish ? 'BUY' : bearish ? 'BUY' : null
  const optionDirection = bullish ? 'CE' : bearish ? 'PE' : null
  if (!direction) return { valid: false, score: 0, direction: null, reasons: ['Trend, VWAP, and breakout conditions are not aligned.'] }
  const reasons = []; let score = 0
  score += 2; reasons.push(`${bullish ? 'Bullish' : 'Bearish'} 5-minute breakout confirmation.`)
  score += 1; reasons.push(`Price is ${bullish ? 'above' : 'below'} VWAP.`)
  score += 1; reasons.push(`20 EMA is ${bullish ? 'above' : 'below'} 50 EMA.`)
  score += 2; reasons.push(`${bullish ? 'Resistance breakout' : 'Support breakdown'} confirmed.`)
  const recentVolume = average(prior.map(candle => candle.volume).filter(Boolean)); const volumeConfirmed = recentVolume && latest.volume > recentVolume
  if (volumeConfirmed) { score += 1; reasons.push('Relative volume confirmation is present.') }
  if ((bullish && momentum > 50) || (bearish && momentum < 50)) { score += 1; reasons.push(`RSI momentum confirms the ${bullish ? 'bullish' : 'bearish'} direction.`) }
  if (optionConfirmation.direction === optionDirection) { score += 1; reasons.push('Option-chain direction confirmation is positive.') }
  if (optionConfirmation.liquid) { score += 1; reasons.push('Option liquidity and volume confirmation is present.') }
  return { valid: score >= Number(process.env.SIGNAL_SCORE_THRESHOLD || 8), score, direction, optionType: optionDirection, reasons, latest, stopReference: bullish ? Math.min(...prior.map(candle => candle.low)) : Math.max(...prior.map(candle => candle.high)) }
}

export function levels({ entry, stopReference, direction, riskReward1 = 1, riskReward2 = 2 }) {
  const risk = Math.abs(entry - stopReference)
  return { stopLoss: stopReference, target1: direction === 'BUY' ? entry + risk * riskReward1 : entry - risk * riskReward1, target2: direction === 'BUY' ? entry + risk * riskReward2 : entry - risk * riskReward2 }
}
