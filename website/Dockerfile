FROM nginx:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/index.html dist/style.css dist/agent.md dist/site.js dist/mouse-gaze.js /usr/share/nginx/html/
COPY dist/assets/mochi.png dist/assets/mochi-face.png dist/assets/watch-3d.png /usr/share/nginx/html/assets/
EXPOSE 8080
