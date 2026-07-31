# Guia de Deploy — YouRH no Railway

## Estrutura da pasta
```
railway-app/
├── server.js             ← servidor principal
├── package.json
├── railway.json          ← configuração Railway
├── .gitignore
├── .env.example          ← referência das variáveis
├── scripts/
│   └── hash-password.js  ← gera senhas seguras
└── public/
    ├── login.html        ← página de login YouRH
    └── dashboard.html    ← painel (dados injetados pelo servidor)
```

---

## Passo 1 — Gerar senhas dos usuários

Antes de subir, gere o hash seguro para cada senha. No terminal (dentro da pasta railway-app):

```bash
npm install
node scripts/hash-password.js SuaSenhaAqui123
```

Copie o hash gerado (começa com `$2b$10$...`). Você vai usá-lo no Passo 3.

---

## Passo 2 — Criar repositório GitHub

1. Acesse github.com → **New repository**
2. Nome: `youRH-dashboard` (pode ser privado)
3. Não inicialize com README
4. Copie a URL do repositório

No terminal, dentro da pasta `railway-app/`:
```bash
git init
git add .
git commit -m "YouRH Dashboard — Railway edition"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/youRH-dashboard.git
git push -u origin main
```

---

## Passo 3 — Criar projeto no Railway

1. Acesse **railway.app** → **New Project**
2. Selecione **"Deploy from GitHub repo"**
3. Autorize o Railway a acessar seu GitHub se necessário
4. Selecione o repositório `youRH-dashboard`
5. Railway detecta automaticamente o Node.js e inicia o build

---

## Passo 4 — Configurar variáveis de ambiente

No Railway, vá em **Settings → Variables** e adicione:

| Variável | Valor |
|---|---|
| `JWT_SECRET` | Uma string aleatória longa (ex: `xT7#mK9!pQ2vL8nR4wY6`) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Conteúdo completo do arquivo JSON da Service Account (em uma linha) |
| `SPREADSHEET_ID` | `1kjwjwQF8KL2ijEt9jB-UkWYLmLTZ5XuF6k44sAFzAgU` |
| `SHEET_NAME` | Nome exato da aba na planilha (ex: `Dados`) |
| `USERS` | JSON com os usuários (ver formato abaixo) |
| `NODE_ENV` | `production` |

### Formato da variável USERS

Cole como uma única linha (sem quebras):

```json
[{"email":"admin@suaempresa.com","nome":"William Barboza","role":"rh_admin","setor":null,"password":"$2b$10$HASH_DO_PASSO_1"},{"email":"gestor.tech@empresa.com","nome":"Nome Gestor","role":"gestor","setor":"Tech","password":"$2b$10$HASH_DO_PASSO_1"}]
```

Papéis disponíveis:
- `rh_admin` → vê todos os colaboradores e setores
- `gestor` → vê apenas o setor definido em `"setor"`
- `colaborador` → vê apenas os próprios dados (campo `"nome"` deve ser idêntico ao da planilha)

### Como colar o JSON da Service Account

Abra o arquivo `.json` da Service Account em um editor de texto. Selecione tudo → copie → cole direto no campo de valor da variável no Railway. O Railway aceita o JSON completo.

---

## Passo 5 — Obter a URL pública

Após o deploy concluir (geralmente 1-2 minutos):

Railway → seu projeto → **Settings → Domains** → **Generate Domain**

Você receberá uma URL como `youRH-dashboard.up.railway.app`. Essa é a URL de acesso ao painel.

---

## Verificar se está funcionando

Acesse a URL → deve aparecer a tela de login YouRH. Entre com o e-mail e senha configurados. Se tudo estiver correto, o painel carrega com os dados da planilha.

---

## Solução de problemas

| Sintoma | Causa provável | Solução |
|---|---|---|
| Tela em branco | Erro no servidor | Railway → Deployments → ver logs |
| "Erro ao buscar dados" | Planilha não compartilhada com Service Account | Compartilhe a planilha com o e-mail do `client_email` do JSON |
| "Nome da aba não encontrado" | `SHEET_NAME` errado | Verifique o nome exato da aba na parte inferior do Google Sheets |
| Login não funciona | `USERS` mal formatado | Verifique se o JSON é válido em jsonlint.com |
| Dados desatualizados | Cache de 5 minutos | Aguarde 5 min ou acesse `/api/refresh` como admin |

---

## Atualizar o painel

Toda vez que você fizer alterações no código (inclusive no dashboard.html), basta fazer push para o GitHub:

```bash
git add .
git commit -m "descrição da alteração"
git push
```

Railway detecta automaticamente e faz o redeploy em segundos.
