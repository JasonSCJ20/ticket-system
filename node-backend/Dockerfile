FROM node:20-slim

# dumb-init handles PID 1 signal forwarding and zombie reaping. curl/unzip/
# ca-certificates are needed to fetch the real scanner binaries below.
# python3-pip is Semgrep's actual distribution mechanism — its wheel
# bundles a compiled core binary, there's no standalone Linux release.
RUN apt-get update -qq \
  && apt-get install -y --no-install-recommends dumb-init curl unzip ca-certificates python3-pip \
  && rm -rf /var/lib/apt/lists/*

# Every real scan this platform runs (Trivy, Gitleaks, Nuclei, Semgrep)
# shells out to these binaries by name (see services/scanners/*.js) —
# without them on PATH, every scan fails with "spawn <tool> ENOENT" and
# silently produces zero findings. Confirmed as the root cause of every
# single scan failing in production: ScanRunRecords showed 100% "failed"
# status for all four tools, every run, since the scanners were wired up —
# this image never actually had them installed.
#
# Versions pinned for reproducible builds — bump periodically as routine
# maintenance, same as any other dependency.
RUN curl -sSL https://github.com/aquasecurity/trivy/releases/download/v0.73.0/trivy_0.73.0_Linux-64bit.tar.gz \
  | tar -xz -C /usr/local/bin trivy

RUN curl -sSL https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz \
  | tar -xz -C /usr/local/bin gitleaks

RUN curl -sSL -o /tmp/nuclei.zip https://github.com/projectdiscovery/nuclei/releases/download/v3.11.0/nuclei_3.11.0_linux_amd64.zip \
  && unzip -q /tmp/nuclei.zip -d /usr/local/bin nuclei \
  && chmod +x /usr/local/bin/nuclei \
  && rm /tmp/nuclei.zip

# Not version-pinned like the three above — pip resolves whatever's
# current, avoiding the same stale-version guess that broke the first
# attempt at pinning Trivy/Gitleaks/Nuclei above (their actual latest
# releases had moved well past the versions first guessed here).
RUN pip3 install --no-cache-dir --break-system-packages semgrep

WORKDIR /app

# Copy manifests first for layer caching.
COPY package.json package-lock.json* ./

# Production dependencies only.
RUN npm ci --omit=dev --ignore-scripts

# Copy source.
COPY src/ ./src/

# Non-root user for defence-in-depth. Needs a real home directory (unlike
# before) because Nuclei caches its community template library under
# $HOME, and Trivy caches its vulnerability database the same way — both
# fail at runtime with no home dir for the process to write to.
RUN groupadd --gid 1001 nodejs && useradd --uid 1001 --gid nodejs --shell /bin/sh --create-home nodejs
ENV HOME=/home/nodejs
USER nodejs

# Fetch Nuclei's template library at build time so the very first real scan
# doesn't block on a live download from GitHub mid-request; it re-checks
# for updates on its own after that. Trivy's vulnerability DB is left to
# its own normal first-run auto-download (documented, standard behavior) —
# not pre-warmed here to avoid pinning to a specific CLI flag across
# versions.
RUN nuclei -update-templates -silent || true

EXPOSE 8001

# dumb-init as PID 1 so SIGTERM propagates correctly to node.
CMD ["dumb-init", "node", "src/app.js"]
