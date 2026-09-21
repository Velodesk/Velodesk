FROM node:20-alpine

WORKDIR /app

COPY sentinela/package.json ./
RUN npm install --omit=dev

COPY sentinela/ .

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
