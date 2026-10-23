# DevOps pipeline and container handoff

This integration adapts the pipeline, Docker, Compose and Nginx pattern from the supplied `web-app-main (1).zip` to Greenlink. The archive was treated as reference source; its application code, database dump, registry account and embedded instructions were not imported.

| Reference example | Greenlink integration |
| --- | --- |
| Next.js lint/build and optional tests | JavaScript/Python syntax, required PostgreSQL tests, Python tests, browser workflows and actual process integration |
| One Node image | Separate non-root banking and FastAPI image targets in `Dockerfile` |
| Web and Nginx | Nginx, banking, private scorer, PostgreSQL and a one-shot schema/permissions job |
| Hardcoded third-party Docker Hub repository | Repository-owned GHCR packages with immutable commit tags and explicit manual publication |
| Broad build context | Runtime source allowlist; credentials, local databases and reports excluded |

## GitHub workflow

`.github/workflows/ci-cd.yml` runs on pushes and pull requests to `main`, and through **Actions → Greenlink CI and container delivery → Run workflow**.

1. `verify` installs locked Node and pinned Python dependencies on Node 22/Python 3.13, runs syntax checks, the real PostgreSQL functional/security suite, Python and browser tests, process integration, and package verification. The source ZIP/checksum are retained as workflow artifacts for seven days.
2. `containers` builds both images and starts a newly seeded disposable Compose stack. A banking payment goes through Nginx, Express, PostgreSQL and Python; the check also verifies idempotency, history, rules and restricted database grants. The runner removes its own containers and volume afterward.
3. `publish` runs only when **Run workflow** is selected on `main` with **publish_images** checked, and both earlier jobs pass. It publishes `ghcr.io/<owner>/<repository>/banking` and `/fraud`, tagged `sha-<full-commit>` and `latest`. Registry login uses the built-in `GITHUB_TOKEN`; no Docker Hub account is needed. Package-write permission is scoped to this job. See [GitHub's package workflow permissions](https://docs.github.com/en/packages/managing-github-packages-using-github-actions-workflows/publishing-and-installing-a-package-with-github-actions).

Actions are pinned to full commit revisions. Pull requests cannot publish images, and no production deployment or server credentials are configured. Configure a deployment target separately with the DIT team; publishing an image does not deploy a bank.

## Run the separate container application

Install Docker Desktop with Linux containers / Docker Engine and Compose v2. The existing native app at port 3000 and native PostgreSQL data are independent of this stack.

```sh
npm run devops:setup
npm run devops:up
```

Open `http://localhost:8080`. This creates a separate, initially empty PostgreSQL database in the `greenlink_postgres_data` Docker volume. Register a business operator, then provision staff and review its application as documented below. Existing local customers are not copied into this volume.

For an explicitly seeded sample stack, set `GREENLINK_SEED_DEMO=true` before starting. PowerShell:

```powershell
$env:GREENLINK_SEED_DEMO = 'true'
npm run devops:up
npm run test:containers
```

On macOS/Linux use `GREENLINK_SEED_DEMO=true npm run devops:up` and `GREENLINK_SEED_DEMO=true npm run test:containers`. The sample identities/passwords in the root README apply to this freshly seeded container database. The smoke command performs a small sample transfer and requires that explicit flag; it is intended only for a disposable demo stack.

Stop using `npm run devops:down`; this retains the database volume and secret files. Repeating setup preserves secrets, accounts and money. Do not remove the volume or regenerate secrets to perform a normal restart or update.

Container configuration uses `GREENLINK_` prefixes so the native app's `.env` cannot accidentally change the container origin or image names:

| Variable | Default / meaning |
| --- | --- |
| `GREENLINK_WEB_PORT` | `8080`, bound to host loopback only |
| `GREENLINK_PUBLIC_ORIGIN` | `http://localhost:8080`; must match the browser's exact origin |
| `GREENLINK_BANKING_IMAGE` | `greenlink-banking:local`, or a published GHCR banking commit tag |
| `GREENLINK_FRAUD_IMAGE` | `greenlink-fraud:local`, or a published GHCR fraud commit tag |
| `GREENLINK_SEED_DEMO` | `false`; opt in only for sample data |

When changing the port, change the origin too. The proxy network reserves `172.30.5.0/24`, with only Nginx's `172.30.5.10/32` trusted by Express. If that subnet conflicts with an existing network, update the subnet, Nginx address and trust setting together.

To use published images, set both image variables to matching commit tags, authenticate with GHCR if the packages are private, then run `docker compose pull` and `docker compose up --no-build --wait --wait-timeout 180`. Keep the banking/scorer revision aligned. A changed database-setup image applies pending checksum-verified migrations before banking starts; [Compose dependency conditions](https://docs.docker.com/compose/how-tos/startup-order/) gate startup on successful completion and healthy dependencies. A source build uses `npm run devops:up` instead.

## Credentials, data and financial controls

`npm run devops:setup` creates five independently generated secrets in ignored `data/devops/secrets/`. On Unix the directory is private (0700); its files are readable by the non-root container users through Compose's read-only file mounts. Retain/back up these values privately alongside the Docker PostgreSQL volume. The existing `.env`, native data and PostgreSQL backup are never overwritten.

| Container | Secret access |
| --- | --- |
| PostgreSQL | Bootstrap PostgreSQL password |
| Database setup | Bootstrap, migration-owner and runtime-role passwords |
| Banking | Restricted runtime password, service token and persistent MFA encryption key |
| Fraud scorer | Service token only |
| Nginx | None |

The setup job reuses the existing database provisioner: generated credentials, unrelated-target refusal, migrations, restricted runtime grants and repeat-run authentication checks remain active. Demo seeding runs there with the owner connection only when explicitly requested. The banking container never seeds and cannot create roles or tables. Startup verifies migration checksums with the restricted role.

The PostgreSQL 18 volume is mounted at `/var/lib/postgresql`, matching the [official image's version-specific data layout](https://hub.docker.com/_/postgres). Database/scorer/banking ports are not published to the host; only Nginx exposes loopback port 8080. Banking and scorer use separate images, private networking, read-only root filesystems, dropped capabilities and no new privileges. Nginx overwrites forwarded headers; Express trusts only its configured address. Browser origin, CSRF, sessions and financial authorization stay enforced.

An empty container database requires deliberate staff provisioning. Set `GREENLINK_STAFF_PASSWORD` privately in your terminal, then run:

```sh
docker compose --profile ops run --rm -e GREENLINK_STAFF_PASSWORD staff-admin --email bankops@example.com --name "Bank Operations"
```

Clear the variable afterward. This short-lived operator container mounts only the owner secret and uses the existing audited staff-creation workflow; existing registrations are never replaced. The web container never receives the owner secret. Sign in as this staff account at the container URL to independently review registered business applications. The automatic CI fixture instead uses explicit demo seeding for its staff identity. Native `npm run admin:create` continues to target the native database and must not be mistaken for container administration.

TLS termination, cloud resources, image deployment promotion, managed backups and production secret storage remain DIT operational work. This local Nginx configuration uses HTTP on loopback. For a hosted endpoint, the deployment team must supply HTTPS, the exact public origin and an appropriate explicit proxy trust boundary. No SSH, AWS or personal registry credentials are included.

## Reproduce checks

`npm run check`, `npm test`, `npm run test:python`, `npm run test:browser`, and `node --env-file=.env --env-file=.env.test scripts/platform-smoke.js` verify source behavior locally. Node/database tests need a separate `TEST_DATABASE_URL`; the GitHub runner supplies an isolated PostgreSQL service. Docker-specific build/health/smoke checks run in the `containers` job or through the Compose commands above.
