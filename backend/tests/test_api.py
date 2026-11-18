from __future__ import annotations

import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np
from fastapi.testclient import TestClient

from backend.app import main
from backend.app.security import AccessControl
from backend.app.services.session_manager import SessionManager


class ApiTests(unittest.TestCase):
    def test_access_code_protects_api_when_enabled(self) -> None:
        with patch.object(main, "access_control", AccessControl("grupo-piloto", "segredo")):
            with TestClient(main.app) as client:
                protected = client.get("/api/sessions")
                self.assertEqual(protected.status_code, 401)
                login = client.post("/api/auth/login", json={"access_code": "grupo-piloto"})
                self.assertEqual(login.status_code, 200, login.text)
                token = login.json()["access_token"]
                allowed = client.get(
                    "/api/sessions", headers={"Authorization": f"Bearer {token}"}
                )
                self.assertEqual(allowed.status_code, 200)

    def test_upload_edit_and_path_sanitization(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manager = SessionManager(Path(temporary))
            nucleus = np.zeros((64, 64), np.uint8)
            cv2.circle(nucleus, (32, 32), 15, 255, -1)
            protein = np.full((64, 64), 8, np.uint8)
            protein[nucleus > 0] = 100
            encode = lambda image: cv2.imencode(".png", image)[1].tobytes()
            with patch.object(main, "manager", manager):
                with TestClient(main.app) as client:
                    response = client.post(
                        "/api/sessions",
                        data={
                            "config_json": json.dumps(
                                {"min_nucleus_area": 20, "protein_channel": 0}
                            ),
                            "reviewer": "Pesquisadora API",
                        },
                        files={
                            "nucleus_file": (
                                "../nucleus.png",
                                encode(nucleus),
                                "image/png",
                            ),
                            "protein_file": (
                                "protein.png",
                                encode(protein),
                                "image/png",
                            ),
                        },
                    )
                    self.assertEqual(response.status_code, 202, response.text)
                    session = response.json()
                    result = None
                    for _ in range(100):
                        result = client.get(
                            f"/api/sessions/{session['session_id']}/result"
                        ).json()
                        if result["status"] == "ready" and result["nuclei"]:
                            break
                        time.sleep(0.05)
                    self.assertIsNotNone(result)
                    self.assertEqual(result["status"], "ready")
                    self.assertTrue(result["nuclei"], result)
                    self.assertEqual(result["nuclei"][0]["state"], "active")
                    edited = client.post(
                        f"/api/sessions/{session['session_id']}/edits",
                        json={
                            "operation": "exclude",
                            "nucleus_ids": [1],
                            "base_revision": 0,
                        },
                    )
                    self.assertEqual(edited.status_code, 200, edited.text)
                    self.assertEqual(edited.json()["aggregate"]["nucleus_count"], 0)
                    sessions = client.get("/api/sessions")
                    self.assertEqual(sessions.status_code, 200, sessions.text)
                    self.assertEqual(sessions.json()[0]["session_id"], session["session_id"])
                    audit = client.get(f"/api/sessions/{session['session_id']}/history")
                    self.assertEqual(audit.status_code, 200, audit.text)
                    self.assertEqual(audit.json()[0]["reviewer"], "Pesquisadora API")
                    self.assertEqual(audit.json()[-1]["operation"], "exclude")
                    self.assertEqual(audit.json()[-1]["reviewer"], "Pesquisadora API")
                    conflict = client.post(
                        f"/api/sessions/{session['session_id']}/edits",
                        json={
                            "operation": "restore",
                            "nucleus_ids": [1],
                            "base_revision": 0,
                        },
                    )
                    self.assertEqual(conflict.status_code, 409)
                    multichannel = client.post(
                        "/api/sessions",
                        data={
                            "config_json": json.dumps(
                                {
                                    "min_nucleus_area": 20,
                                    "nucleus_channel": 0,
                                    "protein_channel": 0,
                                }
                            )
                        },
                        files={
                            "nucleus_file": (
                                "channels.png",
                                encode(protein),
                                "image/png",
                            )
                        },
                    )
                    self.assertEqual(multichannel.status_code, 202, multichannel.text)
            manager.executor.shutdown(wait=True)


if __name__ == "__main__":
    unittest.main()
