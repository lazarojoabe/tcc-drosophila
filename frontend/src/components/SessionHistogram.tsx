import { useState } from "react";
import type { HistogramKind } from "../api";
import type { Result } from "../types";

interface Props {
  result: Result;
  histogramUrl: (kind: HistogramKind) => string;
  context?: string;
}

const options: Record<HistogramKind, { title: string; description: string }> = {
  protein: {
    title: "Intensidade proteica corrigida por núcleo",
    description: "A intensidade média da proteína é corrigida pelo sinal de fundo.",
  },
  nucleus: {
    title: "Intensidade nuclear por núcleo",
    description: "A distribuição usa a intensidade média do canal nuclear em cada núcleo.",
  },
  "standard-deviation": {
    title: "Desvio padrão intranuclear da proteína",
    description: "Mostra a variação de intensidade proteica dentro de cada núcleo.",
  },
};

function value(number: number | null | undefined) {
  return number === null || number === undefined ? "—" : number.toFixed(3);
}

export function SessionHistogram({ result, histogramUrl, context = "amostra individual" }: Props) {
  const [kind, setKind] = useState<HistogramKind>("protein");
  const option = options[kind];
  const statistics =
    kind === "protein"
      ? {
          meanLabel: "Média corrigida",
          mean: result.aggregate.mean_protein_background_corrected,
          deviationLabel: "DP entre núcleos",
          deviation: result.aggregate.std_protein_background_corrected,
        }
      : kind === "nucleus"
        ? {
            meanLabel: "Intensidade média nuclear",
            mean: result.aggregate.mean_nucleus_intensity,
            deviationLabel: "DP entre núcleos",
            deviation: result.aggregate.std_nucleus_intensity,
          }
        : {
            meanLabel: "DP intranuclear médio",
            mean: result.aggregate.mean_protein_intranuclear_std,
            deviationLabel: "Variação dos DPs",
            deviation: result.aggregate.std_protein_intranuclear_std,
          };
  if (!result.aggregate.nucleus_count) return null;
  return (
    <section className="session-summary">
      <div className="session-summary-heading">
        <div>
          <span className="section-label">HISTOGRAMA INDIVIDUAL · {context.toUpperCase()}</span>
          <strong>{option.title}</strong>
          <p>
            {option.description} Média, mediana e intervalo interquartil aparecem no gráfico.
          </p>
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
          <span className="batch-summary-count">{result.aggregate.nucleus_count} núcleos</span>
          <a className="export-link" href={histogramUrl(kind)} download>
            Histograma PNG
          </a>
        </div>
      </div>
      <div className="session-summary-body">
        <img
          src={`${histogramUrl(kind)}${histogramUrl(kind).includes("?") ? "&" : "?"}revision=${result.revision}`}
          alt={option.title}
        />
        <div className="batch-summary-metrics">
          <div>
            <span>{statistics.meanLabel}</span>
            <strong>{value(statistics.mean)}</strong>
          </div>
          <div>
            <span>{statistics.deviationLabel}</span>
            <strong>{value(statistics.deviation)}</strong>
          </div>
          <div>
            <span>Núcleos considerados</span>
            <strong>{result.aggregate.nucleus_count}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}
