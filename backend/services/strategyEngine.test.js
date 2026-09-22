import test from 'node:test'
import assert from 'node:assert/strict'
import { ema, rsi, scoreSetup } from './strategyEngine.js'
import { isCrudeMarketOpen, isNiftyMarketOpen } from './marketDataService.js'

const candles = (count, start, step, volume = 100) => Array.from({ length: count }, (_, index) => { const close = start + index * step; return { open: close - 1, high: close + 2, low: close - 2, close, volume } })

test('ema and rsi return values once enough candles exist', () => {
  assert.equal(ema([1, 2, 3], 5), null)
  assert.equal(ema([1, 2, 3, 4, 5], 3), 4)
  assert.ok(rsi(Array.from({ length: 20 }, (_, index) => index + 1)) > 99)
})

test('NIFTY is live only during the Indian market session', () => {
  assert.equal(isNiftyMarketOpen(new Date('2026-09-22T05:00:00.000Z')), true)
  assert.equal(isNiftyMarketOpen(new Date('2026-09-22T10:00:00.000Z')), false)
  assert.equal(isNiftyMarketOpen(new Date('2026-09-26T05:00:00.000Z')), false)
})

test('Crude uses its longer MCX session independently', () => {
  assert.equal(isCrudeMarketOpen(new Date('2026-09-22T16:00:00.000Z')), true)
  assert.equal(isCrudeMarketOpen(new Date('2026-09-22T18:00:00.000Z')), false)
})

test('strategy fails closed when required data is absent', () => {
  const result = scoreSetup({ candles5m: [], candles15m: [], vwap: null, optionConfirmation: null })
  assert.equal(result.valid, false)
  assert.equal(result.score, 0)
})

test('strategy only validates a multi-confirmation setup', () => {
  const candles5m = candles(60, 100, 1, 250)
  candles5m[59].close = 170; candles5m[59].high = 171
  const candles15m = candles(60, 100, 1, 250)
  const result = scoreSetup({ candles5m, candles15m, vwap: 120, optionConfirmation: { direction: 'CE', liquid: true } })
  assert.equal(result.direction, 'BUY')
  assert.equal(result.valid, true)
  assert.ok(result.score >= 8)
})
