# build stage
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
ARG VITE_BOOK_API_BASE
ARG VITE_ASSEMBLYAI_API_KEY
ENV VITE_BOOK_API_BASE=$VITE_BOOK_API_BASE
ENV VITE_ASSEMBLYAI_API_KEY=$VITE_ASSEMBLYAI_API_KEY

RUN npm run build

# serve stage
FROM nginx:alpine
# SPA fallback
RUN printf 'server {\n  listen 80;\n  server_name _;\n  root /usr/share/nginx/html;\n  index index.html;\n  location / {\n    try_files $uri /index.html;\n  }\n}\n' > /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx","-g","daemon off;"]
