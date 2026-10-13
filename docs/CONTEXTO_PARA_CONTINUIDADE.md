# Contexto de continuidade do projeto do TCC

Este documento reúne o contexto técnico, científico e operacional do projeto
para que outra pessoa ou outra IA consiga continuar o desenvolvimento sem
depender do histórico da conversa original.

## 1. Identidade e escopo do projeto

**Projeto:** caracterização morfológica e quantificação de proteína em núcleos
de *Drosophila melanogaster*.

**Repositório correto do TCC:**

```text
C:\Users\lazar\OneDrive - Universidade Federal de Uberlândia\UFU\10o semestre\tcc\tcc-drosophila
```

Este repositório é o projeto principal do TCC. O repositório da iniciação
científica é apenas uma referência histórica. Não fazer alterações no
repositório da IC quando a solicitação se referir ao TCC.

O diretório externo abaixo contém resultados antigos que devem ser usados como
referência para comparação agregada, quando solicitado:

```text
C:\Users\lazar\OneDrive - Universidade Federal de Uberlândia\UFU\10o semestre\tcc\results13062022
```

A comparação com `results13062022` usa imagens diferentes e, portanto, não é
uma validação pareada imagem a imagem.

## 2. Objetivo científico

O projeto processa imagens de núcleos e de proteína para:

- identificar núcleos individualmente;
- medir área e características morfológicas;
- medir a intensidade da proteína dentro de cada núcleo;
- estimar e subtrair um fundo de referência;
- produzir médias, medianas, desvios padrão e intensidade integrada;
- permitir revisão manual dos contornos e do estado dos núcleos;
- exportar resultados por núcleo, por imagem e por lote.

A entrega atual é uma base metodológica e computacional mais rastreável. Ela
ainda não deve ser apresentada como biologicamente validada, porque não existe
uma máscara manual de referência integrada ao projeto.

## 3. Estado do repositório na revisão

Antes da criação deste documento, o último commit era:

```text
23d1df4 Padronizar formatação do código
```

Esse commit contém a aplicação local, o pipeline, as comparações e a
formatação profissional do código. O presente documento deve ser incluído no
commit seguinte.

O projeto usa atualmente:

- Python 3.11 usado nos testes locais;
- NumPy e OpenCV para processamento;
- Matplotlib para histogramas;
- FastAPI e Uvicorn no backend;
- Pydantic para contratos e validação;
- SQLite para metadados e histórico de edições;
- React + TypeScript + Vite no frontend;
- Vitest para testes do frontend.

## 4. Estrutura principal

```text
tcc-drosophila/
├── backend/
│   ├── app/
│   │   ├── main.py                         # API FastAPI e endpoints
│   │   ├── models/schemas.py                # modelos Pydantic e contratos
│   │   ├── processing/
│   │   │   ├── algorithm.py                 # adaptador do pipeline para a API
│   │   │   ├── image_io.py                  # leitura, validação e prévias
│   │   │   └── metrics.py                   # métricas e histogramas
│   │   ├── repositories/sqlite.py           # metadados/histórico em SQLite
│   │   └── services/session_manager.py     # sessões, lotes e edições
│   └── tests/                               # testes da API e do serviço
├── frontend/
│   ├── src/App.tsx                          # estado principal da interface
│   ├── src/api.ts                            # cliente HTTP/SSE
│   ├── src/types.ts                          # tipos TypeScript
│   ├── src/components/
│   │   ├── ImageViewer.tsx                  # canvas, zoom, pan e contornos
│   │   ├── MetricsPanel.tsx                 # métricas e ações do núcleo
│   │   ├── NucleiTable.tsx                  # tabela de núcleos
│   │   ├── BatchSummary.tsx                 # resumo/histogramas de lote
│   │   └── SessionHistogram.tsx             # histograma individual
│   └── src/utils/geometry.ts                 # transformações geométricas
├── src/
│   ├── pipeline_melhorado.py                # pipeline de linha de comando
│   ├── comparar_resultados.py               # baseline IC versus TCC
│   ├── tabela_comparativa.py                # tabela resumida IC/TCC
│   ├── relatorio_comparativo_dataset.py    # Markdown amostra a amostra
│   └── relatorio_comparativo_results13062022.py
├── data/
│   ├── raw/imagens_nucleos/                 # 43 imagens de núcleos
│   ├── raw/imagens_proteinas/               # 43 imagens de proteínas
│   └── baseline/nucleos_preenchidos/        # máscaras do método antigo
├── docs/
├── results/                                 # resultados locais, em geral ignorados
├── requirements.txt
└── README.md
```

