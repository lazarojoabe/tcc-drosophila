# Comparativo completo: projeto da IC versus código revisado do TCC

Este documento descreve, de forma auditável, o que foi alterado entre o projeto da iniciação científica (IC) e a versão revisada para o TCC. Ele separa três ideias:

1. **Correção científica da medida:** medir o canal que realmente contém a proteína e usar a região interna dos núcleos.
2. **Robustez computacional:** tratar pareamento, formatos de arquivo, ruídos e componentes de forma explícita.
3. **Reprodutibilidade e manutenção:** transformar scripts dependentes de pastas intermediárias em um pipeline parametrizado, testável e documentado.

A versão revisada ainda não deve ser apresentada como biologicamente validada. Ela é uma versão metodologicamente mais coerente e preparada para a próxima etapa de validação com anotações manuais, controles experimentais e análise estatística.

## 1. Resumo em uma frase

Na IC, o projeto funcionava como uma sequência de scripts que produzia uma média de intensidade a partir de pontos de contorno; no TCC, ele foi reorganizado como um pipeline reproduzível que identifica os pares de imagens, segmenta cada núcleo individualmente, mede a proteína no interior usando o canal vermelho bruto, estima o fundo e exporta resultados detalhados por núcleo e por amostra.

## 2. O que existia na IC

### 2.1 Organização original

O repositório original reunia imagens brutas, imagens intermediárias, máscaras, imagens de borda, imagens preenchidas, scripts auxiliares e o relatório final. A execução dependia de várias pastas previamente criadas e de uma ordem manual entre scripts.

Os principais scripts eram:

- `aplicaGaussianoEOtsu.py`: filtro Gaussiano e limiarização de Otsu.
- `detectaBordas.py`: detecção de bordas com Canny e desenho dos contornos.
- `preencheNucleos.py`: preenchimento dos contornos.
- `obtemMediaProteina.py`: coleta de intensidades e cálculo da média.
- `procura_proteinas_relatorio.py`: cópia/renomeação de arquivos para organizar parte do material do relatório.

### 2.2 Fluxo efetivamente executado

```text
imagens_nucleos
    -> Gaussian + Otsu
    -> Canny
    -> contornos desenhados
    -> contornos preenchidos
    -> coordenadas dos contornos
    -> média da proteína

imagens_proteinas
    -> também passavam por Gaussian + Otsu,
       mas essa saída não era usada pelo script de quantificação
    -> no cálculo final eram lidas diretamente em tons de cinza
```

O relatório da IC descreve a motivação, as etapas de processamento e as métricas do projeto original. Para compreender a alteração, é importante distinguir o procedimento descrito do comportamento efetivo dos scripts: o cálculo final em `obtemMediaProteina.py` usava somente os pontos dos contornos, apesar de a etapa anterior ter produzido imagens preenchidas.

### 2.3 Problemas identificados no código original

#### A. Pareamento incompleto

O código substituía exatamente `_z0_ch00.tif` por `_z0_ch02.tif`. Uma amostra (`Image007`) não possuía `_z0_` no nome. Portanto, havia 43 imagens de núcleos e 43 de proteína, mas somente 42 pares eram efetivamente medidos pelo script original.

#### B. Canal inadequado no pré-processamento da proteína

As imagens de núcleos têm sinal no canal 0, correspondente ao azul no arquivo lido pelo OpenCV. As imagens de proteína têm sinal no canal 2, correspondente ao vermelho. Entretanto, `aplicaGaussianoEOtsu.py` selecionava `blue` para os dois tipos de imagem. Como consequência, as imagens `proteinas_gaussianas` e `proteinas_binarizadas` eram essencialmente vazias para este conjunto de dados.

Esse erro não anulava completamente o resultado final porque `obtemMediaProteina.py` lia `imagens_proteinas` diretamente, mas revelava uma inconsistência no pipeline e poderia causar erro caso as imagens intermediárias da proteína fossem usadas.

