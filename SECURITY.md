# Security Policy

## Reporting a vulnerability

Please do not report security vulnerabilities in public issues or pull requests.

Use the private email address [security@oogwaylabs.com](mailto:security@oogwaylabs.com) to report a suspected vulnerability. Include a concise description and steps to reproduce when possible. Keep vulnerability details private while the issue is investigated; do not post reports or reproduction details in public issues, pull requests, or discussions.

This is an early-stage alpha. There are no stable releases or backported security fixes; fixes are made on `main`.

## Configuration and data

- Local development authentication (`AUTH_DEV=true` and `AUTH_DEV_ALLOW_INSECURE=1`) is disabled in production and must never be used on an exposed instance.
- In `single-org` tenancy mode, all verified accounts on the configured domain share the same workspaces and data. Use `isolated` mode for separate teams; inviting other accounts is not currently supported.
- Keep provider keys, database credentials, storage keys, and the internal API token on the server. Never commit real credentials or `.env` files.
- The bundled seed fixture is synthetic. User-provided datasets, prompts, outputs, and speech audio may contain sensitive information.
- STT route probes send the bundled synthetic non-speech audio sample to the selected provider to check request compatibility; this does not measure transcription quality.