## 5. Pipeline de linha de comando

O pipeline principal está em `src/pipeline_melhorado.py`.

### 5.1 Pareamento das imagens

O dataset possui arquivos de canal nuclear e proteico. Os sufixos aceitos são
`_z0_ch00.tif`, `_z0_ch02.tif`, `_ch00.tif` e `_ch02.tif`. O pareamento remove
somente o sufixo de canal e utiliza a chave restante.

O manifesto produzido é `results/manifesto_amostras.csv` e registra:

- `sample_key`;
- arquivo de núcleo;
- arquivo de proteína;
- estado `paired` ou `incomplete_pair`.

Isso recupera a amostra `Image007`, que era perdida pelo pareamento literal do
código da iniciação científica. O método antigo media 42 pares; o revisado
consegue processar 43 pares completos neste dataset.

### 5.2 Canais

As imagens são lidas com OpenCV sem conversão automática para tons de cinza:

- canal nuclear padrão: `0`;
- canal de proteína padrão: `2`, correspondente ao vermelho no array BGR.

A conversão para tons de cinza é inadequada para a quantificação da proteína
neste dataset porque reduz o valor específico do marcador vermelho.

### 5.3 Segmentação

Para o canal nuclear, o pipeline executa:

1. recorte para a faixa de 8 bits;
2. filtro Gaussiano;
3. limiarização de Otsu;
4. abertura morfológica elíptica;
5. fechamento morfológico elíptico;
6. componentes conectados com conectividade 8;
7. remoção de componentes menores que `min_nucleus_area`;
8. remapeamento para IDs individuais.

A máscara usada na medição é monocanal e binária. Overlays coloridos só são
gerados para controle visual quando `--save-images` é usado.

### 5.4 Configuração padrão do CLI

```text
nucleus_channel = 0
protein_channel = 2
gaussian_kernel = 5
gaussian_sigma = 1.0
opening_kernel = 3
closing_kernel = 5
min_nucleus_area = 100
background_border_width = 20
```

Os kernels precisam ser positivos e ímpares.

### 5.5 Fundo

O fundo padrão é estimado pela faixa externa de 20 pixels da imagem,
excluindo pixels pertencentes aos núcleos. Se essa faixa tiver menos de 100
pixels válidos, o algoritmo usa todos os pixels fora dos núcleos.

```text
intensidade corrigida = média da proteína no núcleo − média do fundo
```

Valores negativos não são convertidos para zero. Eles podem indicar que o
sinal do núcleo não se diferencia do fundo ou que a referência precisa ser
reavaliada.

### 5.6 Métricas por núcleo

O arquivo `results/resultados_por_nucleo.csv` contém uma linha por núcleo:

- `sample_key`;
- `nucleus_id`;
- `area_px`;
- `signal_mean_raw`;
- `signal_median_raw`;
- `signal_std_raw`;
- `integrated_intensity_raw`;
- `background_mean_raw`;
- `signal_mean_background_corrected`;
- `background_pixels`.

Na aplicação web, as métricas possuem nomes mais descritivos e incluem também:

- centroide;
- caixa delimitadora;
- perímetro;
- raio e diâmetro equivalentes;
- eixos maior e menor;
- excentricidade;
- intensidade nuclear;
- intensidade proteica;
- mediana e desvio padrão de cada canal;
- intensidade integrada;
- polígono do contorno;
- estado do núcleo.

Os desvios padrão atuais são populacionais (`numpy.std`, `ddof=0`). Isso deve
ser mantido ou explicitamente alterado em todos os relatórios se o TCC decidir
usar desvio amostral.

### 5.7 Resumos e arquivos gerados

O pipeline também produz:

- `results/resumo_por_amostra.csv`;
- `results/configuracao.json`;
- `results/comparativo_amostras.csv`;
- `results/comparativo_resultados.md`;
- `results/comparativo_resumo.json`.

Com `--save-images`, também são criadas:

- `results/mascaras_melhoradas/`;
- `results/overlays_melhorados/`.

## 6. Aplicação web local

A aplicação é composta por uma API FastAPI e uma interface React local.

### 6.1 Fluxo de uma imagem

