"""Gera uma tabela Markdown completa do dataset: baseline original versus TCC."""

from __future__ import annotations

import csv
from pathlib import Path


def number(value: str | None) -> float | None:
    if value in (None, ""):
        return None
    parsed = float(value)
    return parsed if parsed == parsed and abs(parsed) != float("inf") else None


def integer(value: str | None) -> int | None:
    parsed = number(value)
    return int(parsed) if parsed is not None else None


def fmt(value: str | None, digits: int = 2) -> str:
    parsed = number(value)
    return "—" if parsed is None else f"{parsed:.{digits}f}"


def fmt_int(value: str | None) -> str:
    parsed = integer(value)
    return "—" if parsed is None else str(parsed)


def read_rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as stream:
        return list(csv.DictReader(stream))


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    input_path = root / "results" / "comparativo_amostras.csv"
    output_path = root / "results" / "comparacao_completa_dataset.md"
    rows = read_rows(input_path)
    common = [
        row
        for row in rows
        if row.get("legacy_status") == "measured" and row.get("improved_status") == "ok"
    ]
    old_measured = sum(row.get("legacy_status") == "measured" for row in rows)
    new_measured = sum(row.get("improved_status") == "ok" for row in rows)
    lines = [
        "# Comparação completa do dataset — baseline original versus algoritmo do TCC",
        "",
        "Este arquivo compara, amostra por amostra, o resultado já existente do método original (baseline da IC) com o algoritmo revisado do TCC. O baseline mede pontos do contorno em tons de cinza; o TCC mede o interior de cada núcleo no canal vermelho bruto e também apresenta a correção pelo fundo.",
        "",
        "## Cobertura do dataset",
        "",
        f"- Amostras listadas no dataset: **{len(rows)}**.",
        f"- Amostras medidas pelo baseline: **{old_measured}**.",
        f"- Amostras processadas pelo algoritmo do TCC: **{new_measured}**.",
        f"- Amostras comuns aos dois métodos: **{len(common)}**.",
        "",
        "## Tabela por amostra",
        "",
        "| Amostra | Baseline | TCC | Contornos baseline | Núcleos TCC | Média baseline cinza | DP baseline cinza | Média TCC bruta | DP TCC bruta | Média TCC corrigida | DP TCC corrigida | Diferença corrigida − baseline | Variação |",
        "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in rows:
        old_mean = number(row.get("legacy_mean_gray_boundary"))
        corrected = number(
            row.get("improved_mean_background_corrected_red_per_nucleus")
        )
        difference = (
            corrected - old_mean
            if old_mean is not None and corrected is not None
            else None
        )
        variation = (
            100 * difference / old_mean if difference is not None and old_mean else None
        )
        lines.append(
            "| {sample} | {old_status} | {new_status} | {old_count} | {new_count} | {old_mean} | {old_std} | {new_mean} | {new_std} | {corrected_mean} | {corrected_std} | {difference} | {variation}% |".format(
                sample=row.get("sample_key", ""),
                old_status=row.get("legacy_status", "—"),
                new_status=row.get("improved_status", "—"),
                old_count=fmt_int(row.get("legacy_contours")),
                new_count=fmt_int(row.get("improved_nucleus_count")),
                old_mean=fmt(row.get("legacy_mean_gray_boundary")),
                old_std=fmt(row.get("legacy_std_gray_boundary")),
                new_mean=fmt(row.get("improved_mean_raw_red_per_nucleus")),
                new_std=fmt(row.get("improved_std_raw_red_per_nucleus")),
                corrected_mean=fmt(
                    row.get("improved_mean_background_corrected_red_per_nucleus")
                ),
                corrected_std=fmt(
                    row.get("improved_std_background_corrected_red_per_nucleus")
                ),
                difference="—" if difference is None else f"{difference:.2f}",
                variation="—" if variation is None else f"{variation:.2f}",
            )
        )
    lines.extend(
        [
            "",
            "## Interpretação",
            "",
            "A diferença numérica não deve ser interpretada como ganho biológico direto, porque os métodos não calculam exatamente a mesma grandeza. O baseline usa pontos do contorno e tons de cinza; o algoritmo do TCC usa pixels internos, identifica núcleos individualmente, preserva o canal proteico e calcula o fundo. Portanto, esta tabela documenta a mudança de medida e a cobertura do dataset; a validação de acurácia exige anotações manuais e controles experimentais.",
            "",
            "Os desvios padrão do TCC nesta tabela representam a dispersão das intensidades médias entre os núcleos da respectiva amostra. Os desvios padrão do baseline representam a dispersão dos valores nos pontos de contorno.",
        ]
    )
    output_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Relatório Markdown: {output_path}")
    print(f"Amostras: {len(rows)} | comuns: {len(common)}")


if __name__ == "__main__":
    main()
