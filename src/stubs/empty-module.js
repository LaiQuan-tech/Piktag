'use strict';

// Empty stub for native-only modules on web
const noop = () => {};

exports.default = noop;
exports.preventScreenCaptureAsync = noop;
exports.allowScreenCaptureAsync = noop;
exports.CameraView = noop;
exports.useCameraPermissions = () => [null, noop];
exports.ScaleDecorator = ({ children }) => children;
exports.NestableScrollContainer = ({ children }) => children;
