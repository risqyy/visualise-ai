# syntax=docker/dockerfile:1

# ---- build ----------------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- runtime --------------------------------------------------------------
FROM nginx:1.29-alpine AS runtime

# The site config is a template so the request size limit can follow the
# backend's MAX_EVENT_BYTES. The image entrypoint renders /etc/nginx/templates
# into /etc/nginx/conf.d on start.
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

# NGINX_ENVSUBST_FILTER restricts substitution to this one variable, so Nginx's
# own $host, $uri, $backend and friends survive template rendering untouched.
ENV MAX_REQUEST_BODY_SIZE=4m \
    NGINX_ENVSUBST_FILTER=MAX_REQUEST_BODY_SIZE

# The only port published to the host by Compose.
EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
