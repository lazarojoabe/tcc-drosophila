import { FormEvent, type ReactNode, useEffect, useState } from "react";
import { LockKeyhole, Microscope } from "lucide-react";
import { getAccessStatus, login } from "../api";

interface Props {
  children: ReactNode;
}

export function AccessGate({ children }: Props) {
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [requiresCode, setRequiresCode] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void getAccessStatus()
      .then((status) => {
        setRequiresCode(status.authentication_required);
        setAllowed(!status.authentication_required || status.authenticated);
      })
      .catch(() => setError("Não foi possível conectar à plataforma."))
      .finally(() => setLoading(false));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      setError("");
      await login(accessCode);
      setAllowed(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Código de acesso inválido");
    }
  }

  if (loading) return <main className="access-gate">Conectando à plataforma…</main>;
  if (allowed) return <>{children}</>;
  if (!requiresCode) return <main className="access-gate">{error}</main>;
  return (
    <main className="access-gate">
      <form className="access-card" onSubmit={submit}>
        <span className="access-icon"><Microscope size={27} /></span>
        <span className="section-label">ACESSO RESTRITO</span>
        <h1>Revisão científica de núcleos</h1>
        <p>Informe o código fornecido pela equipe de pesquisa para acessar as análises.</p>
        <label>
          <span><LockKeyhole size={14} /> Código de acesso</span>
          <input
            autoFocus
            type="password"
            value={accessCode}
            onChange={(event) => setAccessCode(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error ? <p className="access-error">{error}</p> : null}
        <button type="submit">Entrar na plataforma</button>
      </form>
    </main>
  );
}
