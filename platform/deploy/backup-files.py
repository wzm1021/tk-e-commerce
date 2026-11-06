#!/usr/bin/env python3
"""Verified local snapshot of immutable objects and encrypted credentials, never master keys."""
import argparse
import datetime
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import tarfile
import uuid

GIB = 1024 ** 3

def verify(archive):
    with tarfile.open(archive, 'r:gz') as tar:
        manifest = json.load(tar.extractfile('manifest.json'))
        members = tar.getmembers()
        if len(members) != len(manifest['files']) + 1:
            raise ValueError('backup_member_mismatch')
        for name, entry in manifest['files'].items():
            member = tar.getmember(name)
            if not member.isfile() or member.size != entry['size']:
                raise ValueError('backup_member_invalid')
            digest = hashlib.file_digest(tar.extractfile(member), 'sha256').hexdigest()
            if digest != entry['sha256']:
                raise ValueError('backup_hash_mismatch')
        return {'files': len(manifest['files']), 'started_at': manifest['started_at']}

def backup(source, destination, keep=3):
    os.umask(0o077)
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if source == destination or source in destination.parents:
        raise ValueError('backup_destination_inside_source')
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    started = datetime.datetime.now(datetime.timezone.utc)
    files = []
    for directory in ['objects', 'secrets']:
        base = source / directory
        if not base.exists():
            continue
        for p in base.rglob('*'):
            if p.is_symlink():
                raise ValueError('backup_symlink_forbidden')
            if p.is_file() and not p.name.endswith('.tmp'):
                name = p.relative_to(source).as_posix()
                if not re.fullmatch(r'(objects/[a-f0-9-]{36}/[a-f0-9]{64}|secrets/[a-f0-9-]{36})', name):
                    raise ValueError('backup_unrecognized_file')
                files.append((p, name, p.stat().st_size))
    size = sum(x[2] for x in files)
    if size > 2 * GIB or shutil.disk_usage(destination).free < size + 5 * GIB:
        raise ValueError('backup_capacity_limit')
    name = 'files-' + started.strftime('%Y%m%dT%H%M%S') + '-' + uuid.uuid4().hex[:8] + '.tar.gz'
    temporary = destination / (name + '.tmp')
    final = destination / name
    manifest = {'schema_version': 1, 'started_at': started.isoformat(), 'files': {},
                'database': 'RDS backup must be restored to this time or earlier; this archive contains no database or master key.'}
    try:
        with tarfile.open(temporary, 'w:gz', compresslevel=3) as tar:
            for p, relative, _ in files:
                with p.open('rb') as stream:
                    digest = hashlib.file_digest(stream, 'sha256').hexdigest()
                    stream.seek(0)
                    info = tar.gettarinfo(str(p), arcname=relative)
                    if not info.isfile():
                        raise ValueError('backup_file_changed')
                    info.uid = info.gid = 0
                    info.uname = info.gname = ''
                    info.mode = 0o600
                    manifest['files'][relative] = {'sha256': digest, 'size': info.size}
                    tar.addfile(info, stream)
            raw = json.dumps(manifest, ensure_ascii=False).encode()
            info = tarfile.TarInfo('manifest.json')
            info.size, info.mode = len(raw), 0o600
            tar.addfile(info, io.BytesIO(raw))
        result = verify(temporary)
        with temporary.open('rb') as stream:
            os.fsync(stream.fileno())
        os.replace(temporary, final)
        fd = os.open(destination, os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)
        for old in sorted(destination.glob('files-*.tar.gz'), reverse=True)[keep:]:
            old.unlink()
        return {**result, 'archive': final.name, 'bytes': final.stat().st_size}
    finally:
        temporary.unlink(missing_ok=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', default='/srv/tidelab/data')
    parser.add_argument('--destination', default='/srv/tidelab/backups')
    parser.add_argument('--verify')
    args = parser.parse_args()
    try:
        result = verify(args.verify) if args.verify else backup(args.source, args.destination)
        print(json.dumps({'ok': True, **result}))
    except Exception as error:
        print(json.dumps({'ok': False, 'error': type(error).__name__}))
        raise SystemExit(1)
