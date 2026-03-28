FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY slides.md ./
EXPOSE 3030
CMD ["npx", "slidev", "--port", "3030", "--remote", "--base", "/slides/"]