1. O usuário seleciona um arquivo nuclear e um arquivo proteico.
2. A interface envia os arquivos e a configuração para `POST /api/sessions`.
3. O backend valida nomes, tamanho, formato, dimensões e canais.
4. A sessão recebe um `session_id` e um `job_id`.
5. O processamento é executado em segundo plano.
6. O frontend acompanha o job por SSE e polling de segurança.
7. O resultado é carregado e exibido no canvas, no painel de métricas e na tabela.

Também é possível enviar uma imagem multicanal como arquivo nuclear e omitir o
arquivo proteico; nesse caso o backend reutiliza os mesmos bytes e extrai os
canais configurados.

### 6.2 Fluxo de pastas

O modo **Pastas** recebe:

- uma pasta de núcleos;
- uma pasta de proteínas.

O frontend envia todos os arquivos com `webkitRelativePath`. O backend
normaliza o nome, faz o pareamento e cria uma sessão para cada par. Os pares
incompletos aparecem no lote e não são processados. Arquivos duplicados para a
mesma chave geram erro.

O lote tem monitoramento próprio, progresso, estado por par e seleção de um par
concluído para revisão individual.

### 6.3 Estados dos núcleos

Cada núcleo pode estar em um dos estados:

- `active`: considerado normalmente;
- `hidden`: continua nos resultados, mas é visualmente atenuado;
- `excluded`: não participa das métricas agregadas.

As ações de ocultar, excluir e restaurar podem ser aplicadas a um ou vários
IDs selecionados. A seleção pode ser feita na imagem ou na tabela.

### 6.4 Histórico e revisão concorrente

Cada resultado tem uma `revision`. Alterações enviam `base_revision`. Se outra
alteração já tiver modificado a sessão, a API responde HTTP 409 com a revisão e
o resultado atual.

As operações suportadas são:

- ocultar;
- excluir;
- restaurar;
- editar contorno;
- desfazer;
- refazer;
- reprocessar com nova configuração.

Atalhos do frontend:

- `Ctrl+Z` ou `Cmd+Z`: desfazer;
- `Ctrl+Y` ou `Cmd+Y`: refazer.

Reprocessar descarta IDs e edições atuais, por isso a interface pede
confirmação.

### 6.5 Zoom e navegação da imagem

O componente `ImageViewer` desenha a imagem e os contornos em um canvas HTML.
Ele mantém uma transformação com:

```text
scale, x, y
```

O scroll calcula um fator de zoom em torno da posição do cursor. A função
`zoomAt` converte o cursor para coordenadas da imagem antes de alterar a escala
e recalcula o deslocamento para manter o ponto sob o cursor. A escala é limitada
entre `0.1` e `12`.

Controles disponíveis:

- scroll: zoom centrado no cursor;
- arrastar área vazia: pan;
- `+` e `−`: zoom centrado no canvas;
- `Ajustar`: encaixar na área disponível;
- `100%`: escala real.

O `ResizeObserver` refaz o ajuste enquanto o usuário não interagiu. Depois que
há pan ou zoom manual, o redimensionamento não deve roubar a posição escolhida.

### 6.6 Edição de contorno

O contorno é um polígono em coordenadas da imagem. Ao entrar em edição, o
frontend copia o polígono do núcleo selecionado para um estado temporário.

- Arrastar um ponto amarelo move um vértice.
- Duplo clique próximo a uma aresta calcula a projeção mais próxima nessa aresta
  e insere um novo vértice.
- Botão direito próximo a um vértice remove esse ponto.
- O polígono não pode ficar com menos de três vértices.
- `Confirmar` envia `edit_contour`, valida o polígono no backend e recalcula as
  métricas.
- `Cancelar` descarta a cópia temporária.

A tolerância de seleção é calculada em coordenadas da imagem e varia com o
zoom, aproximadamente entre 8 e 22 pixels. A implementação atual usa o
primeiro vértice do polígono que está dentro da tolerância; se houver vértices
muito próximos, uma melhoria futura é escolher explicitamente o vértice de
menor distância.

O backend verifica quantidade de pontos, limites da imagem, área não nula e
autointerseções básicas antes de aceitar o contorno.

### 6.7 Histogramas, CSV e JSON

Os histogramas são gerados no backend com Matplotlib, não desenhados com SVG ou
Canvas no frontend. Eles exibem barras, média, faixa média ± 1 DP e quantidade
de valores.

No modo individual, o histograma começa oculto e aparece quando o usuário
aciona **Histograma**. Ele representa a distribuição das médias de proteína
dos núcleos ativos.

