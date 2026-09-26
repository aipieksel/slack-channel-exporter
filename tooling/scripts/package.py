from pathlib import Path
import zipfile, json, hashlib
import struct
root=Path(__file__).resolve().parents[2]/'extension'
runtime=['manifest.json','panel.html','panel.css','panel.js','src/background.js','src/core.js','src/zip.js','src/adapter.js','src/panel-shell.js','src/content.js','src/download-attachments.js']
runtime += [f'icons/icon-{size}.png' for size in [16,32,48,128]]
runtime += [f'icons/icon-{theme}-{size}.png' for theme in ['light','dark'] for size in [16,32,48,128]]
license_bytes=(root.parent/'LICENSE').read_bytes()
package_entries=runtime+['LICENSE']
version=json.loads((root/'manifest.json').read_text())['version']
out=root.parent/'dist';out.mkdir(exist_ok=True)
target=out/f'slack-channel-exporter-{version}.zip'
modified_at=(2020,1,1,0,0,0)
with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as z:
 for name in package_entries:
  info=zipfile.ZipInfo(name,modified_at);info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,license_bytes if name=='LICENSE' else (root/name).read_bytes())
with zipfile.ZipFile(target) as z:
 assert z.testzip() is None
 assert len(z.namelist())==len(set(z.namelist()))==len(package_entries)
 assert set(z.namelist())==set(package_entries)
 assert all(not Path(n).is_absolute() and '..' not in Path(n).parts and not any(p.startswith('.') for p in Path(n).parts) for n in z.namelist())
 assert json.loads(z.read('manifest.json'))['version']==version
 for size in [16,32,48,128]:
  for name in [f'icons/icon-{size}.png',f'icons/icon-light-{size}.png',f'icons/icon-dark-{size}.png']:
   data=z.read(name)
   assert data[:8]==b'\x89PNG\r\n\x1a\n' and struct.unpack('>II',data[16:24])==(size,size)
 assert target.stat().st_size < 2*1024**3
 for name in runtime: assert z.read(name)==(root/name).read_bytes()
 assert z.read('LICENSE')==license_bytes
print(target.name,hashlib.sha256(target.read_bytes()).hexdigest())
