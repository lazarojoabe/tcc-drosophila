from __future__ import annotations

import json
import os
from pathlib import Path
from threading import Lock
from typing import Any, Iterator

import numpy as np


class FilesystemRepository:
    """Armazena sessões auditáveis em arquivos autocontidos por análise."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = Lock()

    def session_dir(self, session_id: str) -> Path:
        return self.root / session_id

    def save_state(
        self,
        session_id: str,
        payload: dict[str, Any],
        labels: np.ndarray | None,
        mask: np.ndarray | None,
    ) -> None:
        directory = self.session_dir(session_id)
        directory.mkdir(parents=True, exist_ok=True)
        with self.lock:
            self._write_json(directory / "session.json", payload)
            if labels is not None:
                temp = directory / "analysis.tmp"
                with temp.open("wb") as handle:
                    np.savez_compressed(handle, labels=labels, mask=mask)
                os.replace(temp, directory / "analysis.npz")

    def save_revision(
        self,
        session_id: str,
        revision: int,
        payload: dict[str, Any],
        operation: str,
        created_at: str,
    ) -> None:
        directory = self.session_dir(session_id) / "revisions"
        directory.mkdir(parents=True, exist_ok=True)
        with self.lock:
            self._write_json(
                directory / f"revision-{revision:06d}.json",
                {
                    "revision": revision,
                    "operation": operation,
                    "created_at": created_at,
                    "result": payload,
                },
            )

    def append_audit(self, session_id: str, entry: dict[str, Any]) -> None:
        path = self.session_dir(session_id) / "audit.jsonl"
        with self.lock, path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
            handle.flush()
            os.fsync(handle.fileno())

    def history(self, session_id: str) -> list[dict[str, Any]]:
        path = self.session_dir(session_id) / "audit.jsonl"
        if not path.exists():
            return []
        entries: list[dict[str, Any]] = []
        with self.lock, path.open(encoding="utf-8") as handle:
            for line in handle:
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        return entries

    def states(self) -> Iterator[tuple[Path, dict[str, Any]]]:
        for directory in self.root.iterdir():
            path = directory / "session.json"
            if not directory.is_dir() or not path.exists():
                continue
            try:
                yield directory, json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue

    @staticmethod
    def _write_json(path: Path, payload: dict[str, Any]) -> None:
        temp = path.with_suffix(f"{path.suffix}.tmp")
        temp.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        os.replace(temp, path)