No modo de pastas, são exibidos três histogramas:

1. desvio padrão proteico por imagem;
2. número de núcleos por imagem;
3. intensidade média de proteína por núcleo no lote.

Exportações disponíveis:

- CSV individual por sessão;
- JSON individual por sessão;
- CSV resumido do lote;
- PNG do histograma individual;
- PNGs dos histogramas do lote.

### 6.8 Avisos e elementos removidos

Foi removida da criação de sessões a mensagem:

> A validação automática é uma etapa de apoio e não substitui uma máscara anotada manualmente.

O frontend ainda pode exibir avisos de entrada derivada, por exemplo quando o
nome do arquivo contém `_mask`, `_overlay`, `_border`, `binariz`, `gaussian` ou
`filled`. Esse aviso é diferente da mensagem removida.

A métrica de circularidade não é mais exibida no painel da interface nem na
tabela. Entretanto, o campo legado `circularity` ainda é calculado em
`backend/app/processing/metrics.py` e permanece no tipo TypeScript. Se for
necessário removê-lo completamente, será preciso alterar o cálculo, o contrato,
os testes e qualquer consumidor de exportação.

## 7. Endpoints da API

Todos os endpoints usam o prefixo `/api`.

| Método e rota | Finalidade |
|---|---|
| `GET /health` | Verifica se a API está ativa. |
| `POST /sessions` | Cria e inicia uma análise individual. |
| `GET /sessions/{id}` | Retorna metadados da sessão. |
| `GET /sessions/{id}/result` | Retorna métricas e núcleos processados. |
| `GET /sessions/{id}/events` | Fluxo SSE do job. |
| `GET /jobs/{id}` | Consulta o estado do processamento. |
| `GET /sessions/{id}/images/{nucleus\|protein\|mask}.png` | Retorna prévia de camada. |
| `POST /sessions/{id}/edits` | Oculta, exclui, restaura ou edita contorno. |
| `POST /sessions/{id}/undo` | Desfaz uma revisão. |
| `POST /sessions/{id}/redo` | Refaz uma revisão. |
| `POST /sessions/{id}/reprocess` | Reprocessa com configuração. |
| `GET /sessions/{id}/export.csv` | Exporta métricas por núcleo. |
| `GET /sessions/{id}/export.json` | Exporta resultado e histórico. |
| `GET /sessions/{id}/protein-histogram.png` | Histograma individual. |
| `POST /batches` | Cria análise de duas pastas. |
| `GET /batches/{id}` | Consulta estado e resumo do lote. |
| `GET /batches/{id}/export.csv` | Exporta resumo do lote. |
| `GET /batches/{id}/histogram/{kind}.png` | Gera histograma `standard-deviation`, `nuclei` ou `intensity`. |
| `GET /batches/{id}/standard-deviation.png` | Rota legada para histograma de DP. |

## 8. Persistência e ciclo de vida

O diretório de dados do backend é `.nuclei_data/` por padrão e pode ser
alterado com `NUCLEI_DATA_DIR`.

O SQLite guarda:

- IDs de sessão e job;
- revisão;
- status;
- configuração;
- metadados dos arquivos;
- histórico das operações.

As imagens, arrays NumPy, labels, núcleos processados e lotes ficam em memória
no `SessionManager`. Portanto, reiniciar o backend não restaura completamente
as sessões existentes. Essa é uma limitação importante se a aplicação for
transformada em serviço persistente.

Há dois pools de threads:

- até dois workers para sessões individuais;
- um monitor para acompanhar lotes.

O processamento de cada sessão individual é assíncrono. O frontend usa SSE e
uma consulta periódica ao job para evitar ficar preso em uma porcentagem antiga.

## 9. Comparações já produzidas

### 9.1 Baseline da iniciação científica

`src/comparar_resultados.py` compara o método antigo, reproduzido pelas
máscaras em `data/baseline/nucleos_preenchidos`, com o pipeline revisado.

O baseline mede pontos do contorno em tons de cinza. O TCC mede pixels internos
no canal vermelho, preserva o ID do núcleo e aplica correção de fundo.

O relatório completo é gerado por:

```powershell
python src/comparar_resultados.py
python src/relatorio_comparativo_dataset.py
```

O arquivo amostra a amostra é:

```text
results/comparacao_completa_dataset.md
```

