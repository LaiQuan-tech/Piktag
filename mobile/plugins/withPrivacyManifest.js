const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Config plugin that copies PrivacyInfo.xcprivacy into the iOS project root
 * during prebuild, satisfying Apple's Privacy Manifest requirement (May 2024+).
 */
const withPrivacyManifest = (config) => {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const src = path.join(__dirname, 'PrivacyInfo.xcprivacy');
      const projectName = cfg.modRequest.projectName;
      const dest = path.join(
        cfg.modRequest.platformProjectRoot,
        projectName,
        'PrivacyInfo.xcprivacy'
      );
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      return cfg;
    },
  ]);
};

module.exports = withPrivacyManifest;
