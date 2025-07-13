export default {
  apps: [
    {
      name: "corent-backend", // Name of your application
      script: "./src/server.js", // Path to your entry file
      instances: "max", // Automatically scale to the number of available CPUs
      exec_mode: "cluster", // Use cluster mode for multi-core usage
      watch: false, // Disable file watching (set to true if you want PM2 to restart on file changes)
      autorestart: true, // Automatically restart the app if it crashes
      max_memory_restart: "500M", // Restart the app if it exceeds 500MB memory usage
      log_date_format: "YYYY-MM-DD HH:mm:ss", // Log date format
      error_file: "./logs/error.log", // File to store error logs
      out_file: "./logs/output.log", // File to store standard output logs
      pid_file: "./pids/app.pid", // File to store process ID
    },
  ],
};