Essa comparação é útil para documentar a mudança de definição de medida, mas a
diferença numérica não pode ser descrita como aumento biológico da proteína.

### 9.2 Acervo externo `results13062022`

O relatório solicitado pelo usuário foi criado com:

```powershell
python src/relatorio_comparativo_results13062022.py `
  --reference-dir "C:\Users\lazar\OneDrive - Universidade Federal de Uberlândia\UFU\10o semestre\tcc\results13062022"
```

Na execução de referência, foram encontrados:

- TCC: 43 imagens e 1.705 núcleos;
- resultados existentes: 204 imagens e 13.740 núcleos.

O relatório separa os três conjuntos experimentais existentes e compara média,
desvio padrão, área e núcleos por imagem. O arquivo padrão é:

```text
results/comparacao_tcc_vs_results13062022.md
```

Essa tabela é descritiva e agregada. Não há pareamento entre os 43 arquivos do
TCC e as 204 imagens externas.

## 10. Como executar

### 10.1 Instalação

Na raiz do repositório:

```powershell
python -m pip install -r requirements.txt
```

No frontend:

```powershell
cd frontend
npm install
```

### 10.2 Aplicação web

Terminal 1, na raiz:

```powershell
python -m uvicorn backend.app.main:app --reload --port 8000
```

Terminal 2:

```powershell
cd frontend
npm run dev
```

Abrir:

```text
http://localhost:5173
```

O frontend usa `http://localhost:8000/api` por padrão. Para outro endereço,
definir `VITE_API_URL` antes de iniciar o Vite.

### 10.3 Pipeline CLI

```powershell
python src/pipeline_melhorado.py --verbose
python src/pipeline_melhorado.py --save-images
python src/comparar_resultados.py
python src/tabela_comparativa.py
```

Parâmetros mais usados:

```powershell
python src/pipeline_melhorado.py --min-nucleus-area 100 --background-border-width 20
```

### 10.4 Testes e build

```powershell
python -m unittest discover -s tests -v
python -m pytest backend/tests -q
cd frontend
npm test
npm run build
```

Na última validação antes deste documento:

- 3 testes do pipeline passaram;
- 8 testes do backend passaram;
- 3 testes do frontend passaram;
- o build de produção do frontend passou.

## 11. Revisão técnica: limitações e pontos de atenção

Esta seção é deliberadamente explícita para orientar futuras alterações.

### 11.1 Validação biológica ainda ausente

Não há ground truth manual, métricas de IoU/precision/recall/F1 ou controles
experimentais conectados ao código. Não afirmar que o algoritmo é mais acurado
biologicamente apenas porque é mais rastreável ou produz intensidades maiores.

### 11.2 Núcleos encostados

A segmentação por componentes conectados pode manter dois núcleos encostados
como um único objeto. Watershed é uma melhoria futura provável, mas deve ser
validada com anotações manuais.

### 11.3 Fundo

A faixa externa de 20 pixels é uma escolha operacional. Ela pode não representar
o fundo biológico correto em todos os experimentos. Alterá-la exige documentar
o motivo e reprocessar os resultados.

### 11.4 Edição de contorno e máscara

Ao editar um contorno, o backend recalcula o polígono e as métricas daquele
núcleo, mas não reconstrói `state.labels` nem a máscara binária global. Como a
rota de imagem da máscara usa `state.labels`, a visualização da máscara pode
continuar mostrando a segmentação original enquanto as métricas já refletem o
contorno editado. Se a intenção for uma edição completamente consistente, será
necessário atualizar labels, máscara, fundo e demais objetos afetados.

### 11.5 Persistência

O SQLite não é suficiente para reabrir uma sessão completa após reinício. Para
produção ou uso prolongado, seria preciso persistir imagens ou resultados
serializados e reconstruir o `SessionManager` na inicialização.

### 11.6 Circularidade

O usuário pediu a retirada da circularidade da interface. Isso foi atendido no
frontend, mas o backend ainda retorna o campo. Uma remoção completa requer
decidir se o campo também deve desaparecer dos CSVs/JSONs e então ajustar
`calculate_metrics`, os tipos TypeScript e os testes.

### 11.7 Contorno complexo

O teste de autointerseção é intencionalmente simples. Contornos com pontos
colineares, arestas coincidentes ou geometrias degeneradas podem exigir uma
validação geométrica mais robusta.

### 11.8 Escalabilidade

