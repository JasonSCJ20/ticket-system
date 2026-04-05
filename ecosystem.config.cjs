// PM2 ecosystem configuration for Cybersecurity Command Centre
// Usage:
//   Development:  pm2 start ecosystem.config.cjs
//   Production:   NODE_ENV=production pm2 start ecosystem.config.cjs
//   Cluster mode: PM2_INSTANCES=max pm2 start ecosystem.config.cjs
//   Manage:       pm2 status | pm2 logs | pm2 restart all | pm2 delete all
//   Auto-start:   pm2 save && pm2 startup

module.exports = {
  apps: [
    {
      name: 'ccc-api',
      script: './src/app.js',
      cwd: './node-backend',
      interpreter: 'node',

      // Scale to available CPU cores in production; single instance in dev.
      instances: process.env.PM2_INSTANCES || 1,
      exec_mode: process.env.PM2_INSTANCES ? 'cluster' : 'fork',

      // Restart on crash with exponential back-off (max 5 retries in 60 s).
      autorestart: true,
      max_restarts: 5,
      min_uptime: '10s',
      restart_delay: 2000,

      // Memory guard — restart if Node leaks past 512 MB.
      max_memory_restart: '512M',

      // Environment variables.
      env: {
        NODE_ENV: 'development',
        PORT: 8001,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 8001,
      },

      // Log configuration.
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      out_file: './logs/api-out.log',
      error_file: './logs/api-error.log',
      merge_logs: true,
    },
  ],
};
