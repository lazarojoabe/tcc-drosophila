import type { AggregateMetrics, Nucleus } from "../types";
interface Props {
  nucleus?: Nucleus;
  aggregate?: AggregateMetrics;
  revision: number;
  onAction: (operation: "hide" | "exclude" | "restore") => void;
  editing: boolean;
  editMode: "adjust" | "redraw";
  onEdit: () => void;
  onRedraw: () => void;
  onRestartRedraw: () => void;
  onSave: () => void;
  onCancel: () => void;
}
function Value({ label, value }: { label: string; value: unknown }) {
  const rendered =
    value === null || value === undefined
      ? "—"
      : typeof value === "number"
        ? value.toFixed(3)
        : String(value);
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{rendered}</strong>
    </div>
  );
}
export function MetricsPanel({
  nucleus,
  aggregate,
  onAction,
  editing,
  editMode,
  onEdit,
  onRedraw,
  onRestartRedraw,
  onSave,
  onCancel,
}: Props) {
  return (
    <aside className="panel right">
      <div className="panel-title">
        <span>Resumo da amostra</span>
        <span className="sample-count">
          {aggregate ? `${aggregate.nucleus_count} ativos` : "—"}
        </span>
      </div>
      {aggregate ? (
        <>
          <h4>Quantificação principal</h4>
          <div className="metrics-grid">
            <Value
              label="Média proteica corrigida"
              value={aggregate.mean_protein_background_corrected}
            />
            <Value
              label="DP entre núcleos"
              value={aggregate.std_protein_background_corrected}
            />
            <Value label="Núcleos ocultos" value={aggregate.hidden_count} />
            <Value label="Núcleos excluídos" value={aggregate.excluded_count} />
          </div>
        </>
      ) : null}
      {!nucleus ? (
        <div className="empty-panel">
          Selecione um núcleo para consultar as métricas individuais.
        </div>
      ) : (
        <>
          <div className="panel-title nucleus-title">
            <span>Núcleo #{nucleus.nucleus_id}</span>
            <span className={`state state-${nucleus.state}`}>
              {nucleus.state}
            </span>
          </div>
          <div className="action-row">
            {editing ? (
              <>
                {editMode === "redraw" ? (
                  <button onClick={onRestartRedraw}>Recomeçar traço</button>
                ) : null}
                <button className="primary" onClick={onSave}>
                  Confirmar
                </button>
                <button onClick={onCancel}>Cancelar</button>
              </>
            ) : (
              <>
                <button onClick={onEdit}>Ajustar pontos</button>
                <button className="primary" onClick={onRedraw}>
                  Redesenhar
                </button>
                <button
                  onClick={() =>
                    onAction(nucleus.state === "hidden" ? "restore" : "hide")
                  }
                >
                  {nucleus.state === "hidden" ? "Mostrar" : "Ocultar"}
                </button>
                <button
                  className="danger"
                  onClick={() =>
                    onAction(
                      nucleus.state === "excluded" ? "restore" : "exclude",
                    )
                  }
                >
                  {nucleus.state === "excluded" ? "Restaurar" : "Excluir"}
                </button>
              </>
            )}
          </div>
          <h4>Morfometria</h4>
          <div className="metrics-grid">
            <Value
              label="Área"
              value={
                nucleus.area_um2
                  ? `${nucleus.area_um2.toFixed(2)} µm²`
                  : `${nucleus.area_px} px²`
              }
            />
            <Value label="Diâmetro equivalente" value={nucleus.equivalent_diameter_px} />
            <Value label="Circularidade" value={nucleus.circularity} />
            <Value label="Excentricidade" value={nucleus.eccentricity} />
          </div>
          <h4>Quantificação individual</h4>
          <div className="metrics-grid">
            <Value label="Proteína corrigida" value={nucleus.protein_mean_background_corrected} />
            <Value label="Sinal bruto médio" value={nucleus.protein_mean} />
            <Value
              label="Sinal integrado"
              value={nucleus.protein_integrated}
            />
            <Value label="Fundo" value={nucleus.background_mean} />
            <Value
              label="Prot. corrigida"
              value={nucleus.protein_mean_background_corrected}
            />
          </div>
        </>
      )}
    </aside>
  );
}
