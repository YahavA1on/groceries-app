import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

export function useRealtimeRefresh(channelName, tables, onChange) {
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!channelName || tables.length === 0) return undefined

    const channel = supabase.channel(channelName)
    for (const table of tables) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => onChangeRef.current?.()
      )
    }

    channel.subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [channelName, tables])
}
