from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import time


class AccessControl:
    """Portão de acesso temporário para a validação por pesquisadores.

    Quando ``NUCLEI_ACCESS_CODE`` não está definido, a autenticação permanece
    desligada para desenvolvimento local. Em produção, o código é trocado por
    um token assinado e de curta duração; o código original nunca é enviado nas
    requisições de análise.
    """

    def __init__(self, access_code: str | None = None, secret: str | None = None) -> None:
        self.access_code = access_code if access_code is not None else os.getenv("NUCLEI_ACCESS_CODE", "")
        self.secret = secret if secret is not None else os.getenv("NUCLEI_AUTH_SECRET", "")
        self.ttl_seconds = int(os.getenv("NUCLEI_AUTH_TTL_SECONDS", "43200"))

    @property
    def enabled(self) -> bool:
        return bool(self.access_code)

    def issue_token(self, access_code: str) -> str:
        if not self.enabled:
            return ""
        if not self.secret:
            raise RuntimeError("NUCLEI_AUTH_SECRET deve ser definido quando NUCLEI_ACCESS_CODE estiver ativo")
        if not hmac.compare_digest(access_code, self.access_code):
            raise PermissionError("Código de acesso inválido")
        expires_at = int(time.time()) + self.ttl_seconds
        payload = f"{expires_at}:{secrets.token_urlsafe(16)}".encode("utf-8")
        encoded = base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")
        signature = hmac.new(
            self.secret.encode("utf-8"), encoded.encode("ascii"), hashlib.sha256
        ).hexdigest()
        return f"{encoded}.{signature}"

    def valid_token(self, token: str | None) -> bool:
        if not self.enabled:
            return True
        if not token or not self.secret:
            return False
        try:
            encoded, signature = token.split(".", 1)
            expected = hmac.new(
                self.secret.encode("utf-8"), encoded.encode("ascii"), hashlib.sha256
            ).hexdigest()
            if not hmac.compare_digest(signature, expected):
                return False
            padding = "=" * (-len(encoded) % 4)
            expires_at = int(base64.urlsafe_b64decode(encoded + padding).decode("utf-8").split(":", 1)[0])
            return expires_at > time.time()
        except (ValueError, UnicodeDecodeError):
            return False

    def token_from_request(self, authorization: str | None, query_token: str | None) -> str | None:
        if authorization and authorization.lower().startswith("bearer "):
            return authorization[7:].strip()
        return query_token
