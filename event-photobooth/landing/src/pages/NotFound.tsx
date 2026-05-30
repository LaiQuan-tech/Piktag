import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-white text-neutral-900 flex items-center justify-center px-8">
      <div className="text-center">
        <h1 className="text-xl font-light mb-3">Not Found</h1>
        <Link
          to="/"
          className="inline-block mt-6 text-sm text-neutral-700 underline underline-offset-4"
        >
          Home
        </Link>
      </div>
    </div>
  )
}
