// One-time bootstrap (deployed by the owner with admin credentials): lets GitHub Actions on the
// main branch assume a deploy role through OIDC, with no long-lived AWS keys (PRD 12).

import { CfnOutput, Duration, Stack, type StackProps } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

export interface GithubOidcStackProps extends StackProps {
  /** "owner/repo" */
  repo: string;
  branch: string;
  /** ARN of an existing GitHub OIDC provider in the account, if there is one already. */
  existingProviderArn?: string;
}

export class GithubOidcStack extends Stack {
  constructor(scope: Construct, id: string, props: GithubOidcStackProps) {
    super(scope, id, props);

    const provider = props.existingProviderArn
      ? iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
          this,
          "Github",
          props.existingProviderArn,
        )
      : new iam.OpenIdConnectProvider(this, "Github", {
          url: "https://token.actions.githubusercontent.com",
          clientIds: ["sts.amazonaws.com"],
        });

    const role = new iam.Role(this, "DeployRole", {
      roleName: "resonance-github-deploy",
      description: `GitHub Actions deploys of ${props.repo}@${props.branch}`,
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": `repo:${props.repo}:ref:refs/heads/${props.branch}`,
        },
      }),
    });

    // `cdk deploy` works by assuming the CDK bootstrap roles; the deploy role needs nothing else
    // for CloudFormation. The bootstrap roles themselves are scoped by `cdk bootstrap`.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: [`arn:aws:iam::${this.account}:role/cdk-*`],
      }),
    );
    // Uploading the site and invalidating the CDN, limited to Resonance's resources by name.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:ListBucket", "s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        resources: ["arn:aws:s3:::resonancesite-*", "arn:aws:s3:::resonancesite-*/*"],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"],
        resources: [`arn:aws:cloudfront::${this.account}:distribution/*`],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["cloudformation:DescribeStacks"],
        resources: [`arn:aws:cloudformation:*:${this.account}:stack/ResonanceSite/*`],
      }),
    );

    new CfnOutput(this, "DeployRoleArn", { value: role.roleArn });
  }
}
