import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl = 'https://utlhlkhlzirfjmvcrerm.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0bGhsa2hsemlyZmptdmNyZXJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzAyNTgsImV4cCI6MjA4Njg0NjI1OH0.JNLC4ZE_T9KcogeVFrR0vnQuyll5XEGZiiCfMXOA8JM';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
