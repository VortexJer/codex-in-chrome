"""Disposable fixtures under the checkout, with inherited Windows ACLs."""
from contextlib import contextmanager
from pathlib import Path
import shutil
import uuid

@contextmanager
def fixture_dir(prefix):
    root=Path(__file__).resolve().parent / '.fixtures'
    root.mkdir(parents=True,exist_ok=True)
    folder=root / (prefix+uuid.uuid4().hex)
    folder.mkdir()
    try:
        yield str(folder)
    finally:
        assert folder.resolve().parent == root.resolve()
        shutil.rmtree(folder)
