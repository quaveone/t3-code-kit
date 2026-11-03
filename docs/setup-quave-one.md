# Set up on Quave ONE

The step-by-step setup is the runbook in the [README](../README.md#set-up-a-new-t3-code-server-on-quave-one). Follow it
for every new server: it covers the catalog and manual paths, disk, secrets, health checks, snapshots, alerts and
pairing. It was tested end to end by agents that had only the README.

This page adds what the runbook leaves out.

## Build from source instead of the published image

Deploy the `image/` folder as a Dockerfile app instead of using `ghcr.io/quaveone/t3-code:stable`:

1. [`create-app`] with `"dockerPreset": "CUSTOM"`, `"isCliDeployment": true`, port `3773`, health check `/` (no
   `useImage`).
2. Create the environment, turn on the volume at `/data` and size the disk as in the runbook.
3. Upload `image/` with `quaveone deploy`, or with [`request-deploy-storage-key`], an HTTP `PUT` of a `.tgz` of the folder,
   and [`notify-code-upload`].

A source-built environment does not follow `:stable`. To switch it to the published image later, set the app to image
mode [`update-app` `useImage: true`], deploy `ghcr.io/quaveone/t3-code:stable` [`deploy-app-env-image`] and turn on
image auto-deploy. The volume, and everything on it, is kept.

## Restore drill

Do this once per server, so recovery is known to work:

1. Wait for a recovery point (hourly) and validate it [`validate-app-env-volume-backup`].
2. Restore it into a new environment [`create-app-env-from-volume-backup`]. If the restore refuses the disk size, the
   account's app volume limit is lower than the server's disk; ask support to raise it.
3. A restored source-built environment waits for a code upload, and its first deploy can fail while the volume is still
   restoring; redeploy it once. Image environments start on their own.
4. Pair a browser with the restored server (newest `Pairing URL` in its log), check the projects and threads, then delete
   the restored environment.

## Agents and secrets

Secret values never go through an agent's chat or logs. The person enters them in the dashboard. When an agent has to
set a secret, it should read the value from its own environment or secret store and call the Quave ONE MCP directly,
without echoing it.