#### C. Conversão desnecessária da proteína para tons de cinza

O cálculo final usava `cv2.IMREAD_GRAYSCALE`. Para imagens com sinal exclusivamente vermelho, isso reduz o valor medido para uma combinação ponderada dos canais, em vez de preservar o valor original do canal vermelho. No dataset analisado, a intensidade vermelha é aproximadamente 3,35 vezes maior que o valor correspondente em tons de cinza.

#### D. Medição de contorno em vez de medição da área nuclear

O script extraía as coordenadas dos pontos de contorno e consultava a proteína somente nesses pontos. A área interna que havia sido preenchida na etapa anterior não era usada para calcular a média final.

Isso torna a medida sensível ao perímetro, à discretização do contorno e à complexidade da borda, em vez de representar a expressão média de todos os pixels do núcleo.

#### E. Perda da identidade dos núcleos

Todos os pontos de todos os contornos eram colocados em uma única lista e uma única média era calculada por imagem. O resultado não permitia saber qual núcleo tinha qual intensidade, área, variabilidade ou valor integrado.

#### F. Ausência de correção de fundo

O valor reportado era a intensidade direta da imagem de proteína. Não havia estimativa explícita do sinal de fundo da imagem. Assim, iluminação desigual, autofluorescência e sinal residual poderiam ser incorporados à medida como se fossem expressão proteica.

#### G. Ruído e fragmentação sem tratamento explícito

O código original aplicava Canny com limiares fixos `0` e `20`, mas não tinha uma etapa explícita para remover componentes pequenos depois da binarização. O dataset apresentava, em média, aproximadamente 80 componentes por imagem na máscara de Otsu, muitos deles menores que 50 pixels.

#### H. Imagens intermediárias em excesso

Cada etapa gravava novas imagens em pastas diferentes. Isso aumentava o uso de disco, poluía o controle de versão e dificultava saber quais arquivos eram entradas, intermediários ou resultados finais.

#### I. Baixa rastreabilidade

Os parâmetros estavam espalhados no código, os resultados eram impressos no terminal e não havia manifesto, arquivo de configuração, esquema de saída ou testes automatizados.

## 3. O que foi implementado no TCC

### 3.1 Novo fluxo

```text
imagens_nucleos + imagens_proteinas
    -> manifesto e pareamento por chave normalizada
    -> leitura explícita dos canais 0 e 2
    -> Gaussian
    -> Otsu
    -> abertura morfológica
    -> fechamento morfológico
    -> remoção de componentes menores
    -> labels individuais dos núcleos
    -> máscara monocanal
    -> fundo externo de referência
    -> medidas por núcleo
    -> resumo por amostra + CSV detalhado + configuração
```

O fluxo foi implementado em `src/pipeline_melhorado.py`. O método antigo foi preservado por meio das máscaras em `data/baseline/nucleos_preenchidos` e é reproduzido pelo `src/comparar_resultados.py`, permitindo uma comparação real entre as duas definições de medida.

### 3.2 Alteração 1 — repositório próprio e estrutura limpa

Foi criado o repositório dedicado ao TCC, separado do repositório da IC:

```text
tcc-drosophila/
├── src/
│   ├── pipeline_melhorado.py
│   └── comparar_resultados.py
├── tests/
│   └── test_pipeline_melhorado.py
├── data/
│   ├── raw/
│   │   ├── imagens_nucleos/
│   │   └── imagens_proteinas/
│   └── baseline/nucleos_preenchidos/
├── docs/
│   ├── MELHORIAS_TCC.md
│   ├── COMPARATIVO_IC_VS_TCC.md
│   └── Relatório_Final_Iniciacao_Cientifica.pdf
├── results/
└── requirements.txt
```

Foram mantidas as 43 imagens brutas de núcleos, as 43 imagens brutas de proteína e as 43 máscaras necessárias para reproduzir o baseline. As demais cópias intermediárias que não são necessárias para executar ou auditar o TCC ficaram fora do novo repositório.

