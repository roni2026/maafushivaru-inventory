import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

export function useSettings() {
  const [settings, setSettings] = useState({})
  const [loading,  setLoading]  = useState(true)

  const fetchSettings = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('settings').select('*')
    if (error) {
      toast.error('Failed to load settings')
    } else {
      const map = (data || []).reduce((acc, s) => {
        acc[s.key] = s.value
        return acc
      }, {})
      setSettings(map)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchSettings() }, [fetchSettings])

  const saveSetting = async (key, value) => {
    const { error } = await supabase
      .from('settings')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    if (error) throw error
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  const saveSettings = async (updates) => {
    const rows = Object.entries(updates).map(([key, value]) => ({
      key,
      value,
      updated_at: new Date().toISOString(),
    }))
    const { error } = await supabase
      .from('settings').upsert(rows, { onConflict: 'key' })
    if (error) throw error
    setSettings(prev => ({ ...prev, ...updates }))
  }

  return { settings, loading, saveSetting, saveSettings, refetch: fetchSettings }
}
