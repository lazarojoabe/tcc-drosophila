"""Compara os resultados atuais do TCC com os CSVs existentes em results13062022."""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

import numpy as np


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


def values(rows: list[dict[str, str]], key: str) -> np.ndarray:
    return np.asarray(
        [float(row[key]) for row in rows if row.get(key) not in (None, "")], dtype=float
    )


def stats(
    rows: list[dict[str, str]], intensity_key: str, area_key: str
) -> dict[str, float | int | str]:
    image_keys = {row.get("sample_key", "") for row in rows}
    intensity = values(rows, intensity_key)
    area = values(rows, area_key)
    nuclei_per_image = np.asarray(
        [
            sum(row.get("sample_key", "") == key for row in rows)
            for key in image_keys
            if key
        ],
        dtype=float,
    )
    return {
        "images": len(image_keys),
        "nuclei": len(rows),
        "nuclei_mean": (
            float(nuclei_per_image.mean()) if nuclei_per_image.size else float("nan")
        ),
        "nuclei_std": (
            float(nuclei_per_image.std()) if nuclei_per_image.size else float("nan")
        ),
        "intensity_mean": float(intensity.mean()) if intensity.size else float("nan"),
        "intensity_std": float(intensity.std()) if intensity.size else float("nan"),
        "area_mean": float(area.mean()) if area.size else float("nan"),
        "area_std": float(area.std()) if area.size else float("nan"),
    }


def fmt(value: float | int | str) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, int):
        return str(value)
    return "—" if not np.isfinite(value) else f"{value:.2f}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference-dir", type=Path, required=True)
    parser.add_argument(
        "--current-csv", type=Path, default=Path("results/resultados_por_nucleo.csv")
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("results/comparacao_tcc_vs_results13062022.md"),
    )
    args = parser.parse_args()

    current_rows = read_csv(args.current_csv)
    current_rows = [
        {**row, "sample_key": row.get("sample_key", "")} for row in current_rows
    ]
    old_rows: list[dict[str, str]] = []
    old_groups: list[tuple[str, list[dict[str, str]]]] = []
    for csv_path in sorted(args.reference_dir.rglob("*_data.csv")):
        rows = read_csv(csv_path)
        if not rows or "intensidade" not in rows[0]:
            continue
        group = csv_path.relative_to(args.reference_dir).parts[0]
        normalized = [
            {**row, "sample_key": str(csv_path.relative_to(args.reference_dir))}
            for row in rows
        ]
        old_rows.extend(normalized)
        old_groups.append((group, normalized))

    current = stats(current_rows, "signal_mean_raw", "area_px")
    reference = stats(old_rows, "intensidade", "area")
    lines = [
        "# Comparação do algoritmo do TCC com `results13062022`",
        "",
        "Este relatório compara os resultados atuais do algoritmo do TCC com os resultados já existentes em `C:\\Users\\lazar\\OneDrive - Universidade Federal de Uberlândia\\UFU\\10o semestre\\tcc\\results13062022`. Como os dois conjuntos são compostos por imagens diferentes, a comparação é descritiva e agregada; não há pareamento amostra a amostra.",
        "",
        "## Resumo dos conjuntos",
        "",
        "| Conjunto | Origem | Imagens | Núcleos | Núcleos/imagem — média | Núcleos/imagem — DP | Intensidade — média | Intensidade — DP | Área — média | Área — DP |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
        f"| Algoritmo TCC | `{args.current_csv}` | {fmt(current['images'])} | {fmt(current['nuclei'])} | {fmt(current['nuclei_mean'])} | {fmt(current['nuclei_std'])} | {fmt(current['intensity_mean'])} | {fmt(current['intensity_std'])} | {fmt(current['area_mean'])} | {fmt(current['area_std'])} |",
        f"| Resultados existentes | `{args.reference_dir}` | {fmt(reference['images'])} | {fmt(reference['nuclei'])} | {fmt(reference['nuclei_mean'])} | {fmt(reference['nuclei_std'])} | {fmt(reference['intensity_mean'])} | {fmt(reference['intensity_std'])} | {fmt(reference['area_mean'])} | {fmt(reference['area_std'])} |",
        "",
        "## Resultados existentes por conjunto experimental",
        "",
        "| Conjunto experimental | Imagens | Núcleos | Núcleos/imagem — média | Núcleos/imagem — DP | Intensidade — média | Intensidade — DP | Área — média | Área — DP |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for group in sorted({name for name, _ in old_groups}):
        group_rows = [row for name, rows in old_groups if name == group for row in rows]
        item = stats(group_rows, "intensidade", "area")
        lines.append(
            f"| {group} | {fmt(item['images'])} | {fmt(item['nuclei'])} | {fmt(item['nuclei_mean'])} | {fmt(item['nuclei_std'])} | {fmt(item['intensity_mean'])} | {fmt(item['intensity_std'])} | {fmt(item['area_mean'])} | {fmt(item['area_std'])} |"
        )
    lines.extend(
        [
            "",
            "## Definição das medidas",
            "",
            "- **Intensidade do TCC:** `signal_mean_raw`, média do canal proteico bruto dentro de cada núcleo segmentado.",
            "- **Intensidade existente:** `intensidade`, valor registrado nos CSVs produzidos pelo processamento antigo.",
            "- **Núcleos/imagem:** número de linhas de núcleos em cada CSV ou `sample_key`.",
            "- **DP:** desvio padrão populacional dos valores observados no conjunto correspondente.",
            "",
            "Esta comparação não afirma superioridade biológica de um método sobre o outro, pois os arquivos não são as mesmas imagens e os procedimentos de medição também diferem. Ela serve para caracterizar a distribuição dos resultados do TCC frente ao acervo de resultados existentes.",
        ]
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Relatório Markdown: {args.output}")
    print(f"TCC: {current['images']} imagens / {current['nuclei']} núcleos")
    print(f"Referência: {reference['images']} imagens / {reference['nuclei']} núcleos")


if __name__ == "__main__":
    main()
