# TCC — Caracterização morfológica e quantificação nuclear em Drosophila melanogaster

Repositório dedicado ao Trabalho de Conclusão de Curso, derivado do projeto de iniciação científica.

## Estrutura

```text
src/                         Pipeline revisado e comparador
tests/                       Testes de regressão
data/raw/                    Imagens de entrada
data/baseline/               Máscaras usadas pelo método antigo
docs/                        Relatório e documentação
results/                     Resultados gerados localmente
```

As pastas intermediárias antigas e as imagens não utilizadas diretamente foram deixadas fora para manter o projeto limpo. O repositório original permanece preservado.

## Execução

```text
python src/pipeline_melhorado.py --verbose
python src/comparar_resultados.py
python src/tabela_comparativa.py
```

Por padrão, o pipeline gera apenas arquivos tabulares e não cria imagens intermediárias. Para gerar máscaras e overlays de controle de qualidade:

```text
python src/pipeline_melhorado.py --save-images
```

## Testes

```text
python -m unittest discover -s tests -v
```

As alterações estão documentadas em [docs/MELHORIAS_TCC.md](docs/MELHORIAS_TCC.md). O comparativo detalhado, com roteiro para apresentação, está em [docs/COMPARATIVO_IC_VS_TCC.md](docs/COMPARATIVO_IC_VS_TCC.md). O contexto completo para continuidade por outra pessoa ou IA está em [docs/CONTEXTO_PARA_CONTINUIDADE.md](docs/CONTEXTO_PARA_CONTINUIDADE.md).

Para uma tabela simples, própria para mostrar ao orientador, execute `python src/tabela_comparativa.py`. Ela gera `results/tabela_media_proteina_ic_vs_tcc.csv` e `results/tabela_media_proteina_ic_vs_tcc.md`.

Para o comparativo completo, amostra por amostra, entre o baseline original e o
algoritmo do TCC, execute `python src/relatorio_comparativo_dataset.py`. O arquivo
gerado é `results/comparacao_completa_dataset.md` e inclui contagem de núcleos,
médias, desvios-padrão e diferenças entre os métodos.

Para comparar os resultados atuais com o acervo externo de `results13062022`,
execute `python src/relatorio_comparativo_results13062022.py --reference-dir
"C:\\Users\\lazar\\OneDrive - Universidade Federal de Uberlândia\\UFU\\10o semestre\\tcc\\results13062022"`.

## Interface web de revisão

O projeto do TCC também inclui uma aplicação local para revisar, editar e
quantificar núcleos em `backend/` e `frontend/`. O pipeline original do TCC em
`src/pipeline_melhorado.py` foi preservado e é reutilizado pelo adaptador do
backend; o repositório da iniciação científica é somente a referência histórica.

### Execução

Na raiz deste repositório:

```text
python -m pip install -r requirements.txt
python -m uvicorn backend.app.main:app --reload --port 8000
```

Em outro terminal:

```text
cd frontend
npm install
npm run dev
```

Abra `http://localhost:5173`. O backend aceita TIFF/TIF, PNG e JPEG, imagens
monocanais/RGB, canais configuráveis, pares separados e uma única imagem
multicanal pela API. Uploads têm nomes sanitizados, validação de formato,
limite de tamanho e não aceitam caminhos arbitrários.

O processamento é assíncrono e informado por SSE. A interface permite zoom,
pan, seleção no canvas e na tabela, consulta das métricas, ocultar, excluir,
restaurar, editar vértices do contorno, undo/redo e exportação CSV/JSON.
O botão **Salvar e baixar** grava a sessão e baixa um pacote ZIP autocontido com
os arquivos originais, imagens normalizadas, máscara original e revisada,
overlays com os contornos/IDs, métricas, auditoria, revisões e histogramas de
proteína, núcleo e desvio padrão. No processamento em lote, **Baixar lote
completo (ZIP)** reúne ainda os histogramas consolidados e o pacote de cada par.
Cada edição usa `base_revision`; conflitos retornam HTTP 409.

### Persistência e rastreabilidade

Não é necessário configurar banco de dados. Cada análise é guardada localmente
em `.nuclei_data/<id-da-sessão>/`, contendo os arquivos de entrada, o estado
atual (`session.json`), as matrizes de segmentação (`analysis.npz`), fotografias
das revisões e o diário de auditoria (`audit.jsonl`). Ao reiniciar o backend, as
sessões concluídas são restauradas e podem ser reabertas pela seção **Sessões
salvas** da interface.

O diário registra criação, processamento, ajustes de contorno, exclusões,
restaurações, desfazer/refazer e reprocessamentos, com horário, revisão e o
responsável informado na interface. O mesmo histórico também acompanha a
exportação JSON. Para armazenar essas análises em outro local, defina a
variável de ambiente `NUCLEI_DATA_DIR` antes de iniciar o backend.

Ao redesenhar um núcleo, um traço que se cruza é normalizado
automaticamente para um contorno externo válido antes da quantificação. A
correção fica registrada na trilha de auditoria, evitando que um deslize no
desenho interrompa a revisão.

Entradas com nomes `_border`, `_mask`, `_overlay`, `binarizada`, `gaussian` ou
`filled` são marcadas como derivadas e geram um aviso, pois overlays não
equivalem aos pixels dos TIFFs brutos. Normalizações são usadas somente para
pré-visualização; a quantificação usa os arrays originais.

### Testes

```text
python -m unittest discover -s tests -v
python -m pytest backend/tests -q
cd frontend
npm test
npm run build
```

As definições matemáticas das métricas, a arquitetura e as limitações
biológicas permanecem documentadas em `docs/MELHORIAS_TCC.md`.

Para disponibilizar a plataforma ao grupo de validação, siga o roteiro de
[publicação com Vercel e Railway](docs/DEPLOYMENT.md).