### 3.3 Alteração 2 — pareamento por chave, não por substituição literal

Foi criada a função `pairing_key`, que aceita os formatos com e sem `_z0_`. A função `build_manifest` indexa os canais separadamente, detecta duplicidades e registra a união de todas as chaves.

O resultado é `results/manifesto_amostras.csv`, com:

- chave da amostra;
- nome do arquivo de núcleo;
- nome do arquivo de proteína;
- status `paired` ou `incomplete_pair`.

Impacto observado: 42 pares no método original passaram a 43 pares no método revisado.

### 3.4 Alteração 3 — leitura correta e explícita dos canais

Foi criada `read_channel`, que usa `cv2.IMREAD_UNCHANGED`, verifica se a imagem foi lida, verifica a quantidade de canais e extrai o canal solicitado sem conversão automática para tons de cinza.

Os canais são declarados na configuração:

- núcleo: `channel=0`;
- proteína: `channel=2`.

Isso elimina a ambiguidade do código original e preserva a intensidade original de 8 bits do canal vermelho da proteína.

### 3.5 Alteração 4 — segmentação mais controlada

A etapa `segment_nuclei` mantém o Gaussian e o Otsu usados na IC, mas acrescenta:

- abertura morfológica elíptica de tamanho 3 para remover pequenos ruídos;
- fechamento morfológico elíptico de tamanho 5 para fechar pequenas falhas;
- componentes conectados com conectividade 8;
- filtro por área mínima, inicialmente `100` pixels;
- identificação individual por labels.

A mudança é importante porque a máscara deixa de ser apenas uma imagem visual de contornos e passa a ser uma estrutura de dados com um identificador numérico para cada componente aceito.

O pipeline ainda não separa automaticamente dois núcleos que estejam encostados. Essa é uma limitação conhecida e um candidato natural para a próxima etapa, usando watershed e validação manual.

### 3.6 Alteração 5 — separação entre máscara de medição e visualização

Na versão revisada, a máscara usada na medição é monocanal, binária e independente de cores de desenho. A imagem colorida com contornos verdes passou a ser apenas um overlay opcional de controle de qualidade.

Isso evita que uma cor desenhada para visualização seja interpretada como intensidade biológica. Também corrige o problema prático de criação automática de muitas imagens: por padrão, o pipeline não salva máscaras nem overlays. Eles só são gerados quando o usuário executa:

```text
python src/pipeline_melhorado.py --save-images
```

### 3.7 Alteração 6 — medição de todos os pixels internos

Para cada label individual, o algoritmo cria uma máscara booleana e seleciona todos os valores de proteína que estão dentro daquele núcleo. Não são mais usados apenas os pontos do perímetro.

Para cada núcleo, são exportados:

- `area_px`: quantidade de pixels do núcleo;
- `signal_mean_raw`: média bruta do canal vermelho;
- `signal_median_raw`: mediana, mais robusta a valores extremos;
- `signal_std_raw`: desvio-padrão da intensidade;
- `integrated_intensity_raw`: soma das intensidades do núcleo;
- `background_mean_raw`: média do fundo de referência da amostra;
- `signal_mean_background_corrected`: média bruta menos o fundo;
- `background_pixels`: quantidade de pixels usada para estimar o fundo.

Essa mudança transforma a saída de um número por imagem em uma tabela de análise por núcleo. Também permite escolher posteriormente entre intensidade média, mediana, intensidade integrada ou uma métrica normalizada pela área.

### 3.8 Alteração 7 — média por núcleo, e não uma única lista de contorno

Na IC, a média era calculada sobre todos os pontos concatenados dos contornos. Na revisão, primeiro é calculada a média de cada núcleo e depois a média das médias dos núcleos da amostra.

Assim, cada núcleo contribui igualmente para o resumo da amostra. Essa escolha deve ser declarada metodologicamente: ela não é igual a somar todos os pixels de todos os núcleos e dividir pelo número total de pixels.

