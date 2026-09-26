import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../services/supabase'

const SemesterContext = createContext({ semester: null, loading: true })

export const SemesterProvider = ({ children }) => {
  const [semester, setSemester] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    const { data } = await supabase
      .from('semesters')
      .select('id, code, name, start_date, end_date')
      .eq('is_active', true)
      .maybeSingle()
    setSemester(data || null)
    setLoading(false)
  }

  useEffect(() => {
    load()

    // Realtime: when the active semester changes, refetch
    const channel = supabase
      .channel('semester-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'semesters' },
        () => load()
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  return (
    <SemesterContext.Provider value={{ semester, loading, refresh: load }}>
      {children}
    </SemesterContext.Provider>
  )
}

export const useSemester = () => useContext(SemesterContext)