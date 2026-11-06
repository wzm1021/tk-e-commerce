#!/usr/bin/env python3
"""Remove superseded program releases only after explicit release acceptance."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import urllib.request


def command(*args):
    return subprocess.check_output(args, text=True, timeout=30).strip()


def candidates(root):
    releases = root / 'releases'
    current = (root / 'current').resolve(strict=True)
    if not (root / 'current').is_symlink() or current.parent != releases.resolve():
        raise RuntimeError('current_must_point_to_release')
    old = sorted(p for p in releases.iterdir()
                 if p != current and not p.is_symlink() and p.is_dir()
                 and re.fullmatch(r'\d{8}-[A-Za-z0-9_.-]+', p.name))
    return current, old


def assert_unreferenced(old, current, containers):
    needles = [str(p) + '/' for p in old]
    def check(text):
        if any(p in text + '/' for p in needles):
            raise RuntimeError('old_release_still_referenced')
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit() or int(proc.name) == os.getpid():
            continue
        try:
            check(str((proc / 'cwd').resolve()) + '/')
            check(str((proc / 'exe').resolve()) + '/')
            check((proc / 'maps').read_text())
            check((proc / 'cmdline').read_bytes().replace(b'\0', b' ').decode(errors='replace'))
        except (FileNotFoundError, ProcessLookupError):
            continue
    for base in [current, Path('/etc/systemd/system'), Path('/etc/cron.d')]:
        for parent, dirs, files in os.walk(base, followlinks=False):
            for name in dirs + files:
                p = Path(parent) / name
                if p.is_symlink():
                    check(str(p.resolve()) + '/')
                elif base != current and p.is_file():
                    check(p.read_text(errors='replace'))
    for container in containers:
        for mount in container.get('Mounts', []):
            check(mount.get('Source', '') + '/')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    root = Path('/opt/tidelab')
    with Path('/run/lock/tidelab-release-cleanup.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        current, old = candidates(root)
        if (root / 'release-accepted').read_text().strip() != current.name:
            raise RuntimeError('current_release_not_accepted')
        worker = Path('/etc/tidelab/worker.env').exists()
        unit = 'tidelab-worker' if worker else 'tidelab-app'
        if command('systemctl', 'is-active', unit) != 'active':
            raise RuntimeError('service_not_active')
        containers, images = [], []
        if worker:
            cfg = dict(line.split('=', 1) for line in Path('/etc/tidelab/worker.env').read_text().splitlines()
                       if '=' in line and not line.startswith('#'))
            image = cfg['AGENT_IMAGE']
            if not image.startswith('tidelab-agent:'):
                raise RuntimeError('unexpected_agent_image')
            current_image = json.loads(command('docker', 'image', 'inspect', image))[0]['Id']
            ids = command('docker', 'ps', '-aq').split()
            if ids:
                containers = json.loads(command('docker', 'inspect', *ids))
            used = {c['Image'] for c in containers} | {current_image}
            for line in command('docker', 'image', 'ls', '--no-trunc', '--format', '{{json .}}', 'tidelab-agent').splitlines():
                row = json.loads(line)
                if row['Tag'] != '<none>' and row['ID'] not in used:
                    images.append(row['Repository'] + ':' + row['Tag'])
        else:
            with urllib.request.urlopen('http://127.0.0.1:9080/healthz', timeout=10) as response:
                if not json.load(response).get('ok'):
                    raise RuntimeError('application_unhealthy')
        assert_unreferenced(old, current, containers)
        plan = {'current': current.name, 'old_releases': [p.name for p in old], 'old_image_tags': images}
        print(json.dumps({'plan': plan, 'apply': args.apply}), flush=True)
        if not args.apply:
            return
        before = shutil.disk_usage(root).free
        for p in old:
            if (root / 'current').resolve() != current:
                raise RuntimeError('release_changed_during_cleanup')
            shutil.rmtree(p)
        for image in images:
            # Never force removal of a container's image or touch volumes/build caches.
            command('docker', 'image', 'rm', image)
        result = {'current': current.name, 'removed_releases': len(old), 'removed_image_tags': len(images),
                  'available_bytes': shutil.disk_usage(root).free,
                  'reclaimed_bytes': shutil.disk_usage(root).free - before}
        (root / 'release-cleanup.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
