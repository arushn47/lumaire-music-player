"""Official engine wheel updates; bundled packages remain the offline fallback."""
import hashlib
import json
import os
import re
import sys
import time
import urllib.request
import zipfile
from pathlib import Path
from urllib.parse import urlparse


def fetch(url, limit):
    if urlparse(url).scheme != 'https' or urlparse(url).hostname not in ('pypi.org', 'files.pythonhosted.org', 'api.github.com'):
        raise ValueError('Unsupported engine update source.')
    with urllib.request.urlopen(url, timeout=5) as response:
        if urlparse(response.url).scheme != 'https' or urlparse(response.url).hostname not in ('pypi.org', 'files.pythonhosted.org', 'api.github.com'):
            raise ValueError('Unsupported engine update redirect.')
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError('Engine update exceeds size limit.')
    return data


def wheel_asset(metadata, project):
    requirement = metadata['info'].get('requires_python') or ''
    minimum = re.fullmatch(r'>=3\.(\d+)', requirement)
    if not minimum or sys.version_info[:2] < (3, int(minimum[1])):
        raise ValueError('Engine update requires an unsupported Python version.')
    prefix = project.replace('-', '_') + '-'
    for asset in metadata['urls']:
        name = asset['filename']
        digest = asset.get('digests', {}).get('sha256', '')
        if (not asset.get('yanked') and name.startswith(prefix) and name.endswith('-py3-none-any.whl')
                and re.fullmatch(r'[A-Za-z0-9_.-]+', name) and re.fullmatch(r'[a-f0-9]{64}', digest)
                and 0 < asset['size'] <= 8_000_000):
            return name, asset['url'], digest
    raise ValueError('No compatible engine wheel.')


def valid_set(folder):
    try:
        entries = json.loads((folder / 'verified.json').read_text())
        if not isinstance(entries, dict) or len(entries) != 2:
            return False
        for name, digest in entries.items():
            if not re.fullmatch(r'yt_dlp(?:_ejs)?-[A-Za-z0-9_.-]+-py3-none-any\.whl', name):
                return False
            if (folder / name).stat().st_size > 8_000_000:
                return False
            data = (folder / name).read_bytes()
            if len(data) > 8_000_000 or hashlib.sha256(data).hexdigest() != digest:
                return False
        return True
    except (OSError, ValueError, TypeError):
        return False


def select(wheels):
    root = Path(wheels) / 'updates'
    try:
        root.mkdir(exist_ok=True)
    except OSError:
        return wheels
    marker = root / 'checked'
    try:
        name = (root / 'active.json').read_text()
        active = root / name if re.fullmatch(r'candidate-[A-Za-z0-9_-]+', name) else root / 'missing'
    except OSError:
        active = root / 'missing'
    fallback = str(active) if valid_set(active) else wheels
    staged = None
    try:
        if marker.exists() and 0 <= time.time() - marker.stat().st_mtime < 86400:
            return fallback
        marker.touch()
        release = json.loads(fetch('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', 1_000_000))
        version = release.get('tag_name', '')
        if release.get('draft') or release.get('prerelease') or not re.fullmatch(r'20\d{2}\.\d{2}\.\d{2}', version):
            raise ValueError('Unsupported engine release.')
        metadata = json.loads(fetch('https://pypi.org/pypi/yt-dlp/' + version + '/json', 1_000_000))
        requirements = metadata['info'].get('requires_dist') or []
        solver = next((re.match(r'yt-dlp-ejs==([0-9.]+)(?:;|$)', item) for item in requirements if item.startswith('yt-dlp-ejs==')), None)
        if not solver:
            raise ValueError('Engine solver compatibility is unknown.')
        ejs = json.loads(fetch('https://pypi.org/pypi/yt-dlp-ejs/' + solver[1] + '/json', 1_000_000))
        assets = [wheel_asset(metadata, 'yt-dlp'), wheel_asset(ejs, 'yt-dlp-ejs')]
        expected = {name: digest for name, _, digest in assets}
        if valid_set(active) and json.loads((active / 'verified.json').read_text()) == expected:
            return str(active)
        # A new process owns each request, so the old wheels are never replaced while imported.
        import tempfile
        staged = Path(tempfile.mkdtemp(prefix='candidate-', dir=root))
        for name, url, digest in assets:
            data = fetch(url, 8_000_000)
            if hashlib.sha256(data).hexdigest() != digest:
                raise ValueError('Engine checksum mismatch.')
            (staged / name).write_bytes(data)
            with zipfile.ZipFile(staged / name) as archive:
                if len(archive.infolist()) > 10000 or sum(entry.file_size for entry in archive.infolist()) > 64_000_000 or archive.testzip():
                    raise ValueError('Invalid engine wheel.')
        (staged / 'verified.json').write_text(json.dumps(expected))
        return str(staged)
    except Exception:
        if staged is not None:
            import shutil
            shutil.rmtree(staged, ignore_errors=True)
        return fallback


def activate(folder, wheels):
    candidate = Path(folder)
    root = Path(wheels) / 'updates'
    if candidate.parent != root or not candidate.name.startswith('candidate-'):
        return
    pointer = root / 'active.json'
    previous = pointer.read_text() if pointer.exists() else ''
    if previous == candidate.name:
        return
    pending = root / 'active.tmp'
    pending.write_text(candidate.name)
    os.replace(pending, pointer)
    # Retain one previous set; interrupted candidates must not accumulate forever.
    import shutil
    for old in root.glob('candidate-*'):
        if old.name not in (candidate.name, previous) and old.is_dir():
            shutil.rmtree(old, ignore_errors=True)
