// Empty stub for native-only modules on web
const noop = () => {};

export default noop;
export const preventScreenCaptureAsync = noop;
export const allowScreenCaptureAsync = noop;
export const CameraView = noop;
export const useCameraPermissions = () => [null, noop];
export const ScaleDecorator = ({ children }: any) => children;
export const NestableScrollContainer = ({ children }: any) => children;
