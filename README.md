# Slopify

Local AI delivery workbench.

## Run

```sh
docker compose up --build --wait
```

Open <http://127.0.0.1:3000>. Put optional provider credentials in `.env`.

Stop the application with `docker compose down`.

## Development

```sh
corepack pnpm install --frozen-lockfile
pnpm build
pnpm test
```
