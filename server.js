const http = require("http");
const next = require("next");

const port = Number(process.env.PORT || 3000);
const hostname = process.env.HOSTNAME || "0.0.0.0";
const app = next({
  dev: false,
  dir: __dirname,
  hostname,
  port
});

const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    http
      .createServer((req, res) => handle(req, res))
      .listen(port, hostname, () => {
        console.log(`ArX Task web is listening on http://${hostname}:${port}`);
      });
  })
  .catch((error) => {
    console.error("Failed to start ArX Task web server", error);
    process.exit(1);
  });
