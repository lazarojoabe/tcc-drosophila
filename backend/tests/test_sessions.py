from __future__ import annotations

import tempfile
import unittest
import io
import zipfile
from pathlib import Path

import cv2
import numpy as np

from backend.app.models.schemas import EditRequest, SegmentationConfig
from backend.app.services.session_manager import RevisionConflict, SessionManager


class SessionTests(unittest.TestCase):
    def test_batch_pairs_folder_files_and_reports_incomplete_items(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manager = SessionManager(Path(temporary))
            nucleus = np.zeros((64, 64), np.uint8)
            cv2.circle(nucleus, (32, 32), 15, 255, -1)
            protein = np.full((64, 64), 8, np.uint8)
            protein[nucleus > 0] = 100
            encode = lambda image: cv2.imencode(".png", image)[1].tobytes()
            batch = manager.create_batch(
                [
                    (encode(nucleus), "nucleos/experiment_A_z0_ch00.png"),
                    (encode(nucleus), "nucleos/only_nucleus_z0_ch00.png"),
                ],
                [(encode(protein), "proteinas/experiment_A_z0_ch02.png")],
                SegmentationConfig(min_nucleus_area=20, protein_channel=0),
            )
            self.assertEqual(len(batch.pairs), 2)
            self.assertEqual(sum(pair["status"] == "paired" for pair in batch.pairs), 1)
            self.assertEqual(
                sum(pair["status"] == "incomplete" for pair in batch.pairs), 1
            )
            manager.executor.shutdown(wait=True)
            manager.batch_executor.shutdown(wait=True)
            summary = manager.batch_result(batch.batch_id)["summary"]
            self.assertEqual(summary["images_processed"], 1)
            self.assertEqual(len(summary["protein_std_values"]), 1)
            for kind in ("protein", "nucleus", "standard-deviation"):
                self.assertTrue(
                    manager.batch_histogram(batch.batch_id, kind).startswith(b"\x89PNG")
                )
            self.assertIn(b"std_protein", manager.export_batch_csv(batch.batch_id))
            saved_batch = manager.save_batch(batch.batch_id, "Pesquisadora lote")
            self.assertEqual(saved_batch["completed"], 1)
            ready_session = next(
                pair["session_id"] for pair in batch.pairs if pair["status"] == "ready"
            )
            self.assertEqual(
                manager.audit_history(ready_session)[-1]["operation"], "manual_save"
            )
            with zipfile.ZipFile(io.BytesIO(manager.export_batch_package(batch.batch_id))) as archive:
                names = set(archive.namelist())
            self.assertIn("batch.json", names)
            self.assertIn("batch.csv", names)
            self.assertIn("histograms/protein.png", names)
            self.assertTrue(any(name.startswith("sessions/") for name in names))

    def test_event_cursor_can_start_at_end_and_receive_future_event(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manager = SessionManager(Path(temporary))
            manager.events["session"] = [{"event": "job", "data": {"status": "queued"}}]
            cursor, events = manager.events_after("session", 10**9)
            self.assertEqual(cursor, 1)
            self.assertEqual(events, [])
            manager.events["session"].append(
                {"event": "job", "data": {"status": "completed"}}
            )
            cursor, events = manager.events_after("session", cursor)
            self.assertEqual(cursor, 2)
            self.assertEqual(events[0]["data"]["status"], "completed")

    def test_filesystem_audit_restores_completed_session(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            manager = SessionManager(directory)
            nucleus = np.zeros((64, 64), np.uint8)
            cv2.circle(nucleus, (32, 32), 15, 255, -1)
            protein = np.full((64, 64), 5, np.uint8)
            protein[nucleus > 0] = 100
            encode = lambda image: cv2.imencode(".png", image)[1].tobytes()
            state = manager.create_session(
                encode(nucleus),
                "nucleus.png",
                encode(protein),
                "protein.png",
                SegmentationConfig(min_nucleus_area=20, protein_channel=0),
            )
            manager.executor.shutdown(wait=True)
            manager.apply_edit(
                state.session_id,
                EditRequest(
                    operation="hide",
                    nucleus_ids=[1],
                    base_revision=0,
                    reviewer="Pesquisadora teste",
                ),
            )
            restored = SessionManager(directory)
            result = restored.result(state.session_id)
            self.assertEqual(result["revision"], 1)
            self.assertEqual(result["nuclei"][0]["state"], "hidden")
            history = restored.audit_history(state.session_id)
            self.assertEqual(history[-1]["reviewer"], "Pesquisadora teste")
            restored.save(state.session_id, "Pesquisadora teste")
            self.assertEqual(restored.audit_history(state.session_id)[-1]["operation"], "manual_save")
            self.assertTrue((directory / state.session_id / "analysis.npz").exists())
            package = restored.export_package(state.session_id)
            with zipfile.ZipFile(io.BytesIO(package)) as archive:
                names = set(archive.namelist())
            self.assertTrue(
                {
                    "README.txt",
                    "analysis.json",
                    "nuclei.csv",
                    "audit.jsonl",
                    "histograms/protein.png",
                    "histograms/nucleus.png",
                    "histograms/standard-deviation.png",
                    "images/nucleus.png",
                    "images/protein.png",
                    "images/mask.png",
                    "images/review-overlay.png",
                    "images/protein-review-overlay.png",
                    "images/review-mask.png",
                    "original/nucleus-nucleus.png",
                    "original/protein-protein.png",
                }.issubset(names)
            )
            restored.executor.shutdown(wait=True)
            restored.batch_executor.shutdown(wait=True)

    def test_exclude_restore_undo_and_conflict(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manager = SessionManager(Path(temporary))
            nucleus = np.zeros((64, 64), np.uint8)
            cv2.circle(nucleus, (32, 32), 15, 255, -1)
            protein = np.full((64, 64), 4, np.uint8)
            protein[nucleus > 0] = 100

            def encode(image):
                return cv2.imencode(".png", image)[1].tobytes()

            state = manager.create_session(
                encode(nucleus),
                "nucleus.png",
                encode(protein),
                "protein.png",
                SegmentationConfig(min_nucleus_area=20, protein_channel=0),
            )
            manager.executor.shutdown(wait=True)
            self.assertEqual(state.status, "ready")
            self.assertTrue(
                manager.protein_mean_histogram(state.session_id).startswith(b"\x89PNG")
            )
            for kind in ("protein", "nucleus", "standard-deviation"):
                self.assertTrue(
                    manager.session_histogram(state.session_id, kind).startswith(
                        b"\x89PNG"
                    )
                )
            original = manager.result(state.session_id)
            changed = manager.apply_edit(
                state.session_id,
                EditRequest(operation="exclude", nucleus_ids=[1], base_revision=0),
            )
            self.assertEqual(changed["aggregate"]["nucleus_count"], 0)
            restored = manager.apply_edit(
                state.session_id,
                EditRequest(operation="restore", nucleus_ids=[1], base_revision=1),
            )
            self.assertEqual(restored["aggregate"]["nucleus_count"], 1)
            undone = manager.undo(state.session_id, 2)
            self.assertEqual(undone["aggregate"]["nucleus_count"], 0)
            with self.assertRaises(RevisionConflict):
                manager.apply_edit(
                    state.session_id,
                    EditRequest(operation="restore", nucleus_ids=[1], base_revision=0),
                )
            self.assertEqual(original["aggregate"]["nucleus_count"], 1)


if __name__ == "__main__":
    unittest.main()
