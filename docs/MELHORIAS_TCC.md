# Melhorias implementadas no pipeline

## Objetivo

Esta versão revisada foi criada para transformar o protótipo da iniciação científica em um pipeline mais adequado ao TCC, mantendo os scripts originais intactos para permitir uma comparação reprodutível.

O método original é reproduzido pelo comparador usando as máscaras preservadas em `data/baseline/nucleos_preenchidos`. O novo método está em `src/pipeline_melhorado.py` e a comparação está em `src/comparar_resultados.py`.

## Alterações implementadas

### 1. Pareamento robusto

O novo pipeline normaliza os sufixos `_z0_ch00.tif`, `_z0_ch02.tif`, `_ch00.tif` e `_ch02.tif`. Isso recupera o par `Image007`, que era ignorado pelo código original.

O arquivo `manifesto_amostras.csv` registra todos os arquivos pareados e incompletos.

### 2. Seleção explícita dos canais

O núcleo é lido pelo canal azul (`channel=0`) e a proteína pelo canal vermelho (`channel=2`), preservando a intensidade original de 8 bits. A nova implementação não converte a proteína para tons de cinza antes da quantificação.

### 3. Máscara monocanal e segmentação individual

O pipeline aplica Gaussian, Otsu, abertura/fechamento morfológico e remoção de componentes menores que `min_nucleus_area`. Depois, cada componente conectado recebe um identificador próprio.

As máscaras são mantidas como imagens binárias monocanais. Sobreposições coloridas são usadas apenas para controle visual.

### 4. Quantificação no interior do núcleo

Para cada núcleo são calculados área, média, mediana, desvio-padrão, intensidade integrada, fundo local e intensidade média corrigida pelo fundo.

O resultado está em `results/resultados_por_nucleo.csv`. A média por amostra é calculada a partir das médias dos núcleos, sem misturar todos os contornos em uma única lista.

### 5. Correção de fundo por amostra

Por padrão, é utilizada uma faixa externa de 20 pixels da imagem como referência global de fundo por amostra. Essa escolha evita que um anel local ao redor do núcleo capture sinal citoplasmático ou outras estruturas da larva. Se a faixa não tiver pixels suficientes, o pipeline usa como fallback todos os pixels fora dos núcleos. O valor não é truncado em zero, pois valores negativos são úteis para identificar amostras em que o sinal não se diferencia do fundo.

### 6. Validações de entrada e saída

O pipeline verifica leitura das imagens, compatibilidade de dimensões, existência de canais, nomes duplicados e falhas de gravação.

### 7. Reprodutibilidade

Os parâmetros utilizados são salvos em `configuracao.json`. O processamento pode ser executado pela linha de comando e gera resultados tabulares, manifesto e configuração. Imagens de controle de qualidade são opcionais para evitar poluir o repositório.

## Execução

```text
python src/pipeline_melhorado.py --verbose
python src/comparar_resultados.py
```

Para gerar máscaras e overlays de controle visual sob demanda:

```text
python src/pipeline_melhorado.py --save-images
```

Parâmetros úteis:

```text
python src/pipeline_melhorado.py --min-nucleus-area 100 --background-border-width 20
```

## Arquivos gerados

- `results/manifesto_amostras.csv`: pares de imagens e status.
- `results/resultados_por_nucleo.csv`: medidas individuais.
- `results/resumo_por_amostra.csv`: resumo por imagem.
- `results/comparativo_amostras.csv`: comparação amostra a amostra.
- `results/comparativo_resultados.md`: resumo textual da comparação.
- `results/comparativo_resumo.json`: estatísticas numéricas da comparação.
- `results/mascaras_melhoradas/`: máscaras binárias por amostra, somente com `--save-images`.
- `results/overlays_melhorados/`: imagens para inspeção visual, somente com `--save-images`.

## Testes

Os testes de regressão em `tests/test_pipeline_melhorado.py` verificam os dois formatos de nome de arquivo, a existência dos 43 pares completos e a presença de sinal nos canais selecionados.

```text
python -m unittest discover -s tests -v
```

## Limitações que permanecem como trabalho experimental

1. A segmentação ainda precisa ser validada contra máscaras anotadas manualmente.
2. O limiar de área mínima e os kernels morfológicos devem ser ajustados usando um conjunto de validação, não apenas pelo resultado visual.
3. Núcleos encostados podem exigir watershed para separar instâncias.
4. A correção de fundo deve ser comparada com controles experimentais e com uma região de fundo biologicamente adequada; a faixa externa de 20 pixels é uma escolha operacional inicial, não uma calibração biológica definitiva.
5. O registro espacial entre os canais deve ser validado caso as imagens tenham sido adquiridas/exportadas separadamente.

Essas limitações estão explicitadas para evitar que a nova versão seja apresentada como validada biologicamente antes da etapa de ground truth.
