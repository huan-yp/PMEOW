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

const mobileNodeModules = path.resolve(__dirname, 'node_modules');

const singleInstancePackages = ['react', 'react-native'];

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
    resolveRequest: (context, moduleName, platform) => {
      const pkg = singleInstancePackages.find(
        (name) => moduleName === name || moduleName.startsWith(name + '/'),
      );
      if (pkg && !context.originModulePath.startsWith(mobileNodeModules + path.sep + pkg + path.sep)) {
        return context.resolveRequest(
          { ...context, nodeModulesPaths: [mobileNodeModules] },
          moduleName,
          platform,
        );
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
});
