# Publicação para validação científica

Esta aplicação foi preparada para um frontend React no **Vercel** e a API de
processamento no **Railway**. O repositório deve permanecer privado enquanto
contiver imagens ou resultados de pesquisa.

## 1. Publicar a API no Railway

1. Crie um projeto no Railway e conecte o repositório GitHub.
2. O Railway detecta `railway.toml` e constrói `backend/Dockerfile`.
3. Adicione um **Volume** com ponto de montagem `/var/data/nuclei`.
4. Configure as variáveis abaixo e gere um domínio público para o serviço:

```text
NUCLEI_DATA_DIR=/var/data/nuclei
NUCLEI_ALLOWED_ORIGINS=https://SEU-PROJETO.vercel.app
NUCLEI_ACCESS_CODE=<código compartilhado com a equipe>
NUCLEI_AUTH_SECRET=<segredo aleatório longo>
NUCLEI_AUTH_TTL_SECONDS=43200
```

`NUCLEI_AUTH_SECRET` deve ser diferente do código de acesso. Um valor seguro
pode ser gerado localmente com `python -c "import secrets; print(secrets.token_urlsafe(32))"`.

Confira `https://SEU-BACKEND.up.railway.app/api/health`: a resposta esperada é
`{"status":"ok"}`. O volume é obrigatório: ele guarda as imagens originais,
resultados, revisões e logs de auditoria em `/var/data/nuclei`.

## 2. Publicar a interface no Vercel

1. Importe o mesmo repositório no Vercel.
2. Defina **Root Directory** como `frontend`.
3. Cadastre a variável de ambiente de produção:

```text
VITE_API_URL=https://SEU-BACKEND.up.railway.app/api
```

4. Faça o deploy. Em seguida, copie a URL do Vercel para
`NUCLEI_ALLOWED_ORIGINS` no Railway e faça um novo deploy da API.

## Proteção de acesso da fase de validação

Com `NUCLEI_ACCESS_CODE` configurado, a interface apresenta uma tela de acesso.
O código é trocado por um token assinado, válido por doze horas por padrão; ele
não fica no repositório. Essa é uma barreira adequada para o grupo piloto, mas
não substitui contas individuais. Antes de ampliar o público, a próxima etapa é
integrar autenticação institucional (Google/Microsoft da UFU) e associar a
identidade ao registro de auditoria.

## Operação e backup

- Mantenha apenas uma instância da API: a persistência atual é por volume de
  arquivos, não por banco compartilhado.
- Faça um backup periódico do volume antes de atualizações relevantes e defina
  com a equipe por quanto tempo imagens e análises devem ser retidas.
- O GitHub Actions executa os testes do backend, pipeline e frontend a cada
  envio para `main`/`master` e em pull requests.
