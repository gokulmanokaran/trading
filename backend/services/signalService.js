export function createSignalService({ supabase }) {
  return {
    async insertIfNew(signal) {
      if (!supabase) return { created: false, reason: 'persistence_unconfigured' }
      const { data: existing, error: lookupError } = await supabase.from('trading_calls').select('id').eq('market', signal.market).eq('option_instrument_key', signal.option_instrument_key).eq('signal', signal.signal).eq('strategy_name', signal.strategy_name).eq('timeframe', signal.timeframe).eq('status', 'ACTIVE').limit(1)
      if (lookupError) throw lookupError
      if (existing?.length) return { created: false, reason: 'active_duplicate' }
      const { data, error } = await supabase.from('trading_calls').insert(signal).select().single()
      if (error) throw error
      console.log(JSON.stringify({ event: 'signal_generated', market: signal.market, score: signal.strategy_score, id: data.id }))
      return { created: true, data }
    }
  }
}
