# syntax=docker/dockerfile:1

# ESXtop Lens is a dependency-free Python app with a vanilla ES-module frontend.
FROM python:3.15-alpine

ARG APP_VERSION=dev
ARG IMAGE_TAG=local
ARG GIT_SHA=local
ARG BUILD_DATE=

LABEL org.opencontainers.image.title="ESXtop Lens" \
      org.opencontainers.image.description="Local-first esxtop batch CSV analysis for ESXi" \
      org.opencontainers.image.source="https://github.com/RogerBergling/esxtop-perf" \
      org.opencontainers.image.url="https://github.com/RogerBergling/esxtop-perf" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="$APP_VERSION" \
      org.opencontainers.image.revision="$GIT_SHA" \
      io.esxtoplens.build.version="$APP_VERSION" \
      io.esxtoplens.build.image-tag="$IMAGE_TAG" \
      io.esxtoplens.build.revision="$GIT_SHA" \
      io.esxtoplens.build.date="$BUILD_DATE"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ESXTOP_MAX_UPLOAD_MB=512

WORKDIR /app

RUN addgroup -S app && adduser -S -G app app

COPY --chown=app:app esxtop_perf ./esxtop_perf
COPY --chown=app:app public ./public
COPY --chown=app:app start.py ./start.py

RUN APP_VERSION="$APP_VERSION" IMAGE_TAG="$IMAGE_TAG" GIT_SHA="$GIT_SHA" BUILD_DATE="$BUILD_DATE" \
    python3 -c "import json, os; data = {'version': os.environ['APP_VERSION'], 'imageTag': os.environ['IMAGE_TAG'], 'commit': os.environ['GIT_SHA'], 'buildDate': os.environ.get('BUILD_DATE') or None}; open('public/version.json', 'w', encoding='utf-8').write(json.dumps(data, indent=2) + '\n')" \
    && chown app:app public/version.json

USER app

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["python3", "-c", "import urllib.request; urllib.request.build_opener(urllib.request.ProxyHandler({})).open('http://127.0.0.1:8080/api/health', timeout=2).read()"]

CMD ["python3", "start.py", "--host", "0.0.0.0", "--port", "8080", "--no-browser"]
