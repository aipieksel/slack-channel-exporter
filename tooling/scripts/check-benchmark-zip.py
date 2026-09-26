import hashlib
import json
from pathlib import Path
import re
import sys
import zipfile

base = Path(__file__).resolve().parents[3] / 'tooling' / 'evidence' / 'slack-benchmark' / '20260910'
expected = json.loads((base / 'expected.json').read_text())
with zipfile.ZipFile(sys.argv[1]) as archive:
    assert archive.testzip() is None
    names = archive.namelist()
    assert len(names) == len(set(names)) == 13, names
    assert 'General.md' in names and 'manifest.md' not in names
    transcript = archive.read('General.md').decode('utf-8')
    assert '[Open message]' not in transcript
    for item in expected['parents'] + expected['replies']:
        assert transcript.count(f"{expected['run']} {item['id']}/") == 1, item['id']
    for item in expected['files']:
        original = Path(item['name'])
        pattern = rf'media/{re.escape(original.stem)}-\d{{4}}{re.escape(original.suffix)}'
        matches = [name for name in names if re.fullmatch(pattern, name)]
        assert len(matches) == 1, (item['name'], matches)
        content = archive.read(matches[0])
        assert len(content) == item['bytes'], item['name']
        assert hashlib.sha256(content).hexdigest() == item['sha256'], item['name']
        assert matches[0] in transcript, (item['name'], 'missing transcript reference')
print('PASS actual ZIP: all 300 unique message markers, 12 byte-identical files, suffix numbering and transcript references')
