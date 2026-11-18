import { useState } from "react";
import type { HistogramKind } from "../api";
import type { Batch } from "../types";

interface Props {
  batch: Batch;
  histogramUrl: (kind: HistogramKind) => string;
  csvUrl: string;
  packageUrl: string;
}

const options: Record<HistogramKind, { title: string; description: string }> = {
  protein: {
    title: "Intensidade proteica",
    description:
      "Reúne a intensidade média de todos os núcleos de todas as imagens concluídas.",
  },
  nucleus: {
    title: "Intensidade nuclear",
    description:
      "Reúne a intensidade média do canal nuclear de todos os núcleos do lote.",
  },
  "standard-deviation": {
    title: "Desvio padrão intranuclear da proteína",
    description:
      "Reúne a variação de intensidade proteica dentro de cada núcleo de todo o lote.",
  },
};

function value(number: number | null | undefined) {
  return number === null || number === undefined ? "—" : number.toFixed(3);
}

export function BatchSummary({ batch, histogramUrl, csvUrl, packageUrl }: Props) {
  const [kind, setKind] = useState<HistogramKind>("protein");
  const summary = batch.summary;
  const option = options[kind];
  const statistics =
    kind === "protein"
      ? {
          meanLabel: "Intensidade média proteica",
          mean: summary?.mean_protein,
          deviationLabel: "DP entre núcleos",
          deviation: summary?.std_corrected_protein,
        }
      : kind === "nucleus"
        ? {
            meanLabel: "Intensidade média nuclear",
            mean: summary?.mean_nucleus_intensity,
            deviationLabel: "DP entre núcleos",
            deviation: summary?.std_nucleus_intensity,
          }
        : {
            meanLabel: "DP intranuclear médio",
            mean: summary?.mean_protein_intranuclear_std,
            deviationLabel: "Variação dos DPs",
            deviation: summary?.std_protein_intranuclear_std,
          };
  if (!summary || summary.images_processed === 0) return null;
  return (
    <section className="batch-summary">
      <div className="batch-summary-heading">
        <div>
          <span className="section-label">HISTOGRAMA CONSOLIDADO · TODAS AS IMAGENS DA PASTA</span>
          <strong>{option.title}</strong>
          <p>{option.description}</p>
        </div>
        <div className="batch-summary-heading-actions">
          <div className="histogram-selector">
            <span>Variável</span>
            <div className="histogram-segmented" role="group" aria-label="Variável do histograma">
              <button
                className={kind === "protein" ? "selected" : ""}
                onClick={() => setKind("protein")}
              >
                Proteína
              </button>
              <button
                className={kind === "nucleus" ? "selected" : ""}
                onClick={() => setKind("nucleus")}
              >
                Núcleo
              </button>
              <button
                className={kind === "standard-deviation" ? "selected" : ""}
                onClick={() => setKind("standard-deviation")}
              >
                DP
              </button>
            </div>
          </div>
          <span className="batch-summary-count">{summary.images_processed} imagens</span>
          <a className="export-link" href={csvUrl} download>CSV</a>
          <a className="export-link" href={histogramUrl(kind)} download>
            Histograma PNG
          </a>
          <a className="export-link primary" href={packageUrl} download>
            Baixar lote completo (ZIP)
          </a>
        </div>
      </div>
      <div className="batch-summary-body">
        <img
          src={`${histogramUrl(kind)}${histogramUrl(kind).includes("?") ? "&" : "?"}progress=${batch.progress}`}
          alt={`${option.title} do lote`}
        />
        <div className="batch-summary-metrics">
          <div>
            <span>Imagens concluídas</span>
            <strong>{summary.images_processed}</strong>
          </div>
          <div>
            <span>Núcleos analisados</span>
            <strong>{summary.nuclei_analyzed}</strong>
          </div>
          <div>
            <span>{statistics.meanLabel}</span>
            <strong>{value(statistics.mean)}</strong>
          </div>
          <div>
            <span>{statistics.deviationLabel}</span>
            <strong>{value(statistics.deviation)}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}
