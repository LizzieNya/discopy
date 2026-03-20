// PM2 process config — keeps your bot alive 24/7
module.exports = {
  apps: [
    {
      name: "discopy",
      script: "index.js",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