### 3.9 Alteração 8 — correção do fundo

O método revisado usa, por padrão, uma faixa externa de 20 pixels da imagem, excluindo os pixels classificados como núcleo, para estimar o fundo global da amostra. Se essa faixa não tiver pixels suficientes, o algoritmo usa todos os pixels fora dos núcleos como fallback.

A intensidade corrigida é:

```text
intensidade corrigida = média no núcleo − média do fundo
```

Valores negativos não são truncados para zero. Eles são úteis como sinal de que o núcleo não se diferencia do fundo ou de que a segmentação/seleção da região de referência precisa ser revisada.

Importante: a borda externa de 20 pixels é uma escolha operacional inicial. A validação biológica do fundo deverá comparar essa referência com controles e regiões de fundo apropriadas ao experimento.

### 3.10 Alteração 9 — saída estruturada e rastreável

O pipeline passa a gerar:

- `manifesto_amostras.csv`: auditoria do pareamento;
- `resultados_por_nucleo.csv`: uma linha por núcleo;
- `resumo_por_amostra.csv`: uma linha por imagem;
- `configuracao.json`: parâmetros usados na execução;
- arquivos de comparação baseline versus revisado.

Os resultados deixam de depender apenas do texto exibido no terminal e podem ser analisados por R, Python, Excel ou outro software estatístico.

### 3.11 Alteração 10 — parâmetros configuráveis

Os principais parâmetros foram centralizados em `PipelineConfig` e também podem ser alterados pela linha de comando:

- canal do núcleo: 0;
- canal da proteína: 2;
- kernel Gaussiano: 5;
- sigma Gaussiano: 1,0;
- kernel de abertura: 3;
- kernel de fechamento: 5;
- área mínima: 100 pixels;
- largura da borda para fundo: 20 pixels.

A configuração efetivamente usada fica salva no resultado. Isso permite repetir uma análise e saber exatamente com quais parâmetros ela foi executada.

### 3.12 Alteração 11 — validações e testes

Foram adicionadas verificações para:

- imagem ilegível;
- imagem monocanal incompatível com o canal solicitado;
- número de canais insuficiente;
- dimensões diferentes entre núcleo e proteína;
- nome de arquivo sem sufixo reconhecido;
- arquivos duplicados para uma mesma chave;
- ausência de pixels disponíveis para o fundo;
- falha na gravação de imagens opcionais;
- kernels pares ou não positivos.

Também foram criados testes de regressão que verificam:

- reconhecimento dos dois formatos de sufixo;
- existência dos 43 pares completos;
- presença de sinal nos canais selecionados.

Resultado atual: **3 testes passaram**.

## 4. Comparação quantitativa realizada

Os números abaixo foram calculados nos 42 pares comuns, para evitar comparar amostras diferentes. O pipeline revisado, entretanto, processou 43 pares porque recuperou `Image007`.

| Indicador | Método da IC | Método revisado | Interpretação |
|---|---:|---:|---|
| Pares medidos | 42 | 43 | O novo pareamento recupera uma amostra |
| Definição da região | Pontos do contorno | Todos os pixels internos | A medida passa a representar a área nuclear |
| Canal da proteína | Tons de cinza | Vermelho bruto, canal 2 | Preserva a intensidade do marcador |
| Fundo | Não estimado | Média da borda externa | Permite corrigir sinal de base |
| Identidade individual | Não preservada | `nucleus_id` por núcleo | Permite análise intra-amostra |
| Média original/revisada bruta | 20,202 | 60,724 | Diferença esperada pelo canal e pela região |
| Média revisada corrigida | — | 36,189 | Sinal médio após subtrair o fundo |
| Núcleos quantificados | — | 1.705 | Saída detalhada em nível individual |
| Mudança absoluta média | — | 25,685 | Diferença média entre corrigido e baseline |
| Mudança relativa média | — | 77,66% | A definição da medida mudou substancialmente |
| Elementos detectados por imagem | 46,95 contornos | 39,48 núcleos | Não é comparação direta: contorno fragmentado não equivale necessariamente a núcleo |

