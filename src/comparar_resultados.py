from __future__ import annotations

import csv
import json
from pathlib import Path

import cv2
import numpy as np

from pipeline_melhorado import build_manifest, pairing_key, read_channel


def write_csv(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = list(rows[0].keys()) if rows else []
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def legacy_measurement(filled_path: Path, protein_path: Path) -> dict:
    nuclei = cv2.imread(str(filled_path), cv2.IMREAD_GRAYSCALE)
    protein_gray = cv2.imread(str(protein_path), cv2.IMREAD_GRAYSCALE)
    protein_raw = read_channel(protein_path, 2)
    if nuclei is None or protein_gray is None:
        raise IOError(f"Falha de leitura no baseline: {filled_path.name}")
    contours, _ = cv2.findContours(nuclei, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    coordinates = [tuple(point[0]) for contour in contours for point in contour]
    if not coordinates:
        return {
            "legacy_contours": len(contours),
            "legacy_boundary_points": 0,
            "legacy_mean_gray_boundary": float("nan"),
            "legacy_mean_red_boundary": float("nan"),
            "legacy_std_gray_boundary": float("nan"),
            "legacy_std_red_boundary": float("nan"),
        }
    gray_values = np.array([protein_gray[y, x] for x, y in coordinates], dtype=float)
    red_values = np.array([protein_raw[y, x] for x, y in coordinates], dtype=float)
    return {
        "legacy_contours": len(contours),
        "legacy_boundary_points": len(coordinates),
        "legacy_mean_gray_boundary": float(gray_values.mean()),
        "legacy_mean_red_boundary": float(red_values.mean()),
        "legacy_std_gray_boundary": float(gray_values.std()),
        "legacy_std_red_boundary": float(red_values.std()),
    }


def load_rows(path: Path) -> dict[str, list[dict]]:
    with path.open(encoding="utf-8", newline="") as stream:
        rows = list(csv.DictReader(stream))
    result: dict[str, list[dict]] = {}
    for row in rows:
        result.setdefault(row["sample_key"], []).append(row)
    return result


def main() -> None:
    root = Path(".")
    output_dir = root / "results"
    improved_summary = load_rows(output_dir / "resumo_por_amostra.csv")
    improved_nuclei = load_rows(output_dir / "resultados_por_nucleo.csv")
    pairs = build_manifest(
        root / "data/raw/imagens_nucleos", root / "data/raw/imagens_proteinas"
    )

    filled = {
        pairing_key(path): path
        for path in (root / "data/baseline/nucleos_preenchidos").glob("*.tif")
    }
    protein_by_name = {
        path.name: path for path in (root / "data/raw/imagens_proteinas").glob("*.tif")
    }
    comparison_rows: list[dict] = []
    for pair in pairs:
        baseline = {}
        if pair.key in filled:
            # Reproduz exatamente o pareamento do script original. Em
            # particular, o caso Image007 não possui `_z0_` e fica fora do
            # baseline, como ocorria no código da iniciação científica.
            legacy_protein_name = filled[pair.key].name.replace(
                "_z0_ch00.tif", "_z0_ch02.tif"
            )
            if legacy_protein_name in protein_by_name:
                baseline = legacy_measurement(
                    filled[pair.key], protein_by_name[legacy_protein_name]
                )
        summary = improved_summary.get(pair.key, [{}])[0]
        nucleus_rows = improved_nuclei.get(pair.key, [])
        comparison_rows.append(
            {
                "sample_key": pair.key,
                "has_pair": bool(pair.nucleus_path and pair.protein_path),
                "legacy_status": "measured" if baseline else "not_measured",
                "improved_status": summary.get("status", "missing"),
                "legacy_contours": baseline.get("legacy_contours", ""),
                "legacy_boundary_points": baseline.get("legacy_boundary_points", ""),
                "legacy_mean_gray_boundary": baseline.get(
                    "legacy_mean_gray_boundary", ""
                ),
                "legacy_mean_red_boundary": baseline.get(
                    "legacy_mean_red_boundary", ""
                ),
                "legacy_std_gray_boundary": baseline.get(
                    "legacy_std_gray_boundary", ""
                ),
                "legacy_std_red_boundary": baseline.get("legacy_std_red_boundary", ""),
                "improved_nucleus_count": summary.get("nucleus_count", ""),
                "improved_area_total_px": summary.get("area_total_px", ""),
                "improved_mean_raw_red_per_nucleus": summary.get(
                    "mean_raw_red_per_nucleus", ""
                ),
                "improved_mean_background_corrected_red_per_nucleus": summary.get(
                    "mean_background_corrected_red_per_nucleus", ""
                ),
                "improved_std_raw_red_per_nucleus": (
                    float(
                        np.std(
                            [float(item["signal_mean_raw"]) for item in nucleus_rows]
                        )
                    )
                    if nucleus_rows
                    else ""
                ),
                "improved_std_background_corrected_red_per_nucleus": (
                    float(
                        np.std(
                            [
                                float(item["signal_mean_background_corrected"])
                                for item in nucleus_rows
                            ]
                        )
                    )
                    if nucleus_rows
                    else ""
                ),
            }
        )

    write_csv(output_dir / "comparativo_amostras.csv", comparison_rows)

    common = [
        row
        for row in comparison_rows
        if row["legacy_status"] == "measured" and row["improved_status"] == "ok"
    ]
    legacy = np.array([float(row["legacy_mean_gray_boundary"]) for row in common])
    raw = np.array([float(row["improved_mean_raw_red_per_nucleus"]) for row in common])
    corrected = np.array(
        [
            float(row["improved_mean_background_corrected_red_per_nucleus"])
            for row in common
        ]
    )
    deltas = corrected - legacy
    summary = {
        "legacy_total_input_nuclei": len(
            list((root / "data/raw/imagens_nucleos").glob("*.tif"))
        ),
        "legacy_measured_pairs": len(common),
        "improved_pairs": sum(row["has_pair"] for row in comparison_rows),
        "unmatched_legacy_or_missing": sum(
            row["legacy_status"] != "measured" for row in comparison_rows
        ),
        "legacy_mean_gray_boundary_common": (
            float(legacy.mean()) if legacy.size else None
        ),
        "improved_mean_raw_red_per_nucleus_common": (
            float(raw.mean()) if raw.size else None
        ),
        "improved_mean_background_corrected_red_per_nucleus_common": (
            float(corrected.mean()) if corrected.size else None
        ),
        "mean_absolute_change_corrected_minus_legacy": (
            float(np.abs(deltas).mean()) if deltas.size else None
        ),
        "median_absolute_change_corrected_minus_legacy": (
            float(np.median(np.abs(deltas))) if deltas.size else None
        ),
        "mean_relative_change_corrected_vs_legacy_percent": (
            float(np.mean(deltas / legacy) * 100) if np.all(legacy != 0) else None
        ),
        "legacy_contours_mean_common": (
            float(np.mean([float(row["legacy_contours"]) for row in common]))
            if common
            else None
        ),
        "improved_nuclei_mean_common": (
            float(np.mean([float(row["improved_nucleus_count"]) for row in common]))
            if common
            else None
        ),
    }
    (output_dir / "comparativo_resumo.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    markdown = [
        "# Comparativo do método original e do método melhorado",
        "",
        "Os valores foram calculados nos pares comuns ao baseline e ao pipeline revisado.",
        "",
        f"- Pares medidos pelo método original: **{summary['legacy_measured_pairs']}**.",
        f"- Pares processados pelo método melhorado: **{summary['improved_pairs']}**.",
        f"- Amostras sem resultado no baseline: **{summary['unmatched_legacy_or_missing']}**.",
        f"- Média original (tons de cinza no contorno): **{summary['legacy_mean_gray_boundary_common']:.3f}**.",
        f"- Média revisada sem correção (canal vermelho, interior): **{summary['improved_mean_raw_red_per_nucleus_common']:.3f}**.",
        f"- Média revisada com correção de fundo: **{summary['improved_mean_background_corrected_red_per_nucleus_common']:.3f}**.",
        f"- Mudança absoluta média: **{summary['mean_absolute_change_corrected_minus_legacy']:.3f}**.",
        f"- Mudança relativa média: **{summary['mean_relative_change_corrected_vs_legacy_percent']:.2f}%**.",
        f"- Contornos no baseline: **{summary['legacy_contours_mean_common']:.2f}** por imagem; núcleos no método revisado: **{summary['improved_nuclei_mean_common']:.2f}** por imagem.",
        "",
        "A diferença inclui quatro mudanças deliberadas: canal vermelho bruto, pixels do interior, identificação individual dos núcleos e correção global do fundo. Portanto, ela não deve ser interpretada como simples ganho/perda de desempenho numérico; trata-se de uma mudança na definição da medida.",
    ]
    (output_dir / "comparativo_resultados.md").write_text(
        "\n".join(markdown) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
