from __future__ import annotations

import unittest

from backend.app.security import AccessControl


class AccessControlTests(unittest.TestCase):
    def test_issues_and_validates_a_signed_token(self) -> None:
        control = AccessControl("equipe-teste", "segredo-de-teste")
        token = control.issue_token("equipe-teste")
        self.assertTrue(control.valid_token(token))
        self.assertFalse(control.valid_token(token + "alterado"))
        with self.assertRaises(PermissionError):
            control.issue_token("incorreto")

    def test_local_development_without_code_remains_open(self) -> None:
        control = AccessControl("", "")
        self.assertTrue(control.valid_token(None))


if __name__ == "__main__":
    unittest.main()