Em termos de cobertura, o resultado passou de 42 para 43 imagens, um aumento de aproximadamente 2,38% no número de amostras processadas.

### 4.1.1 Diagnóstico da máscara

Nos dados analisados, o método original produziu, em média, 53.931 pixels preenchidos por imagem, enquanto a máscara binária de Otsu tinha aproximadamente 34.789 pixels. A razão média entre essas áreas foi 1,586. A sobreposição entre a máscara binária de Otsu e a máscara preenchida apresentou IoU médio de 0,616 e recall médio de 0,976.

Esses números são diagnósticos de consistência entre etapas do próprio processamento; não são uma medida de acurácia biológica, porque não existe ainda uma máscara manual de referência. Eles mostram que o preenchimento recupera grande parte dos pixels positivos, mas também amplia a região em relação à binarização original.

### 4.2 Como interpretar a mudança de 20,202 para 36,189

Não é correto dizer simplesmente que a proteína “aumentou 77,66%”. O que mudou foi a forma de medir:

1. o baseline usava tons de cinza, enquanto a revisão usa o vermelho bruto;
2. o baseline amostrava o contorno, enquanto a revisão usa o interior;
3. a revisão subtrai o fundo;
4. a revisão calcula uma média por núcleo antes da média da imagem.

Portanto, o número de 77,66% é uma medida da diferença entre duas definições de intensidade, não uma evidência de aumento biológico da expressão gênica.

### 4.3 Desempenho computacional

Foram feitas otimizações estruturais:

- o pareamento deixa de procurar cada proteína dentro de todos os nomes de proteína e passa a usar índices por chave;
- a proteína não passa mais por uma etapa intermediária de Gaussian/Otsu que não era usada na quantificação;
- a seleção dos pixels do núcleo usa máscaras e arrays NumPy;
- a gravação de imagens foi tornada opcional;
- o processamento passa a ser executável por uma única entrada de linha de comando.

Não se deve prometer uma aceleração global sem um benchmark controlado. O teste exploratório disponível comparou aproximadamente 1,54 s do cálculo antigo baseado em máscaras já prontas com 4,20 s do núcleo revisado incluindo nova segmentação e quantificação de 1.705 núcleos. Essa comparação não é equivalente: a versão revisada realiza mais trabalho e produz muito mais informação. A prioridade desta entrega foi corrigir a definição da medida e melhorar a rastreabilidade; a otimização de tempo deverá ser medida separadamente depois da estabilização da segmentação.

## 5. O que ainda não foi resolvido

Estas pendências devem ser apresentadas como próximos passos:

1. validar as máscaras contra anotações manuais;
2. medir precisão, recall, IoU e F1 contra ground truth real;
3. ajustar área mínima e kernels em um conjunto de validação;
4. testar watershed para núcleos encostados;
5. validar o registro espacial entre canais;
6. escolher, com base biológica, a região de fundo;
7. avaliar normalização por área, controles negativos e intensidade integrada;
8. fazer benchmark separado para tempo, memória e escalabilidade;
9. avaliar a estabilidade dos resultados em imagens de outros lotes/experimentos.

## 6. Roteiro de apresentação para o orientador

### Abertura

> “Eu preservei o repositório da iniciação científica e criei um repositório dedicado ao TCC. A primeira etapa foi reproduzir o comportamento do código original e comparar esse baseline com uma versão revisada, mantendo os mesmos dados de entrada.”

### Problema encontrado

> “A investigação mostrou que o código original media pontos de contorno em tons de cinza, embora o objetivo fosse medir a proteína no interior dos núcleos. Também havia uma inconsistência de canal: o pré-processamento selecionava azul para a proteína, mas o sinal da proteína está no vermelho. Além disso, uma imagem ficava sem par por causa do padrão do nome do arquivo.”

### Solução implementada

