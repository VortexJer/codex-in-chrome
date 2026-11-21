"""Check the versioned release, author credits, English UI, and packaging boundaries."""
from pathlib import Path
import json
import subprocess

root=Path(__file__).resolve().parents[1]
def git(*args):
    return subprocess.check_output(['git','-C',str(root),*args],text=True)
files=git('ls-files').splitlines()
private_root=str(Path.home()).replace('\\','/')
required=['README.md','LICENSE','CHANGELOG.md','docs/VALIDATION.md','install.mjs','install.cmd','uninstall.cmd','install.ps1','uninstall.ps1','scripts/setup.mjs','skills/codex-in-chrome/SKILL.md','.github/workflows/test.yml','requirements-dev.txt']
assert all(name in files for name in required)
assert 'server/config.json' not in files
assert not any('/node_modules/' in f or f.startswith(('artifacts/','.goldentokens/','.unlazy/')) for f in files)
manifest=json.loads((root/'extension/manifest.json').read_text(encoding='utf8'))
package=json.loads((root/'server/package.json').read_text(encoding='utf8'))
assert manifest['name']=='Codex in Chrome' and manifest['version']==package['version']
for file in files:
    if file.endswith(('.py','.js','.mjs','.md','.html','.ps1','.cmd','.json','.yml')):
        text=(root/file).read_text(encoding='utf8')
        assert private_root not in text.replace('\\','/'), file
        assert ('BEGIN '+'PRIVATE KEY') not in text, file
        if file.endswith('.py'): compile(text,file,'exec')
ui='\n'.join((root/'extension'/name).read_text(encoding='utf8') for name in ['permissions.html','permissions.js','panel.js','access.js','background.js'])
old=['Guardar autorización','Detener y revocar','Qué puede hacer','Sin permisos concedidos','Pestañas controladas']
def english_check(text): return not any(phrase in text for phrase in old)
assert not english_check('prefix '+old[0]), 'positive control must detect untranslated UI'
assert english_check(ui)
assert '<html lang="en">' in ui
baseline='5b11d93b6d13304cffe47e12eecdacb558496827'
git('merge-base','--is-ancestor',baseline,'HEAD')
messages=git('log',baseline+'..HEAD','--format=%B%x00').split('\x00')
messages=[m for m in messages if m.strip()]
assert len(messages)>=1
assert all('Co-Authored-By: Codex <noreply@openai.com>' in m for m in messages)
authors=git('log',baseline+'..HEAD','--format=%an <%ae>').splitlines()
assert set(authors)=={'VortexJer <222700615+VortexJer@users.noreply.github.com>'}
print(f'Checked {len(files)} versioned files and {len(messages)} attributed commits.')
print('RELEASE VERIFIED')
