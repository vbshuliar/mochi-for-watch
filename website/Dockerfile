FROM nginx:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/index.html dist/style.css dist/agent.md /usr/share/nginx/html/
COPY dist/assets/jolly.png dist/assets/jolly-face.png dist/assets/watch-3d.png /usr/share/nginx/html/assets/
EXPOSE 8080
