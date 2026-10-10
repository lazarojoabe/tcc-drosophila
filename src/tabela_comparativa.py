"""Gera uma tabela simples da média de proteína: IC versus TCC."""

from __future__ import annotations

import argparse
import csv
import math
from pathlib import Path

INPUT_NAME = "comparativo_amostras.csv"


def number(value: str) -> float | None:
    if value in ("", None):
        return None
    parsed = float(value)
    return parsed if math.isfinite(parsed) else None


def format_number(value: float | None) -> str:
    return "—" if value is None else f"{value:.2f}"


def read_comparison(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as stream:
        return list(csv.DictReader(stream))


def build_rows(source_rows: list[dict[str, str]]) -> list[dict[str, str]]:
    rows = []
    for source in source_rows:
        ic = number(source["legacy_mean_gray_boundary"])
        tcc_raw = number(source["improved_mean_raw_red_per_nucleus"])
        tcc_corrected = number(
            source["improved_mean_background_corrected_red_per_nucleus"]
        )
        delta = (
            tcc_corrected - ic if ic is not None and tcc_corrected is not None else None
        )
        percent = 100 * delta / ic if delta is not None and ic != 0 else None
        rows.append(
            {
                "imagem": source["sample_key"],
                "status_ic": source["legacy_status"],
                "status_tcc": source["improved_status"],
                "media_ic": format_number(ic),
                "media_tcc_bruta": format_number(tcc_raw),
                "media_tcc_corrigida": format_number(tcc_corrected),
                "diferenca_tcc_corrigida_menos_ic": format_number(delta),
                "variacao_percentual": format_number(percent),
            }
        )
    return rows


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = list(rows[0]) if rows else []
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, delimiter=";")
        writer.writeheader()
        writer.writerows(rows)


def write_markdown(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# Média de proteína — IC versus TCC",
        "",
        "A média da IC usa tons de cinza nos pontos do contorno. A média do TCC usa o canal vermelho no interior dos núcleos. A coluna corrigida subtrai o fundo da amostra.",
        "",
        "| Imagem | IC | TCC bruta | TCC corrigida | Diferença | Variação | Status IC | Status TCC |",
        "|---|---:|---:|---:|---:|---:|---|---|",
    ]
    for row in rows:
        lines.append(
            "| {imagem} | {media_ic} | {media_tcc_bruta} | {media_tcc_corrigida} | "
            "{diferenca_tcc_corrigida_menos_ic} | {variacao_percentual}% | {status_ic} | {status_tcc} |".format(
                **row
            )
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, default=Path("results"))
    parser.add_argument("--output-dir", type=Path, default=Path("results"))
    args = parser.parse_args()

    source = args.input_dir / INPUT_NAME
    if not source.exists():
        raise FileNotFoundError(
            f"Arquivo não encontrado: {source}. Execute antes pipeline_melhorado.py e comparar_resultados.py."
        )

    rows = build_rows(read_comparison(source))
    csv_path = args.output_dir / "tabela_media_proteina_ic_vs_tcc.csv"
    markdown_path = args.output_dir / "tabela_media_proteina_ic_vs_tcc.md"
    write_csv(csv_path, rows)
    write_markdown(markdown_path, rows)

    print(f"Tabela CSV: {csv_path}")
    print(f"Tabela Markdown: {markdown_path}")
    print(f"Imagens listadas: {len(rows)}")


if __name__ == "__main__":
    main()
