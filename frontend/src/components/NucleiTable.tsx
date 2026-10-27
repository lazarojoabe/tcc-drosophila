import type { Nucleus } from "../types";
interface Props {
  nuclei: Nucleus[];
  selected: number[];
  onSelect: (id: number, multi: boolean) => void;
  compact?: boolean;
}
export function NucleiTable({ nuclei, selected, onSelect, compact = false }: Props) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Estado</th>
            <th>Intensidade corrigida</th>
            {!compact ? <th>Área</th> : null}
            {!compact ? <th>Circularidade</th> : null}
          </tr>
        </thead>
        <tbody>
          {nuclei.map((n) => (
            <tr
              key={n.nucleus_id}
              className={selected.includes(n.nucleus_id) ? "selected-row" : ""}
              onClick={(e) => onSelect(n.nucleus_id, e.ctrlKey || e.shiftKey)}
            >
              <td>#{n.nucleus_id}</td>
              <td>
                <span className={`state state-${n.state}`}>{n.state}</span>
              </td>
              <td>{n.protein_mean_background_corrected?.toFixed(2) ?? "—"}</td>
              {!compact ? (
                <td>{n.area_um2 ? `${n.area_um2.toFixed(2)} µm²` : `${n.area_px} px²`}</td>
              ) : null}
              {!compact ? <td>{n.circularity?.toFixed(3) ?? "—"}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
