import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, COLORS_DARK, type ColorPalette } from '../constants/theme';

type ThemeMode = 'light' | 'dark' | 'system';

type ThemeContextType = {
  colors: ColorPalette;
  isDark: boolean;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextType>({
  colors: COLORS,
  isDark: false,
  mode: 'system',
  setMode: () => {},
});

const STORAGE_KEY = 'piktag_theme_mode';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme(); // 'light' | 'dark' | null
  // Initial mode = 'system' (NOT 'light'). AsyncStorage.getItem is
  // async, so the first React render happens before the saved
  // preference loads. Defaulting to 'system' makes that first frame
  // follow the device colour scheme (useColorScheme is synchronous)
  // instead of always rendering light — which caused a white flash
  // on launch for dark-mode users. Once AsyncStorage resolves, the
  // user's actual preference takes over.
  const [mode, setModeState] = useState<ThemeMode>('system');

  // Load saved preference
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        setModeState(saved);
      }
    });
  }, []);

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode);
    AsyncStorage.setItem(STORAGE_KEY, newMode);
  }, []);

  const isDark = mode === 'system' ? systemScheme === 'dark' : mode === 'dark';
  const colors = isDark ? COLORS_DARK : COLORS;

  // Memoize the context value so consumers using useTheme() don't
  // re-render on every ThemeProvider render — only when one of the
  // four fields actually changes. setMode is stable via useCallback
  // above; colors flips object identity only on isDark change.
  const value = useMemo(
    () => ({ colors, isDark, mode, setMode }),
    [colors, isDark, mode, setMode]
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
