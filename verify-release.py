#!/usr/bin/env python3
"""Check the generated Ubuntu update feed against the actual Debian package."""
import base64
import hashlib
import pathlib
import subprocess
import sys
import yaml

root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'dist').resolve()
feed = yaml.safe_load((root / 'stable-linux.yml').read_text())
files = feed.get('files', [])
if len(files) != 1:
    raise SystemExit('Expected exactly one Ubuntu update package')
entry = files[0]
name = entry.get('url', '')
if pathlib.Path(name).name != name or not name.endswith('.deb'):
    raise SystemExit('The update package must be a local .deb filename')
package = root / name
content = package.read_bytes()
sha512 = base64.b64encode(hashlib.sha512(content).digest()).decode()
if entry.get('sha512') != sha512 or feed.get('sha512') != sha512:
    raise SystemExit('Update SHA-512 does not match the package')
if entry.get('size') != len(content) or feed.get('path') != name:
    raise SystemExit('Update filename or size does not match the package')
fields = subprocess.check_output(['dpkg-deb', '-f', str(package), 'Package', 'Version', 'Architecture'], text=True)
expected = feed['version'].replace('-', '~', 1)
if f'Package: deepseek-harness\n' not in fields or f'Version: {expected}\n' not in fields or 'Architecture: amd64\n' not in fields:
    raise SystemExit('Debian package identity does not match the update feed')
sha256 = hashlib.sha256(content).hexdigest()
checksums = (root / 'SHA256SUMS').read_text().splitlines()
if not any(line.split() == [sha256, name] or line.split() == [sha256, './' + name] for line in checksums):
    raise SystemExit('SHA256SUMS does not match the package')
print(f'Ubuntu update package verified: {feed["version"]}, {len(content)} bytes')
