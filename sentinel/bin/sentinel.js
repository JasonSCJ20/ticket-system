#!/usr/bin/env node
import { sentinel } from '../src/index.js';

// Config comes from the environment — this is what a systemd unit or
// container env file sets, not a config file to keep track of.
const assetId = process.env.COMMANDCENTRE_ASSET_ID;
const sentinelKey = process.env.COMMANDCENTRE_SENTINEL_KEY;
const commandCentreUrl = process.env.COMMANDCENTRE_URL;

if (!assetId || !sentinelKey || !commandCentreUrl) {
  console.error(
    '[commandcentre-sentinel] Missing required environment variables. Set COMMANDCENTRE_ASSET_ID, COMMANDCENTRE_SENTINEL_KEY, and COMMANDCENTRE_URL.',
  );
  process.exit(1);
}

console.log(`[commandcentre-sentinel] Starting for asset ${assetId} against ${commandCentreUrl}`);
const instance = sentinel({ assetId, sentinelKey, commandCentreUrl });

process.on('SIGTERM', () => {
  instance.stop();
  process.exit(0);
});
process.on('SIGINT', () => {
  instance.stop();
  process.exit(0);
});
