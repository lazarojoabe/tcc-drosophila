import type { AuditEntry } from "../types";

interface Props {
  entries: AuditEntry[];
}

const labels: Record<string, string> = {
  session_created: "Sessão criada",
  processing_completed: "Processamento concluído",
  processing_failed: "Falha no processamento",
  manual_save: "Análise salva",
  edit_contour: "Contorno revisado",
  hide: "Núcleo ocultado",
  exclude: "Núcleo excluído",
  restore: "Núcleo restaurado",
  undo: "Alteração desfeita",
  redo: "Alteração refeita",
  reprocess_requested: "Reprocessamento solicitado",
};

function description(entry: AuditEntry) {
  const nucleusIds = entry.details.nucleus_ids;
  const ids = Array.isArray(nucleusIds) && nucleusIds.length
    ? ` · núcleo${nucleusIds.length > 1 ? "s" : ""} ${nucleusIds.map((id) => `#${id}`).join(", ")}`
    : "";
  if (entry.operation === "edit_contour" && entry.details.contour_auto_corrected)
    return `${ids} · autointerseção corrigida automaticamente`;
  return ids;
}

export function AuditTrail({ entries }: Props) {
  return (
    <section className="audit-trail">
      <div className="audit-trail-heading">
        <div>
          <span className="section-label">TRILHA DE AUDITORIA</span>
          <strong>Histórico da revisão</strong>
        </div>
        <span>{entries.length} eventos</span>
      </div>
      {entries.length ? (
        <ol className="audit-list">
          {[...entries].reverse().map((entry, index) => (
            <li key={`${entry.timestamp}-${index}`}>
              <span className="audit-marker" />
              <div>
                <strong>{labels[entry.operation] ?? entry.operation}</strong>
                <p>
                  Revisão {entry.revision}{description(entry)}
                </p>
              </div>
              <time>
                {new Date(entry.timestamp).toLocaleString("pt-BR")}
                <small>{entry.reviewer}</small>
              </time>
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty-panel">Ainda não há eventos registrados nesta sessão.</p>
      )}
    </section>
  );
}
