// Shared configuration for all web API routes
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kbwfdskulxnhjckdvghj.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtid2Zkc2t1bHhuaGpja2R2Z2hqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzOTgwNTAsImV4cCI6MjA4Njk3NDA1MH0.q1wxMahfity_5An5I_PPSoxglJeKHXX6ohYeGvsaIC8';

const BRAND_COLOR = '#aa00ff';
const BRAND_ACCENT = '#8c52ff';
const BRAND_DARK = '#360066';
const BRAND_BG = '#faf5ff';
const BRAND_GRADIENT = 'linear-gradient(90deg, #ff5757 0%, #8c52ff 100%)';

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

module.exports = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  BRAND_COLOR,
  BRAND_ACCENT,
  BRAND_DARK,
  BRAND_BG,
  BRAND_GRADIENT,
  escapeHtml,
};
