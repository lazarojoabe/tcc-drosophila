from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

from backend.app.models.schemas import EditRequest, SegmentationConfig
from backend.app.services.session_manager import RevisionConflict, SessionManager


class SessionTests(unittest.TestCase):
    def test_batch_pairs_folder_files_and_reports_incomplete_items(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manager = SessionManager(Path(temporary))
            nucleus = np.zeros((64, 64), np.uint8); cv2.circle(nucleus, (32, 32), 15, 255, -1)
            protein = np.full((64, 64), 8, np.uint8); protein[nucleus > 0] = 100
            encode = lambda image: cv2.imencode(".png", image)[1].tobytes()
            batch = manager.create_batch(
                [(encode(nucleus), "experiment_A_z0_ch00.png"), (encode(nucleus), "only_nucleus_z0_ch00.png")],
                [(encode(protein), "experiment_A_z0_ch02.png")],
                SegmentationConfig(min_nucleus_area=20, protein_channel=0),
            )
            self.assertEqual(len(batch.pairs), 2)
            self.assertEqual(sum(pair["status"] == "paired" for pair in batch.pairs), 1)
            self.assertEqual(sum(pair["status"] == "incomplete" for pair in batch.pairs), 1)
            manager.executor.shutdown(wait=True)
            manager.batch_executor.shutdown(wait=True)
            summary = manager.batch_result(batch.batch_id)["summary"]
            self.assertEqual(summary["images_processed"], 1)
            self.assertEqual(len(summary["protein_std_values"]), 1)
            self.assertTrue(manager.batch_standard_deviation_histogram(batch.batch_id).startswith(b"\x89PNG"))
            self.assertIn(b"std_protein", manager.export_batch_csv(batch.batch_id))

    def test_event_cursor_can_start_at_end_and_receive_future_event(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manager = SessionManager(Path(temporary))
            manager.events["session"] = [{"event": "job", "data": {"status": "queued"}}]
            cursor, events = manager.events_after("session", 10**9)
            self.assertEqual(cursor, 1)
            self.assertEqual(events, [])
            manager.events["session"].append({"event": "job", "data": {"status": "completed"}})
            cursor, events = manager.events_after("session", cursor)
            self.assertEqual(cursor, 2)
            self.assertEqual(events[0]["data"]["status"], "completed")

    def test_exclude_restore_undo_and_conflict(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manager = SessionManager(Path(temporary))
            nucleus = np.zeros((64, 64), np.uint8); cv2.circle(nucleus, (32, 32), 15, 255, -1)
            protein = np.full((64, 64), 4, np.uint8); protein[nucleus > 0] = 100
            def encode(image):
                return cv2.imencode(".png", image)[1].tobytes()
            state = manager.create_session(encode(nucleus), "nucleus.png", encode(protein), "protein.png", SegmentationConfig(min_nucleus_area=20, protein_channel=0))
            manager.executor.shutdown(wait=True)
            self.assertEqual(state.status, "ready")
            self.assertTrue(manager.protein_mean_histogram(state.session_id).startswith(b"\x89PNG"))
            original = manager.result(state.session_id)
            changed = manager.apply_edit(state.session_id, EditRequest(operation="exclude", nucleus_ids=[1], base_revision=0))
            self.assertEqual(changed["aggregate"]["nucleus_count"], 0)
            restored = manager.apply_edit(state.session_id, EditRequest(operation="restore", nucleus_ids=[1], base_revision=1))
            self.assertEqual(restored["aggregate"]["nucleus_count"], 1)
            undone = manager.undo(state.session_id, 2)
            self.assertEqual(undone["aggregate"]["nucleus_count"], 0)
            with self.assertRaises(RevisionConflict):
                manager.apply_edit(state.session_id, EditRequest(operation="restore", nucleus_ids=[1], base_revision=0))
            self.assertEqual(original["aggregate"]["nucleus_count"], 1)


if __name__ == "__main__":
    unittest.main()
