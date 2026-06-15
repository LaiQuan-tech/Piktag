import { useEffect, useState } from 'react'
import { photoUrl } from '../lib/photo'
import { formatDisplay } from '../lib/code'

const EDGE_FN =
  'https://tekcfwmdtwyrshnmbwva.supabase.co/functions/v1/list-event-sessions'

interface Session {
  code: string
  taken_at: string
  photo_count: number
}

interface DayGroup {
  label: string
  sessions: Session[]
}

// Taiwan is UTC+8
function toTaiwanDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone: 'Asia/Taipei',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

function toTaiwanTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function groupByDay(sessions: Session[]): DayGroup[] {
  const map = new Map<string, Session[]>()
  for (const s of sessions) {
    const label = toTaiwanDate(s.taken_at)
    if (!map.has(label)) map.set(label, [])
    map.get(label)!.push(s)
  }
  return Array.from(map.entries()).map(([label, sessions]) => ({ label, sessions }))
}

export default function Timeline() {
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(EDGE_FN)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setSessions(j.sessions)
        else setError(j.error ?? 'Unknown error')
      })
      .catch((e) => setError(String(e)))
  }, [])

  if (error) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-8">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    )
  }

  if (sessions === null) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-sm text-neutral-400">Loading...</p>
      </div>
    )
  }

  const groups = groupByDay(sessions)

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <header className="pt-10 pb-6 px-6 text-center border-b border-neutral-100">
        <h1 className="text-lg font-medium">2026 Rotary International Convention</h1>
        <p className="text-sm text-neutral-500 mt-1">House of Friendship — All Photos</p>
        <p className="text-xs text-neutral-400 mt-3">{sessions.length} sessions</p>
      </header>

      <main className="max-w-2xl mx-auto px-3 pb-16">
        {groups.map((group) => (
          <section key={group.label}>
            <h2 className="text-xs font-semibold text-neutral-400 uppercase tracking-widest px-2 pt-8 pb-3">
              {group.label}
            </h2>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {group.sessions.map((s) => (
                <a
                  key={s.code}
                  href={`/${s.code}`}
                  className="block rounded-lg overflow-hidden bg-neutral-100 active:opacity-70 transition-opacity"
                >
                  <img
                    src={photoUrl(s.code, 1)}
                    alt={formatDisplay(s.code)}
                    loading="lazy"
                    className="w-full aspect-[2/3] object-cover block"
                  />
                  <div className="px-2 py-1.5">
                    <p className="text-[10px] font-mono text-neutral-500 truncate">
                      {formatDisplay(s.code)}
                    </p>
                    <p className="text-[10px] text-neutral-400">
                      {toTaiwanTime(s.taken_at)}
                    </p>
                  </div>
                </a>
              ))}
            </div>
          </section>
        ))}

        {sessions.length === 0 && (
          <p className="text-center text-sm text-neutral-400 mt-20">No photos yet.</p>
        )}
      </main>
    </div>
  )
}
