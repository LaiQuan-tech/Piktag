import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { formatDisplay, isValid, normalize } from '../lib/code'
import { allPhotoUrls, PHOTO_COUNT } from '../lib/photo'
import PikTagPromo from '../components/PikTagPromo'

type ImageStatus = 'loading' | 'ok' | 'error'

export default function Gallery() {
  const { code: rawCode = '' } = useParams<{ code: string }>()
  const code = useMemo(() => normalize(rawCode), [rawCode])
  const valid = isValid(code)

  const urls = useMemo(() => (valid ? allPhotoUrls(code) : []), [code, valid])
  const [statuses, setStatuses] = useState<ImageStatus[]>(
    () => Array(PHOTO_COUNT).fill('loading'),
  )
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  useEffect(() => {
    setStatuses(Array(PHOTO_COUNT).fill('loading'))
  }, [code])

  if (!valid) {
    return <InvalidCode raw={rawCode} />
  }

  const errorCount = statuses.filter((s) => s === 'error').length
  const allErrored = errorCount === PHOTO_COUNT

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <header className="pt-10 pb-10 px-6 text-center">
        <img
          src="/logo.png"
          alt="Rotary Taipei 2026"
          className="h-12 w-auto mx-auto mb-7"
          loading="eager"
        />
        <h1 className="text-xl font-medium leading-snug tracking-wide">
          2026 Taipei Rotary<br />International Convention
        </h1>
        <p className="mt-2 text-sm text-neutral-500 tracking-wide">
          House of Friendship
        </p>
        <p className="mt-5 text-[11px] text-neutral-500 font-mono tracking-[0.3em]">
          {formatDisplay(code)}
        </p>
      </header>

      {allErrored ? (
        <NotReadyOrExpired />
      ) : (
        <>
          <p className="px-6 pb-6 text-center text-xs text-neutral-500">
            Long press any photo to save
          </p>

          <main className="flex flex-col gap-4 px-3 pb-14">
            {urls.map((url, i) => (
              <button
                key={url}
                type="button"
                onClick={() => statuses[i] === 'ok' && setLightboxUrl(url)}
                className="block w-full overflow-hidden rounded-lg bg-neutral-100 active:opacity-80 transition-opacity"
              >
                <img
                  src={url}
                  alt={`Photo ${i + 1}`}
                  loading="lazy"
                  className="w-full h-auto block"
                  onLoad={() => setStatuses((s) => updateAt(s, i, 'ok'))}
                  onError={() => setStatuses((s) => updateAt(s, i, 'error'))}
                />
                {statuses[i] === 'loading' && (
                  <div className="h-2 bg-gradient-to-r from-transparent via-neutral-300 to-transparent animate-pulse" />
                )}
              </button>
            ))}
          </main>
        </>
      )}

      <PikTagPromo />

      <p className="text-center pb-10 px-6 text-[10px] text-neutral-400">
        Photos auto-delete after 30 days
      </p>

      {lightboxUrl && <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </div>
  )
}

function updateAt<T>(arr: T[], i: number, v: T): T[] {
  const next = arr.slice()
  next[i] = v
  return next
}

function InvalidCode({ raw }: { raw: string }) {
  return (
    <div className="min-h-screen bg-white text-neutral-900 flex items-center justify-center px-8">
      <div className="text-center max-w-xs">
        <h1 className="text-xl font-light mb-3">Invalid code</h1>
        <p className="text-xs text-neutral-500">
          "{raw || '(empty)'}" is not a valid 8-character code.
        </p>
        <a
          href="/"
          className="inline-block mt-8 text-sm text-neutral-700 underline underline-offset-4"
        >
          Enter code
        </a>
      </div>
    </div>
  )
}

function NotReadyOrExpired() {
  return (
    <div className="mx-6 my-4 rounded-lg border border-neutral-200 bg-neutral-50 p-6 text-center">
      <p className="text-sm text-neutral-800 mb-2">Photos not ready</p>
      <p className="text-xs text-neutral-500 leading-relaxed">
        Just took the photo? Refresh in ~30 seconds.<br />
        Older than 30 days? Photos have been deleted.
      </p>
    </div>
  )
}

// Lightbox stays dark — photo viewers traditionally dim everything else.
function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm flex items-center justify-center px-2"
      onClick={onClose}
    >
      <img
        src={url}
        alt="Full size"
        className="max-w-full max-h-full object-contain"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        onClick={onClose}
        className="absolute top-5 right-5 w-10 h-10 rounded-full bg-white/10 backdrop-blur flex items-center justify-center text-white text-lg"
        aria-label="Close"
      >
        ✕
      </button>
      <p className="absolute bottom-6 left-1/2 -translate-x-1/2 text-[11px] text-white/60 px-4 text-center">
        Long press to save
      </p>
    </div>
  )
}
