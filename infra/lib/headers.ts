// Maps the shared header file (packages/web/security-headers.json, also served by `vite preview`
// in e2e tests) onto a CloudFront response headers policy.

import { Duration } from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import headers from "../../packages/web/security-headers.json" with { type: "json" };

/** Headers that CloudFront models as "security headers"; everything else is custom. */
const SECURITY = new Set(["Content-Security-Policy", "X-Content-Type-Options", "Referrer-Policy"]);

export function securityHeaderValues(): Record<string, string> {
  const { "//": _comment, ...values } = headers as Record<string, string>;
  void _comment;
  return values;
}

export function responseHeadersPolicyProps(): cloudfront.ResponseHeadersPolicyProps {
  const values = securityHeaderValues();
  const referrer = values["Referrer-Policy"];
  if (referrer !== "strict-origin-when-cross-origin") {
    throw new Error(`map Referrer-Policy "${referrer}" to a CloudFront enum value`);
  }
  return {
    comment: "Resonance: cross-origin isolation (COOP/COEP) for SharedArrayBuffer, CSP, HSTS",
    securityHeadersBehavior: {
      contentSecurityPolicy: {
        contentSecurityPolicy: values["Content-Security-Policy"]!,
        override: true,
      },
      contentTypeOptions: { override: true },
      referrerPolicy: {
        referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
        override: true,
      },
      strictTransportSecurity: {
        accessControlMaxAge: Duration.days(730),
        includeSubdomains: true,
        override: true,
      },
      frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
    },
    customHeadersBehavior: {
      customHeaders: Object.entries(values)
        .filter(([name]) => !SECURITY.has(name))
        .map(([header, value]) => ({ header, value, override: true })),
    },
  };
}
