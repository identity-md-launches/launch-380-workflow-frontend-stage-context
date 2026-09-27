"""Rehearse packaging only in the explicitly disposable test/scratch checkout."""
from pathlib import Path
import subprocess, shutil, json, datetime
root = Path(__file__).resolve().parents[2]
fixture = root / 'test/scratch/package-check'
bundle = root / 'test/scratch/submission-check.bundle'
report_path = root / 'docs/evidence/packaging.json'
base = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
if not fixture.exists():
    subprocess.run(['git', 'clone', '--no-hardlinks', str(root), str(fixture)], check=True)
files = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'web', 'dist', 'docs'], cwd=root).decode().split('\0')
files = [f for f in files if f and f != 'docs/evidence/packaging.json']
for file in files:
    path = Path(file)
    assert path.parts[0] in ('web','dist','docs')
    assert 'node_modules' not in path.parts
    assert not any(part in ('.cache', '.git', '.npm', '.vite') for part in path.parts)
    assert not any(part.startswith('.') for part in path.parts) or file == 'web/.gitignore'
    assert path.suffix not in ('.tgz', '.zip')
    dest = fixture / file
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(root / file, dest)
subprocess.run(['git','add','--','web','dist','docs'],cwd=fixture,check=True)
changed=subprocess.check_output(['git','diff','--cached','--name-only'],cwd=fixture,text=True).splitlines()
assert changed and all(f.startswith(('web/','dist/','docs/')) for f in changed)
subprocess.run(['git','-c','user.name=Packaging check','-c','user.email=local@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','-m','Rehearse frontend submission packaging'],cwd=fixture,check=True,stdout=subprocess.DEVNULL)
subprocess.run(['git','bundle','create',str(bundle),'HEAD'],cwd=fixture,check=True)
subprocess.run(['git','bundle','verify',str(bundle)],cwd=fixture,check=True,stdout=subprocess.DEVNULL)
size=bundle.stat().st_size
assert size + 8192 < 8388608
report={'date':datetime.datetime.now(datetime.timezone.utc).isoformat(),'result':'pass','scope':'web/**, dist/**, docs/** plus explicit web/.gitignore','baseCommit':base,'changedFileCount':len(changed),'completeHistoryBundleBytes':size,'reservedBytesForThisReportAndGitOverhead':8192,'budgetBytes':8388608,'bundleIncludesOriginalHistory':True,'newSubmodules':False,'excluded':['node_modules','package-manager caches','scratch directories','this generated report'],'originalRepositoryCommit':'blocked: original .git metadata is read-only','note':'The scratch clone is a packaging fixture, not a publication or an original-repository commit.'}
assert not any(line.startswith('160000 ') for line in subprocess.check_output(['git','ls-files','--stage'],cwd=fixture,text=True).splitlines())
report_path.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
