# AWS deployment package

This directory prepares a **single-host** Greenlink Digital Bank deployment. Nothing here has been applied to AWS. Provisioning is an explicit operator action and incurs AWS charges. Terraform formatting/provider validation and bootstrap syntax checks pass. Docker execution, certificate issuance and EC2 bootstrap still require an operator deployment test.

The host runs the existing five application processes in Docker Compose, with Caddy as the HTTPS entry point. SQLite databases, the notification outbox, fraud state, TLS certificates, and the host-generated service token live on a separate encrypted gp3 EBS volume. This is durable single-host storage, with downtime during replacement; it is not a highly available or horizontally scaled banking system.

## Infrastructure and access

Terraform creates a VPC, public subnet, Internet gateway, static IPv4 address, EC2 instance, instance role, and encrypted EBS volume. Only TCP 80 and 443 accept inbound traffic. There is no SSH rule or key pair. Use AWS Systems Manager Session Manager with your own operator IAM identity. The instance requires IMDSv2, with a response hop limit of one to keep instance credentials outside the application containers.

The instance role has the AWS-managed SSM core policy and `s3:GetObject` for exactly the configured release object. It cannot list the release bucket or read other objects. Supply an existing private bucket in the chosen region, using S3-managed encryption (SSE-S3); a KMS-encrypted artifact requires a separately reviewed KMS permission change. Bucket policies must also permit this role. The bucket is not created or made public by this package.

Both root and data EBS volumes are encrypted. The data volume has Terraform `prevent_destroy`; deleting it requires an explicit source change. Root disk replacement does not remove the application databases. Do not manually delete or force-detach the data volume while services are running.

## Prepare a release

Run the repository's tested release packaging and verification commands from the project root:

```sh
npm test
npm run package
npm run package:verify -- releases/greenlink-digital-bank-1.1.0.zip
```

The archive contains project files directly at its root, including `Dockerfile`, `compose.yaml`, `compose.cloud.yaml`, and `cloud/Caddyfile`. It excludes `.git`, private environment files, databases, logs, `node_modules`, test output, and the separate hosted prototype. Bootstrap additionally rejects unsafe paths, symlinks, secrets files, development state directories, and archives exceeding 512 MiB expanded.

Review the source and calculate the exact ZIP SHA-256 (also recorded by the package manifest):

```powershell
Get-FileHash .\releases\greenlink-digital-bank-1.1.0.zip -Algorithm SHA256
```

Upload it to an immutable, versioned key in your private S3 bucket using your operator credentials. Use SSE-S3, S3 Block Public Access, and bucket versioning. Never embed AWS keys, passwords, databases, or the service token in the archive or Terraform variables. An object checksum mismatch stops bootstrap before any release is started.

## Review and provision

Install Terraform 1.9 or later (below 2.0), AWS CLI, and the Session Manager plugin on the operator machine. Authenticate using your normal AWS identity or SSO; this package supplies no credentials. In `cloud/aws`, copy `terraform.tfvars.example` to `terraform.tfvars`, then set the real domain, existing bucket, exact ZIP key, and checksum. The default instance is x86_64 `t3.small` in `ap-southeast-1`.

```sh
cd cloud/aws
terraform init
terraform fmt -check
terraform validate
terraform plan -out=reviewed.tfplan
# Review the complete plan, permissions, expected charges, and data-volume lifecycle.
terraform apply reviewed.tfplan
```

These are operator instructions; they have **not** been executed against AWS. Store Terraform state and saved plans securely outside source control. Choose an encrypted remote backend with locking appropriate to your organization before a shared deployment. Do not run concurrent applies. The public Canonical Ubuntu 24.04 AMI parameter is resolved during planning; a newer AMI or changed release checksum can replace the instance. Read every replacement plan.

Set the domain's public **A** record to `terraform output -raw public_ipv4`. Remove stale AAAA records unless you separately configure IPv6. Caddy obtains and renews the public certificate once DNS points to this host and ports 80/443 are reachable. The application receives an exact `PUBLIC_ORIGIN=https://your-domain`, issues Secure session cookies, and rejects mismatched browser origins. Only Caddy publishes ports; the gateway's development port is removed by the cloud override.

The cloud override fixes `SEED_DEMO=false`. No public demo credentials are created. Register the intended administrator account through HTTPS. Then, in an SSM session on the host, grant its role using the operator-only command:

```sh
cd /opt/greenlink/current
sudo docker compose --env-file /srv/greenlink/config/platform.env -p greenlink -f compose.yaml -f compose.cloud.yaml exec banking node scripts/manage-admin.js --email registered@example.com
```