Os arrays e lotes ficam em memória. Imagens muito grandes, muitos arquivos ou
vários usuários simultâneos podem exigir limites, limpeza de sessões, fila de
jobs e armazenamento externo.

### 11.9 Testes de interface

Os testes atuais cobrem transformações geométricas, API, processamento e
serviço. Ainda não há teste de navegador para upload de pastas, zoom real,
edição de vértices ou fluxo completo de SSE.

## 12. Procedimento recomendado para futuras IAs

1. Confirmar que o diretório de trabalho é o repositório `tcc-drosophila`.
2. Executar `git status --short` antes de alterar qualquer arquivo.
3. Ler este documento, `README.md` e o arquivo específico que será modificado.
4. Preservar `data/raw` e não substituir os resultados do TCC pelos dados da IC.
5. Antes de mudar métricas, decidir se a alteração afeta CLI, API, frontend,
   CSV, JSON e relatórios.
6. Manter compatibilidade entre `backend/app/models/schemas.py`,
   `backend/app/processing/metrics.py`, `frontend/src/types.ts` e os componentes.
7. Para mudanças na API, atualizar os testes em `backend/tests`.
8. Para mudanças de zoom/contorno, atualizar `frontend/src/utils/geometry.test.ts`
   e considerar a transformação entre tela e imagem.
9. Rodar todos os testes e o build antes do commit.
10. Registrar no commit o que mudou e não adicionar `Co-authored-by` se a
    solicitação continuar exigindo commits sem coautoria.

## 13. Arquivos que normalmente precisam ser alterados juntos

### Nova métrica

```text
backend/app/processing/metrics.py
backend/app/services/session_manager.py
backend/app/models/schemas.py       # quando houver modelo explícito
frontend/src/types.ts
frontend/src/components/MetricsPanel.tsx
src/pipeline_melhorado.py            # se também existir no CLI
README.md ou docs/
```

### Novo endpoint

```text
backend/app/main.py
backend/app/services/session_manager.py
frontend/src/api.ts
frontend/src/types.ts
backend/tests/test_api.py
backend/tests/test_sessions.py       # se afetar o serviço
```

### Mudança no editor de contorno

```text
frontend/src/components/ImageViewer.tsx
frontend/src/utils/geometry.ts
frontend/src/utils/geometry.test.ts
backend/app/processing/algorithm.py
backend/app/services/session_manager.py
backend/tests/test_sessions.py
```

### Mudança em exportações ou comparação

```text
backend/app/services/session_manager.py
backend/app/main.py
src/comparar_resultados.py
src/relatorio_comparativo_dataset.py
src/relatorio_comparativo_results13062022.py
README.md
docs/
```

## 14. Resumo para colar em outra IA

```text
Este é o repositório do TCC em
C:\Users\lazar\OneDrive - Universidade Federal de Uberlândia\UFU\10o semestre\tcc\tcc-drosophila.
Não alterar o repositório da IC; ele serve somente como referência.

O projeto tem dois fluxos:
1. src/pipeline_melhorado.py: CLI que pareia imagens, lê canal nuclear 0 e
   proteína 2, aplica Gauss/Otsu/morfologia, rotula núcleos, estima fundo e
   exporta CSV/JSON.
2. backend + frontend: aplicação local FastAPI/React para processar imagens ou
   duas pastas, revisar métricas, selecionar/ocultar/excluir/restaurar núcleos,
   editar contornos, desfazer/refazer, ver histogramas Matplotlib e exportar.

A interface usa canvas. Scroll faz zoom em torno do cursor; arrastar faz pan.
Na edição, arrastar vértices move pontos, duplo clique perto da borda adiciona
um ponto e botão direito remove ponto, com mínimo de três vértices. Confirmar
envia edit_contour com base_revision.

Os desvios padrão são populacionais (numpy.std). Excluir remove o núcleo das
métricas agregadas; ocultar apenas o atenua visualmente. Histogramas começam
ocultos no modo individual. O lote exibe histogramas de DP por imagem, núcleos
por imagem e intensidade proteica, além de CSV.

A mensagem de validação manual foi removida. Circularidade não aparece mais na
interface, mas ainda existe como campo legado no backend. Sessões e lotes ficam
em memória; SQLite guarda apenas metadados e histórico. Editar o contorno
recalcula o núcleo, mas atualmente não substitui a máscara global exibida.

Antes de modificar: leia este documento, verifique git status, mantenha a
compatibilidade entre backend e frontend, rode os testes e o build.
```
