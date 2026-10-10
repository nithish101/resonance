# Deploying Resonance

Resonance is a static site: a private S3 bucket behind CloudFront, with a response headers
policy that makes every response cross-origin isolated (COOP/COEP) and sets CSP and HSTS. The
infrastructure is AWS CDK (TypeScript) in `infra/`. Deploys run from GitHub Actions through
OIDC, so no long-lived AWS keys exist anywhere.

Nothing has been deployed yet. These are the one-time steps for the repository owner.

## What you need

- An AWS account where you can create IAM roles (an administrator, or SSO with admin access).
- The AWS CLI v2, signed in: `aws sts get-caller-identity` should print your account.
- This repository on GitHub (the CD workflow trusts `githubRepo` in `infra/cdk.json`; it's set to
  `nithish101/resonance`, so change it if the repo lives elsewhere).

## 1. Bootstrap CDK (once per account and region)

```sh
cd infra
pnpm exec cdk bootstrap aws://<ACCOUNT_ID>/us-east-1
```

## 2. Create the GitHub deploy role (once)

```sh
pnpm exec cdk deploy ResonanceGithubOidc
```

This creates the GitHub OIDC identity provider and an IAM role, `resonance-github-deploy`, that
only the `main` branch of the configured repository can assume. It prints `DeployRoleArn`.

If your account already has a GitHub OIDC provider (`aws iam list-open-id-connect-providers`),
pass its ARN instead of creating a second one:

```sh
pnpm exec cdk deploy ResonanceGithubOidc -c githubOidcProviderArn=arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com
```

## 3. Tell GitHub about the role

In the repository on GitHub: **Settings → Secrets and variables → Actions → Variables**, add:

| Variable              | Value                      |
| --------------------- | -------------------------- |
| `AWS_DEPLOY_ROLE_ARN` | the `DeployRoleArn` output |
| `AWS_REGION`          | `us-east-1`                |

These are variables, not secrets: the role ARN is not sensitive, because only this repo's `main`
branch can assume it.

## 4. Deploy

Push to `main` (or run the **Deploy** workflow manually from the Actions tab). After CI passes,
the Deploy workflow:

1. builds the site,
2. runs `cdk deploy ResonanceSite`,
3. uploads the build with `scripts/deploy-assets.sh` (hashed assets cached for a year,
   `application/wasm` set explicitly, `index.html` set to `no-cache`),
4. invalidates `/` and `/index.html` and waits for the invalidation,
5. runs `scripts/smoke.mjs` against the live URL: COOP, COEP, CSP, and HSTS headers present,
   WASM served as `application/wasm`, `crossOriginIsolated === true` in a real browser, and the
   audio engine starts and produces frames.

The live URL (`https://dxxxxxxxxxxxx.cloudfront.net`) is in the workflow summary and the
`SiteUrl` stack output. Put it in the README's demo link.

## Optional: a custom domain

1. Request an ACM certificate for the domain **in us-east-1** (CloudFront only reads
   certificates from there) and validate it through DNS.
2. Add repository variables `DOMAIN_NAME` (e.g. `resonance.example.com`) and `CERTIFICATE_ARN`.
3. Deploy, then point a CNAME (or Route 53 alias) for the domain at the distribution domain.

## Cost

For portfolio traffic this stays within the AWS free tier: CloudFront's always-free tier includes
1 TB of transfer and 10 million requests a month, and the bucket holds about 25 MB (most of it the
three bundled tracks). The distribution uses `PriceClass_100` (North America and Europe edges).

## Tearing it down

```sh
cd infra
pnpm exec cdk destroy ResonanceSite        # bucket contents are deleted with it
pnpm exec cdk destroy ResonanceGithubOidc
```

## Checking a deploy by hand

```sh
node scripts/smoke.mjs https://<your-site>      # needs a local build in packages/web/dist
```