This promotes an existing account and writes an operator audit record; it creates no password. Sign out and sign in again afterward. Use a separate registered administrator for maker-checker approvals. Do not enable demo seeding on a private deployment.

## Bootstrap and operations

Bootstrap installs exact Docker Engine 29.9.2, CLI 29.9.2, containerd 2.4.2, and Buildx 0.38.1 packages from Docker's signed Ubuntu repository. Each downloaded package is checked against both its pinned SHA-256 and authenticated APT metadata. Compose 5.6.1 is checked against its pinned official Linux x86_64 release digest (`47737f4236e6d3ccea7291995203f8f018058783b4c3a9469119811a0b5db8c0`). Caddy uses the fixed `2.11.7-alpine` release tag. Review and update pins for future security releases; automatic package upgrades do not change held Docker versions.

The data disk is found by its EBS volume serial, never by an assumed NVMe device number. Bootstrap formats only an unformatted, signature-free configured volume, accepts an existing ext4 volume, and refuses unexpected layouts. Docker and containerd require the mounted disk before starting. The secret is generated on the host at `/srv/greenlink/config/platform.env` with mode `0600`; it is preserved across instance replacements and is never a Terraform input or output.

Use the `session_command` Terraform output to connect. Useful commands on the host:

```sh
sudo cloud-init status --wait
sudo systemctl status greenlink
sudo journalctl -u greenlink --since today
sudo tail -n 100 /var/log/greenlink-bootstrap.log
cd /opt/greenlink/current
sudo docker compose --env-file /srv/greenlink/config/platform.env -p greenlink -f compose.yaml -f compose.cloud.yaml ps
```

Avoid `docker compose config` in shared logs because it renders environment secrets. The per-container local log driver rotates logs; monitor host disk space, EBS health, service health, certificate renewal, failed jobs, and pending notifications using your normal operational tooling. This package does not provision monitoring, a WAF, email delivery, or a disaster-recovery service.

To deploy a reviewed update, back up first, upload a new immutable ZIP, change its key/checksum, and review the Terraform plan. Stop `greenlink.service` before applying a replacement. Terraform also stops the old instance before detaching its disk. The same data disk is reattached, the service token is retained, and bootstrap installs the new release. Expect downtime. Verify `/health`, HTTPS login, your account balances, and worker/outbox health after the update. Reverting source may not reverse database schema changes; restore a verified backup when required.

## Backup and recovery

Use a scheduled, tested backup process. For a consistent whole-platform backup, stop `greenlink.service`, confirm all Compose containers stopped, create an EBS snapshot, and restart the service. A snapshot of a running SQLite database is only crash-consistent; do not copy a live `.sqlite` file without its WAL state or use it as a substitute for a database-aware backup. Protect snapshots with encryption, retention controls, and restricted IAM permissions. Include certificate data and the secret file in the recovery plan.

Test restoring the snapshot to an ext4 EBS volume in the same availability zone. With services stopped and backups verified, have an operator import or explicitly replace the Terraform-managed data-volume identity and review the resulting plan. Bootstrap accepts the existing filesystem and does not reset balances. Do not let a recovery test share production DNS or the production data disk. A retained volume alone is not a backup.

## Sources

Version and implementation references checked on 23 October 2026:

- [Docker Engine installation on Ubuntu](https://docs.docker.com/engine/install/ubuntu/) and [official Ubuntu packages](https://download.docker.com/linux/ubuntu/dists/noble/pool/stable/amd64/).
- [Docker Compose 5.6.1 release assets and SHA-256](https://github.com/docker/compose/releases/expanded_assets/v5.6.1), [CLI plugin installation](https://docs.docker.com/compose/install/linux/), and [Compose merge/reset semantics](https://docs.docker.com/reference/compose-file/merge/).
- [Caddy releases](https://github.com/caddyserver/caddy/releases) and [automatic HTTPS requirements](https://caddyserver.com/docs/automatic-https).
- [Canonical Ubuntu AMI SSM parameter](https://documentation.ubuntu.com/aws/aws-how-to/instances/build-cloudformation-templates/), [AWS SSM preinstalled images](https://docs.aws.amazon.com/systems-manager/latest/userguide/ami-preinstalled-agent.html), and [SSM instance permissions](https://docs.aws.amazon.com/systems-manager/latest/userguide/setup-instance-permissions.html).
- [AWS identification of NVMe EBS volumes](https://docs.aws.amazon.com/ebs/latest/userguide/identify-nvme-ebs-device.html) and [Terraform AWS instance resource](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/instance).
