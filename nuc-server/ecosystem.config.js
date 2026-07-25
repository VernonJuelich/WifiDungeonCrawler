module.exports = {
  apps: [{
    name: 'dungeon-crawler',
    script: 'server.js',
    cwd: __dirname,
    watch: false,
    env: { NODE_ENV: 'production', PORT: 9310 },
    error_file: 'C:\\AI-Lab\\Logs\\dungeon-crawler-err.log',
    out_file:   'C:\\AI-Lab\\Logs\\dungeon-crawler-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};
