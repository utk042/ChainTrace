FROM node:20-alpine AS build

WORKDIR /app
# The image only builds the app; it never runs the browser tests, and
# Playwright's postinstall would otherwise pull ~150 MB of browsers into a
# layer nothing uses.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
