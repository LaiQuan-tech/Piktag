import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl = 'https://kbwfdskulxnhjckdvghj.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtid2Zkc2t1bHhuaGpja2R2Z2hqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzOTgwNTAsImV4cCI6MjA4Njk3NDA1MH0.q1wxMahfity_5An5I_PPSoxglJeKHXX6ohYeGvsaIC8';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
