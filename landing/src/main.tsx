import {StrictMode, useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter, Routes, Route, useLocation} from 'react-router-dom';
import App from './App.tsx';
import Contact from './pages/Contact.tsx';
import ResetPassword from './pages/ResetPassword.tsx';
import {initAnalytics, trackPageView} from './lib/analytics';
import './i18n';
import './index.css';

// Fire analytics SDK init *before* React renders so `$pageview` on the first
// route change has a fully-warm pipeline. SDKs no-op in dev / when env vars
// are missing.
initAnalytics();

/**
 * RouteTracker — listens to react-router location changes and fires a single
 * page view fan-out (PostHog / GA4 / Meta Pixel). Mounted inside BrowserRouter
 * so `useLocation()` works.
 */
function RouteTracker() {
  const location = useLocation();
  useEffect(() => {
    trackPageView(location.pathname + location.search);
  }, [location.pathname, location.search]);
  return null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <RouteTracker />
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/reset-password" element={<ResetPassword />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
