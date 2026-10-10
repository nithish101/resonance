// Static hosting for Resonance (PRD 12): a private S3 bucket behind CloudFront with Origin
// Access Control, HTTPS only, and a response headers policy that makes every response
// cross-origin isolated. Files are uploaded by the CD workflow (scripts/deploy-assets.sh), which
// sets Content-Type (including application/wasm) and Cache-Control per path.

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import { responseHeadersPolicyProps } from "./headers.js";

export interface SiteStackProps extends StackProps {
  /** Optional custom domain; requires an ACM certificate in us-east-1. */
  domainName?: string;
  certificateArn?: string;
}

export class SiteStack extends Stack {
  readonly bucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: SiteStackProps = {}) {
    super(scope, id, props);

    this.bucket = new s3.Bucket(this, "Site", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      // Site content is reproducible from git; deleting the stack shouldn't strand a bucket.
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const headers = new cloudfront.ResponseHeadersPolicy(
      this,
      "Headers",
      responseHeadersPolicyProps(),
    );

    // index.html (and other unhashed paths) must revalidate so deploys show up immediately;
    // CloudFront honours the origin's Cache-Control, which the upload sets to no-cache.
    const revalidate = new cloudfront.CachePolicy(this, "Revalidate", {
      comment: "Respect origin Cache-Control (no-cache for index.html)",
      defaultTtl: Duration.seconds(0),
      minTtl: Duration.seconds(0),
      maxTtl: Duration.days(1),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    const origin = origins.S3BucketOrigin.withOriginAccessControl(this.bucket);
    const immutable = {
      origin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      responseHeadersPolicy: headers,
      compress: true,
    };

    const certificate = props.certificateArn
      ? acm.Certificate.fromCertificateArn(this, "Cert", props.certificateArn)
      : undefined;

    this.distribution = new cloudfront.Distribution(this, "Cdn", {
      comment: "Resonance real-time music visualizer",
      defaultRootObject: "index.html",
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      // A minimum TLS version only applies with a custom certificate; the default
      // *.cloudfront.net certificate uses CloudFront's own policy.
      ...(certificate && props.domainName
        ? {
            certificate,
            domainNames: [props.domainName],
            minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
          }
        : {}),
      defaultBehavior: {
        origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: revalidate,
        responseHeadersPolicy: headers,
        compress: true,
      },
      additionalBehaviors: {
        // Content-hashed build output: cached for a year at the edge and in browsers.
        "/assets/*": immutable,
        // Bundled tracks: large, rarely change; cached a week (set by the upload).
        "/audio/*": immutable,
      },
      errorResponses: [
        // A private bucket answers 403 for missing keys; serve a plain 404 instead.
        {
          httpStatus: 403,
          responseHttpStatus: 404,
          responsePagePath: "/index.html",
          ttl: Duration.minutes(5),
        },
      ],
    });

    new CfnOutput(this, "BucketName", { value: this.bucket.bucketName });
    new CfnOutput(this, "DistributionId", { value: this.distribution.distributionId });
    new CfnOutput(this, "SiteUrl", {
      value: `https://${props.domainName ?? this.distribution.distributionDomainName}`,
    });
  }
}
