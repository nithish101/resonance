import { App } from "aws-cdk-lib";
import { GithubOidcStack } from "../lib/github-oidc-stack.js";
import { SiteStack } from "../lib/site-stack.js";

const app = new App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  // CloudFront is global; us-east-1 keeps ACM certificates and the stack in one region.
  region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
};

new SiteStack(app, "ResonanceSite", {
  env,
  domainName: app.node.tryGetContext("domainName"),
  certificateArn: app.node.tryGetContext("certificateArn"),
});

new GithubOidcStack(app, "ResonanceGithubOidc", {
  env,
  repo: app.node.tryGetContext("githubRepo"),
  branch: app.node.tryGetContext("githubBranch"),
  existingProviderArn: app.node.tryGetContext("githubOidcProviderArn"),
});
