#!/usr/bin/env bash
set -euo pipefail
release_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
source_commit=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["commit"])' "$release_root/upstream.json")
update_url=${DSH_DESKTOP_LINUX_UPDATE_URL:-$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["updateURL"])' "$release_root/upstream.json")}
if [[ ! "$source_commit" =~ ^[a-f0-9]{40}$ ]]; then
  echo 'upstream.json must contain an exact reviewed source commit' >&2
  exit 1
fi
mkdir -p "$release_root/work" "$release_root/dist"
source_dir=$(mktemp -d "$release_root/work/source.XXXXXX")
git -C "$source_dir" init --quiet
git -C "$source_dir" remote add origin https://github.com/deepseek-ai/deepseek-harness.git
git -C "$source_dir" fetch --depth 1 origin "$source_commit"
git -C "$source_dir" checkout --detach FETCH_HEAD
git -C "$source_dir" apply --check "$release_root/patches/ubuntu-desktop.patch"
git -C "$source_dir" apply "$release_root/patches/ubuntu-desktop.patch"
cd "$source_dir"
corepack pnpm install --frozen-lockfile --store-dir "$release_root/work/pnpm-store"
DSH_GATE_CONCURRENCY=${DSH_GATE_CONCURRENCY:-2} \
DSH_DESKTOP_LINUX_UPDATE_URL="$update_url" \
corepack pnpm run package:linux:x64
corepack pnpm exec vitest run \
  apps/desktop/tests/desktop-build-paths.spec.ts \
  apps/desktop/tests/cli-launcher.spec.ts \
  apps/desktop/tests/linux-packaging.spec.ts \
  apps/desktop/tests/development-project.spec.ts \
  apps/desktop/tests/tray.spec.ts \
  apps/desktop/tests/installer-packaging.spec.ts \
  apps/desktop/tests/command-installation.spec.ts \
  apps/desktop/tests/command-management.spec.ts \
  apps/desktop/tests/update-coordinator.spec.ts \
  apps/desktop/tests/update-schedule.spec.ts --maxWorkers=2
artifact_dir="$source_dir/apps/desktop/.desktop-build/targets/linux-x64/unsigned-artifacts"
cp "$artifact_dir"/*.deb "$artifact_dir"/*-linux.yml "$release_root/dist/"
cp "$release_root/upstream.json" "$release_root/dist/upstream.json"
printf '%s\n' "$source_dir" > "$release_root/dist/source-directory.txt"
(cd "$release_root/dist" && sha256sum ./*.deb > SHA256SUMS)
python3 "$release_root/verify-release.py" "$release_root/dist"
echo "Verified release assets: $release_root/dist"
