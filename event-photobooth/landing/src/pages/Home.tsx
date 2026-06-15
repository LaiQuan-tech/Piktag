import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { isValid, normalize } from '../lib/code'
import PikTagPromo from '../components/PikTagPromo'

export default function Home() {
  const navigate = useNavigate()
  const [raw, setRaw] = useState('')
  const [error, setError] = useState(false)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const code = normalize(raw)
    if (!isValid(code)) {
      setError(true)
      return
    }
    navigate(`/${code}`)
  }

  return (
    <div className="min-h-screen bg-white text-neutral-900 flex flex-col">
      <main className="flex-1 flex items-center justify-center px-8 py-12">
        <div className="w-full max-w-xs">
          <h1 className="text-xl font-medium leading-snug tracking-wide text-center">
            2026 Rotary International<br />Convention in Taipei
          </h1>
          <p className="mt-2 text-sm text-neutral-500 tracking-wide text-center mb-10">
            House of Friendship
          </p>
          <p className="text-xs text-neutral-500 text-center mb-6">
            Enter the 8-character code from your receipt
          </p>

          <form onSubmit={submit} className="space-y-3">
            <input
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value)
                setError(false)
              }}
              placeholder="XXXX-XXXX"
              className="w-full px-6 py-4 rounded-lg bg-neutral-50 border border-neutral-200 font-mono tracking-[0.2em] text-center text-lg uppercase placeholder:text-neutral-300 focus:outline-none focus:border-neutral-400 focus:bg-white"
            />
            {error && (
              <p className="text-xs text-red-500 text-center">
                Invalid code
              </p>
            )}
            <button
              type="submit"
              className="w-full py-4 rounded-lg bg-neutral-900 text-white font-medium active:bg-neutral-700 transition-colors"
            >
              View Photos
            </button>
          </form>
        </div>
      </main>

      <PikTagPromo />
    </div>
  )
}