> “A versão revisada identifica os pares por uma chave normalizada, lê explicitamente o canal azul dos núcleos e o canal vermelho da proteína, remove ruídos com morfologia, cria labels individuais e calcula média, mediana, desvio-padrão, intensidade integrada e correção de fundo para cada núcleo.”

### Resultado

> “O método antigo mediu 42 pares e o revisado 43. Nos 42 pares comuns, a média do baseline foi 20,202, a média revisada bruta foi 60,724 e a média corrigida pelo fundo foi 36,189. A diferença média corrigida foi 25,685, ou 77,66%, mas isso não deve ser interpretado como aumento biológico: são definições de medida diferentes.”

### Fechamento

> “A principal entrega desta etapa é uma base de medição mais correta e auditável. A próxima etapa é validar a segmentação com ground truth manual e verificar qual medida de intensidade — média, mediana ou integrada — apresenta melhor relação com os controles biológicos.”

## 7. Perguntas prováveis e respostas

**“O algoritmo melhorou ou apenas mudou o resultado?”**

Ele mudou o resultado porque mudou a definição da medida. A melhoria que pode ser defendida agora é metodológica: canal correto, região interna, identificação por núcleo, fundo explícito e reprodutibilidade. A superioridade biológica ainda depende de ground truth e controles.

**“Por que não usar a imagem em tons de cinza?”**

Porque o marcador de proteína está concentrado no canal vermelho. Converter antes da quantificação aplica uma ponderação de cor e reduz a intensidade do sinal. O canal vermelho bruto preserva diretamente a informação adquirida naquele marcador.

**“Por que medir o interior e não o contorno?”**

Porque a pergunta é a quantidade média de proteína no núcleo. O contorno representa apenas uma pequena fração da área e pode ser influenciado pela discretização e pela qualidade da borda.

**“A média corrigida pode ser negativa?”**

Pode. Isso indica que o sinal médio do núcleo ficou abaixo da referência de fundo. O valor não foi artificialmente truncado, para que amostras potencialmente problemáticas sejam identificadas.

**“A contagem caiu de 46,95 para 39,48; isso é pior?”**

Não é uma comparação direta. O número antigo é de contornos externos, que podem incluir fragmentos de ruído; o novo número é de componentes conectados filtrados por área. A contagem correta precisa ser validada contra o número de núcleos anotado manualmente.

**“O algoritmo ficou mais rápido?”**

Ainda não há evidência de aceleração global em comparação justa. O código ficou mais eficiente em pareamento e I/O, mas o pipeline revisado faz mais trabalho e gera dados por núcleo. O benchmark de desempenho será uma etapa separada após validar a segmentação.

## 8. Comandos para demonstrar a execução

Na raiz do repositório dedicado ao TCC:

```text
python -m unittest discover -s tests -v
python src/pipeline_melhorado.py --verbose
python src/comparar_resultados.py
```

Para inspeção visual sob demanda, sem deixar imagens novas no controle de versão por padrão:

```text
python src/pipeline_melhorado.py --save-images
```

Os arquivos mais importantes para mostrar são:

- `results/manifesto_amostras.csv`;
- `results/resultados_por_nucleo.csv`;
- `results/resumo_por_amostra.csv`;
- `results/comparativo_resultados.md`;
- `results/comparativo_resumo.json`.

## 9. Conclusão da primeira entrega

A transição da IC para o TCC não foi apenas uma refatoração estética. Ela corrigiu problemas que afetavam diretamente a interpretação da intensidade proteica: pareamento incompleto, seleção ambígua de canais, uso de tons de cinza, amostragem somente do contorno, ausência de fundo e perda da identidade individual dos núcleos.

O resultado é um pipeline mais limpo, verificável e extensível. A afirmação adequada para esta etapa é: **a versão revisada produz uma medida mais alinhada ao objetivo experimental e oferece evidências de execução e auditoria; a validação da acurácia biológica ainda é o próximo experimento do TCC.**
