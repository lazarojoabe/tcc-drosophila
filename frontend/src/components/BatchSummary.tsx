import type { Batch } from "../types";

interface Props {
  batch: Batch;
  histogramUrls: {
    standardDeviation: string;
    nuclei: string;
    intensity: string;
  };
  csvUrl: string;
}
function value(number: number | null | undefined) {
  return number === null || number === undefined ? "—" : number.toFixed(3);
}

export function BatchSummary({ batch, histogramUrls, csvUrl }: Props) {
  const summary = batch.summary;
  if (!summary || summary.images_processed === 0) return null;
  return (
    <section className="batch-summary">
      <div className="batch-summary-heading">
        <div>
          <span className="section-label">HISTOGRAMAS DO LOTE</span>
          <strong>Núcleos, intensidades e desvio padrão</strong>
          <p>
            Os gráficos usam as imagens processadas e destacam a média e ±1
            desvio padrão.
          </p>
        </div>
        <div className="batch-summary-heading-actions">
          <span className="batch-summary-count">
            {summary.images_processed} imagens
          </span>
          <a className="export-link" href={csvUrl} download>
            CSV
          </a>
          <a
            className="export-link"
            href={histogramUrls.standardDeviation}
            download
          >
            PNG
          </a>
        </div>
      </div>
      <div className="batch-summary-charts">
        <figure>
          <figcaption>Desvio padrão por imagem</figcaption>
          <img
            src={`${histogramUrls.standardDeviation}?progress=${batch.progress}`}
            alt="Histograma do desvio padrão por imagem"
          />
        </figure>
        <figure>
          <figcaption>Núcleos por imagem</figcaption>
          <img
            src={`${histogramUrls.nuclei}?progress=${batch.progress}`}
            alt="Histograma do número de núcleos por imagem"
          />
        </figure>
        <figure>
          <figcaption>Intensidade proteica</figcaption>
          <img
            src={`${histogramUrls.intensity}?progress=${batch.progress}`}
            alt="Histograma da intensidade proteica por núcleo"
          />
        </figure>
      </div>
      <div className="batch-summary-metrics">
        <div>
          <span>DP médio por imagem</span>
          <strong>{value(summary.mean_protein_std)}</strong>
        </div>
        <div>
          <span>DP entre imagens</span>
          <strong>{value(summary.std_protein_std)}</strong>
        </div>
        <div>
          <span>Valores de intensidade</span>
          <strong>{summary.protein_mean_values_count}</strong>
        </div>
        <div>
          <span>Pares concluídos</span>
          <strong>
            {batch.completed}/{batch.total}
          </strong>
        </div>
      </div>
    </section>
  );
}
