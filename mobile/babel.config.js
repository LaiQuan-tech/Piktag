// Expo auto-infers babel config from `babel-preset-expo` by default, but we
// need a production-only plugin (`transform-remove-console`) that strips all
// console.log / console.warn / console.error calls from the release bundle.
// With no babel.config.js, Metro only sees the preset — this file is the
// explicit hook point Metro reads on startup to see the extra plugins.
//
// Dev builds keep all console.* so you can still debug in Expo Go / dev
// clients. The env check is evaluated once at Metro startup.
module.exports = function (api) {
  api.cache(true);

  const plugins = [];

  // In production, strip console.* calls (~10-20KB off the bundle plus tiny
  // runtime savings from not evaluating log arguments).
  if (process.env.NODE_ENV === 'production' || process.env.EAS_BUILD) {
    plugins.push('transform-remove-console');
  }

  return {
    presets: ['babel-preset-expo'],
    plugins,
  };
};
