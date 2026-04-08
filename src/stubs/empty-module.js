// Empty stub for native-only modules on web
module.exports = {};
module.exports.default = () => null;
module.exports.ScaleDecorator = ({ children }) => children;
module.exports.NestableScrollContainer = ({ children }) => children;
module.exports.preventScreenCaptureAsync = () => {};
module.exports.allowScreenCaptureAsync = () => {};
module.exports.CameraView = () => null;
module.exports.useCameraPermissions = () => [null, () => {}];
