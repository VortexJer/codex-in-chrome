"""Disposable fixtures under the checkout, with inherited Windows ACLs."""
from contextlib import contextmanager
from pathlib import Path
import shutil
import uuid

def tool_failed(result):
    """Accept the protocol field and older SDK snake_case convenience access."""
    if hasattr(result, 'isError'):
        return result.isError
    return result.is_error

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
