FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm install --workspace backend --include-workspace-root=false
COPY backend backend
RUN npm run build --workspace backend

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY backend/package.json backend/
RUN npm install --omit=dev --workspace backend --include-workspace-root=false
COPY --from=build /app/backend/dist backend/dist
COPY database database
USER node
EXPOSE 4000
CMD ["node", "backend/dist/server.js"]
