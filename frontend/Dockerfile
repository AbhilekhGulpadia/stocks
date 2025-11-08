# frontend/Dockerfile (multi-stage)
# Stage 1: build the React app
FROM node:18-alpine AS build
WORKDIR /app
COPY frontend/package*.json ./ 
# If you have package-lock.json or yarn.lock, copy them too
RUN npm ci --silent
COPY frontend/ . 
RUN npm run build

# Stage 2: serve with nginx
FROM nginx:stable-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
# copy the build output from the previous stage
COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]