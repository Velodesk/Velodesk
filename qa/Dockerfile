# Dockerfile v1.0.0 — Claudio Q.A. (agente de QA do Velodesk), pra rodar como Cloud Run Job
# VERSION: v1.0.0 | DATE: 2026-09-16 | AUTHOR: VeloHub Development Team
#
# Base oficial do Playwright: já vem com Chromium/Firefox/WebKit e todas as
# dependências de SO instaladas — evita reproduzir aqui o "playwright install
# --with-deps" que o workflow do GitHub Actions fazia toda rodada.
#
# A tag da imagem TEM que bater com a versão do pacote "playwright" no
# package-lock.json (hoje: 1.63.0) — se o lockfile mudar de versão, atualize
# a tag abaixo junto, senão o Playwright recusa rodar (browser/lib desalinhados).
FROM mcr.microsoft.com/playwright:v1.63.0-jammy

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production

# Cloud Run Job: roda até terminar e sai — sem porta exposta, sem healthcheck,
# diferente de um Cloud Run Service (ver backend/Dockerfile pra comparação).
CMD ["npm", "run", "qa"]
