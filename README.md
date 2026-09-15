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
```

Por padrão, o pipeline gera apenas arquivos tabulares e não cria imagens intermediárias. Para gerar máscaras e overlays de controle de qualidade:

```text
python src/pipeline_melhorado.py --save-images
```

## Testes

```text
python -m unittest discover -s tests -v
```

As alterações estão documentadas em [docs/MELHORIAS_TCC.md](docs/MELHORIAS_TCC.md). O comparativo detalhado, com roteiro para apresentação, está em [docs/COMPARATIVO_IC_VS_TCC.md](docs/COMPARATIVO_IC_VS_TCC.md).
