const path = require('path');
const exclusionList = require('metro-config/src/defaults/exclusionList');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const workspaceRoot = path.resolve(__dirname, '../..');
const defaultConfig = getDefaultConfig(__dirname);

function escapePathForRegex(filePath) {
  return filePath.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&').replaceAll('/', '[/\\\\]');
}

const androidNativeBuildDirs = [
  path.join(__dirname, 'android', 'app', '.cxx'),
  path.join(__dirname, 'android', 'app', 'build'),
  path.join(__dirname, 'android', 'build'),
];

module.exports = mergeConfig(defaultConfig, {
  watchFolders: [workspaceRoot],
  resolver: {
    blockList: exclusionList(
      androidNativeBuildDirs.map(
        (directoryPath) => new RegExp(`^${escapePathForRegex(directoryPath)}([/\\\\].*)?$`)
      )
    ),
    nodeModulesPaths: [
      path.resolve(workspaceRoot, 'node_modules'),
    ],
  },
});
