import { useEffect, useRef } from "react";
import type { Nucleus, SelectionModifiers } from "../types";
interface Props {
  nuclei: Nucleus[];
  selected: number[];
  onSelect: (id: number, modifiers: SelectionModifiers) => void;
  onSelectAll: (ids: number[]) => void;
  compact?: boolean;
}
export function NucleiTable({
  nuclei,
  selected,
  onSelect,
  onSelectAll,
  compact = false,
}: Props) {
  const selectAllRef = useRef<HTMLInputElement>(null);
  const selectedInTable = nuclei.filter((nucleus) =>
    selected.includes(nucleus.nucleus_id),
  ).length;
  const allSelected = nuclei.length > 0 && selectedInTable === nuclei.length;
  const someSelected = selectedInTable > 0 && !allSelected;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th className="selection-cell">
              <input
                ref={selectAllRef}
                className="selection-checkbox"
                type="checkbox"
                aria-label="Selecionar todos os núcleos visíveis"
                checked={allSelected}
                onChange={() =>
                  onSelectAll(nuclei.map((nucleus) => nucleus.nucleus_id))
                }
              />
            </th>
            <th>ID</th>
            <th>Estado</th>
            <th>Intensidade proteica</th>
            {!compact ? <th>Área</th> : null}
            {!compact ? <th>Circularidade</th> : null}
          </tr>
        </thead>
        <tbody>
          {nuclei.map((nucleus) => {
            const isSelected = selected.includes(nucleus.nucleus_id);
            return (
              <tr
                key={nucleus.nucleus_id}
                className={isSelected ? "selected-row" : ""}
                onClick={(event) =>
                  onSelect(nucleus.nucleus_id, {
                    additive: event.ctrlKey || event.metaKey,
                    range: event.shiftKey,
                  })
                }
              >
                <td className="selection-cell">
                  <input
                    className="selection-checkbox"
                    type="checkbox"
                    aria-label={`Selecionar núcleo ${nucleus.nucleus_id}`}
                    checked={isSelected}
                    onChange={() =>
                      onSelect(nucleus.nucleus_id, { additive: true, range: false })
                    }
                    onClick={(event) => event.stopPropagation()}
                  />
                </td>
                <td>#{nucleus.nucleus_id}</td>
                <td>
                  <span className={`state state-${nucleus.state}`}>{nucleus.state}</span>
                </td>
                <td>{nucleus.protein_mean?.toFixed(2) ?? "—"}</td>
                {!compact ? (
                  <td>
                    {nucleus.area_um2
                      ? `${nucleus.area_um2.toFixed(2)} µm²`
                      : `${nucleus.area_px} px²`}
                  </td>
                ) : null}
                {!compact ? <td>{nucleus.circularity?.toFixed(3) ?? "—"}</td> : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
