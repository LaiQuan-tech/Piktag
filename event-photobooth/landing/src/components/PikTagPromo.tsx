// Subtle bottom-of-page promo. Hidden entirely when neither store URL is set.

const APP_STORE = import.meta.env.VITE_PIKTAG_APP_STORE ?? ''
const PLAY_STORE = import.meta.env.VITE_PIKTAG_PLAY_STORE ?? ''

export default function PikTagPromo() {
  if (!APP_STORE && !PLAY_STORE) return null

  return (
    <footer className="mt-4 pt-8 px-6 text-center border-t border-neutral-200">
      <p className="text-[11px] text-neutral-500 mb-4 tracking-wider">
        Powered by PikTag
      </p>
      <div className="flex gap-2 justify-center">
        {APP_STORE && (
          <a
            href={APP_STORE}
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 py-2 rounded-lg border border-neutral-200 text-xs text-neutral-700 active:bg-neutral-50"
          >
            App Store
          </a>
        )}
        {PLAY_STORE && (
          <a
            href={PLAY_STORE}
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 py-2 rounded-lg border border-neutral-200 text-xs text-neutral-700 active:bg-neutral-50"
          >
            Google Play
          </a>
        )}
      </div>
    </footer>
  )
}
