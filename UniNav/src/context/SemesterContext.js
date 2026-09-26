import { createContext, useContext, useEffect, useState, useMemo } from 'react'
import { supabase } from '../services/supabase'

const SemesterContext = createContext({
  semester: null,
  loading: true,
  progress: null,
})

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

  // ------------------------------------------------------------
  // Derived semester progress
  //
  // Both endpoints are anchored at LOCAL MIDNIGHT so the day count
  // is a clean calendar diff and never drifts by 1 due to the time
  // of day or a DST transition.
  //
  // For 2026-08-17 → 2026-12-19 on 2026-09-26:
  //   total   = 124 days
  //   elapsed =  40 days
  //   left    =  84 days
  //   pct     ≈ 32.3%
  // ------------------------------------------------------------
  const progress = useMemo(() => {
    if (!semester?.start_date || !semester?.end_date) return null

    const start = new Date(semester.start_date + 'T00:00:00')
    const end = new Date(semester.end_date + 'T00:00:00')

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const MS_PER_DAY = 1000 * 60 * 60 * 24
    const totalMs = end - start
    const elapsedMs = today - start
    const remainingMs = end - today

    const daysTotal = Math.max(1, Math.round(totalMs / MS_PER_DAY))
    const daysLeft = Math.max(0, Math.round(remainingMs / MS_PER_DAY))
    const daysDone = Math.min(
      daysTotal,
      Math.max(0, Math.round(elapsedMs / MS_PER_DAY))
    )

    let pct = elapsedMs / totalMs
    if (pct < 0) pct = 0
    if (pct > 1) pct = 1

    let state = 'active'
    if (today < start) state = 'upcoming'
    else if (today > end) state = 'ended'

    return { pct, daysLeft, daysTotal, daysDone, state }
  }, [semester])

  return (
    <SemesterContext.Provider
      value={{ semester, loading, progress, refresh: load }}
    >
      {children}
    </SemesterContext.Provider>
  )
}

export const useSemester = () => useContext(SemesterContext)