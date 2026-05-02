const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROLLUP_NATIVE_PACKAGES = {
  "linux-x64": "@rollup/rollup-linux-x64-gnu",
};

const ESBUILD_NATIVE_PACKAGES = {
  "linux-x64": "@esbuild/linux-x64",
};

const NATIVE_DEPENDENCIES = [
  {
    packageName: ROLLUP_NATIVE_PACKAGES[`${process.platform}-${process.arch}`],
    sourcePackageName: "rollup",
  },
  {
    expectedFile: "bin/esbuild",
    packageName: ESBUILD_NATIVE_PACKAGES[`${process.platform}-${process.arch}`],
    sourcePackageName: "esbuild",
  },
].filter((dependency) => dependency.packageName);

function resolvePackage(name) {
  try {
    return require.resolve(name);
  } catch {
    return null;
  }
}

function packageExists(name, expectedFile) {
  const manifestPath = path.join(packageDirectory(name), "package.json");
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return fs.existsSync(path.join(packageDirectory(name), expectedFile ?? manifest.main ?? ""));
  } catch {
    return false;
  }
}

function packageVersion(name) {
  try {
    const lockfilePath = path.join(process.cwd(), "package-lock.json");
    const lockfile = JSON.parse(fs.readFileSync(lockfilePath, "utf8"));
    return lockfile.packages?.[`node_modules/${name}`]?.version ?? null;
  } catch {
    return null;
  }
}

function packageDirectory(name) {
  return path.join(process.cwd(), "node_modules", ...name.split("/"));
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
}

function windowsPathFromMntPath(posixPath) {
  const match = posixPath.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (!match) {
    return null;
  }

  return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, "\\")}`;
}

function mkdirp(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return;
  } catch (error) {
    const windowsPath = windowsPathFromMntPath(dir);
    if (!windowsPath) {
      throw error;
    }

    const result = spawnSync("cmd.exe", ["/c", "mkdir", windowsPath], {
      stdio: "ignore",
    });
    if (result.status !== 0 && !fs.existsSync(dir)) {
      throw error;
    }
  }
}

function copyDirectory(source, target) {
  mkdirp(target);

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
    } else if (entry.isSymbolicLink()) {
      fs.symlinkSync(fs.readlinkSync(sourcePath), targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function installPackageFromTarball(name, version) {
  const targetDir = packageDirectory(name);
  const targetParent = path.dirname(targetDir);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "native-deps-"));
  const extractDir = path.join(tempDir, "extract");

  try {
    mkdirp(targetParent);
    mkdirp(extractDir);

    const packResult = run("npm", ["pack", `${name}@${version}`, "--silent"], {
      cwd: tempDir,
      stdio: "pipe",
      encoding: "utf8",
    });

    if (packResult.status !== 0) {
      if (packResult.stderr) {
        process.stderr.write(packResult.stderr);
      }
      throw new Error(`npm pack failed for ${name}@${version}`);
    }

    const tarball = packResult.stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .at(-1);
    if (!tarball) {
      throw new Error(`npm pack did not return a tarball for ${name}@${version}`);
    }

    const tarballPath = path.join(tempDir, tarball);
    const tarResult = run("tar", ["-xzf", tarballPath, "-C", extractDir], {
      cwd: tempDir,
    });
    if (tarResult.status !== 0) {
      throw new Error(`failed to extract ${tarballPath}`);
    }

    const packageRoot = path.join(extractDir, "package");
    fs.rmSync(targetDir, { recursive: true, force: true });
    copyDirectory(packageRoot, targetDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

for (const { expectedFile, packageName, sourcePackageName } of NATIVE_DEPENDENCIES) {
  if (packageExists(packageName, expectedFile) || resolvePackage(packageName)) {
    continue;
  }

  const version = packageVersion(sourcePackageName);
  if (!version) {
    console.error(`[native-deps] ${sourcePackageName} is not present in package-lock.json; run npm install in frontend.`);
    process.exit(1);
  }

  console.warn(`[native-deps] Missing ${packageName}; repairing npm optional dependency install.`);
  try {
    installPackageFromTarball(packageName, version);
  } catch (error) {
    console.error(`[native-deps] Failed to install ${packageName}@${version}.`);
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  if (!packageExists(packageName, expectedFile)) {
    console.error(`[native-deps] Installed ${packageName}@${version}, but the native package files are still missing.`);
    process.exit(1);
  }
}
