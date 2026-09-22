import test from 'node:test'
import assert from 'node:assert/strict'
import { ema, rsi, scoreSetup } from './strategyEngine.js'

const candles = (count, start, step, volume = 100) => Array.from({ length: count }, (_, index) => { const close = start + index * step; return { open: close - 1, high: close + 2, low: close - 2, close, volume } })

test('ema and rsi return values once enough candles exist', () => {
  assert.equal(ema([1, 2, 3], 5), null)
  assert.equal(ema([1, 2, 3, 4, 5], 3), 4)
  assert.ok(rsi(Array.from({ length: 20 }, (_, index) => index + 1)) > 99)
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
