import type { Nucleus } from "../types";
interface Props {
  nuclei: Nucleus[];
  selected: number[];
  onSelect: (id: number, multi: boolean) => void;
}
export function NucleiTable({ nuclei, selected, onSelect }: Props) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Estado</th>
            <th>Área px</th>
            <th>Prot. média</th>
            <th>Prot. corrigida</th>
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
              <td>{n.area_px}</td>
              <td>{n.protein_mean?.toFixed(2) ?? "—"}</td>
              <td>{n.protein_mean_background_corrected?.toFixed(2) ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
