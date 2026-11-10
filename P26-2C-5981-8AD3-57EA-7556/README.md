# Projeto #3: Batalha Naval Tático

- **Modalidade:** Projeto Oficial Sorteado (Valendo 100 pontos)
- **Estudante:** Pedro Favoreto Alves
- **Turma:** 2C
- **Chave Única:** `P26-2C-5981-8AD3-57EA-7556`
- **URL_CLOUDFLARE:** `https://avalia2026-2-bet.pages.dev/` *(Atualize com a URL pública real do seu deploy na Cloudflare antes de abrir o Pull Request)*

---

## Especificação do Projeto

Implemente o clássico jogo de Batalha Naval em duas fases: posicionamento da frota em uma malha 10x10 e combate por coordenadas. O cliente em JavaScript vanilla deve gerenciar a interação de posicionamento horizontal e vertical das embarcações e disparar requisições fetch para o backend na Cloudflare a cada bombardeio realizado.

A autenticação via Discord OAuth2 vincula cada jogador às suas partidas ativas no Cloudflare D1. As funções serverless devem validar se as embarcações foram posicionadas dentro dos limites da matriz e processar os disparos ocultando a matriz do oponente, retornando ao cliente apenas se o tiro resultou em "água", "acerto" ou "navio afundado", atualizando o placar geral ao término do confronto.

---

## Como Publicar esta Subpasta no Cloudflare Pages + D1 + Discord OAuth2

1. No painel da Cloudflare (**Workers & Pages** → **Create** → **Pages** → **Connect to Git**), selecione o seu fork do repositório `Avalia2026-2`.
2. Configure os parâmetros de build apontando para esta subpasta:
   - **Root directory (Diretório raiz):** `P26-2C-5981-8AD3-57EA-7556`
   - **Build command:** *(deixe em branco — HTML/CSS/JS puro)*
   - **Build output directory:** `public`
3. Crie o banco de dados D1 e aplique a migração inicial (no terminal do laboratório usando Scoop):
   ```powershell
   cd P26-2C-5981-8AD3-57EA-7556
   npx.cmd wrangler d1 create db-p26-2c-5981-8ad3-57ea-7556
   # Copie o database_id gerado para o arquivo wrangler.jsonc e execute:
   npx.cmd wrangler d1 migrations apply DB --remote
   ```
4. **Vincule o Banco D1 ao seu Cloudflare Pages (Obrigatório para ativar env.DB):**
   - No painel da Cloudflare: acesse seu projeto Pages → **Settings** → **Functions** → **D1 database bindings**.
   - Clique em **Add binding**:
     - **Variable name:** `DB`
     - **D1 database:** selecione o banco que você criou (`db-p26-2c-5981-8ad3-57ea-7556`).
5. **Configuração do Discord OAuth2 (Obrigatório para autenticação real):**
   - Acesse o **Discord Developer Portal** (https://discord.com/developers/applications) e crie uma nova Application.
   - Na aba **OAuth2**:
     - Copie o **Client ID** e gere o **Client Secret**.
     - Em **Redirects**, adicione a URL exata do deploy:
       `https://p26-2c-5981-8ad3-57ea-7556.pages.dev/api/auth/discord/callback`
   - No painel do seu projeto no Cloudflare Pages:
     - Acesse **Settings** → **Environment variables**.
     - Adicione as variáveis de ambiente:
       - `DISCORD_CLIENT_ID`
       - `DISCORD_CLIENT_SECRET`
6. Atualize o campo **URL_CLOUDFLARE** no topo deste `README.md` com o endereço público gerado pela Cloudflare.
7. Na raiz do repositório, execute `node validar-local.mjs P26-2C-5981-8AD3-57EA-7556` para validar todos os critérios antes de fazer o commit e abrir o Pull Request.
