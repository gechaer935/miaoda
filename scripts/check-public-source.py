#!/usr/bin/env python3
"""Inspect the Git index before publishing; never print credential contents.

This supplements a dedicated secret scanner such as Gitleaks. It does not
claim to identify every form of private information or replace asset review.
"""
from pathlib import Path, PurePosixPath
import re
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def git(*args, input_data=None):
    return subprocess.check_output(['git', '-C', str(ROOT), *args], input=input_data)


def main():
    files = [p.decode('utf-8') for p in git('ls-files', '-z').split(b'\0') if p]
    if not files:
        raise SystemExit('No staged/tracked source files found. Stage the intended files first.')
    # Read all indexed blobs in one Git process, including binary assets.
    blobs = git('cat-file', '--batch', input_data=''.join(':' + name + '\n' for name in files).encode('utf-8'))
    cursor = 0
    issues = []
    forbidden_dirs = {'.codex', '.claude', '.codex-tmp', 'node_modules', 'dist', 'dist-electron', 'release', 'backups', 'marketing', 'tutorial-assets'}
    forbidden_suffixes = {'.pem', '.key', '.p12', '.pfx', '.sqlite', '.db', '.exe', '.msi', '.zip', '.7z', '.log'}
    for name in files:
        path = PurePosixPath(name)
        if set(path.parts) & forbidden_dirs or path.suffix.lower() in forbidden_suffixes:
            issues.append((name, 'private/generated file category'))
        if path.name.startswith('.env') and path.name != '.env.example':
            issues.append((name, 'real environment file'))
        header_end = blobs.index(b'\n', cursor)
        _, kind, size = blobs[cursor:header_end].split()
        if kind != b'blob':
            raise SystemExit('Unexpected non-file Git object: ' + name)
        size = int(size)
        data = blobs[header_end + 1:header_end + 1 + size]
        cursor = header_end + 2 + size
        if data.startswith(b'\x89PNG\r\n\x1a\n'):
            offset = 8
            while offset < len(data):
                length = struct.unpack('>I', data[offset:offset + 4])[0]
                kind = data[offset + 4:offset + 8]
                if kind in (b'tEXt', b'zTXt', b'iTXt', b'eXIf', b'tIME'):
                    issues.append((name, 'unreviewed image text/EXIF metadata'))
                offset += length + 12
        try:
            text = data.decode('utf-8-sig')
        except UnicodeError:
            continue
        if re.search(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----', text):
            issues.append((name, 'private key material'))
        if path.name == '.env.example':
            for n, line in enumerate(text.splitlines(), 1):
                if '=' not in line or line.lstrip().startswith('#'):
                    continue
                key, value = line.split('=', 1)
                if re.search(r'KEYS?$|SECRET$|TOKEN$|PASSWORD$', key.strip()) and value.strip():
                    issues.append((name + ':' + str(n), 'credential template must be empty'))
    for path, reason in issues:
        print(path + ': ' + reason)
    if issues:
        return 1
    print(f'PASS: {len(files)} indexed files; private file categories, key blocks, credential templates and image metadata checked.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
