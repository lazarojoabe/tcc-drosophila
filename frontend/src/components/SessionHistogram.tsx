import type { Result } from "../types";

interface Props {
  result: Result;
  histogramUrl: string;
}
function value(number: number | null | undefined) {
  return number === null || number === undefined ? "—" : number.toFixed(3);
}

export function SessionHistogram({ result, histogramUrl }: Props) {
  if (!result.aggregate.nucleus_count) return null;
  return (
    <section className="session-summary">
      <div className="session-summary-heading">
        <div>
          <span className="section-label">HISTOGRAMA DA AMOSTRA</span>
          <strong>Intensidade proteica por núcleo</strong>
          <p>
            A média e o desvio padrão são calculados entre as intensidades
            médias dos núcleos ativos.
          </p>
        </div>
        <div className="batch-summary-heading-actions">
          <span className="batch-summary-count">
            {result.aggregate.nucleus_count} núcleos
          </span>
          <a className="export-link" href={histogramUrl} download>
            Histograma PNG
          </a>
        </div>
      </div>
      <div className="session-summary-body">
        <img
          src={`${histogramUrl}?revision=${result.revision}`}
          alt="Histograma da intensidade proteica por núcleo"
        />
        <div className="batch-summary-metrics">
          <div>
            <span>Média</span>
            <strong>{value(result.aggregate.mean_protein)}</strong>
          </div>
          <div>
            <span>Desvio padrão</span>
            <strong>{value(result.aggregate.std_protein)}</strong>
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
