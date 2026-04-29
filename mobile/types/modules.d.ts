// Ambient module stubs for runtime packages whose published @types/* lag
// the version we depend on, OR whose own type defs are not present in the
// installed node_modules tree on this machine. The runtime API surface we
// actually use from each module is stubbed here so editors and `tsc` stop
// flagging valid call sites — without taking on a hard dep on package
// internals that may shift across patch versions.

declare module '@react-native-community/netinfo' {
  // Minimal surface — we only call addEventListener + read isConnected /
  // isInternetReachable. The full module exposes more (fetch(), configure,
  // type-specific .details), but adding it here would over-constrain.
  export type NetInfoState = {
    isConnected: boolean | null;
    isInternetReachable: boolean | null;
    type: string;
    [key: string]: unknown;
  };
  export type NetInfoSubscription = () => void;
  export function addEventListener(
    listener: (state: NetInfoState) => void,
  ): NetInfoSubscription;
  export function fetch(): Promise<NetInfoState>;
  const NetInfo: {
    addEventListener: typeof addEventListener;
    fetch: typeof fetch;
  };
  export default NetInfo;
}

declare module 'expo-tracking-transparency' {
  // iOS App Tracking Transparency wrapper. We only call request + the
  // status enum on iOS; Android paths short-circuit before importing.
  export enum PermissionStatus {
    UNDETERMINED = 'undetermined',
    DENIED = 'denied',
    GRANTED = 'granted',
  }
  export type TrackingPermissionResponse = {
    status: PermissionStatus;
    granted: boolean;
    canAskAgain: boolean;
    expires: 'never' | number;
  };
  export function requestTrackingPermissionsAsync(): Promise<TrackingPermissionResponse>;
  export function getTrackingPermissionsAsync(): Promise<TrackingPermissionResponse>;
}
