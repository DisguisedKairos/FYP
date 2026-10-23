"""Container token-file contract without starting or publishing containers."""
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from deploy.fraud import token


class DeliveryTokenTests(unittest.TestCase):
    def test_valid_token_file_is_read_without_database_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / "service_token"
            filename.write_text("a" * 64 + "\n", encoding="utf-8")
            with patch.dict(os.environ, {"SERVICE_TOKEN_FILE": str(filename)}, clear=True):
                self.assertEqual(token(), "a" * 64)

    def test_malformed_and_oversized_tokens_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / "service_token"
            for value in ("", "not-a-token", "A" * 64, "a" * 129):
                filename.write_text(value, encoding="utf-8")
                with patch.dict(os.environ, {"SERVICE_TOKEN_FILE": str(filename)}, clear=True):
                    with self.assertRaises(ValueError):
                        token()

    def test_missing_token_never_uses_an_environment_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {"SERVICE_TOKEN_FILE": str(Path(directory) / "absent"), "SERVICE_TOKEN": "a" * 64}, clear=True):
                with self.assertRaises(ValueError):
                    token()
