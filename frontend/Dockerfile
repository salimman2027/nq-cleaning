FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm install --workspace frontend --include-workspace-root=false
COPY frontend frontend
RUN npm run build --workspace frontend

FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
