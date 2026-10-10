import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { GithubOidcStack } from "../lib/github-oidc-stack.js";
import { SiteStack } from "../lib/site-stack.js";

const env = { account: "123456789012", region: "us-east-1" };

describe("SiteStack", () => {
  const t = Template.fromStack(new SiteStack(new App(), "ResonanceSite", { env }));

  it("keeps the bucket private and encrypted", () => {
    t.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: Match.anyValue(),
    });
  });

  it("reads the bucket through Origin Access Control, not a public website", () => {
    t.resourceCountIs("AWS::CloudFront::OriginAccessControl", 1);
    t.hasResourceProperties("AWS::S3::BucketPolicy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Principal: { Service: "cloudfront.amazonaws.com" },
            Action: "s3:GetObject",
          }),
        ]),
      },
    });
  });

  it("serves HTTPS only, with the cross-origin isolation headers on every behaviour", () => {
    const template = t.toJSON() as {
      Resources: Record<string, { Type: string; Properties: Record<string, unknown> }>;
    };
    const dist = Object.values(template.Resources).find(
      (r) => r.Type === "AWS::CloudFront::Distribution",
    )!;
    const cfg = dist.Properties.DistributionConfig as {
      DefaultCacheBehavior: { ViewerProtocolPolicy: string; ResponseHeadersPolicyId: unknown };
      CacheBehaviors: {
        PathPattern: string;
        ViewerProtocolPolicy: string;
        ResponseHeadersPolicyId: unknown;
      }[];
    };
    const behaviours = [cfg.DefaultCacheBehavior, ...cfg.CacheBehaviors];
    expect(behaviours).toHaveLength(3);
    for (const b of behaviours) {
      expect(b.ViewerProtocolPolicy).toBe("redirect-to-https");
      expect(b.ResponseHeadersPolicyId).toBeDefined();
    }
    expect(cfg.CacheBehaviors.map((b) => b.PathPattern).sort()).toEqual(["/assets/*", "/audio/*"]);
  });

  it("sets COOP, COEP, CORP, CSP with wasm-unsafe-eval, and HSTS", () => {
    t.hasResourceProperties("AWS::CloudFront::ResponseHeadersPolicy", {
      ResponseHeadersPolicyConfig: {
        CustomHeadersConfig: {
          Items: Match.arrayWith([
            { Header: "Cross-Origin-Opener-Policy", Value: "same-origin", Override: true },
            { Header: "Cross-Origin-Embedder-Policy", Value: "require-corp", Override: true },
            { Header: "Cross-Origin-Resource-Policy", Value: "same-origin", Override: true },
          ]),
        },
        SecurityHeadersConfig: {
          ContentSecurityPolicy: {
            ContentSecurityPolicy: Match.stringLikeRegexp("script-src 'self' 'wasm-unsafe-eval'"),
            Override: true,
          },
          StrictTransportSecurity: Match.objectLike({ AccessControlMaxAgeSec: 63072000 }),
          ContentTypeOptions: { Override: true },
        },
      },
    });
  });

  it("caches hashed assets with the managed CachingOptimized policy", () => {
    const template = t.toJSON() as {
      Resources: Record<string, { Type: string; Properties: Record<string, unknown> }>;
    };
    const dist = Object.values(template.Resources).find(
      (r) => r.Type === "AWS::CloudFront::Distribution",
    )!;
    const cfg = dist.Properties.DistributionConfig as {
      CacheBehaviors: { PathPattern: string; CachePolicyId: string }[];
    };
    const assets = cfg.CacheBehaviors.find((b) => b.PathPattern === "/assets/*")!;
    expect(assets.CachePolicyId).toBe("658327ea-f89d-4fab-a63d-7e88639e58f6");
  });
});

describe("GithubOidcStack", () => {
  const t = Template.fromStack(
    new GithubOidcStack(new App(), "ResonanceGithubOidc", {
      env,
      repo: "owner/resonance",
      branch: "main",
    }),
  );

  it("trusts only the main branch of the repository", () => {
    t.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Action: "sts:AssumeRoleWithWebIdentity",
            Condition: {
              StringEquals: {
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                "token.actions.githubusercontent.com:sub":
                  "repo:owner/resonance:ref:refs/heads/main",
              },
            },
          }),
        ],
      },
    });
  });

  it("grants no wildcard actions", () => {
    const json = JSON.stringify(t.toJSON());
    expect(json).not.toMatch(/"Action":\s*"\*"/);
    expect(json).not.toMatch(/"s3:\*"/);
  });
});
