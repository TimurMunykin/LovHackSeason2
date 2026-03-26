# ── Stage 1: build the fat JAR ────────────────────────────────────────────────
FROM eclipse-temurin:21-jdk-jammy AS builder

WORKDIR /build
COPY gradlew gradlew
COPY gradle/ gradle/
COPY build.gradle settings.gradle ./
COPY src/ src/

RUN chmod +x gradlew && ./gradlew bootJar --no-daemon -q

# ── Stage 2: runtime image ────────────────────────────────────────────────────
FROM eclipse-temurin:21-jre-jammy

LABEL org.opencontainers.image.description="unicalc-backend: Java Spring Boot AI backend"

# Tools needed before Playwright install-deps runs
RUN apt-get update && apt-get install -y --no-install-recommends \
        xvfb \
        x11vnc \
        novnc \
        websockify \
        curl \
        unzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /build/build/libs/*.jar app.jar

# Install Playwright Chromium browser + all required system dependencies.
# We unpack the fat JAR to access the bundled CLI, then run two separate commands:
#   install chromium       — downloads the exact Chromium build for this library version
#   install-deps chromium  — installs all required system libs via apt (more complete than --with-deps)
# Running them separately avoids the incomplete dep set that --with-deps sometimes produces.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers
RUN mkdir /tmp/pw-install && \
    cd /tmp/pw-install && \
    unzip -q /app/app.jar 'BOOT-INF/lib/*' && \
    java -cp "BOOT-INF/lib/*" com.microsoft.playwright.CLI install chromium && \
    java -cp "BOOT-INF/lib/*" com.microsoft.playwright.CLI install-deps chromium && \
    cd / && rm -rf /tmp/pw-install

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3001 6080

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
