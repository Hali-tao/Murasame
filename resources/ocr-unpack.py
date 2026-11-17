"""Unpack only verified wheels into an isolated embedded Python installation."""
import pathlib
import sys
import zipfile

root = pathlib.Path(sys.argv[1]).resolve()
target = root / "runtime" / "Lib" / "site-packages"
target.mkdir(parents=True, exist_ok=True)
for wheel in sorted((root / "downloads").glob("*.whl")):
    with zipfile.ZipFile(wheel) as archive:
        for item in archive.infolist():
            if item.is_dir():
                continue
            parts = pathlib.PurePosixPath(item.filename).parts
            if parts[0].endswith(".data"):
                if len(parts) < 3 or parts[1] not in ("purelib", "platlib"):
                    continue  # No command-line scripts or build headers are needed.
                parts = parts[2:]
            output = target.joinpath(*parts).resolve()
            if not output.is_relative_to(target):
                raise ValueError("Unsafe wheel path")
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(archive.read(item))
(root / "runtime" / "python311._pth").write_text(
    "python311.zip\n.\nLib/site-packages\nimport site\n", encoding="ascii")
