const terminalStatuses = new Set(['TARGET_2_HIT', 'STOP_LOSS_HIT', 'CLOSED', 'EXPIRED', 'INVALIDATED'])

export function createCallMonitor({ supabase }) {
  return async function monitor() {
    if (!supabase) return
    const { data: calls, error } = await supabase.from('trading_calls').select('*').eq('status', 'ACTIVE')
    if (error) { console.error(JSON.stringify({ event: 'call_monitor_error', error: error.message })); return }
    for (const call of calls || []) {
      const marketPrice = null
      if (marketPrice == null) continue
      let status = call.status; const patch = {}
      if (marketPrice >= call.target_2) { status = 'TARGET_2_HIT'; patch.target_2_at = new Date().toISOString(); patch.closed_at = patch.target_2_at }
      else if (marketPrice >= call.target_1) { status = 'TARGET_1_HIT'; patch.target_1_at = new Date().toISOString() }
      else if (marketPrice <= call.stop_loss) { status = 'STOP_LOSS_HIT'; patch.stop_loss_at = new Date().toISOString(); patch.closed_at = patch.stop_loss_at }
      if (status !== call.status && !terminalStatuses.has(call.status)) { const { error: updateError } = await supabase.from('trading_calls').update({ status, ...patch }).eq('id', call.id); if (updateError) console.error(JSON.stringify({ event: 'call_status_error', id: call.id, error: updateError.message })); else console.log(JSON.stringify({ event: 'call_status_updated', id: call.id, status })) }
    }
  }
}
