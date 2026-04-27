import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

export function useNetInfo() {
  const [isConnected, setIsConnected] = useState<boolean>(true);
  useEffect(() => {
    const unsub = NetInfo.addEventListener((s) => setIsConnected(!!s.isConnected));
    return unsub;
  }, []);
  return { isConnected };
}
